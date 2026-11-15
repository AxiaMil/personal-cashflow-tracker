// Inline the app into ONE self-contained HTML file (the shape a Muse space ships as) and fail the build if
// anything would reach the network (Muse spaces can't load CDNs or web fonts).
//   node tools/build.mjs            -> dist/cashflow.html, the blank app (what you give Muse)
//   node tools/build.mjs --local    -> dist/cashflow.local.html, with your local-only data and template baked in
import { fileURLToPath } from 'node:url';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');
const LOCAL = process.argv.includes('--local');
const file = join(ROOT, 'app', 'index.html');
let html = await readFile(file, 'utf8');
const base = dirname(file);
const inline = async (src) => { try { return await readFile(resolve(base, src), 'utf8'); } catch { return null; } };
if (LOCAL) html = html.replace('<script src="../core/data.js"></script>', '<script src="../core/snapshot.local.js"></script>\n<script src="../core/templates.local.js"></script>\n<script src="../core/data.js"></script>');
for (const m of [...html.matchAll(/<link rel="stylesheet" href="([^"]+)"\s*\/?>/g)]) { const css = await inline(m[1]); html = html.replace(m[0], () => (css == null ? '' : `<style>/* ${m[1]} */\n${css}</style>`)); } // function form: "$'" in code must not act as a replacement pattern
for (const m of [...html.matchAll(/<script src="([^"]+)"><\/script>/g)]) { const js = await inline(m[1]); html = html.replace(m[0], () => (js == null ? `<!-- ${m[1]} not found -->` : `<script>/* ${m[1]} */\n${js.replace(/<\/script/gi, () => '<\\/script')}</script>`)); }
let failed = false;
const leftovers = [...html.matchAll(/<script[^>]*\ssrc=|<link[^>]*rel="stylesheet"[^>]*href=/gi)].length;
if (leftovers) { failed = true; console.error(`✗ ${leftovers} script/stylesheet tag(s) still point at files, not inlined`); }
const external = [...html.matchAll(/(?:src|href)\s*=\s*["'](https?:)?\/\/[^"']+|@import|url\(\s*["']?https?:/gi)].map((m) => m[0]).filter((u) => !/xmlns|w3\.org\/2000\/svg/.test(u));
if (external.length) { failed = true; console.error(`✗ external references -> ${external.slice(0, 5).join(', ')}`); }
if (!LOCAL && /CF\.snapshot\s*=|CF\.templates\s*=/.test(html)) { failed = true; console.error('✗ local-only data found in the public build'); }
await mkdir(join(ROOT, 'dist'), { recursive: true });
const out = join(ROOT, 'dist', LOCAL ? 'cashflow.local.html' : 'cashflow.html');
await writeFile(out, html);
console.log(`${failed ? '✗' : '✓'} ${out.slice(ROOT.length + 1)}  ${(html.length / 1024).toFixed(0)} KB, self-contained${LOCAL ? ', with your local data' : ''}`);
process.exit(failed ? 1 : 0);
