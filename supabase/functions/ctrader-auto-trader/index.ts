import { decryptSecret, encryptSecret, json, requiredEnv, supabaseAdmin } from "../_shared/ctrader.ts";

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
          if(type===2126&&execution===7){finish(new Error("cTrader rejected the order"));return;}
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
  if(req.headers.get("Authorization")!==`Bearer ${requiredEnv("SUPABASE_SERVICE_ROLE_KEY")}`)return json({error:"Unauthorized scheduler request"},401);
  const admin=supabaseAdmin();const outcomes:Record<string,unknown>[]=[];
  const {data:settings,error}=await admin.from("bot_settings").select("user_id,environment,bot_enabled,symbol").eq("bot_enabled",true).eq("environment","demo").eq("symbol","XAUUSD");
  if(error)return json({error:"Could not load bot settings"},500);
  for(const setting of settings??[]){
    const userId=String(setting.user_id);const lock=crypto.randomUUID();
    try{
      const {data:locked,error:lockError}=await admin.rpc("acquire_ctrader_bot_lock",{p_user_id:userId,p_lock_token:lock,p_ttl_seconds:120});
      if(lockError||!locked){outcomes.push({userId,status:"skipped",reason:"Another bot scan is already running"});continue;}
      const {data:risk,error:riskError}=await admin.from("risk_settings").select("*").eq("user_id",userId).maybeSingle();
      if(riskError||!risk||risk.demo_only!==true||risk.trading_enabled!==true||
        !(num(risk.cash_risk_per_trade)>0)||!(num(risk.daily_loss_limit_cash)>0)||!(num(risk.weekly_loss_limit_cash)>0)){
        outcomes.push({userId,status:"blocked",reason:"Trading must be explicitly enabled and fixed trade, daily and weekly cash-risk limits must be configured"});continue;
      }
      const {data:account,error:accountError}=await admin.from("ctrader_accounts").select("ctrader_account_id,environment,connection_status,account_currency").eq("user_id",userId).eq("environment","demo").eq("connection_status","connected").maybeSingle();
      if(accountError||!account){outcomes.push({userId,status:"blocked",reason:"No connected Deriv demo account"});continue;}
      const {data:tokenRow,error:tokenError}=await admin.from("ctrader_oauth_tokens").select("user_id,access_token_ciphertext,refresh_token_ciphertext,token_expires_at").eq("user_id",userId).maybeSingle();
      if(tokenError||!tokenRow)throw new Error("Encrypted cTrader token unavailable");
      const market=await fetch(requiredEnv("SUPABASE_URL")+"/functions/v1/ctrader-market-data",{method:"POST",headers:{"content-type":"application/json","x-internal-bot-secret":requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),"Authorization":`Bearer ${requiredEnv("SUPABASE_SERVICE_ROLE_KEY")}`,"apikey":requiredEnv("SUPABASE_SERVICE_ROLE_KEY")},body:JSON.stringify({user_id:userId})});
      const data=await market.json();
      if(!market.ok||!data.connected)throw new Error(data.error??"Market data scan failed");
      const s=data.strategy;
      if(!data.dataReady||!data.quoteFresh||!data.candlesFresh||!data.sessionOpen||!s||s.status!=="candidate"||!["buy","sell"].includes(s.direction)){
        outcomes.push({userId,status:"no_trade",reason:(s?.reasons??["Market/session/strategy gates not satisfied"]).join(" ")});continue;
      }
      if((data.openPositions?.length??0)>0||(data.pendingOrders?.length??0)>0){outcomes.push({userId,status:"blocked",reason:"Existing broker position or pending order; one-position limit"});continue;}
      const now=new Date();
      const dayStart=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate())).toISOString();
      const weekStart=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()-((now.getUTCDay()+6)%7))).toISOString();
      const {data:daily,error:dailyError}=await admin.from("trade_history").select("profit,commission,swap").eq("user_id",userId).eq("status","closed").gte("closed_at",dayStart);
      const {data:weekly,error:weeklyError}=await admin.from("trade_history").select("profit,commission,swap").eq("user_id",userId).eq("status","closed").gte("closed_at",weekStart);
      const {data:lastClosed,error:lastError}=await admin.from("trade_history").select("profit,commission,swap").eq("user_id",userId).eq("status","closed").order("closed_at",{ascending:false}).limit(2);
      if(dailyError||weeklyError||lastError)throw new Error("Could not verify daily/weekly loss limits and consecutive losses");
      const net=(t:Record<string,unknown>)=>num(t.profit??0)-Math.abs(num(t.commission??0))-Math.abs(num(t.swap??0));
      const dailyLoss=Math.max(0,-(daily??[]).reduce((a,t)=>a+net(t),0));
      const weeklyLoss=Math.max(0,-(weekly??[]).reduce((a,t)=>a+net(t),0));
      const consecutiveLosses=(lastClosed??[]).length>=2&&(lastClosed??[]).every(t=>net(t)<0)?2:0;
      if(dailyLoss>=num(risk.daily_loss_limit_cash)||weeklyLoss>=num(risk.weekly_loss_limit_cash)||consecutiveLosses>=2){
        outcomes.push({userId,status:"blocked",reason:"Daily/weekly cash loss limit reached or two consecutive losing trades; bot paused"});continue;
      }
      // XAUUSD is quoted in USD. We only size automatically when the broker confirms
      // the account deposit asset is the same USD quote asset. Never guess FX conversion.
      if(!data.symbol?.quoteAssetId||!data.account?.depositAssetId||String(data.symbol.quoteAssetId)!==String(data.account.depositAssetId)){
        outcomes.push({userId,status:"blocked",reason:"Account currency conversion is not verified; order skipped rather than risking an incorrect cash amount"});continue;
      }
      const lotSize=num(data.symbol.lotSize),digits=num(data.symbol.digits),minVolume=num(data.symbol.minVolume),stepVolume=num(data.symbol.stepVolume),maxVolume=num(data.symbol.maxVolume);
      const measurementUnits=String(data.symbol.measurementUnits??"").trim().toUpperCase();
      const stopDistance=Math.abs(num(s.entry)-num(s.stop));const targetDistance=Math.abs(num(s.target)-num(s.entry));
      
      const cashRisk=num(risk.cash_risk_per_trade);
      if(!(lotSize>0&&digits>=0&&minVolume>0&&stepVolume>0&&maxVolume>=minVolume&&stopDistance>0&&targetDistance>=stopDistance*2&&Number(data.symbol.tradingMode)===0&&measurementUnits==="OZ")){
        outcomes.push({userId,status:"blocked",reason:"Broker contract or structural stop/target data is invalid"});continue;
      }
      // cTrader volume is hundredths of the symbol base unit. With XAUUSD\n      // measurementUnits=OZ and USD quote/deposit assets matched, one unit is\n      // one troy ounce: a $1 stop distance risks $1 per unit. Refuse any other unit.
      const rawProtocolVolume=cashRisk/(stopDistance*0.01);
      const volume=Math.floor(Math.min(rawProtocolVolume,maxVolume)/stepVolume)*stepVolume;
      const estimatedRisk=(volume/100)*stopDistance;
      if(volume<minVolume||estimatedRisk>cashRisk+0.000001){outcomes.push({userId,status:"blocked",reason:"Broker minimum/step volume would exceed the fixed cash-risk cap"});continue;}
      const token=await freshToken(admin,tokenRow);const accountId=num(account.ctrader_account_id);
      const ws=new WebSocket("wss://demo.ctraderapi.com:5036");
      await new Promise<void>((resolve,reject)=>{const t=setTimeout(()=>reject(new Error("cTrader demo connection timeout")),10000);ws.addEventListener("open",()=>{clearTimeout(t);resolve();},{once:true});ws.addEventListener("error",()=>{clearTimeout(t);reject(new Error("cTrader demo connection failed"));},{once:true});});
      try{
        await ctraderRequest(ws,2100,{clientId:requiredEnv("CTRADER_CLIENT_ID"),clientSecret:requiredEnv("CTRADER_CLIENT_SECRET")},2101);
        const auth=await ctraderRequest(ws,2102,{ctidTraderAccountId:accountId,accessToken:token},2103);
        if(String(auth.ctidTraderAccountId??"")!==String(accountId))throw new Error("Broker account identity mismatch");
        const rec=await ctraderRequest(ws,2124,{ctidTraderAccountId:accountId,returnProtectionOrders:false},2125);
        const reconciledPositions=Array.isArray(rec.position)?rec.position:[];const reconciledOrders=Array.isArray(rec.order)?rec.order:[];
        if(reconciledPositions.length>0||reconciledOrders.length>0)throw new Error("A broker position/order appeared during the scan; refusing duplicate entry");
        const relativeSL=Math.round(stopDistance*100000),relativeTP=Math.round(targetDistance*100000);
        if(!(relativeSL>0&&relativeTP>=relativeSL*2))throw new Error("Invalid relative protection distances");
        const orderId=crypto.randomUUID();
        const eventPromise=waitFor(ws,2126,orderId,20000);
        ws.send(JSON.stringify({payloadType:2106,clientMsgId:orderId,payload:{
          ctidTraderAccountId:accountId,symbolId:num(data.symbol.symbolId),orderType:1,
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
              ctidTraderAccountId:accountId,positionId:num(position.positionId),volume:closeVolume
            }}));
            await closePromise;
            const afterClose=await ctraderRequest(ws,2124,{ctidTraderAccountId:accountId,returnProtectionOrders:false},2125);
            const remains=((afterClose.position??[]) as Record<string,unknown>[]).some(p=>String(p.positionId)===String(position.positionId));
            if(remains)throw new Error("CRITICAL: incomplete order fill could not be fully closed; broker inspection required");
            throw new Error("Order was not fully filled; any partial position was closed and verified.");
          }
          throw new Error("Order was not confirmed fully filled; no position was recorded.");
        }
        if(!position?.positionId)throw new Error("Broker fill event did not include a position ID");
        const verified=await ctraderRequest(ws,2124,{ctidTraderAccountId:accountId,returnProtectionOrders:false},2125);
        const opened=(verified.position??[]) as Record<string,unknown>[];
        const live=opened.find(p=>String(p.positionId)===String(position.positionId));
        if(!live||!num(live.stopLoss)||!num(live.takeProfit)){
          const closeId=crypto.randomUUID();const closePromise=waitFor(ws,2126,closeId,15000);
          ws.send(JSON.stringify({payloadType:2111,clientMsgId:closeId,payload:{ctidTraderAccountId:accountId,positionId:num(position.positionId),volume:num(live?.volume??position.volume??volume)}}));
          await closePromise;
          const afterClose=await ctraderRequest(ws,2124,{ctidTraderAccountId:accountId,returnProtectionOrders:false},2125);
          const stillOpen=((afterClose.position??[]) as Record<string,unknown>[]).some(p=>String(p.positionId)===String(position.positionId));
          if(stillOpen)throw new Error("CRITICAL: broker position opened without verified protection and emergency close was not confirmed");
          throw new Error("Broker position lacked verified SL/TP; emergency close confirmed and no trade was retained");
        }
        const {error:historyError}=await admin.from("trade_history").insert({
          user_id:userId,ctrader_account_id:String(accountId),broker_deal_id:String(position.positionId),
          symbol:"XAUUSD",side:s.direction,volume:volume/100,entry_price:num(position.price),stop_loss:num(live.stopLoss),
          take_profit:num(live.takeProfit),cash_risk_amount:estimatedRisk,account_currency:account.account_currency,
          strategy_score:num(s.score),is_demo:true,status:"open",opened_at:new Date().toISOString()
        });
        if(historyError)throw historyError;
        outcomes.push({userId,status:"filled",positionId:String(position.positionId),volume:volume/100,estimatedCashRisk:estimatedRisk});
      }finally{try{ws.close(1000,"Bot scan complete");}catch{/* closed */}}
    }catch(e){
      const message=e instanceof Error?e.message:"Unknown bot execution error";
      await admin.from("ctrader_bot_runs").insert({user_id:userId,ctrader_account_id:"unknown",environment:"demo",symbol:"XAUUSD",status:"failed",reason:message,details:{}});
      outcomes.push({userId,status:"failed",reason:message});
    }finally{
      await admin.rpc("release_ctrader_bot_lock",{p_user_id:userId,p_lock_token:lock});
    }
  }
  return json({ok:true,processed:outcomes.length,outcomes});
});
