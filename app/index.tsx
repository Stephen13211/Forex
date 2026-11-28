import React, { useEffect, useState } from "react";
import { ScrollView, View, Text, StyleSheet, Pressable, Switch, TextInput, Linking } from "react-native";
import { supabase } from "../lib/supabase";
import { Ionicons } from "@expo/vector-icons";

const GOLD="#E9C451", BG="#0B0E10", PANEL="#151820", MUTED="#8791A4", WHITE="#F4F5F7";
type Tab="Home"|"Chart"|"Strategy"|"Risk"|"History"|"cTrader"|"Profile";
const tabs:Tab[]=["Home","Chart","Strategy","Risk","History","cTrader","Profile"];
const iconMap:any={Home:"grid",Chart:"candlestick",Strategy:"options",Risk:"shield-checkmark",History:"time",cTrader:"link",Profile:"person-circle"};
function Card({children}:{children:any}){return <View style={s.card}>{children}</View>}
function Heading({children}:{children:any}){return <Text style={s.heading}>{children}</Text>}
function Metric({label,value,sub}:{label:string;value:string;sub?:string}){return <View style={s.metric}><Text style={s.muted}>{label}</Text><Text style={s.metricValue}>{value}</Text>{sub?<Text style={s.muted}>{sub}</Text>:null}</View>}
function Row({label,value,detail}:{label:string;value:string;detail?:string}){return <View style={s.row}><View style={{flex:1}}><Text style={s.rowLabel}>{label}</Text>{detail?<Text style={s.muted}>{detail}</Text>:null}</View><Text style={s.gold}>{value}</Text></View>}
function Toggle({label,initial=false}:{label:string;initial?:boolean}){const [v,setV]=useState(initial);return <View style={s.row}><Text style={s.rowLabel}>{label}</Text><Switch value={v} onValueChange={setV} trackColor={{false:"#343A46",true:"#806A2D"}} thumbColor={v?GOLD:"#C7CBD2"}/></View>}

function AuthPanel(){
 const [session,setSession]=useState<any>(null),[email,setEmail]=useState(""),[password,setPassword]=useState(""),[mode,setMode]=useState<"signin"|"signup">("signin"),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
 useEffect(()=>{supabase.auth.getSession().then(({data})=>setSession(data.session));const {data:{subscription}}=supabase.auth.onAuthStateChange((_event,next)=>setSession(next));return ()=>subscription.unsubscribe();},[]);
 useEffect(()=>{if(!session?.user?.id)return;let active=true;(async()=>{const userId=session.user.id;const rows=await Promise.all([
  supabase.from("profiles").upsert({id:userId},{onConflict:"id"}),
  supabase.from("user_settings").upsert({user_id:userId},{onConflict:"user_id"}),
  supabase.from("risk_settings").upsert({user_id:userId},{onConflict:"user_id"}),
  supabase.from("bot_settings").upsert({user_id:userId},{onConflict:"user_id"})
 ]);const failure=rows.find(x=>x.error);if(active&&failure)setMessage("Signed in, but account setup needs attention: "+(failure.error?.message ?? "Unknown database error"));else if(active)setMessage("Account connected. Your private settings have been initialized.");})();return()=>{active=false;};},[session?.user?.id]);
 async function submit(){setBusy(true);setMessage("");const result=mode==="signin"?await supabase.auth.signInWithPassword({email:email.trim(),password}):await supabase.auth.signUp({email:email.trim(),password});setBusy(false);if(result.error)setMessage(result.error.message);else if(mode==="signup"&&!result.data.session)setMessage("Check your email to confirm your account, then sign in.");}
 async function reset(){if(!email.trim()){setMessage("Enter your email address first.");return;}const {error}=await supabase.auth.resetPasswordForEmail(email.trim());setMessage(error?error.message:"Password reset email requested. Check your inbox.");}
 if(session?.user)return <Card><Heading>Signed in</Heading><Text style={s.body}>{session.user.email}</Text><Text style={s.pill}>SUPABASE AUTH CONNECTED</Text>{message?<Text style={s.authMessage}>{message}</Text>:null}<Pressable onPress={()=>supabase.auth.signOut()} style={s.authButton}><Text style={s.authButtonText}>SIGN OUT</Text></Pressable></Card>;
 return <Card><Heading>{mode==="signin"?"Sign in to Gold Hunter AI":"Create your account"}</Heading><Text style={s.body}>Authentication is handled by Supabase. User data still requires database row-level security policies.</Text><TextInput value={email} onChangeText={setEmail} placeholder="Email address" placeholderTextColor={MUTED} autoCapitalize="none" keyboardType="email-address" style={s.authInput}/><TextInput value={password} onChangeText={setPassword} placeholder="Password (minimum 6 characters)" placeholderTextColor={MUTED} secureTextEntry style={s.authInput}/>{message?<Text style={s.authMessage}>{message}</Text>:null}<Pressable disabled={busy||!email.trim()||password.length<6} onPress={submit} style={[s.authButton,(busy||!email.trim()||password.length<6)&&{opacity:.45}]}><Text style={s.authButtonText}>{busy?"PLEASE WAIT":mode==="signin"?"SIGN IN":"CREATE ACCOUNT"}</Text></Pressable><Pressable onPress={()=>{setMode(mode==="signin"?"signup":"signin");setMessage("");}}><Text style={s.authLink}>{mode==="signin"?"New here? Create an account":"Already registered? Sign in"}</Text></Pressable>{mode==="signin"?<Pressable onPress={reset}><Text style={s.authLink}>Forgot password?</Text></Pressable>:null}</Card>;
}


