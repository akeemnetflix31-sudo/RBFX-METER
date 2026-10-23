import assert from 'node:assert/strict';
import { normalizeMarketPayload } from '../server/functions/market-payload.mjs';
const M15=900_000, nowBase=1_800_000_000_000;
function makeRows(step,count,baseClose=100,breakout=false){const rows=[];for(let i=0;i<count;i++){const t=nowBase+i*step;const row=breakout&&i===count-1?{t,o:100.5,h:103.5,l:100.4,c:103.3}:{t,o:baseClose,h:baseClose+1,l:baseClose-1,c:baseClose};for(const offset of [0,12_000,27_000])rows.push({...row,t:t+offset});}return rows;}
const m15=makeRows(M15,40,100,true),last=m15.at(-1),now=last.t+M15+60_000;
const timeframe={direction:'BULLISH'};
const data={ok:true,asset:'XAUUSD',source:'RBFX_MT5',dataSource:'RBFX_MT5_RAW_OHLC',stale:false,quoteAgeSeconds:20,feedHeartbeatAgeSeconds:20,referencePrice:102.5,digits:2,
 charts:{M15:m15,M1:makeRows(60_000,50).map(x=>({...x,t:now-60_000})),M5:makeRows(300_000,50),H1:makeRows(3_600_000,40)},bars:m15,timeframes:{H1:timeframe,M15:timeframe,M5:timeframe,M1:timeframe},levelsByTimeframe:{M15:{state:'STUDY',items:[{label:'ENTRY',price:999}]}}};
const result=normalizeMarketPayload(data,now);
for(const [tf,step] of Object.entries({H1:3_600_000,M15:900_000,M5:300_000,M1:60_000})){
 const rows=result.charts[tf];assert.equal(rows.length,tf==='M15'?40:tf==='M1'?1:tf==='M5'?50:40,tf+' duplicate samples collapse');
 assert(rows.every(row=>row.t%step===0),tf+' timestamps align to timeframe bucket opens');
 assert.equal(new Set(rows.map(row=>row.t)).size,rows.length,tf+' timestamps are unique');
}
assert.deepEqual(result.bars,result.charts.M15);
assert.equal(result.levelsByTimeframe.M15.items.length,5,'qualified A-grade output retains the five validated M15 study levels');
assert.equal(result.levelsByTimeframe.M15.state,'ACTIVE');
const unaligned={...result,timeframes:{H1:{direction:'BEARISH'},M15:{direction:'BEARISH'},M5:{direction:'BEARISH'},M1:{direction:'BEARISH'}},charts:{...result.charts,M15:result.charts.M15},bars:result.bars};
normalizeMarketPayload(unaligned,now);
assert.equal(unaligned.levelsByTimeframe.M15.items.length,0,'unqualified/conflicting side cannot return drawable M15 levels');
console.log('PASS: Vercel market API MTF payload bucket normalization and A-grade M15 levels fail closed.');
