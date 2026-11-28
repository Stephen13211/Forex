import { decryptSecret, encryptSecret, json, requiredEnv, supabaseAdmin } from "../_shared/ctrader.ts";
import { estimateXauUsdRoundTurnCommission } from "../_shared/broker-risk.ts";

type Msg={payloadType?:number;payload?:Record<string,unknown>;clientMsgId?:string};
function waitFor(ws:WebSocket,type:number,id:string,timeout=15000):Promise<Msg>{
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>finish(new Error("cTrader response timeout")),timeout);
    const cleanup=()=>{clearTimeout(timer);ws.removeEventListener("message",onMessage);ws.removeEventListener("error",onError);ws.removeEventListener("close",onClose);};
    const finish=(e?:Error,m?:Msg)=>{cleanup();e?reject(e):resolve(m!);};
    const onMessage=async(ev:MessageEvent)=>{
      try{
        const raw=typeof ev.data==="string"?ev.data:ev.data instanceof Blob?await ev.data.text():new TextDecoder().decode(ev.data);
        const m=JSON.parse(raw) as Msg;
        if(m.payloadType===2142||m.payloadType===2132){finish(new Error("cTrader rejected the order/request: "+JSON.stringify(m.payload??{})));return;}
        if(m.payloadType===type&&(!m.clientMsgId||m.clientMsgId===id)){
          const execution=Number(m.payload?.executionType??0);
          if(type===2126&&execution===2)return;
          if(type===2126&&(execution===1||execution===7)){finish(new Error("cTrader rejected the order: "+JSON.stringify(m.payload??{})));return;}
          finish(undefined,m);
        }
      }catch(e){finish(e instanceof Error?e:new Error("Invalid cTrader response"));}
    };
    const onError=()=>finish(new Error("cTrader WebSocket error"));
    const onClose=()=>finish(new Error("cTrader WebSocket closed"));
    ws.addEventListener("message",onMessage);ws.addEventListener("error",onError);ws.addEventListener("close",onClose);
  });
}
async function ctraderRequest(ws:WebSocket,type:number,payload:Record<string,unknown>,responseType:number){
  const id=crypto.randomUUID();const p=waitFor(ws,responseType,id);ws.send(JSON.stringify({payloadType:type,payload,clientMsgId:id}));return (await p).payload??{};
}
async function freshToken(admin:ReturnType<typeof supabaseAdmin>,row:Record<string,unknown>){
  let token=await decryptSecret(String(row.access_token_ciphertext));
  if(Date.parse(String(row.token_expires_at))>Date.now()+120000)return token;
  const refresh=await decryptSecret(String(row.refresh_token_ciphertext));
  const res=await fetch("https://openapi.ctrader.com/apps/token",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams({grant_type:"refresh_token",refresh_token:refresh,client_id:requiredEnv("CTRADER_CLIENT_ID"),client_secret:requiredEnv("CTRADER_CLIENT_SECRET")})});
  const p=await res.json();
  if(!res.ok||!p.accessToken||!p.refreshToken||!p.expiresIn)throw new Error("cTrader token refresh failed");
  token=String(p.accessToken);
  const {error}=await admin.from("ctrader_oauth_tokens").update({access_token_ciphertext:await encryptSecret(token),refresh_token_ciphertext:await encryptSecret(String(p.refreshToken)),token_expires_at:new Date(Date.now()+Number(p.expiresIn)*1000).toISOString(),updated_at:new Date().toISOString()}).eq("user_id",String(row.user_id));
  if(error)throw error;return token;
}
const num=(v:unknown)=>Number(v);
Deno.serve(async(req)=>{
  if(req.method!=="POST")return json({error:"POST required"},405);
  const presented=(req.headers.get("Authorization")??"").replace(/^Bearer\s+/i,"");
  const acceptedSecrets=[Deno.env.get("GOLD_HUNTER_SCHEDULER_SECRET"),Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")].filter((v):v is string=>!!v);
  if(!presented||!acceptedSecrets.includes(presented))return json({error:"Unauthorized scheduler request"},401);
  const admin=supabaseAdmin();const outcomes:Record<string,unknown>[]=[];
  const {data:settings,error}=await admin.from("bot_settings").select("user_id,environment,bot_enabled,symbol").eq("bot_enabled",true).eq("environment","demo").eq("symbol","XAUUSD");
  if(error)return json({error:"Could not load bot settings"},500);
  for(const setting of settings??[]){
    const userId=String(setting.user_id);const lock=crypto.randomUUID();
    let accountId="unknown";
    const note=async(status:"blocked"|"no_trade"|"filled",reason:string,extra:Record<string,unknown>={})=>{
      outcomes.push({userId,status,reason,...extra});
      try{await admin.from("ctrader_bot_runs").insert({user_id:userId,ctrader_account_id:accountId,environment:"demo",symbol:"XAUUSD",status,reason,details:extra,finished_at:new Date().toISOString()});}catch{/* audit logging must not break execution */}
    };
    // One evolving audit row per genuine M15 opportunity, rather than one row per minute.
    const noteOpportunity=async(status:"blocked"|"no_trade",reason:string,opportunityTime:string,extra:Record<string,unknown>={})=>{
      const details={...extra,opportunityTime};
      outcomes.push({userId,status,reason,...details});
      try{
        const {data:existing}=await admin.from("ctrader_bot_runs")
          .select("id,details").eq("user_id",userId).eq("symbol","XAUUSD")
          .in("status",["no_trade","blocked"]).gte("started_at",opportunityTime)
          .order("started_at",{ascending:false}).limit(20);
        const prior=(existing??[]).find(row=>String(row.details?.opportunityTime??"")===opportunityTime);
        if(prior){
          await admin.from("ctrader_bot_runs").update({status,reason,details,finished_at:new Date().toISOString()}).eq("id",prior.id);
        }else{
          await admin.from("ctrader_bot_runs").insert({user_id:userId,ctrader_account_id:accountId,environment:"demo",symbol:"XAUUSD",status,reason,details,started_at:opportunityTime,finished_at:new Date().toISOString()});
        }
      }catch{/* audit logging must not break execution */}
    };
    try{
      const {data:locked,error:lockError}=await admin.rpc("acquire_ctrader_bot_lock",{p_user_id:userId,p_lock_token:lock,p_ttl_seconds:120});
      if(lockError||!locked){outcomes.push({userId,status:"skipped",reason:"Another bot scan is already running"});continue;}
      const {data:risk,error:riskError}=await admin.from("risk_settings").select("*").eq("user_id",userId).maybeSingle();
      if(riskError||!risk||risk.demo_only!==true||risk.trading_enabled!==true||!(num(risk.lot_size)>0)){
        outcomes.push({userId,status:"blocked",reason:"DEMO trading settings are not ready"});continue;
      }
      const {data:account,error:accountError}=await admin.from("ctrader_accounts").select("ctrader_account_id,environment,connection_status,account_currency").eq("user_id",userId).eq("environment","demo").eq("connection_status","connected").maybeSingle();
      if(accountError||!account){outcomes.push({userId,status:"blocked",reason:"No connected Deriv demo account"});continue;}
      accountId=String(account.ctrader_account_id);
      const brokerCurrency=String(account.account_currency??"").trim().toUpperCase();
      const configuredCurrency=String(risk.account_currency??"").trim().toUpperCase();
      if(!/^[A-Z]{3,8}$/.test(brokerCurrency)||configuredCurrency!==brokerCurrency){
        outcomes.push({userId,status:"blocked",reason:"Broker deposit currency and risk settings are not yet verified"});continue;
      }
      const {data:tokenRow,error:tokenError}=await admin.from("ctrader_oauth_tokens").select("user_id,access_token_ciphertext,refresh_token_ciphertext,token_expires_at").eq("user_id",userId).maybeSingle();
      if(tokenError||!tokenRow)throw new Error("Encrypted cTrader token unavailable");
      const market=await fetch(requiredEnv("SUPABASE_URL")+"/functions/v1/ctrader-market-data",{method:"POST",headers:{"content-type":"application/json","x-internal-bot-secret":requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),"Authorization":`Bearer ${requiredEnv("SUPABASE_SERVICE_ROLE_KEY")}`,"apikey":requiredEnv("SUPABASE_SERVICE_ROLE_KEY")},body:JSON.stringify({user_id:userId})});
      const data=await market.json();
      if(!market.ok||!data.connected)throw new Error(data.error??"Market data scan failed");
      const s=data.strategy;
      // Routine scans and early strategy failures are deliberately silent.
      // A log is created only after the strategy has identified a real M15 pullback
      // worth tracking, or when a complete candidate reaches an external safety gate.
      if(data.dataReady!==true||data.quoteFresh!==true||data.candlesFresh!==true||!s){
        outcomes.push({userId,status:"scan_only",reason:"No reliable, complete setup evaluation this cycle"});
        continue;
      }
      const opportunityStage=["pullback","sweep","M15_break","confirmed"].includes(String(s.setup));
      const latestM15=data.candles?.m15?.at(-1);
      if(s.status!=="candidate"&&!opportunityStage){
        outcomes.push({userId,status:"scan_only",reason:"No qualified M15 opportunity"});
        continue;
      }
      if(!latestM15?.time){
        outcomes.push({userId,status:"scan_only",reason:"No completed M15 candle timestamp for opportunity tracking"});
        continue;
      }
      const opportunityTime=new Date(Number(latestM15.time)).toISOString();
      const opportunityDetails={
        direction:s.direction,
        setup:s.setup,
        confirmation:s.confirmation,
        strategyScore:s.score,
        estimatedEntry:s.entry,
        estimatedStop:s.stop,
        estimatedTarget:s.target,
        dataQuality:data.dataQuality??null,
        h4:s.h4,
        h1:s.h1
      };
      if(s.status!=="candidate"||!["buy","sell"].includes(s.direction)){
        await noteOpportunity("no_trade",(s.reasons??["Qualified M15 opportunity did not complete all entry confirmations."]).join(" "),opportunityTime,opportunityDetails);
        continue;
      }
      // High-impact USD calendar protection is checked only for a genuine candidate.
      if(data.newsProtection?.status!=="clear"){
        await noteOpportunity("blocked","High-impact USD news protection is not verified clear; no order is allowed.",opportunityTime,{...opportunityDetails,newsProtection:data.newsProtection??null});
        continue;
      }
      if(data.sessionOpen!==true){
        await noteOpportunity("blocked","Outside the configured London and New York trading sessions.",opportunityTime,opportunityDetails);
        continue;
      }
      if((data.openPositions?.length??0)>0||(data.pendingOrders?.length??0)>0){await noteOpportunity("blocked","Existing broker position or pending order; one-position limit.",opportunityTime,opportunityDetails);continue;}
      const now=new Date();
      // Daily/weekly risk periods follow the user's configured South African timezone.
      const johannesburgNow=new Date(now.getTime()+2*60*60*1000);
      const localMidnightUtc=Date.UTC(johannesburgNow.getUTCFullYear(),johannesburgNow.getUTCMonth(),johannesburgNow.getUTCDate())-2*60*60*1000;
      const dayStart=new Date(localMidnightUtc).toISOString();
      const {data:lastClosed,error:lastError}=await admin.from("trade_history").select("profit,commission,swap").eq("user_id",userId).eq("status","closed").gte("closed_at",dayStart).order("closed_at",{ascending:false}).limit(3);
      if(lastError)throw new Error("Could not verify the consecutive-loss safety pause");
      const net=(t:Record<string,unknown>)=>num(t.profit??0)-Math.abs(num(t.commission??0))-Math.abs(num(t.swap??0));
      // Keep a pause after three consecutive losses today; daily/weekly cash caps are removed.
      const consecutiveLosses=(lastClosed??[]).length>=3&&(lastClosed??[]).every(t=>net(t)<0)?3:0;
      if(consecutiveLosses>=3){
        await noteOpportunity("blocked","Three consecutive losing trades today; trading paused until the next South African day.",opportunityTime,opportunityDetails);continue;
      }
      // XAUUSD is quoted in USD. We only size automatically when the broker confirms
      // the account deposit asset is the same USD quote asset. Never guess FX conversion.
      if(!data.symbol?.quoteAssetId||!data.account?.depositAssetId||
        String(data.symbol.quoteAssetId)!==String(data.account.depositAssetId)||
        String(data.account?.currency??"").toUpperCase()!==brokerCurrency){
        await noteOpportunity("blocked","XAUUSD quote currency and verified account deposit currency do not match; no unverified FX conversion is allowed.",opportunityTime,opportunityDetails);continue;
      }
      const lotSize=num(data.symbol.lotSize),digits=num(data.symbol.digits),minVolume=num(data.symbol.minVolume),stepVolume=num(data.symbol.stepVolume),maxVolume=num(data.symbol.maxVolume);
      const measurementUnits=String(data.symbol.measurementUnits??"").trim().toUpperCase();
      const executableEntry=s.direction==="buy"?num(data.quote?.ask):num(data.quote?.bid);
      const structuralStop=num(s.stop),structuralTarget=num(s.target);
      const stopDistance=s.direction==="buy"?executableEntry-structuralStop:structuralStop-executableEntry;
      const targetDistance=s.direction==="buy"?structuralTarget-executableEntry:executableEntry-structuralTarget;
      
      const selectedLots=num(risk.lot_size);
      if(!(lotSize>0&&digits>=0&&minVolume>0&&stepVolume>0&&maxVolume>=minVolume&&stopDistance>0&&targetDistance>=stopDistance*2&&Number(data.symbol.tradingMode)===0&&measurementUnits.includes("OZ")&&selectedLots>0)){
        await noteOpportunity("blocked","Broker contract, selected lot size or structural stop/target data is invalid.",opportunityTime,opportunityDetails);continue;
      }
      // Convert the user's selected lots to cTrader protocol volume. Never silently
      // resize the user's choice: reject values outside broker limits or off its step.
      const rawVolume=selectedLots*lotSize;
      const volume=Math.round(rawVolume/stepVolume)*stepVolume;
      if(!(Number.isFinite(volume)&&volume>=minVolume&&volume<=maxVolume&&Math.abs(volume-rawVolume)<=Math.max(1e-6,stepVolume*1e-6))){
        await noteOpportunity("blocked","Selected lot size does not fit this broker's permitted volume range/step.",opportunityTime,{...opportunityDetails,selectedLots,minVolume,maxVolume,stepVolume});continue;
      }
      const commissionEstimate=estimateXauUsdRoundTurnCommission({
        volumeProtocol:volume,entryPrice:Math.max(executableEntry,structuralStop),lotSizeProtocol:lotSize,
        accountCurrency:brokerCurrency,quoteCurrency:brokerCurrency,
        commissionType:data.symbol.commissionType==null?null:num(data.symbol.commissionType),
        preciseTradingCommissionRate:data.symbol.preciseTradingCommissionRate==null?null:num(data.symbol.preciseTradingCommissionRate),
        preciseMinCommission:data.symbol.preciseMinCommission==null?null:num(data.symbol.preciseMinCommission),
        minCommissionType:data.symbol.minCommissionType==null?null:num(data.symbol.minCommissionType),
        minCommissionAsset:data.symbol.minCommissionAsset==null?null:String(data.symbol.minCommissionAsset)
      });
      if(!commissionEstimate.ok){await noteOpportunity("blocked",commissionEstimate.reason,opportunityTime,opportunityDetails);continue;}
      const estimatedCashRisk=stopDistance*(volume/100)+commissionEstimate.roundTurn;
      const token=await freshToken(admin,tokenRow);const brokerAccountId=num(account.ctrader_account_id);
      const ws=new WebSocket("wss://demo.ctraderapi.com:5036");
      await new Promise<void>((resolve,reject)=>{const t=setTimeout(()=>reject(new Error("cTrader demo connection timeout")),10000);ws.addEventListener("open",()=>{clearTimeout(t);resolve();},{once:true});ws.addEventListener("error",()=>{clearTimeout(t);reject(new Error("cTrader demo connection failed"));},{once:true});});
      try{
        await ctraderRequest(ws,2100,{clientId:requiredEnv("CTRADER_CLIENT_ID"),clientSecret:requiredEnv("CTRADER_CLIENT_SECRET")},2101);
        const auth=await ctraderRequest(ws,2102,{ctidTraderAccountId:brokerAccountId,accessToken:token},2103);
        if(String(auth.ctidTraderAccountId??"")!==String(brokerAccountId))throw new Error("Broker account identity mismatch");
        const rec=await ctraderRequest(ws,2124,{ctidTraderAccountId:brokerAccountId,returnProtectionOrders:false},2125);
        const reconciledPositions=Array.isArray(rec.position)?rec.position:[];const reconciledOrders=Array.isArray(rec.order)?rec.order:[];
        if(reconciledPositions.length>0||reconciledOrders.length>0)throw new Error("A broker position/order appeared during the scan; refusing duplicate entry");
        const relativeSL=Math.round(stopDistance*100000),relativeTP=Math.round(targetDistance*100000);
        if(!(relativeSL>0&&relativeTP>=relativeSL*2))throw new Error("Invalid relative protection distances");
        const orderId=crypto.randomUUID();
        const eventPromise=waitFor(ws,2126,orderId,20000);
        ws.send(JSON.stringify({payloadType:2106,clientMsgId:orderId,payload:{
          ctidTraderAccountId:brokerAccountId,symbolId:num(data.symbol.symbolId),orderType:1,
          tradeSide:s.direction==="buy"?1:2,volume,relativeStopLoss:relativeSL,relativeTakeProfit:relativeTP,
          label:"GoldHunterAI-Demo",timeInForce:4
        }}));
        const event=await eventPromise;const ep=event.payload??{};
        const execution=Number(ep.executionType??0);
        const position=ep.position as Record<string,unknown>|undefined;
        if(execution!==3){
          // FOK should prevent partial fills, but never leave a partial broker position unmanaged.
          if(position?.positionId){
            const tradeData=(position.tradeData??{}) as Record<string,unknown>;
            const closeVolume=num(tradeData.volume??position.volume??0);
            if(!(closeVolume>0))throw new Error("CRITICAL: non-filled order event included a position but no verifiable volume; manual broker inspection required");
            const closeId=crypto.randomUUID();
            const closePromise=waitFor(ws,2126,closeId,20000);
            ws.send(JSON.stringify({payloadType:2111,clientMsgId:closeId,payload:{
              ctidTraderAccountId:brokerAccountId,positionId:num(position.positionId),volume:closeVolume
            }}));
            await closePromise;
            const afterClose=await ctraderRequest(ws,2124,{ctidTraderAccountId:brokerAccountId,returnProtectionOrders:false},2125);
            const remains=((afterClose.position??[]) as Record<string,unknown>[]).some(p=>String(p.positionId)===String(position.positionId));
            if(remains)throw new Error("CRITICAL: incomplete order fill could not be fully closed; broker inspection required");
            throw new Error("Order was not fully filled; any partial position was closed and verified.");
          }
          throw new Error("Order was not confirmed fully filled; no position was recorded.");
        }
        if(!position?.positionId)throw new Error("Broker fill event did not include a position ID");
        const verified=await ctraderRequest(ws,2124,{ctidTraderAccountId:brokerAccountId,returnProtectionOrders:false},2125);
        const opened=(verified.position??[]) as Record<string,unknown>[];
        const live=opened.find(p=>String(p.positionId)===String(position.positionId));
        if(!live||!num(live.stopLoss)||!num(live.takeProfit)){
          const closeId=crypto.randomUUID();const closePromise=waitFor(ws,2126,closeId,15000);
          ws.send(JSON.stringify({payloadType:2111,clientMsgId:closeId,payload:{ctidTraderAccountId:brokerAccountId,positionId:num(position.positionId),volume:num(live?.volume??position.volume??volume)}}));
          await closePromise;
          const afterClose=await ctraderRequest(ws,2124,{ctidTraderAccountId:brokerAccountId,returnProtectionOrders:false},2125);
          const stillOpen=((afterClose.position??[]) as Record<string,unknown>[]).some(p=>String(p.positionId)===String(position.positionId));
          if(stillOpen)throw new Error("CRITICAL: broker position opened without verified protection and emergency close was not confirmed");
          throw new Error("Broker position lacked verified SL/TP; emergency close confirmed and no trade was retained");
        }
        const actualVolume=num(((live.tradeData??{}) as Record<string,unknown>).volume??live.volume??volume);
        const actualEntry=num(live.price??position.price);
        const actualStop=num(live.stopLoss);
        const actualTarget=num(live.takeProfit);
        const actualSide=num(((live.tradeData??{}) as Record<string,unknown>).tradeSide??((position.tradeData??{}) as Record<string,unknown>).tradeSide);
        const actualStopDistance=s.direction==="buy"?actualEntry-actualStop:actualStop-actualEntry;
        const actualTargetDistance=s.direction==="buy"?actualTarget-actualEntry:actualEntry-actualTarget;
        const sideMatches=actualSide===(s.direction==="buy"?1:2);
        const protectionValid=actualStopDistance>0&&actualTargetDistance>=actualStopDistance*2&&sideMatches;
        const actualCommission=estimateXauUsdRoundTurnCommission({
          volumeProtocol:actualVolume,entryPrice:Math.max(actualEntry,actualStop),lotSizeProtocol:lotSize,
          accountCurrency:brokerCurrency,quoteCurrency:brokerCurrency,
          commissionType:data.symbol.commissionType==null?null:num(data.symbol.commissionType),
          preciseTradingCommissionRate:data.symbol.preciseTradingCommissionRate==null?null:num(data.symbol.preciseTradingCommissionRate),
          preciseMinCommission:data.symbol.preciseMinCommission==null?null:num(data.symbol.preciseMinCommission),
          minCommissionType:data.symbol.minCommissionType==null?null:num(data.symbol.minCommissionType),
          minCommissionAsset:data.symbol.minCommissionAsset==null?null:String(data.symbol.minCommissionAsset)
        });
        const priceRisk=actualStopDistance*(actualVolume/100);
        const actualCashRisk=actualCommission.ok?priceRisk+actualCommission.roundTurn:Number.POSITIVE_INFINITY;
        if(!(actualVolume>0&&actualEntry>0&&protectionValid&&Number.isFinite(actualCashRisk))){
          const closeId=crypto.randomUUID();const closePromise=waitFor(ws,2126,closeId,15000);
          ws.send(JSON.stringify({payloadType:2111,clientMsgId:closeId,payload:{ctidTraderAccountId:brokerAccountId,positionId:num(position.positionId),volume:actualVolume>0?actualVolume:volume}}));
          await closePromise;
          const afterClose=await ctraderRequest(ws,2124,{ctidTraderAccountId:brokerAccountId,returnProtectionOrders:false},2125);
          const stillOpen=((afterClose.position??[]) as Record<string,unknown>[]).some(p=>String(p.positionId)===String(position.positionId));
          if(stillOpen)throw new Error("CRITICAL: actual filled risk exceeded the cash cap and emergency close could not be verified");
          throw new Error("Actual fill price/volume made risk exceed the cash cap; position was closed and verified.");
        }
        const {error:historyError}=await admin.from("trade_history").insert({
          user_id:userId,ctrader_account_id:String(brokerAccountId),broker_deal_id:String(position.positionId),
          symbol:"XAUUSD",side:s.direction,volume:actualVolume/100,entry_price:actualEntry,stop_loss:actualStop,
          take_profit:num(live.takeProfit),cash_risk_amount:actualCashRisk,account_currency:brokerCurrency,
          strategy_score:num(s.score),is_demo:true,status:"open",opened_at:new Date().toISOString()
        });
        if(historyError)throw historyError;
        await note("filled","Demo order filled with broker-verified structural SL/TP",{positionId:String(position.positionId),volume:actualVolume/100,lots:actualVolume/lotSize,estimatedCashRisk,actualCashRisk});
      }finally{try{ws.close(1000,"Bot scan complete");}catch{/* closed */}}
    }catch(e){
      const message=e instanceof Error?e.message:"Unknown bot execution error";
      try{await admin.from("ctrader_bot_runs").insert({user_id:userId,ctrader_account_id:accountId,environment:"demo",symbol:"XAUUSD",status:"failed",reason:message,details:{},finished_at:new Date().toISOString()});}catch{/* audit logging must not break execution */}
      outcomes.push({userId,status:"failed",reason:message});
    }finally{
      await admin.rpc("release_ctrader_bot_lock",{p_user_id:userId,p_lock_token:lock});
    }
  }
  return json({ok:true,processed:outcomes.length,outcomes});
});
