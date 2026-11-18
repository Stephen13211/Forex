//+------------------------------------------------------------------+
//| Gold Hunter AI - XAUUSD demo Expert Advisor                      |
//| H4/H1 trend alignment, M15 pullback/structure, M5 confirmation   |
//| DEMO ONLY. No martingale/grid/recovery.                           |
//+------------------------------------------------------------------+
#property strict
#property version "1.00"
#include <Trade/Trade.mqh>
CTrade trade;

input bool   DemoOnly=true;
input double RiskPerTradePercent=1.0; // Percentage of current account equity
input double MaxDailyLossPercent=3.0; // Percentage of equity at start of trading day
input double MaxWeeklyLossPercent=9.0; // Percentage of equity at start of trading week
input int    MaxConsecutiveLosses=2;
input double MinimumRR=2.0;
input int    MaxSpreadPoints=80;
input int    FastEMA=50;
input int    SlowEMA=200;
input int    ATRPeriod=14;
input double ATRStopMultiplier=1.5;
input int    SwingLookback=8;
input ulong  Magic=18112026;

int h4Fast,h4Slow,h1Fast,h1Slow,m15Fast,m15Slow,m5Fast,m5Slow,atrHandle;
datetime lastM15Bar=0;
int consecutiveLosses=0;
double dayStartEquity=0, weekStartEquity=0;
int dayKey=-1, weekKey=-1;