async function getFunctionErrorMessage(error: any): Promise<string> {
 if (error?.context) {
  try {
   const response = typeof error.context.clone === "function" ? error.context.clone() : error.context;
   const payload = await response.json();
   if (payload?.error) return String(payload.error);
   if (payload?.message) return String(payload.message);
  } catch { /* response may not contain JSON */ }
 }
 return error?.message ?? "Unknown Supabase function error";
}

type AvailableCTraderAccount = { account_id: string; login: string | null; broker: string; environment: string };

function CTraderConnectPanel(){
 const [busy,setBusy]=useState(false),[message,setMessage]=useState("Connect your Deriv cTrader DEMO account. Only demo accounts from Deriv will be listed."),[accounts,setAccounts]=useState<AvailableCTraderAccount[]>([]),[connected,setConnected]=useState<AvailableCTraderAccount|null>(null);
 async function loadAccounts(){
  setBusy(true);setMessage("Securely checking the cTrader demo account list…");
  const {data,error}=await supabase.functions.invoke("ctrader-accounts",{body:{}});
  setBusy(false);
  if(error){setMessage("Account discovery failed: "+await getFunctionErrorMessage(error));return;}
  if(data?.error){setMessage(data.error);return;}
  const found=Array.isArray(data?.accounts)?data.accounts as AvailableCTraderAccount[]:[];
  setAccounts(found);
  setMessage(data?.message??(found.length?"Choose the Deriv demo account you want Gold Hunter AI to use.":"No eligible Deriv demo accounts were found."));
 }
 useEffect(()=>{
  const handle=(url:string)=>{if(url.includes("ctrader=connected")||url.includes("ctrader-connected")){setMessage("cTrader authorisation received. Retrieving your Deriv demo accounts…");void loadAccounts();}};
  Linking.getInitialURL().then(url=>{if(url)handle(url);});
  const sub=Linking.addEventListener("url",event=>handle(event.url));
  return()=>sub.remove();
 },[]);
 async function connect(){
  setBusy(true);setMessage("");
  const {data,error}=await supabase.functions.invoke("ctrader-oauth-start",{body:{}});
  setBusy(false);
  if(error){setMessage("cTrader authorisation could not start: "+await getFunctionErrorMessage(error));return;}
  if(!data?.authorization_url){setMessage(data?.error??"The authorisation URL was not returned.");return;}
  try{await Linking.openURL(data.authorization_url);setMessage("Sign in to cTrader and approve access for your Deriv DEMO account.");}
  catch{setMessage("Could not open the cTrader authorisation page on this device.");}
 }
 async function selectAccount(account:AvailableCTraderAccount){
  setBusy(true);setMessage("Authenticating the selected demo account with cTrader…");
  const {data,error}=await supabase.functions.invoke("ctrader-accounts",{body:{account_id:account.account_id}});
  setBusy(false);
  if(error){setMessage("Account authentication failed: "+await getFunctionErrorMessage(error));return;}
  if(data?.error){setMessage(data.error);return;}
  if(data?.connected){setConnected(account);setAccounts([]);setMessage("Deriv demo account authenticated and securely linked. Automated trading is still disabled while the market-data and risk engine are built and tested.");}
 }
 return <Card><Heading>Connect Deriv cTrader DEMO</Heading><Text style={s.body}>Each user authorises their own cTrader account. Gold Hunter AI retrieves the granted accounts securely on the backend; broker tokens and the app secret never enter the mobile app.</Text><Pressable disabled={busy} onPress={connect} style={[s.authButton,busy&&{opacity:.5}]}><Text style={s.authButtonText}>{busy?"PLEASE WAIT":"CONNECT CTRADER DEMO"}</Text></Pressable><Pressable disabled={busy} onPress={loadAccounts} style={[s.authButton,{backgroundColor:"#252B36",marginTop:9},busy&&{opacity:.5}]}><Text style={[s.authButtonText,{color:GOLD}]}>CHECK AUTHORISED ACCOUNTS</Text></Pressable><Text style={s.authMessage}>{message}</Text>{connected?<View style={{padding:13,borderWidth:1,borderColor:GOLD,borderRadius:12,marginTop:8}}><Text style={s.gold}>CONNECTED · DERIV DEMO</Text><Text style={s.body}>Account login: {connected.login??"Not supplied"}</Text><Text style={s.muted}>Account ID: {connected.account_id}</Text></View>:null}{accounts.map(account=><Pressable key={account.account_id} disabled={busy} onPress={()=>selectAccount(account)} style={{padding:14,borderWidth:1,borderColor:"#444B59",borderRadius:13,marginTop:9,backgroundColor:"#10141B"}}><Text style={s.rowLabel}>Deriv DEMO · {account.login??"Account"}</Text><Text style={s.muted}>Account ID: {account.account_id}</Text><Text style={s.gold}>TAP TO CONNECT THIS ACCOUNT →</Text></Pressable>)}<Text style={[s.muted,{marginTop:12}]}>Only Deriv demo accounts are accepted. A successful connection does not enable trading; live prices, strategy checks, cash-risk sizing and broker-side protective orders must still be tested.</Text></Card>;
}


