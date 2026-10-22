#property strict
#property version   "1.00"
#property description "Read-only RBFX MT5 OHLC/quote sender for the RBFX Meter Vercel endpoint. No trade functions."

// Configure the public Vercel endpoint locally in MT5.
// No feed token or RBFX Client Portal password is sent. This public endpoint accepts writes from any internet client.
input string InpEndpoint = "https://YOUR-VERCEL-PROJECT.vercel.app/api/mt5-feed";
input string InpPortalAssets = "XAUUSD,EURUSD,GBPUSD,USDJPY,USDCHF,USDCAD,AUDUSD,NZDUSD,BTCUSD,ETHUSD";
input string InpBrokerSymbols = "XAUUSD,EURUSD,GBPUSD,USDJPY,USDCHF,USDCAD,AUDUSD,NZDUSD,BTCUSD,ETHUSD";
input bool   InpAutoDetectSymbols = true;
input string InpKnownSuffixes = ".a,.m,-ecn,#,.ecn,_ecn,.raw,-raw,.r,r,.pro,.std,m,_m,ecn,a,.,_,#,-";
input int    InpM1Bars = 300;
input int    InpM5Bars = 300;
input int    InpM15Bars = 200;
input int    InpH1Bars = 200;
input int    InpSendEverySeconds = 60;
input int    InpTimeoutMs = 10000;

string Trimmed(string value)
{
   StringTrimLeft(value);
   StringTrimRight(value);
   return value;
}

string JsonEscape(string value)
{
   StringReplace(value, "\\", "\\\\");
   StringReplace(value, "\"", "\\\"");
   return value;
}

long ServerOffsetSeconds()
{
   datetime serverNow = TimeTradeServer();
   datetime utcNow = TimeGMT();
   if(serverNow <= 0 || utcNow <= 0) return 0;
   return (long)(serverNow - utcNow);
}

long EpochMilliseconds(datetime serverTime, long offsetSeconds)
{
   return ((long)serverTime - offsetSeconds) * 1000;
}

long TickUtcMilliseconds(long serverTimeMilliseconds, long offsetSeconds)
{
   return serverTimeMilliseconds - offsetSeconds * 1000;
}

string gResolvedAssets[];
string gResolvedSymbols[];

string NormalizeSymbol(string value)
{
   StringToUpper(value);
   string normalized = "";
   for(int i = 0; i < StringLen(value); ++i)
   {
      ushort ch = (ushort)StringGetCharacter(value, i);
      if((ch >= 65 && ch <= 90) || (ch >= 48 && ch <= 57))
         normalized += StringSubstr(value, i, 1);
   }
   return normalized;
}

string AliasesForAsset(const string asset)
{
   if(asset == "XAUUSD") return "XAUUSD|GOLD|GOLDUSD";
   if(asset == "BTCUSD") return "BTCUSD|XBTUSD";
   if(asset == "ETHUSD") return "ETHUSD";
   return asset;
}

bool HasRequiredSymbolData(const string symbol)
{
   if(symbol == "" || !SymbolSelect(symbol, true)) return false;
   MqlTick tick;
   if(!SymbolInfoTick(symbol, tick) || tick.bid <= 0 || tick.ask < tick.bid) return false;

   // Trigger MT5 history synchronization on all four requested intervals.
   // M1 and M15 are the source series; M5/H1 may be synthesized by Vercel.
   MqlRates bars[];
   long synchronized = 0;
   SeriesInfoInteger(symbol, PERIOD_M1, SERIES_SYNCHRONIZED, synchronized);
   int m1Copied = CopyRates(symbol, PERIOD_M1, 1, 30, bars);
   SeriesInfoInteger(symbol, PERIOD_M5, SERIES_SYNCHRONIZED, synchronized);
   CopyRates(symbol, PERIOD_M5, 1, 30, bars);
   SeriesInfoInteger(symbol, PERIOD_M15, SERIES_SYNCHRONIZED, synchronized);
   int m15Copied = CopyRates(symbol, PERIOD_M15, 1, 30, bars);
   SeriesInfoInteger(symbol, PERIOD_H1, SERIES_SYNCHRONIZED, synchronized);
   CopyRates(symbol, PERIOD_H1, 1, 30, bars);
   return m1Copied >= 30 && m15Copied >= 30;
}

int CachedSymbolIndex(const string asset)
{
   for(int i = 0; i < ArraySize(gResolvedAssets); ++i)
      if(gResolvedAssets[i] == asset) return i;
   return -1;
}