bool IsDemo() { return (ENUM_ACCOUNT_TRADE_MODE)AccountInfoInteger(ACCOUNT_TRADE_MODE)==ACCOUNT_TRADE_MODE_DEMO; }
bool ReadBuf(int handle,int shift,double &v) { double a[]; ArraySetAsSeries(a,true); if(CopyBuffer(handle,0,shift,1,a)!=1) return false; v=a[0]; return true; }
bool NewM15Bar() { datetime t=iTime(_Symbol,PERIOD_M15,0); if(t==0||t==lastM15Bar)return false; lastM15Bar=t; return true; }
void ResetPeriods() {
 MqlDateTime d; TimeToStruct(TimeCurrent(),d); int dk=d.year*1000+d.day_of_year;
 if(dk!=dayKey){dayKey=dk;dayStartEquity=AccountInfoDouble(ACCOUNT_EQUITY);consecutiveLosses=0;}
 int wk=d.year*100+d.day_of_year/7;
 if(wk!=weekKey){weekKey=wk;weekStartEquity=AccountInfoDouble(ACCOUNT_EQUITY);}
}
bool LimitsOK() {
 ResetPeriods();
 double eq=AccountInfoDouble(ACCOUNT_EQUITY);
 if(dayStartEquity>0 && (dayStartEquity-eq)/dayStartEquity*100.0>=MaxDailyLossPercent)return false;
 if(weekStartEquity>0 && (weekStartEquity-eq)/weekStartEquity*100.0>=MaxWeeklyLossPercent)return false;
 if(consecutiveLosses>=MaxConsecutiveLosses)return false;
 // Only block another entry while this EA already has a position on this symbol.
 for(int i=PositionsTotal()-1;i>=0;i--){
   ulong ticket=PositionGetTicket(i);
   if(ticket>0 && PositionGetString(POSITION_SYMBOL)==_Symbol && (ulong)PositionGetInteger(POSITION_MAGIC)==Magic)return false;
 }
 return true;
}
bool Trend(int hf,int hs,int &direction) {
 double f,s;if(!ReadBuf(hf,0,f)||!ReadBuf(hs,0,s))return false;
 direction=f>s?1:(f<s?-1:0);return direction!=0;
}
double RecentLow(ENUM_TIMEFRAMES tf,int n,int from=1){double x=DBL_MAX;for(int i=from;i<from+n;i++)x=MathMin(x,iLow(_Symbol,tf,i));return x;}
double RecentHigh(ENUM_TIMEFRAMES tf,int n,int from=1){double x=-DBL_MAX;for(int i=from;i<from+n;i++)x=MathMax(x,iHigh(_Symbol,tf,i));return x;}
bool Signal(int &side,double &sl,double &tp) {
 int a,b,c,d; if(!Trend(h4Fast,h4Slow,a)||!Trend(h1Fast,h1Slow,b)||a!=b)return false;
 double m15f,m15s,m5f,m5s,atr;
 if(!ReadBuf(m15Fast,0,m15f)||!ReadBuf(m15Slow,0,m15s)||!ReadBuf(m5Fast,0,m5f)||!ReadBuf(m5Slow,0,m5s)||!ReadBuf(atrHandle,1,atr))return false;
 MqlRates r[];ArraySetAsSeries(r,true);if(CopyRates(_Symbol,PERIOD_M15,0,3,r)<3)return false;
 MqlRates q[];ArraySetAsSeries(q,true);if(CopyRates(_Symbol,PERIOD_M5,0,3,q)<3)return false;
 double bid=SymbolInfoDouble(_Symbol,SYMBOL_BID),ask=SymbolInfoDouble(_Symbol,SYMBOL_ASK);
 double spread=(ask-bid)/_Point;if(spread>MaxSpreadPoints||atr<=0)return false;
 // Strict direction: EMA trend + pullback near M15 EMA50, closed-candle rejection and break of prior candle.
 if(a==1 && m15f>m15s && m5f>m5s && r[1].low<=m15f+0.20*atr && r[1].close>r[1].open && r[1].close>r[2].high && q[1].close>q[1].open) {
   side=1; double swingLow=RecentLow(PERIOD_M15,SwingLookback,2); double previousHigh=RecentHigh(PERIOD_M15,SwingLookback,2); sl=swingLow-0.10*atr; double risk=ask-sl;if(risk<=0||previousHigh<=ask)return false;tp=previousHigh;return true;
 }
 if(a==-1 && m15f<m15s && m5f<m5s && r[1].high>=m15f-0.20*atr && r[1].close<r[1].open && r[1].close<r[2].low && q[1].close<q[1].open) {
   side=-1; double swingHigh=RecentHigh(PERIOD_M15,SwingLookback,2); double previousLow=RecentLow(PERIOD_M15,SwingLookback,2); sl=swingHigh+0.10*atr; double risk=sl-bid;if(risk<=0||previousLow>=bid)return false;tp=previousLow;return true;
 }
 return false;
}
double LotsForRisk(double entry,double stop) {
 double distance=MathAbs(entry-stop),tickSize=SymbolInfoDouble(_Symbol,SYMBOL_TRADE_TICK_SIZE),tickValue=SymbolInfoDouble(_Symbol,SYMBOL_TRADE_TICK_VALUE);
 double vmin=SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_MIN),vmax=SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_MAX),step=SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_STEP);
 if(distance<=0||tickSize<=0||tickValue<=0||step<=0)return 0;
 double lossPerLot=(distance/tickSize)*tickValue;if(lossPerLot<=0)return 0;
 double riskMoney=AccountInfoDouble(ACCOUNT_EQUITY)*RiskPerTradePercent/100.0;
 double raw=riskMoney/lossPerLot;
 double lots=MathFloor(raw/step)*step;
 // If the calculated size is below broker minimum, use minimum volume as requested.
 // This can exceed the percentage target; print the actual estimated risk for visibility.
 if(lots<vmin)lots=vmin;
 lots=MathMin(lots,vmax);
 double actualRisk=lots*lossPerLot;
 double actualRiskPct=AccountInfoDouble(ACCOUNT_EQUITY)>0?actualRisk/AccountInfoDouble(ACCOUNT_EQUITY)*100.0:0;
 if(actualRiskPct>RiskPerTradePercent+0.01)Print("WARNING: broker minimum lot risks approximately ",DoubleToString(actualRiskPct,2),"% (target ",DoubleToString(RiskPerTradePercent,2),"%).");
 return lots;
}
int OnInit(){
 if(DemoOnly&&!IsDemo()){Print("Gold Hunter: DEMO ACCOUNT REQUIRED. EA will not trade.");return INIT_FAILED;}
 h4Fast=iMA(_Symbol,PERIOD_H4,FastEMA,0,MODE_EMA,PRICE_CLOSE);h4Slow=iMA(_Symbol,PERIOD_H4,SlowEMA,0,MODE_EMA,PRICE_CLOSE);
 h1Fast=iMA(_Symbol,PERIOD_H1,FastEMA,0,MODE_EMA,PRICE_CLOSE);h1Slow=iMA(_Symbol,PERIOD_H1,SlowEMA,0,MODE_EMA,PRICE_CLOSE);
 m15Fast=iMA(_Symbol,PERIOD_M15,FastEMA,0,MODE_EMA,PRICE_CLOSE);m15Slow=iMA(_Symbol,PERIOD_M15,SlowEMA,0,MODE_EMA,PRICE_CLOSE);
 m5Fast=iMA(_Symbol,PERIOD_M5,FastEMA,0,MODE_EMA,PRICE_CLOSE);m5Slow=iMA(_Symbol,PERIOD_M5,SlowEMA,0,MODE_EMA,PRICE_CLOSE);
 atrHandle=iATR(_Symbol,PERIOD_M15,ATRPeriod);
 if(h4Fast==INVALID_HANDLE||h4Slow==INVALID_HANDLE||h1Fast==INVALID_HANDLE||h1Slow==INVALID_HANDLE||m15Fast==INVALID_HANDLE||m15Slow==INVALID_HANDLE||m5Fast==INVALID_HANDLE||m5Slow==INVALID_HANDLE||atrHandle==INVALID_HANDLE)return INIT_FAILED;
 trade.SetExpertMagicNumber(Magic);trade.SetDeviationInPoints(20);ResetPeriods();return INIT_SUCCEEDED;
}
void OnDeinit(const int reason){IndicatorRelease(h4Fast);IndicatorRelease(h4Slow);IndicatorRelease(h1Fast);IndicatorRelease(h1Slow);IndicatorRelease(m15Fast);IndicatorRelease(m15Slow);IndicatorRelease(m5Fast);IndicatorRelease(m5Slow);IndicatorRelease(atrHandle);}
void OnTick(){
 if(DemoOnly&&!IsDemo())return;
 if(!NewM15Bar()||!LimitsOK())return;
 int side=0;double sl=0,tp=0;if(!Signal(side,sl,tp))return;
 double entry=side>0?SymbolInfoDouble(_Symbol,SYMBOL_ASK):SymbolInfoDouble(_Symbol,SYMBOL_BID);
 double lots=LotsForRisk(entry,sl);if(lots<=0){Print("Skipped: broker minimum volume exceeds configured risk.");return;}
 bool ok=side>0?trade.Buy(lots,_Symbol,0,sl,tp,"GoldHunter demo buy"):trade.Sell(lots,_Symbol,0,sl,tp,"GoldHunter demo sell");
 if(!ok)Print("Order rejected: ",trade.ResultRetcodeDescription());
}
void OnTradeTransaction(const MqlTradeTransaction &trans,const MqlTradeRequest &request,const MqlTradeResult &result){
 if(trans.type!=TRADE_TRANSACTION_DEAL_ADD||trans.deal==0)return;
 if(!HistoryDealSelect(trans.deal))return;
 if((ulong)HistoryDealGetInteger(trans.deal,DEAL_MAGIC)!=Magic)return;
 if((ENUM_DEAL_ENTRY)HistoryDealGetInteger(trans.deal,DEAL_ENTRY)!=DEAL_ENTRY_OUT)return;
 double p=HistoryDealGetDouble(trans.deal,DEAL_PROFIT)+HistoryDealGetDouble(trans.deal,DEAL_SWAP)+HistoryDealGetDouble(trans.deal,DEAL_COMMISSION);
 if(p<0)consecutiveLosses++;else if(p>0)consecutiveLosses=0;
}
