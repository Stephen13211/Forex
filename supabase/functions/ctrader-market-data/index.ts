import { createClient } from "npm:@supabase/supabase-js@2";
import { decryptSecret, encryptSecret, json, requiredEnv, supabaseAdmin } from "../_shared/ctrader.ts";
import { evaluateGoldSetup } from "../_shared/strategy.ts";

type Message = { payloadType?: number; payload?: Record<string, unknown>; clientMsgId?: string };
type Candle = { time:number; open:number; high:number; low:number; close:number; volume?:number };

function waitFor(ws: WebSocket, expected: number, clientMsgId: string, timeoutMs = 15000): Promise<Message> {
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>finish(new Error(`cTrader timed out waiting for message ${expected}`)),timeoutMs);
    const cleanup=()=>{clearTimeout(timer);ws.removeEventListener("message",onMessage);ws.removeEventListener("error",onError);ws.removeEventListener("close",onClose);};
    const finish=(error?:Error,message?:Message)=>{cleanup();error?reject(error):resolve(message!);};
    const onMessage=async(event:MessageEvent)=>{
      try {
        const raw=typeof event.data==="string"?event.data:event.data instanceof Blob?await event.data.text():new TextDecoder().decode(event.data);
        const message=JSON.parse(raw) as Message;
        if(message.payloadType===2142){
          const p=message.payload??{};
          finish(new Error(`cTrader ${String(p.errorCode??"ERROR")}: ${String(p.description??"Request rejected")}`));
        } else if(message.payloadType===expected && (!message.clientMsgId || message.clientMsgId===clientMsgId)) finish(undefined,message);
      } catch(error){finish(error instanceof Error?error:new Error("Invalid cTrader response"));}
    };
    const onError=()=>finish(new Error("cTrader WebSocket connection failed"));
    const onClose=()=>finish(new Error("cTrader closed the WebSocket connection"));
    ws.addEventListener("message",onMessage);ws.addEventListener("error",onError);ws.addEventListener("close",onClose);
  });
}
async function request(ws:WebSocket,type:number,payload:Record<string,unknown>,expected:number){
  const clientMsgId=crypto.randomUUID();
  const response=waitFor(ws,expected,clientMsgId);
  ws.send(JSON.stringify({payloadType:type,payload,clientMsgId}));
  return (await response).payload??{};
}
async function accessToken(admin:ReturnType<typeof supabaseAdmin>,row:Record<string,unknown>){
  let token=await decryptSecret(String(row.access_token_ciphertext));
  if(Date.parse(String(row.token_expires_at))>Date.now()+120000)return token;
  const refresh=await decryptSecret(String(row.refresh_token_ciphertext));
  const response=await fetch("https://openapi.ctrader.com/apps/token",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams({
    grant_type:"refresh_token",refresh_token:refresh,client_id:requiredEnv("CTRADER_CLIENT_ID"),client_secret:requiredEnv("CTRADER_CLIENT_SECRET")
  })});
  const payload=await response.json();
  if(!response.ok||!payload.accessToken||!payload.refreshToken||!payload.expiresIn)throw new Error("cTrader refresh failed. Re-authorise the demo account.");
  token=String(payload.accessToken);
  const {error}=await admin.from("ctrader_oauth_tokens").update({
    access_token_ciphertext:await encryptSecret(token),refresh_token_ciphertext:await encryptSecret(String(payload.refreshToken)),
    token_expires_at:new Date(Date.now()+Number(payload.expiresIn)*1000).toISOString(),updated_at:new Date().toISOString()
  }).eq("user_id",String(row.user_id));
  if(error)throw error;
  return token;
}
function isSessionOpen(now:Date):boolean{
  const inWindow=(timeZone:string,startHour:number,endHour:number)=>{
    const parts=new Intl.DateTimeFormat("en-US",{timeZone,weekday:"short",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(now);
    const values=Object.fromEntries(parts.map(p=>[p.type,p.value]));
    if(values.weekday==="Sat"||values.weekday==="Sun")return false;
    const minute=Number(values.hour)*60+Number(values.minute);
    return minute>=startHour*60&&minute<endHour*60;
  };
  return inWindow("Europe/London",7,17)||inWindow("America/New_York",8,17);
}
function decodeBars(raw:unknown):Candle[]{
  if(!Array.isArray(raw))return [];
  return raw.map((item:any)=>({
    time:Number(item.utcTimestampInMinutes)*60000,
    low:Number(item.low)/100000,
    open:(Number(item.low)+Number(item.deltaOpen))/100000,
    close:(Number(item.low)+Number(item.deltaClose))/100000,
    high:(Number(item.low)+Number(item.deltaHigh))/100000,
    volume:Number(item.volume??0)
  })).filter(c=>[c.time,c.open,c.high,c.low,c.close].every(Number.isFinite)&&c.high>=Math.max(c.open,c.close,c.low)&&c.low<=Math.min(c.open,c.close,c.high))
    .sort((a,b)=>a.time-b.time);
}

async function getUsdNewsProtection(admin:any){
  const unknown={verified:false,status:"unknown",reason:"USD news calendar unavailable",activeEvents:[],checkedAt:new Date().toISOString()};
  try{
    const {data:cached,error:cacheError}=await admin.from("news_calendar_cache")
      .select("payload,fetched_at,provider_server_time").eq("cache_key","USD-high").maybeSingle();
    if(cacheError)return unknown;
    let payload=cached?.payload;
    const age=cached?.fetched_at?Date.now()-Date.parse(String(cached.fetched_at)):Number.POSITIVE_INFINITY;
    if(!payload||!Number.isFinite(age)||age>15*60*1000){
      const response=await fetch("https://showmytrades.com/api/public/calendar/v1?currency=USD&impact=high&days=2&format=json",{signal:AbortSignal.timeout(10000),headers:{"Accept":"application/json"}});
      if(!response.ok)return unknown;
      const fresh=await response.json();
      if(!Array.isArray(fresh?.events)||!Number.isFinite(Number(fresh?.server_time))||Number(fresh.server_time)<=0)return unknown;
      const providerTime=Number(fresh.server_time)*1000;
      if(Math.abs(Date.now()-providerTime)>20*60*1000)return unknown;
      const {error:saveError}=await admin.from("news_calendar_cache").upsert({
        cache_key:"USD-high",payload:fresh,fetched_at:new Date().toISOString(),
        provider_server_time:new Date(providerTime).toISOString(),updated_at:new Date().toISOString()
      },{onConflict:"cache_key"});
      if(saveError)return unknown;
      payload=fresh;
    }
    if(!Array.isArray(payload?.events)||!Number.isFinite(Number(payload?.server_time))||Math.abs(Date.now()-Number(payload.server_time)*1000)>20*60*1000)return unknown;
    const now=Number(payload.server_time);
    const events=payload.events.filter((event:any)=>event?.currency==="USD"&&event?.impact==="high"&&event?.status!=="cancelled");
    if(events.some((event:any)=>!Number.isFinite(Number(event.ts))||Number(event.ts)<=0))return unknown;
    const activeEvents=events.filter((event:any)=>Math.abs(Number(event.ts)-now)<=30*60).map((event:any)=>({
      title:String(event.title??"High-impact USD event"),time:String(event.time??""),status:String(event.status??"scheduled")
    }));
    return {verified:true,status:activeEvents.length?"blocked":"clear",reason:activeEvents.length?"Within 30 minutes of high-impact USD news":"No high-impact USD event within the 30-minute blackout window",activeEvents,checkedAt:new Date().toISOString(),provider:"ShowMyTrades"};
  }catch{return unknown;}
}
Deno.serve(async(req)=>{
  if(req.method!=="POST")return json({error:"POST required"},405);
  let ws:WebSocket|undefined;
  try{
    const admin=supabaseAdmin();
    const internalSecret=req.headers.get("x-internal-bot-secret");
    let userId:string;
    if(internalSecret && internalSecret===requiredEnv("SUPABASE_SERVICE_ROLE_KEY")){
      const body=await req.json().catch(()=>({}));
      if(typeof body.user_id!=="string")return json({error:"user_id required"},400);
      userId=body.user_id;
    }else{
      const jwt=(req.headers.get("Authorization")??"").replace(/^Bearer\\s+/i,"");
      if(!jwt)return json({error:"Sign in first"},401);
      const userClient=createClient(requiredEnv("SUPABASE_URL"),requiredEnv("SUPABASE_ANON_KEY"),{global:{headers:{Authorization:`Bearer ${jwt}`}},auth:{persistSession:false,autoRefreshToken:false}});
      const {data:{user},error:authError}=await userClient.auth.getUser(jwt);
      if(authError||!user)return json({error:"Invalid or expired Supabase session"},401);
      userId=user.id;
    }
    const {data:account,error:accountError}=await admin.from("ctrader_accounts").select("ctrader_account_id,environment,connection_status").eq("user_id",userId).eq("environment","demo").eq("connection_status","connected").maybeSingle();
    if(accountError)throw accountError;
    if(!account)return json({error:"No authenticated Deriv DEMO account is linked. Connect cTrader first."},409);
    const {data:tokenRow,error:tokenError}=await admin.from("ctrader_oauth_tokens").select("user_id,access_token_ciphertext,refresh_token_ciphertext,token_expires_at").eq("user_id",userId).maybeSingle();
    if(tokenError||!tokenRow)throw new Error("Secure cTrader authorisation token is missing. Reconnect cTrader.");
    const token=await accessToken(admin,tokenRow);
    const accountId=String(account.ctrader_account_id);
    ws=new WebSocket("wss://demo.ctraderapi.com:5036");
    await new Promise<void>((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error("Timed out connecting to the cTrader DEMO gateway")),10000);
      ws!.addEventListener("open",()=>{clearTimeout(timer);resolve();},{once:true});
      ws!.addEventListener("error",()=>{clearTimeout(timer);reject(new Error("Could not connect to cTrader DEMO gateway"));},{once:true});
    });
    await request(ws,2100,{clientId:requiredEnv("CTRADER_CLIENT_ID"),clientSecret:requiredEnv("CTRADER_CLIENT_SECRET")},2101);
    const auth=await request(ws,2102,{ctidTraderAccountId:Number(accountId),accessToken:token},2103);
    if(String(auth.ctidTraderAccountId??"")!==accountId)throw new Error("cTrader account authentication returned a mismatched account ID.");
    const reconcile=await request(ws,2124,{ctidTraderAccountId:Number(accountId),returnProtectionOrders:false},2125);
    const openPositions=Array.isArray(reconcile.position)?reconcile.position:[];
    const pendingOrders=Array.isArray(reconcile.order)?reconcile.order:[];
    const traderResponse=await request(ws,2121,{ctidTraderAccountId:Number(accountId)},2122);
    const trader=(traderResponse.trader??{}) as Record<string,unknown>;
    // Reconcile locally recorded bot positions against broker close-deal records.
    // Loss-limit calculations must use broker-confirmed realised results, not stale local rows.
    const {data:localOpen,error:localOpenError}=await admin.from("trade_history")
      .select("id,broker_deal_id,volume,opened_at,cash_risk_amount")
      .eq("user_id",userId).eq("ctrader_account_id",accountId).eq("is_demo",true).eq("status","open");
    if(localOpenError)throw new Error("Could not load open demo trade records for broker reconciliation.");
    for(const local of localOpen??[]){
      const positionId=String(local.broker_deal_id??"");
      if(!positionId||openPositions.some((p:any)=>String(p.positionId)===positionId))continue;
      const openedAt=Date.parse(String(local.opened_at??""));
      if(!Number.isFinite(openedAt))continue;
      const dealResponse=await request(ws,2179,{
        ctidTraderAccountId:Number(accountId),positionId:Number(positionId),
        fromTimestamp:Math.max(0,openedAt-60000),toTimestamp:Date.now()
      },2180);
      const deals=Array.isArray(dealResponse.deal)?dealResponse.deal as Record<string,any>[]:[];
      const closeDeals=deals.filter(d=>d.closePositionDetail&&Number(d.dealStatus)===2);
      if(!closeDeals.length)continue;
      const closedVolume=closeDeals.reduce((sum,d)=>sum+Number(d.closePositionDetail.closedVolume??d.filledVolume??d.volume??0),0);
      const expectedVolume=Number(local.volume)*100;
      if(!(expectedVolume>0)||closedVolume+0.0001<expectedVolume)continue;
      const moneyAmount=(value:unknown,digits:unknown)=>Number(value??0)/Math.pow(10,Number(digits??trader.moneyDigits??2));
      const grossProfit=closeDeals.reduce((sum,d)=>sum+moneyAmount(d.closePositionDetail.grossProfit,d.closePositionDetail.moneyDigits??d.moneyDigits),0);
      const swap=closeDeals.reduce((sum,d)=>sum+Math.abs(moneyAmount(d.closePositionDetail.swap,d.closePositionDetail.moneyDigits??d.moneyDigits)),0);
      const commission=deals.reduce((sum,d)=>{
        const detail=d.closePositionDetail as Record<string,unknown>|undefined;
        const amount=detail?.commission??d.commission??0;
        return sum+Math.abs(moneyAmount(amount,detail?.moneyDigits??d.moneyDigits));
      },0);
      const exitWeight=closeDeals.reduce((sum,d)=>sum+Number(d.closePositionDetail.closedVolume??d.filledVolume??d.volume??0),0);
      const exitPrice=exitWeight>0?closeDeals.reduce((sum,d)=>{
        const weight=Number(d.closePositionDetail.closedVolume??d.filledVolume??d.volume??0);
        return sum+Number(d.closePositionDetail.entryPrice??0)*weight;
      },0)/exitWeight:null;
      const closedAt=Math.max(...closeDeals.map(d=>Number(d.executionTimestamp??0)));
      const netProfit=grossProfit-commission-swap;
      const cashRisk=Number(local.cash_risk_amount??0);
      const {error:closeUpdateError}=await admin.from("trade_history").update({
        status:"closed",profit:grossProfit,commission,swap,exit_price:exitPrice,
        closed_at:closedAt>0?new Date(closedAt).toISOString():new Date().toISOString(),
        r_multiple:cashRisk>0?netProfit/cashRisk:null
      }).eq("id",local.id).eq("status","open");
      if(closeUpdateError)throw new Error("Could not save broker-confirmed closed trade result.");
    }
    const symbolsResponse=await request(ws,2114,{ctidTraderAccountId:Number(accountId),includeArchivedSymbols:false},2115);
    const symbols=Array.isArray(symbolsResponse.symbol)?symbolsResponse.symbol as Record<string,unknown>[]:[];
    const symbol=symbols.find(s=>String(s.symbolName??"").toUpperCase()==="XAUUSD")
      ??symbols.find(s=>String(s.symbolName??"").toUpperCase().startsWith("XAUUSD"));
    if(!symbol?.symbolId)return json({error:"Deriv cTrader did not return an XAUUSD symbol. Available gold-like symbols are not substituted automatically.",availableSymbols:symbols.map(s=>s.symbolName).filter(Boolean).filter(n=>/XAU|GOLD/i.test(String(n)))});
    const symbolId=Number(symbol.symbolId);
    const detailResponse=await request(ws,2116,{ctidTraderAccountId:Number(accountId),symbolId:[symbolId]},2117);
    const detail=(Array.isArray(detailResponse.symbol)?detailResponse.symbol[0]:null) as Record<string,unknown>|null;
    if(!detail)throw new Error("cTrader did not return full XAUUSD contract details.");
    const now=Date.now();
    const spotEventPromise=waitFor(ws,2131,"",10000);
    await request(ws,2127,{ctidTraderAccountId:Number(accountId),symbolId:[symbolId],subscribeToSpotTimestamp:true},2128);
    const spotEvent=await spotEventPromise;
    const spotPayload=spotEvent.payload??{};
    const bid=Number(spotPayload.bid??0)/100000;
    const ask=Number(spotPayload.ask??0)/100000;
    const spotTimestamp=Number(spotPayload.timestamp??0);
    if(!(bid>0&&ask>=bid&&spotTimestamp>0))throw new Error("cTrader did not return a valid, timestamped XAUUSD bid/ask quote.");
    const periods=[{key:"h4",period:10,from:now-100*24*60*60*1000},{key:"h1",period:9,from:now-25*24*60*60*1000},{key:"m15",period:7,from:now-7*24*60*60*1000},{key:"m5",period:5,from:now-3*24*60*60*1000}] as const;
    const candles:Record<string,Candle[]>={};
    for(const p of periods){
      const bars=await request(ws,2137,{ctidTraderAccountId:Number(accountId),symbolId,period:p.period,fromTimestamp:p.from,toTimestamp:now,count:300},2138);
      const durationMs=({h4:240,h1:60,m15:15,m5:5} as const)[p.key]*60*1000;
      candles[p.key]=decodeBars(bars.trendbar).filter(c=>c.time+durationMs<=Date.now());
    }
    const moneyDigits=Number(trader.moneyDigits??2);
    const balance=Number(trader.balance??0)/Math.pow(10,moneyDigits);
    const barsReady=Object.values(candles).every(c=>c.length>=220);
    const freshWindows={h4:8*60*60*1000,h1:2*60*60*1000,m15:30*60*1000,m5:10*60*1000} as const;
    const candlesFresh=(Object.keys(candles) as (keyof typeof freshWindows)[]).every(key=>candles[key].length>0&&now-candles[key].at(-1)!.time<=freshWindows[key]);
    const quoteFresh=now-spotTimestamp<=120000&&now>=spotTimestamp;
    const sessionOpen=isSessionOpen(new Date(now));
    const dataReady=barsReady&&candlesFresh&&quoteFresh;
    const rawStrategy=dataReady?evaluateGoldSetup({h4:candles.h4,h1:candles.h1,m15:candles.m15,m5:candles.m5}):null;
    let strategy=rawStrategy;
    if(strategy&&((openPositions.length+pendingOrders.length)>0))strategy={...strategy,direction:"none",status:"no_trade",entry:null,stop:null,target:null,reasons:[...strategy.reasons,"An existing broker position or pending order blocks new entries."]};
    if(strategy&&strategy.direction!=="none"&&!sessionOpen)strategy={...strategy,direction:"none",status:"no_trade",entry:null,stop:null,target:null,reasons:[...strategy.reasons,"Outside the London and New York trading sessions."]};
    if(strategy&&strategy.direction!=="none"&&strategy.atrM15&&ask-bid>strategy.atrM15*0.1)strategy={...strategy,direction:"none",status:"no_trade",entry:null,stop:null,target:null,reasons:[...strategy.reasons,"Current XAUUSD spread exceeds 10% of M15 ATR."]};
    if(!candlesFresh)strategy=null;
    const newsProtection=await getUsdNewsProtection(admin);
    const result={
      connected:true,environment:"demo",accountId,newsProtection,symbol:{name:String(detail.symbolName??symbol.symbolName),symbolId,digits:detail.digits??null,pipPosition:detail.pipPosition??null,
        minVolume:detail.minVolume??null,stepVolume:detail.stepVolume??null,maxVolume:detail.maxVolume??null,lotSize:detail.lotSize??null,measurementUnits:detail.measurementUnits??null,
        tradingMode:detail.tradingMode??null,baseAssetId:detail.baseAssetId??null,quoteAssetId:detail.quoteAssetId??null,
        commission:detail.commission??null,commissionType:detail.commissionType??null,
        preciseTradingCommissionRate:detail.preciseTradingCommissionRate??null,
        minCommission:detail.minCommission??null,minCommissionType:detail.minCommissionType??null,
        minCommissionAsset:detail.minCommissionAsset??null,preciseMinCommission:detail.preciseMinCommission??null,
        pnlConversionFeeRate:detail.pnlConversionFeeRate??null},
      account:{balance,moneyDigits,leverage:trader.leverageInCents??null,depositAssetId:trader.depositAssetId??null},
      quote:{bid,ask,spread:ask-bid,timestamp:spotTimestamp},candles,strategy,openPositions,pendingOrders,candlesFresh,quoteFresh,sessionOpen,receivedAt:new Date().toISOString(),dataReady
    };
    await admin.from("ctrader_accounts").update({symbol_name:String(detail.symbolName??symbol.symbolName),last_synced_at:new Date().toISOString(),connection_status:"connected"}).eq("ctrader_account_id",accountId);
    return json(result);
  }catch(error){
    console.error("cTrader market data failed",error);
    return json({error:error instanceof Error?error.message:"Could not load cTrader market data."},502);
  }finally{try{ws?.close(1000,"Market data request complete");}catch{/* already closed */}}
});
