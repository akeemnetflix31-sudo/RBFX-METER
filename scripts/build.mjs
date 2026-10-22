import { mkdir, copyFile, access } from 'node:fs/promises';
import { build } from 'esbuild';

const outDir = new URL('../public/', import.meta.url);
await access(new URL('../index.html', import.meta.url));
await access(new URL('../owner-stats.html', import.meta.url));
await mkdir(outDir, { recursive: true });
await mkdir(new URL('../public/THIRD-PARTY-LICENSES/', import.meta.url), { recursive: true });
await copyFile(new URL('../index.html', import.meta.url), new URL('../public/index.html', import.meta.url));
await copyFile(new URL('../owner-stats.html', import.meta.url), new URL('../public/owner-stats.html', import.meta.url));
await copyFile(new URL('../THIRD-PARTY-NOTICES.md', import.meta.url), new URL('../public/THIRD-PARTY-NOTICES.md', import.meta.url));
await copyFile(new URL('../node_modules/lightweight-charts/LICENSE', import.meta.url), new URL('../public/THIRD-PARTY-LICENSES/lightweight-charts-LICENSE', import.meta.url));
await build({
  entryPoints: [new URL('./chart-widget.js', import.meta.url).pathname],
  bundle: true,
  minify: true,
  platform: 'browser',
  target: ['es2020'],
  format: 'iife',
  outfile: new URL('../public/chart.bundle.js', import.meta.url).pathname,
  legalComments: 'inline'
});
await build({
  entryPoints: [new URL('./setup-quality.mjs', import.meta.url).pathname],
  bundle: true,
  minify: true,
  platform: 'browser',
  target: ['es2020'],
  format: 'iife',
  outfile: new URL('../public/setup-quality.bundle.js', import.meta.url).pathname
});
console.log('Portal build ready: bilingual UI, interactive candlestick chart, and fail-closed EA setup quality bundle in public/.');