void CacheResolvedSymbol(const string asset, const string symbol)
{
   int index = CachedSymbolIndex(asset);
   if(index < 0)
   {
      index = ArraySize(gResolvedAssets);
      ArrayResize(gResolvedAssets, index + 1);
      ArrayResize(gResolvedSymbols, index + 1);
      gResolvedAssets[index] = asset;
   }
   gResolvedSymbols[index] = symbol;
}

void ClearResolvedSymbol(const string asset)
{
   int index = CachedSymbolIndex(asset);
   if(index < 0) return;
   for(int i = index; i < ArraySize(gResolvedAssets) - 1; ++i)
   {
      gResolvedAssets[i] = gResolvedAssets[i + 1];
      gResolvedSymbols[i] = gResolvedSymbols[i + 1];
   }
   ArrayResize(gResolvedAssets, ArraySize(gResolvedAssets) - 1);
   ArrayResize(gResolvedSymbols, ArraySize(gResolvedSymbols) - 1);
}

int SymbolAliasScore(const string brokerSymbol, const string asset)
{
   string name = NormalizeSymbol(brokerSymbol);
   string aliases[];
   int count = StringSplit(AliasesForAsset(asset), '|', aliases);
   int best = -1;
   for(int i = 0; i < count; ++i)
   {
      string alias = NormalizeSymbol(aliases[i]);
      if(alias == "") continue;
      if(name == alias) return 10000;
      int at = StringFind(name, alias);
      int extra = StringLen(name) - StringLen(alias);
      if(at < 0 || extra < 0 || extra > 16) continue;
      int score = (at == 0 ? 900 : 650 - at * 20) - extra * 3 + (i == 0 ? 50 : 0);
      if(score > best) best = score;
   }
   return best;
}

string ResolveBrokerSymbol(const string asset, const string preferred)
{
   int cached = CachedSymbolIndex(asset);
   if(cached >= 0)
   {
      if(SymbolSelect(gResolvedSymbols[cached], true)) return gResolvedSymbols[cached];
      ClearResolvedSymbol(asset);
   }

   string exact = Trimmed(preferred);
   if(HasRequiredSymbolData(exact))
   {
      CacheResolvedSymbol(asset, exact);
      return exact;
   }
   if(!InpAutoDetectSymbols) return "";

   string aliases[];
   int aliasCount = StringSplit(AliasesForAsset(asset), '|', aliases);
   for(int a = 0; a < aliasCount; ++a)
   {
      string base = Trimmed(aliases[a]);
      if(HasRequiredSymbolData(base))
      {
         CacheResolvedSymbol(asset, base);
         return base;
      }
   }

   string suffixes[];
   int suffixCount = StringSplit(InpKnownSuffixes, ',', suffixes);
   for(int a = 0; a < aliasCount; ++a)
   {
      string base = Trimmed(aliases[a]);
      for(int s = 0; s < suffixCount; ++s)
      {
         string suffix = Trimmed(suffixes[s]);
         if(suffix == "") continue;
         string candidate = base + suffix;
         if(HasRequiredSymbolData(candidate))
         {
            CacheResolvedSymbol(asset, candidate);
            PrintFormat("RBFX auto-symbol: %s -> %s", asset, candidate);
            return candidate;
         }
      }
      for(int s = 0; s < suffixCount; ++s)
      {
         string suffix = Trimmed(suffixes[s]);
         if(suffix == "") continue;
         string candidate = suffix + base;
         if(HasRequiredSymbolData(candidate))
         {
            CacheResolvedSymbol(asset, candidate);
            PrintFormat("RBFX auto-symbol: %s -> %s", asset, candidate);
            return candidate;
         }
      }
   }

   // Universal last pass: scan all broker symbols for a canonical name or alias
   // embedded with an unlisted prefix/suffix, then require usable MT5 quotes/history.
   string bestSymbol = "";
   int bestScore = -1;
   int total = SymbolsTotal(false);
   for(int i = 0; i < total; ++i)
   {
      string candidate = SymbolName(i, false);
      int score = SymbolAliasScore(candidate, asset);
      if(score <= bestScore) continue;
      if(!HasRequiredSymbolData(candidate)) continue;
      bestScore = score;
      bestSymbol = candidate;
   }
   if(bestSymbol != "")
   {
      CacheResolvedSymbol(asset, bestSymbol);
      PrintFormat("RBFX auto-symbol scan: %s -> %s", asset, bestSymbol);
      return bestSymbol;
   }
   PrintFormat("RBFX auto-symbol: no matching broker symbol found for %s (preferred %s)", asset, exact);
   return "";
}