function RiskSettingsPanel(){
 const [lots,setLots]=useState("0.01");
 const [accountCurrency,setAccountCurrency]=useState("");
 const [busy,setBusy]=useState(false),[message,setMessage]=useState("Choose your position size in lots. Connect your Deriv DEMO account before starting.");
 const [botEnabled,setBotEnabled]=useState(false),[tradingPermission,setTradingPermission]=useState(false),[botBusy,setBotBusy]=useState(false),[botMessage,setBotMessage]=useState("Scanner status and DEMO execution permission are checked separately.");
 useEffect(()=>{let active=true;(async()=>{
  const {data:{user}}=await supabase.auth.getUser();
  if(!user){if(active)setMessage("Sign in before saving your lot size.");return;}
  const {data,error}=await supabase.from("risk_settings").select("lot_size,account_currency,trading_enabled").eq("user_id",user.id).maybeSingle();
  const {data:brokerAccount}=await supabase.from("ctrader_accounts").select("account_currency,connection_status").eq("user_id",user.id).eq("environment","demo").maybeSingle();
  const verifiedCurrency=String(brokerAccount?.account_currency??"").trim().toUpperCase();
  if(active)setAccountCurrency(/^[A-Z]{3,8}$/.test(verifiedCurrency)?verifiedCurrency:"");
  if(!active)return;
  if(error){setMessage("Could not load trading settings: "+error.message);return;}
  if(data){setLots(data.lot_size==null?"0.01":String(data.lot_size));setTradingPermission(data.trading_enabled===true);}
  const {data:botData}=await supabase.from("bot_settings").select("bot_enabled").eq("user_id",user.id).maybeSingle();
  if(active)setBotEnabled(botData?.bot_enabled===true);
 })();return()=>{active=false;};},[]);
 async function setAutomaticTrading(enabled:boolean){
  setBotBusy(true);setBotMessage(enabled?"Checking your selected lot size, demo account, market data and safety gates…":"Stopping automatic demo trading…");
  const {data:{user}}=await supabase.auth.getUser();
  if(!user){setBotBusy(false);setBotMessage("Sign in before changing automatic trading.");return;}
  if(enabled){
   const selectedLots=Number(lots);
   if(!Number.isFinite(selectedLots)||selectedLots<=0){setBotBusy(false);setBotMessage("Enter a valid lot size greater than zero and save it first.");return;}
   const {data:account,error:accountError}=await supabase.from("ctrader_accounts").select("ctrader_account_id,environment,connection_status,account_currency").eq("user_id",user.id).eq("environment","demo").eq("connection_status","connected").maybeSingle();
   const verifiedCurrency=String(account?.account_currency??"").trim().toUpperCase();
   if(accountError||!account||!/^[A-Z]{3,8}$/.test(verifiedCurrency)){setBotBusy(false);setBotMessage("Start blocked: connect your Deriv DEMO account and verify its deposit currency first.");return;}
   const {data:market,error:marketError}=await supabase.functions.invoke("ctrader-market-data",{body:{}});
   if(marketError||!market?.connected||!market?.dataReady||!market?.quoteFresh||!market?.candlesFresh||market?.newsProtection?.verified!==true||market?.newsProtection?.status==="unknown"||market?.newsProtection?.status!=="clear"){
    setBotBusy(false);setBotMessage("Start blocked: fresh broker prices, candles and a verified clear USD news window are required.");return;
   }
   const {error:riskError}=await supabase.from("risk_settings").upsert({user_id:user.id,account_currency:verifiedCurrency,currency_confirmed:true,lot_size:selectedLots,max_open_positions:1,max_consecutive_losses:3,minimum_reward_risk:2,demo_only:true,trading_enabled:true,updated_at:new Date().toISOString()},{onConflict:"user_id"});
   if(riskError){setBotBusy(false);setBotMessage("Could not save DEMO trading settings: "+riskError.message);return;}
   const {error:botError}=await supabase.from("bot_settings").upsert({user_id:user.id,environment:"demo",symbol:"XAUUSD",bot_enabled:true,updated_at:new Date().toISOString()},{onConflict:"user_id"});
   if(botError){await supabase.from("risk_settings").update({trading_enabled:false}).eq("user_id",user.id);setBotBusy(false);setBotMessage("Could not start the demo scanner: "+botError.message);return;}
   setAccountCurrency(verifiedCurrency);setBotEnabled(true);setTradingPermission(true);setBotMessage("DEMO scanner enabled. Orders will use your selected lot size and the strategy's structural stop. Broker, news, spread and one-open-position checks remain active.");
  }else{
   const {error:botError}=await supabase.from("bot_settings").upsert({user_id:user.id,environment:"demo",symbol:"XAUUSD",bot_enabled:false,updated_at:new Date().toISOString()},{onConflict:"user_id"});
   const {error:riskError}=await supabase.from("risk_settings").update({trading_enabled:false,updated_at:new Date().toISOString()}).eq("user_id",user.id);
   if(botError||riskError){setBotBusy(false);setBotMessage("Stop request needs attention: "+(botError?.message??riskError?.message));return;}
   setBotEnabled(false);setTradingPermission(false);setBotMessage("Automatic demo trading stopped and DEMO execution permission is locked.");
  }
  setBotBusy(false);
 }
 async function save(){
  const selectedLots=Number(lots);
  if(!Number.isFinite(selectedLots)||selectedLots<=0){setMessage("Enter a valid lot size greater than zero.");return;}
  setBusy(true);setMessage("");
  const {data:{user}}=await supabase.auth.getUser();
  if(!user){setBusy(false);setMessage("Sign in before saving your lot size.");return;}
  const {error}=await supabase.from("risk_settings").upsert({
   user_id:user.id,lot_size:selectedLots,max_open_positions:1,max_consecutive_losses:3,
   minimum_reward_risk:2,demo_only:true,updated_at:new Date().toISOString()
  },{onConflict:"user_id"});
  setBusy(false);
  setMessage(error?"Lot size was not saved: "+error.message:(tradingPermission?"Lot size saved. DEMO permission remains enabled.":"Lot size saved. Start the DEMO scanner when you're ready."));
 }
 return <Card><Heading>Position size and stop-loss</Heading>
  <Text style={s.body}>Choose the lot size yourself. The bot will keep the stop at the confirmed market-structure swing: below the previous swing low for a BUY, or above the previous swing high for a SELL. It will not move the stop to make a larger lot fit.</Text>
  <Row label="Verified Deriv demo currency" value={accountCurrency||"NOT CONNECTED"}/>
  <Text style={s.rowLabel}>Your position size (lots)</Text>
  <TextInput value={lots} onChangeText={setLots} keyboardType="decimal-pad" placeholder="e.g. 0.01" placeholderTextColor={MUTED} style={s.authInput}/>
  <Text style={s.muted}>The estimated loss depends on your lot size and the actual distance to the structural stop. Check that amount before allowing the bot to run.</Text>
  <Pressable disabled={busy} onPress={()=>void save()} style={[s.authButton,busy&&{opacity:.5}]}><Text style={s.authButtonText}>{busy?"SAVING…":"SAVE LOT SIZE"}</Text></Pressable>
  <Text style={s.authMessage}>{message}</Text>
  <Heading>Automatic DEMO trading</Heading>
  <Row label="Scanner status" value={botEnabled?"ENABLED":"STOPPED"}/>
  <Pressable disabled={botBusy||botEnabled} onPress={()=>void setAutomaticTrading(true)} style={[s.authButton,(botBusy||botEnabled)&&{opacity:.45}]}><Text style={s.authButtonText}>{botBusy?"CHECKING…":"START DEMO SCANNER"}</Text></Pressable>
  <Pressable disabled={botBusy||!botEnabled} onPress={()=>void setAutomaticTrading(false)} style={[s.authButton,{backgroundColor:"#252B36",marginTop:9},(botBusy||!botEnabled)&&{opacity:.45}]}><Text style={[s.authButtonText,{color:GOLD}]}>{botBusy?"PLEASE WAIT":"STOP DEMO SCANNER"}</Text></Pressable>
  <Text style={s.authMessage}>{botMessage}</Text>
  <Row label="Maximum open positions" value="1"/>
  <Row label="Pause after consecutive losses" value="3 in one day"/>
  <Row label="Daily trade-count cap" value="NONE"/>
  <Row label="Daily / weekly cash-loss caps" value="REMOVED"/>
  <Row label="Trading permission" value={tradingPermission?"ENABLED · DEMO":"LOCKED OFF"}/>
 </Card>;
}

