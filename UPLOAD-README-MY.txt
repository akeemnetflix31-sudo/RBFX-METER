RBFX-METER — pakej sumber untuk deployment Vercel

KANDUNGAN
- Snapshot projek RBFX-METER daripada commit asas Production edae816b7ed89dfd4b4a77148d5e0fbb9c1e7b5c, bersama perubahan enjin isyarat dan label sumber.
- Kekal 10 simbol RBFX sahaja. Tiada feed ICTMACROVIP disertakan atau disambungkan.
- Tiada .git, node_modules atau fail .env/rahsia.

SEMAKAN SEBELUM DEPLOY
- Perlukan Node.js 22.x.
- npm ci
- npm test
- npm run check
- npm run build

DEPLOY
1. Ekstrak ZIP pada komputer dalam satu folder projek.
2. Buka terminal dalam folder tersebut dan pautkan ke projek Vercel RBFX-METER yang betul menggunakan Vercel CLI (`vercel link`).
3. Cipta deployment Preview dahulu (`vercel`), semak URL dan route dengan GET sahaja.
4. Jika Preview betul, jalankan deployment Production (`vercel --prod`). Jangan hantar payload ujian/fake kepada Production.

NOTA PENTING
- Pakej ini ialah snapshot fail; ia tidak mengemas kini repo GitHub. Deployment Git seterusnya daripada repo lama boleh menimpa perubahan ini.
- Feed RBFX MT5 disimpan dalam RAM instance Vercel sahaja; cold start atau routing ke instance berbeza boleh menyebabkan feed tidak kelihatan. Data awam dilabel sebagai rujukan awam, bukan quote broker yang disahkan.
- Paras setup dikira daripada candle/ATR yang layak sahaja. Status aktif tidak dipaksa. Ini bukan nasihat atau jaminan dagangan.
- Folder `mt5/` mengandungi kod sumber EA sahaja. Ia tidak dikompil atau disahkan selamat untuk live.