string RatesJson(const string symbol, ENUM_TIMEFRAMES timeframe, int requested, long offsetSeconds, bool requireFullRequest)
{
   int stepSeconds = PeriodSeconds(timeframe);
   if(stepSeconds <= 0) return "[]";
   // The endpoint accepts 30..600 bars per timeframe; clamp user inputs to that contract.
   int boundedRequest = (int)MathMax(30, MathMin(600, requested));
   MqlRates rates[];
   ArraySetAsSeries(rates, true);
   long synchronized = 0;
   SeriesInfoInteger(symbol, timeframe, SERIES_SYNCHRONIZED, synchronized);
   int copied = CopyRates(symbol, timeframe, 1, boundedRequest, rates); // skip the candle still forming
   SeriesInfoInteger(symbol, timeframe, SERIES_SYNCHRONIZED, synchronized);
   if(copied < 30 || (requireFullRequest && copied < boundedRequest)) return "[]";

   long nowUtc = (long)TimeGMT() * 1000;
   long oldestAllowed = nowUtc - 45 * 86400 * 1000;
   long newestAllowed = nowUtc + 120000;
   long stepMillis = (long)stepSeconds * 1000;
   int digits = (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS);
   string result = "[";
   int written = 0;
   long lastWritten = 0;
   // Emit closed bars oldest-to-newest with the same time/price constraints as Vercel.
   for(int i = copied - 1; i >= 0; --i)
   {
      long t = EpochMilliseconds(rates[i].time, offsetSeconds);
      double o = rates[i].open, h = rates[i].high, l = rates[i].low, c = rates[i].close;
      if(t < oldestAllowed || t > newestAllowed || t + stepMillis > nowUtc + 30000) continue;
      if(!MathIsValidNumber(o) || !MathIsValidNumber(h) || !MathIsValidNumber(l) || !MathIsValidNumber(c)) continue;
      if(o <= 0 || h < MathMax(o, c) || l <= 0 || l > MathMin(o, c)) continue;
      if(written > 0 && t <= lastWritten) continue;
      if(written > 0) result += ",";
      result += StringFormat("{\"t\":%I64d,\"o\":%s,\"h\":%s,\"l\":%s,\"c\":%s}",
                             t, DoubleToString(o, digits), DoubleToString(h, digits),
                             DoubleToString(l, digits), DoubleToString(c, digits));
      lastWritten = t;
      written++;
   }
   result += "]";
   return written >= 30 && (!requireFullRequest || written >= boundedRequest) ? result : "[]";
}
bool IsAllowedPortalAsset(const string asset)
{
   return asset == "XAUUSD" || asset == "EURUSD" || asset == "GBPUSD" || asset == "USDJPY" ||
          asset == "USDCHF" || asset == "USDCAD" || asset == "AUDUSD" || asset == "NZDUSD" ||
          asset == "BTCUSD" || asset == "ETHUSD";
}

bool BuildInstrumentJson(const string portalAsset, const string brokerSymbol, long offsetSeconds, string &out)
{
   if(!SymbolSelect(brokerSymbol, true))
      return false;

   MqlTick tick;
   if(!SymbolInfoTick(brokerSymbol, tick) || !MathIsValidNumber(tick.bid) || !MathIsValidNumber(tick.ask) ||
      tick.bid <= 0 || tick.ask < tick.bid || tick.time_msc <= 0 || StringLen(brokerSymbol) > 48)
      return false;

   long quoteUtc = TickUtcMilliseconds(tick.time_msc, offsetSeconds);
   long nowUtc = (long)TimeGMT() * 1000;
   if(quoteUtc < nowUtc - 45 * 86400 * 1000 || quoteUtc > nowUtc + 120000)
      return false;

   int digits = (int)SymbolInfoInteger(brokerSymbol, SYMBOL_DIGITS);
   string m1 = RatesJson(brokerSymbol, PERIOD_M1, InpM1Bars, offsetSeconds, false);
   string m5 = RatesJson(brokerSymbol, PERIOD_M5, InpM5Bars, offsetSeconds, true);
   string m15 = RatesJson(brokerSymbol, PERIOD_M15, InpM15Bars, offsetSeconds, false);
   string h1 = RatesJson(brokerSymbol, PERIOD_H1, InpH1Bars, offsetSeconds, true);
   // M1 and M15 are mandatory inputs; Vercel creates missing/incomplete M5 and H1.
   if(m1 == "[]" || m15 == "[]")
      return false;

   out = StringFormat("{\"asset\":\"%s\",\"symbol\":\"%s\",\"quote\":{\"bid\":%s,\"ask\":%s,\"t\":%I64d},\"m1\":%s,\"m5\":%s,\"m15\":%s,\"h1\":%s}",
                      JsonEscape(portalAsset), JsonEscape(brokerSymbol),
                      DoubleToString(tick.bid, digits), DoubleToString(tick.ask, digits),
                      quoteUtc, m1, m5, m15, h1);
   return true;
}