type MarketCandle = {time:number;open:number;high:number;low:number;close:number;volume?:number};
type MarketSnapshot = {
 connected:boolean;environment:string;accountId:string;strategy?:{direction:string;score:number;status:string;h4:string;h1:string;setup:string;confirmation:string;entry:number|null;stop:number|null;target:number|null;reasons:string[]}|null;
 symbol:{name:string;symbolId:number;digits:number|null;pipPosition:number|null;minVolume:number|null;stepVolume:number|null;maxVolume:number|null;lotSize:number|null;tradingMode:number|null};
 account:{balance:number;moneyDigits:number;leverage:number|null;currency?:string};quote?:{bid:number;ask:number;spread:number;timestamp:number};
 candles:Record<string,MarketCandle[]>;candlesFresh?:boolean;quoteFresh?:boolean;sessionOpen?:boolean;openPositions?:Record<string,unknown>[];pendingOrders?:Record<string,unknown>[];receivedAt:string;dataReady:boolean;
};
function MarketDataPanel(){
 const [snapshot,setSnapshot]=useState<MarketSnapshot|null>(null);
 const [busy,setBusy]=useState(false),[message,setMessage]=useState("Connect your Deriv demo account, then load broker market data.");
 async function refresh(){
  setBusy(true);setMessage("Authenticating the Deriv demo account and requesting XAUUSD candles…");
  const {data,error}=await supabase.functions.invoke("ctrader-market-data",{body:{}});
  setBusy(false);
  if(error){setMessage("Market data request failed: "+await getFunctionErrorMessage(error));return;}
  if(data?.error){setMessage(String(data.error));return;}
  setSnapshot(data as MarketSnapshot);
  setMessage(data.dataReady?"Broker data received. Fresh candle history and quote are ready for strategy evaluation.":`Data is incomplete or stale (candles fresh: ${String(data.candlesFresh)}, quote fresh: ${String(data.quoteFresh)}). No trade can be opened.`);
 }
 useEffect(()=>{void refresh();const interval=setInterval(()=>void refresh(),60000);return()=>clearInterval(interval);},[]);
 const last=(key:string)=>snapshot?.candles?.[key]?.at(-1);
 return <Card><Heading>Live Deriv XAUUSD data</Heading>
  <Text style={s.body}>This reads the authenticated DEMO account directly from cTrader. No sample prices are shown.</Text>
  <Pressable disabled={busy} onPress={()=>void refresh()} style={[s.authButton,busy&&{opacity:.5}]}><Text style={s.authButtonText}>{busy?"LOADING BROKER DATA…":"REFRESH MARKET DATA"}</Text></Pressable>
  <Text style={s.authMessage}>{message}</Text>
  {snapshot?<><View style={s.pills}><Text style={s.pill}>DERIV DEMO VERIFIED</Text><Text style={s.pill}>{snapshot.symbol.name}</Text><Text style={[s.pill,{borderColor:snapshot.dataReady?"#4C9A70":"#B97824",color:snapshot.dataReady?"#71D39B":"#F2A23A"}]}>{snapshot.dataReady?"CANDLES READY":"HISTORY INCOMPLETE"}</Text></View>
   <Row label="Account balance" value={snapshot.account.balance.toFixed(2)+" "+(snapshot.account.currency??"")}/>
   <Row label="Verified deposit currency" value={snapshot.account.currency??"NOT VERIFIED"}/>
   <Row label="Live bid" value={snapshot.quote?.bid?.toFixed(snapshot.symbol.digits??2)??"Unavailable"}/>
   <Row label="Live ask" value={snapshot.quote?.ask?.toFixed(snapshot.symbol.digits??2)??"Unavailable"}/>
   <Row label="Spread" value={snapshot.quote?.spread?.toFixed(snapshot.symbol.digits??2)??"Unavailable"}/>
   <Row label="London / New York session" value={snapshot.sessionOpen?"OPEN":"CLOSED"}/>
   <Row label="Broker open positions" value={String(snapshot.openPositions?.length??0)}/>
   <Row label="Broker pending orders" value={String(snapshot.pendingOrders?.length??0)}/>
   <Row label="cTrader account ID" value={snapshot.accountId}/>
   <Row label="Symbol ID" value={String(snapshot.symbol.symbolId)}/>
   <Row label="Symbol digits" value={String(snapshot.symbol.digits??"Unknown")}/>
   <Row label="Minimum volume (protocol units)" value={String(snapshot.symbol.minVolume??"Unknown")}/>
   <Row label="Volume step (protocol units)" value={String(snapshot.symbol.stepVolume??"Unknown")}/>
   <Row label="Maximum volume (protocol units)" value={String(snapshot.symbol.maxVolume??"Unknown")}/>
   <Row label="Received" value={new Date(snapshot.receivedAt).toLocaleTimeString()}/>
   <Heading>Latest completed candle closes</Heading>
   {(["h4","h1","m15","m5"] as const).map(key=><Row key={key} label={key.toUpperCase()+" · "+(snapshot.candles[key]?.length??0)+" candles"} value={last(key)?.close?.toFixed(snapshot.symbol.digits??2)??"Unavailable"}/>)}
   <Heading>Strategy evaluation</Heading>
   <Row label="H4 trend" value={snapshot.strategy?.h4??"NOT READY"}/>
   <Row label="H1 trend" value={snapshot.strategy?.h1??"NOT READY"}/>
   <Row label="Signal" value={snapshot.strategy?.direction?.toUpperCase()??"NO TRADE"}/>
   <Row label="Setup status" value={snapshot.strategy?.status?.toUpperCase()??"WAITING"}/>
   <Row label="Signal score" value={snapshot.strategy?String(snapshot.strategy.score)+"/100":"—"}/>
   {snapshot.strategy?.entry!=null?<><Row label="Proposed entry" value={snapshot.strategy.entry.toFixed(snapshot.symbol.digits??2)}/><Row label="Structural stop" value={snapshot.strategy.stop?.toFixed(snapshot.symbol.digits??2)??"—"}/><Row label="2R target" value={snapshot.strategy.target?.toFixed(snapshot.symbol.digits??2)??"—"}/></>:null}
   {snapshot.strategy?.reasons?.map((reason,i)=><Text key={i} style={s.muted}>• {reason}</Text>)}
  </>:null}
  <Text style={[s.muted,{marginTop:12}]}>This screen reports broker market data and strategy conditions. Scanner status and DEMO execution permission are shown separately on the Risk screen; the server independently enforces every order safeguard.</Text>
 </Card>;
}


