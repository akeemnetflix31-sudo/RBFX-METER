# Direct feed tanpa database — analisis kod asal dan patch tempatan

**Status:** perubahan di ruang kerja sahaja; tidak dideploy. Tiada Redis/Upstash/env var baharu.

## Punca sebenar

`vercel.json` menulis semula `/api/mt5-feed` dan `/api/market` kepada `/api/feed` yang sama (`mode=feed` / `mode=market`). `api/feed.js` ialah adapter CommonJS; `server/functions/feed-router.mjs` menyimpan batch yang telah divalidasi sebagai pemboleh ubah modul `latestFeed`, dan GET membaca modul itu. Tiada `/tmp` untuk feed; tiada storan persisten. HTTP 200 POST menandakan batch diluluskan dan ditulis ke RAM instance yang menerima POST, **bukan** bukti GET daripada instance lain nampak batch itu.

MQL5 asal (`mt5/RBFXMeter_ReadOnlyFeed.mq5`) menghantar `{"version":1,"serverOffsetSeconds":0,"instruments":[{"asset":"XAUUSD","symbol":"XAUUSD.m","quote":{"bid":2600.39,"ask":2600.41,"t":<epoch-ms>},"m1":[...],"m5":[...],"m15":[...],"h1":[...]}]}`. Setiap bar berbentuk `{ "t": <epoch-ms>, "o": <open>, "h": <high>, "l": <low>, "c": <close> }`. `asset` ialah kod kanonik pilihan portal, `symbol` ialah nama sebenar broker. EA **tidak** menghantar `entry`, `sl`, `tp1`, `tp2`, `tp3`: paras itu dikira daripada candle M15 dan syarat setup A-grade di `scripts/setup-quality.mjs`, kemudian dikembalikan dalam `levels` (array `{label,price}`). Jika tiada setup yang sah, tanda sengkang ialah tingkah laku yang benar; jangan reka paras hanya kerana POST berjaya.

Ketidakpadanan nyata: EA boleh menghantar `m5:[]` dan `h1:[]` jika sejarah broker belum lengkap, tetapi receiver lama menolak instrumen melainkan **keempat-empat** array mempunyai 30–600 candle. Patch ini melengkapkan M5 daripada M1 dan H1 daripada M15 apabila kumpulan candle lengkap mencukupi. Ia juga memetakan simbol broker (`XAUUSD.m`, `GOLD`, `EURUSD_raw`) ke asset kanonik apabila `asset` tiada; asset kanonik daripada EA asal masih digunakan. Keutamaan EA kini tamat setelah 60 saat.

## Had yang tidak boleh dibaiki dengan `/tmp`

RAM dan `/tmp` ialah **setempat kepada instance** dan boleh hilang sewaktu cold start/redeploy. Walaupun POST dan GET pada satu route yang sama, Vercel tidak menjamin ia dihantar ke instance yang sama. Oleh itu patch tanpa storan bersama ini meningkatkan keserasian payload dan kebarangkalian bacaan direct feed, tetapi **tidak boleh menjamin** setiap pelayar sentiasa melihat POST EA. Untuk jaminan merentasi instance, storan bersama atau satu server stateful tetap diperlukan. Jangan salah anggap `HTTP 200` sebagai bukti dashboard sudah menerima batch.

## Semakan

`npm ci && npm run build && npm run check && npm test` lulus tempatan. `tests/direct-feed.mjs` membuktikan POST→GET pada satu instance, penerimaan M5/H1 kosong yang boleh dibina, dan simbol suffix. Selepas deploy, semak **badan** POST (`ok:true`, `stored:true`, `accepted:["XAUUSD"]`), kemudian GET `/api/feed` (`connected:true`, `acceptedInstruments`) dan GET `/api/market?asset=XAUUSD` (`source:"RBFX_MT5"`). Uji berulang dari lokasi berlainan; status GET `connected:false` dengan POST 200 menandakan had instance.