void SendFeed()
{
   if(StringFind(InpEndpoint, "https://") != 0 || StringFind(InpEndpoint, "YOUR-VERCEL-PROJECT") >= 0)
   {
      Print("RBFX feed: configure the deployed Vercel HTTPS endpoint in the EA inputs.");
      return;
   }

   string assets[], symbols[];
   int assetCount = StringSplit(InpPortalAssets, ',', assets);
   int symbolCount = StringSplit(InpBrokerSymbols, ',', symbols);
   if(assetCount <= 0 || assetCount != symbolCount)
   {
      Print("RBFX feed: PortalAssets and BrokerSymbols must contain the same number of comma-separated entries in matching order.");
      return;
   }

   long offsetSeconds = ServerOffsetSeconds();
   string rows = "";
   string acceptedAssets[];
   int accepted = 0;
   for(int i = 0; i < assetCount; ++i)
   {
      string asset = Trimmed(assets[i]);
      StringToUpper(asset);
      if(!IsAllowedPortalAsset(asset))
      {
         PrintFormat("RBFX feed: unsupported portal asset '%s' skipped; use one of the canonical assets.", asset);
         continue;
      }
      bool duplicate = false;
      for(int j = 0; j < accepted; ++j)
         if(acceptedAssets[j] == asset) duplicate = true;
      if(duplicate)
      {
         PrintFormat("RBFX feed: duplicate portal asset '%s' skipped.", asset);
         continue;
      }
      string preferredSymbol = Trimmed(symbols[i]);
      string symbol = ResolveBrokerSymbol(asset, preferredSymbol);
      if(symbol == "") continue;
      string item;
      if(!BuildInstrumentJson(asset, symbol, offsetSeconds, item))
      {
         ClearResolvedSymbol(asset);
         continue;
      }
      if(accepted > 0) rows += ",";
      rows += item;
      ArrayResize(acceptedAssets, accepted + 1);
      acceptedAssets[accepted] = asset;
      accepted++;
   }
   if(accepted <= 0)
   {
      Print("RBFX feed: no configured symbol has a usable quote and enough closed M1/M15 source history.");
      return;
   }

   // Offset is sent with already-normalized UTC bars; backend only applies it if times still look server-local.
   string body = StringFormat("{\"version\":1,\"serverOffsetSeconds\":%I64d,\"instruments\":[%s]}", offsetSeconds, rows);
   if(StringLen(body) > 1900000)
   {
      PrintFormat("RBFX feed: payload too large for the Vercel 2 MB limit (%d chars). Reduce bar inputs.", StringLen(body));
      return;
   }
   char postData[];
   StringToCharArray(body, postData, 0, WHOLE_ARRAY, CP_UTF8);
   if(ArraySize(postData) > 0)
      ArrayResize(postData, ArraySize(postData) - 1); // remove terminating NUL

   char response[];
   string responseHeaders;
   string headers = "Content-Type: application/json\r\nAccept: application/json\r\n";
   ResetLastError();
   int status = WebRequest("POST", InpEndpoint, headers, InpTimeoutMs, postData, response, responseHeaders);
   if(status == 200)
      PrintFormat("RBFX feed: accepted %d instrument(s).", accepted);
   else if(status == -1)
      PrintFormat("RBFX feed: WebRequest failed (error %d). Check MT5 WebRequest allowlist and connection.", GetLastError());
   else
   {
      string responseText = CharArrayToString(response, 0, -1, CP_UTF8);
      PrintFormat("RBFX feed: endpoint returned HTTP %d. Response: %s", status, responseText);
   }
}

int OnInit()
{
   EventSetTimer((int)MathMax(15, InpSendEverySeconds));
   SendFeed();
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason)
{
   EventKillTimer();
}

void OnTimer()
{
   SendFeed();
}