function TradeHistoryPanel(){
 const [rows,setRows]=useState<any[]>([]),[busy,setBusy]=useState(false),[message,setMessage]=useState("Loading broker trade history…");
 async function load(){
  setBusy(true);
  const {data:{user}}=await supabase.auth.getUser();
  if(!user){setBusy(false);setMessage("Sign in to view your private trade history.");return;}
  const {data,error}=await supabase.from("trade_history").select("id,symbol,side,volume,entry_price,exit_price,stop_loss,take_profit,profit,commission,swap,account_currency,cash_risk_amount,r_multiple,strategy_score,status,opened_at,closed_at").eq("user_id",user.id).order("opened_at",{ascending:false}).limit(50);
  setBusy(false);
  if(error){setMessage("Trade history could not be loaded: "+error.message);return;}
  setRows(data??[]);setMessage(data?.length?"Showing the latest "+data.length+" recorded trades.":"No broker trades have been recorded yet.");
 }
 useEffect(()=>{void load();},[]);
 return <Card><Heading>Broker trade history</Heading>
  <Pressable disabled={busy} onPress={()=>void load()} style={[s.authButton,{backgroundColor:"#252B36"},busy&&{opacity:.5}]}><Text style={[s.authButtonText,{color:GOLD}]}>{busy?"LOADING…":"REFRESH TRADE HISTORY"}</Text></Pressable>
  <Text style={s.authMessage}>{message}</Text>
  {rows.map(row=><View key={row.id} style={{paddingVertical:12,borderTopWidth:1,borderColor:"#282F3B"}}>
   <Row label={row.symbol+" · "+String(row.side).toUpperCase()} value={String(row.status).toUpperCase()}/>
   <Row label="Volume" value={row.volume==null?"—":String(row.volume)}/>
   <Row label="Entry / exit" value={(row.entry_price??"—")+" / "+(row.exit_price??"—")}/>
   <Row label="Stop / target" value={(row.stop_loss??"—")+" / "+(row.take_profit??"—")}/>
   <Row label="Profit" value={row.profit==null?"—":String(row.profit)+(row.account_currency?" "+row.account_currency:"")}/>
   <Row label="Cash risk / R multiple" value={(row.cash_risk_amount??"—")+" / "+(row.r_multiple??"—")}/>
   <Text style={s.muted}>{row.opened_at?new Date(row.opened_at).toLocaleString():"Opening time unavailable"}</Text>
  </View>)}
 </Card>;
}


function HomeDashboard(){
 const [broker,setBroker]=useState("CHECKING"),[risk,setRisk]=useState("NOT CONFIGURED"),[bot,setBot]=useState("STOPPED"),[execution,setExecution]=useState("LOCKED");
 useEffect(()=>{let active=true;(async()=>{
  const {data:{user}}=await supabase.auth.getUser();
  if(!user){if(active){setBroker("SIGN IN REQUIRED");setRisk("NOT CONFIGURED");}return;}
  const [account,settings,botSettings]=await Promise.all([
   supabase.from("ctrader_accounts").select("connection_status,environment").eq("user_id",user.id).eq("environment","demo").maybeSingle(),
   supabase.from("risk_settings").select("cash_risk_per_trade,daily_loss_limit_cash,weekly_loss_limit_cash,trading_enabled").eq("user_id",user.id).maybeSingle(),
   supabase.from("bot_settings").select("bot_enabled,environment").eq("user_id",user.id).maybeSingle()
  ]);
  if(!active)return;
  setBroker(account.data?.connection_status==="connected"?"DERIV DEMO LINKED":"NOT CONNECTED");
  setRisk(settings.data?.cash_risk_per_trade&&settings.data?.daily_loss_limit_cash&&settings.data?.weekly_loss_limit_cash?"CONFIGURED":"NOT CONFIGURED");
  setExecution(settings.data?.trading_enabled===true?"PERMISSION ENABLED · DEMO":"LOCKED");
  setBot(botSettings.data?.bot_enabled?"ENABLED IN SETTINGS":"STOPPED");
 })();return()=>{active=false;};},[]);
 return <><Card><Text style={s.kicker}>GOLD HUNTER AI · XAUUSD</Text><Text style={s.big}>DEMO SYSTEM</Text><Text style={s.muted}>The app is restricted to your Deriv cTrader demo account. Live-account trading is not supported.</Text><View style={s.pills}><Text style={s.pill}>{broker}</Text><Text style={s.pill}>{risk} RISK</Text><Text style={s.pill}>{bot}</Text></View></Card>
 <View style={s.metrics}><Metric label="ACCOUNT BALANCE" value="VIEW CHART" sub="Latest broker snapshot"/><Metric label="OPEN POSITIONS" value="VIEW CHART" sub="Broker reconciliation"/><Metric label="TRADE HISTORY" value="VIEW HISTORY"/></View>
 <Card><Heading>Trading framework</Heading><Row label="Market" value="XAUUSD"/><Row label="Higher timeframe direction" value="H4 + H1"/><Row label="Setup timeframe" value="M15"/><Row label="Entry confirmation" value="M5"/><Row label="Stop loss" value="Confirmed structure + ATR buffer"/><Row label="Position sizing" value="Fixed cash risk"/><Row label="Maximum open positions" value="1"/><Row label="Daily trade cap" value="NONE"/></Card>
 <Card><Heading>Safety status</Heading><Row label="Environment" value="DEMO ONLY"/><Row label="Live trading" value="DISABLED"/><Row label="Automatic execution permission" value={execution}/><Text style={s.body}>Execution permission is an explicit DEMO-only setting. The server still requires fresh broker data, a verified deposit currency, supported commission data, clear news, a valid strategy setup and confirmed broker-side protection before it can place an order.</Text></Card></>;
}

function Screen({tab}:{tab:Tab}){
 if(tab==="Home")return <HomeDashboard/>;
 if(tab==="Chart")return <MarketDataPanel/>;
 if(tab==="Strategy")return <><Card><Heading>Gold Hunter strategy</Heading><Text style={s.body}>Strict trend-following pullback strategy. H4 and H1 must agree; disagreement, unclear structure or stale data means NO TRADE.</Text><Row label="H4" value="Primary direction"/><Row label="H1" value="Must confirm H4"/><Row label="M15" value="Pullback + structure break"/><Row label="M5" value="Entry confirmation"/><Row label="EMA filters" value="50 / 200"/><Row label="Minimum reward:risk" value="1 : 2"/><Row label="Quality threshold" value="100 / 100"/></Card><Card><Heading>Setup checklist</Heading>{["H4 and H1 structure agree (HH/HL for buys; LH/LL for sells)","Price pulls back into a valid H1/M15 support or resistance zone","EMA50 / EMA200 and trendline confluence support direction","Liquidity sweep is confirmed, not assumed","M15 candle closes through the relevant structure level","M5 confirms direction or a retest before entry","There is clear room to target and at least 2R after costs","Spread, ATR, session, news and risk gates all pass"].map((x,i)=><Row key={i} label={x} value="REQUIRED"/>)} </Card><Card><Heading>Quality scoring · all mandatory gates (100/100)</Heading><Row label="H4/H1 alignment" value="20"/><Row label="H1 market structure" value="10"/><Row label="M15 pullback into zone" value="15"/><Row label="Trendline confluence" value="10"/><Row label="Liquidity sweep" value="10"/><Row label="M15 structure break" value="15"/><Row label="M5 confirmation" value="10"/><Row label="R:R and target room" value="10"/><Text style={s.muted}>Score is a ranking heuristic, not a probability of winning. Mandatory safety gates cannot be overridden by a high score.</Text></Card><Card><Heading>Automatic filters</Heading>{["London and New York session windows","Maximum spread and abnormal spread expansion","ATR volatility range","Avoid sideways or overextended markets","Previous day/week highs and lows; Asian range","High-impact USD news blackout","No stale prices or duplicate orders"].map((x,i)=><Row key={i} label={x} value="PLANNED"/>)} </Card></>;
 if(tab==="Risk")return <RiskSettingsPanel/>;
 if(tab==="History")return <TradeHistoryPanel/>;
 if(tab==="cTrader")return <><CTraderConnectPanel/><Card><Heading>Demo connection and execution status</Heading><Row label="Broker environment" value="DERIV DEMO ONLY"/><Row label="OAuth token storage" value="ENCRYPTED SERVER-SIDE"/><Row label="Account authentication" value="VERIFY ON DEVICE"/><Row label="XAUUSD market data" value="AVAILABLE AFTER DEPLOYMENT"/><Row label="Strategy evaluation" value="CONNECTED TO CANDLES"/><Row label="Automated order execution" value="SERVER-GATED DEMO ONLY"/><Text style={s.body}>The app now requests real broker data and reconciles open positions. Order execution remains disabled until the account contract, cash-risk conversion, protective order behaviour and loss-limit enforcement are verified. No live account is accepted.</Text></Card></>;
 return <><AuthPanel/><Card><Heading>Account & profile</Heading><Row label="Broker" value="DERIV"/><Row label="Trading environment" value="DEMO ONLY"/></Card><Card><Heading>Partner income</Heading><Text style={s.body}>Referral / introducing-broker earnings are separate from trading P/L. This section will show approved Deriv partner attribution and confirmed commission statements once an official partner account is linked. No commission is assumed or guaranteed.</Text><Row label="Partner account" value="NOT LINKED"/><Row label="Confirmed commission" value="—"/></Card><Card><Heading>Security</Heading><Text style={s.body}>Gold Hunter AI is configured to use its dedicated Supabase project for authentication and user data. cTrader OAuth and the secure server-side trading gateway are still pending. Never place service-role keys, cTrader client secrets or broker tokens in the mobile app or public repository.</Text></Card></>;
}
export default function Home(){const [tab,setTab]=useState<Tab>("Home");return <View style={s.root}><View style={s.header}><View style={s.logo}><Ionicons name="trending-up" size={29} color="#111318"/></View><View style={{flex:1}}><Text style={s.brand}>GOLD HUNTER AI</Text><Text style={s.muted}>DERIV · XAUUSD SYSTEM</Text></View><Text style={s.mode}>DEMO</Text></View><ScrollView contentContainerStyle={s.page}><Screen tab={tab}/><Text style={s.footer}>DEMO ONLY · NOT FINANCIAL ADVICE · NO LIVE ORDERS ENABLED</Text></ScrollView><ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.nav}>{tabs.map(t=><Pressable key={t} onPress={()=>setTab(t)} style={[s.navItem,tab===t&&s.active]}><Ionicons name={iconMap[t]} size={20} color={tab===t?GOLD:MUTED}/><Text style={{color:tab===t?GOLD:MUTED,fontSize:10}}>{t}</Text></Pressable>)}</ScrollView></View>}
const s=StyleSheet.create({root:{flex:1,backgroundColor:BG},header:{paddingTop:28,paddingHorizontal:17,paddingBottom:15,flexDirection:"row",alignItems:"center",borderBottomWidth:1,borderColor:"#242A34"},logo:{width:48,height:48,borderRadius:15,backgroundColor:GOLD,alignItems:"center",justifyContent:"center",marginRight:12},brand:{fontSize:19,fontWeight:"900",letterSpacing:1,color:WHITE},muted:{color:MUTED,fontSize:12,lineHeight:18},mode:{color:GOLD,borderWidth:1,borderColor:GOLD,borderRadius:20,paddingHorizontal:13,paddingVertical:7,fontWeight:"900"},page:{padding:16,paddingBottom:26},card:{backgroundColor:PANEL,borderColor:"#282F3B",borderWidth:1,borderRadius:22,padding:17,marginBottom:13},kicker:{color:MUTED,fontSize:11,letterSpacing:1.3},big:{fontSize:38,fontWeight:"900",color:GOLD,marginVertical:13},pills:{flexDirection:"row",flexWrap:"wrap",gap:7,marginTop:17},pill:{alignSelf:"flex-start",borderWidth:1,borderColor:GOLD,borderRadius:18,paddingHorizontal:10,paddingVertical:7,color:GOLD,fontSize:10,fontWeight:"800",overflow:"hidden"},metrics:{flexDirection:"row",gap:8,marginBottom:13},metric:{flex:1,backgroundColor:PANEL,borderRadius:17,padding:12,borderWidth:1,borderColor:"#282F3B"},metricValue:{fontSize:23,color:WHITE,fontWeight:"800",marginVertical:7},heading:{fontSize:18,color:WHITE,fontWeight:"800",marginBottom:12},body:{fontSize:13,color:"#C0C6D1",lineHeight:21,marginBottom:12},row:{flexDirection:"row",alignItems:"center",paddingVertical:11,borderTopWidth:1,borderColor:"#282F3B",gap:12},rowLabel:{flex:1,color:"#DCE0E7",fontSize:13,lineHeight:19},gold:{color:GOLD,fontSize:12,fontWeight:"800",textAlign:"right",maxWidth:"48%"},chart:{height:170,borderWidth:1,borderColor:"#333B49",borderRadius:16,alignItems:"center",justifyContent:"center",gap:12,marginVertical:15,backgroundColor:"#101319"},authInput:{backgroundColor:"#0E1218",borderWidth:1,borderColor:"#343B49",borderRadius:12,padding:13,color:WHITE,marginBottom:10},authButton:{backgroundColor:GOLD,borderRadius:12,padding:14,alignItems:"center",marginTop:8},authButtonText:{color:"#101216",fontWeight:"900",letterSpacing:1},authLink:{color:GOLD,textAlign:"center",paddingTop:14,fontSize:13},authMessage:{color:"#F2A23A",fontSize:12,lineHeight:18,marginVertical:8},footer:{textAlign:"center",fontSize:9,color:MUTED,marginVertical:12},nav:{maxHeight:68,borderTopWidth:1,borderColor:"#292F3B",backgroundColor:PANEL},navItem:{minWidth:66,alignItems:"center",justifyContent:"center",gap:4,paddingHorizontal:9,paddingVertical:9},active:{borderTopWidth:2,borderColor:GOLD}});
