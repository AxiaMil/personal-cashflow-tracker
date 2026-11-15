// Zero-dependency dev server for the app. Binds to 127.0.0.1 only. Open http://localhost:5174/app/
//
//   static files      every HTML response gets <meta name="cf-dev-token"> (a random per-run token), plus your
//                     local-only core/snapshot.local.js and core/templates.local.js when they exist
//   /ts/*            allowlisted proxy to a timesheet API (TIMESHEET_API_BASE); adds the Bearer key from .env server-side
//   /local/state      GET/PUT data/state.local.json (setup, sessions, your income sources, claim details)
//
// /ts and /local need header `x-cf-token: <token>`. Every request must carry Host localhost:PORT or
// 127.0.0.1:PORT (DNS-rebinding guard). CORS is only granted to Origin `null` (the sandboxed preview
// frames) and the exact localhost origins. Nothing here ever logs headers, the key or the token.
// Dev-only: in Muse the space's own server actions do the syncing, and dist/*.html has no token meta.
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readFile, stat, mkdir, writeFile, rename, chmod } from 'node:fs/promises';
import { dirname, extname, join, normalize } from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.md': 'text/plain; charset=utf-8' };

/* ---------- config: .env parsed by hand; process env wins when non-empty ---------- */
function parseEnv(file) {
  let text = '';
  try { text = readFileSync(file, 'utf8'); } catch { return {}; }
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m) continue;
    let v = m[2];
    if (/^(['"]).*\1$/.test(v)) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, '');
    out[m[1]] = v;
  }
  return out;
}
const FILE_ENV = parseEnv(process.env.CF_ENV_FILE || join(ROOT, '.env'));
const cfg = (k, d = '') => process.env[k] || FILE_ENV[k] || d;
const PORT = Number(cfg('PORT', '5174'));
const KEY = cfg('TIMESHEET_API_KEY');
const TIMESHEET_API_BASE = cfg('TIMESHEET_API_BASE', 'http://127.0.0.1:9/none').replace(/\/+$/, ''); // set TIMESHEET_API_BASE in .env to use live sync
const STATE_FILE = process.env.CF_STATE_FILE || join(ROOT, 'data', 'state.local.json');
const RATE_PER_MIN = Number(cfg('TIMESHEET_RATE_PER_MIN', '55')); // stay under the API's per-minute limit
const TOKEN = randomBytes(24).toString('base64url');
{
  const u = new URL(TIMESHEET_API_BASE);
  const local = u.hostname === '127.0.0.1' || u.hostname === 'localhost';
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) { console.error('TIMESHEET_API_BASE must be https (or http on 127.0.0.1 for the mock).'); process.exit(1); }
}

/* ---------- guards ---------- */
const HOSTS = new Set([`localhost:${PORT}`, `127.0.0.1:${PORT}`]);
const ORIGINS = new Set(['null', `http://localhost:${PORT}`, `http://127.0.0.1:${PORT}`]);
const TOKEN_BUF = Buffer.from(TOKEN);
const tokenOk = (t) => typeof t === 'string' && t.length === TOKEN.length && timingSafeEqual(Buffer.from(t), TOKEN_BUF);
function cors(req) {
  const o = req.headers.origin;
  if (o === undefined || !ORIGINS.has(o)) return {};
  return { 'access-control-allow-origin': o, 'access-control-expose-headers': 'retry-after', vary: 'Origin' };
}
function send(res, status, obj, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers }).end(obj === undefined ? '' : JSON.stringify(obj));
}
const proxyErr = (res, req, status, error, extra = {}, headers = {}) => send(res, status, { error, source: 'dev-proxy', ...extra }, { ...cors(req), ...headers });

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let n = 0;
    req.on('data', (c) => { n += c.length; if (n > limit) { reject(Object.assign(new Error('too large'), { code: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/* ---------- /ts allowlist (exact method + path; raw, undecoded path; no query strings) ---------- */
const M = '(20[0-9]{2}-(?:0[1-9]|1[0-2]))', K = '(timesheet|leave|expenses)', ID = '([A-Za-z0-9_-]{1,80})';
const ROUTES = [
  ['GET', new RegExp('^/me$')],
  ['GET', new RegExp(`^/months/${M}/${K}$`)],
  ['PUT', new RegExp(`^/months/${M}/${K}/entries/${ID}$`)],
  ['DELETE', new RegExp(`^/months/${M}/${K}/entries/${ID}$`)],
  ['POST', new RegExp('^/attachments$')],
  ['GET', new RegExp(`^/attachments/${ID}$`)],
];
const allowed = (method, path) => ROUTES.some(([m, re]) => m === method && re.test(path));

/* ---------- rate guard: sliding 60 s window over requests actually sent upstream ---------- */
const sent = [];
let blockedUntil = 0; // set from an upstream 429's Retry-After
function rateWait() {
  const now = Date.now();
  while (sent.length && now - sent[0] >= 60_000) sent.shift();
  if (now < blockedUntil) return Math.ceil((blockedUntil - now) / 1000);
  if (sent.length >= RATE_PER_MIN) return Math.max(1, Math.ceil((sent[0] + 60_000 - now) / 1000));
  sent.push(now);
  return 0;
}

/* ---------- GET coalescing + micro-cache, so three preview frames loading at once cost one call each.
   A write to a form bumps its generation: stale in-flight reads are neither joined nor cached. ---------- */
const CACHE_MS = Number(cfg('TIMESHEET_GET_CACHE_MS', '3000'));
const cache = new Map(), inflight = new Map(), gen = new Map();
const formKey = (path) => (/^\/months\/[^/]+\/[^/]+/.exec(path) || [path])[0];
const ttl = (path) => (path === '/me' ? 60_000 : /^\/months\//.test(path) ? CACHE_MS : 0);
const bump = (path) => { const k = formKey(path); gen.set(k, (gen.get(k) || 0) + 1); cache.delete(k); };

async function upstream(method, path, body, contentType) {
  const headers = { authorization: `Bearer ${KEY}`, accept: 'application/json' };
  if (body && body.length) headers['content-type'] = contentType || 'application/json';
  const r = await fetch(TIMESHEET_API_BASE + path, { method, headers, body: body && body.length ? body : undefined, redirect: 'manual', signal: AbortSignal.timeout(20_000) });
  const out = { status: r.status, body: Buffer.from(await r.arrayBuffer()), headers: {} };
  for (const h of ['content-type', 'retry-after', 'content-disposition']) { const v = r.headers.get(h); if (v) out.headers[h] = v; }
  if (r.status === 429) blockedUntil = Date.now() + 1000 * Math.min(120, Number(out.headers['retry-after']) || 30);
  return out;
}
async function cachedGet(path) {
  const k = formKey(path), g = gen.get(k) || 0, t = ttl(path);
  const hit = t && cache.get(path);
  if (hit && hit.g === g && Date.now() - hit.at < t) return hit.r;
  const fl = inflight.get(path);
  if (fl && fl.g === g) return fl.p;
  const wait = rateWait();
  if (wait) return { limited: wait };
  const p = upstream('GET', path).then((r) => { if (t && r.status === 200 && (gen.get(k) || 0) === g) cache.set(path, { g, at: Date.now(), r }); return r; })
    .finally(() => { if (inflight.get(path) && inflight.get(path).p === p) inflight.delete(path); });
  inflight.set(path, { g, p });
  return p;
}

async function handleTimesheet(req, res, rawPath, search) {
  const path = rawPath.slice('/ts'.length) || '/';
  if (search || !allowed(req.method, path)) return proxyErr(res, req, 403, 'This request is not on the dev proxy allowlist.');
  if (!KEY) return proxyErr(res, req, 503, 'no key');
  let body = null;
  if (req.method === 'PUT' || req.method === 'DELETE' || req.method === 'POST') {
    try { body = await readBody(req, req.method === 'POST' ? 11 * 1024 * 1024 : 300 * 1024); }
    catch (e) { return proxyErr(res, req, e.code === 413 ? 413 : 400, e.code === 413 ? 'Request too large.' : 'Could not read the request body.'); }
  }
  const t0 = Date.now();
  let r;
  try {
    if (req.method === 'GET' && !path.startsWith('/attachments/')) r = await cachedGet(path);
    else {
      const wait = rateWait();
      if (wait) r = { limited: wait };
      else {
        const write = req.method === 'PUT' || req.method === 'DELETE';
        if (write) bump(path);
        try { r = await upstream(req.method, path, body, req.headers['content-type']); } finally { if (write) bump(path); }
      }
    }
  } catch (e) {
    const timeout = e && (e.name === 'TimeoutError' || e.name === 'AbortError');
    console.log(`ts ${req.method} ${path} -> ${timeout ? 'timeout' : 'unreachable'}`);
    return proxyErr(res, req, timeout ? 504 : 502, timeout ? 'The timesheet API took too long to answer.' : 'Could not reach the timesheet API.');
  }
  if (r.limited) {
    console.log(`ts ${req.method} ${path} -> held by local rate guard (${r.limited}s)`);
    return proxyErr(res, req, 429, 'rate limited', { retryAfter: r.limited }, { 'retry-after': String(r.limited) });
  }
  console.log(`ts ${req.method} ${path} -> ${r.status} (${Date.now() - t0}ms)`);
  res.writeHead(r.status, { 'cache-control': 'no-store', ...r.headers, ...cors(req) }).end(r.body);
}

/* ---------- /local/state ---------- */
let tmpSeq = 0;
async function handleLocal(req, res) {
  const h = cors(req);
  if (req.method === 'GET') {
    let text;
    try { text = await readFile(STATE_FILE, 'utf8'); } catch { return send(res, 200, null, h); }
    try { return send(res, 200, JSON.parse(text), h); } catch { return send(res, 500, { error: 'state file is not valid JSON', source: 'dev-proxy' }, h); }
  }
  if (req.method === 'PUT') {
    let obj;
    try { obj = JSON.parse((await readBody(req, 4 * 1024 * 1024)).toString('utf8')); } catch (e) { return send(res, e.code === 413 ? 413 : 400, { error: e.code === 413 ? 'state too large' : 'invalid JSON', source: 'dev-proxy' }, h); }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return send(res, 400, { error: 'state must be a JSON object', source: 'dev-proxy' }, h);
    await mkdir(dirname(STATE_FILE), { recursive: true, mode: 0o700 });
    const tmp = `${STATE_FILE}.${process.pid}.${++tmpSeq}.tmp`;
    await writeFile(tmp, JSON.stringify(obj, null, 2) + '\n', { mode: 0o600 });
    await rename(tmp, STATE_FILE);
    await chmod(STATE_FILE, 0o600);
    return send(res, 200, { ok: true, savedAt: new Date().toISOString() }, h);
  }
  return send(res, 405, { error: 'method not allowed', source: 'dev-proxy' }, { ...h, allow: 'GET, PUT' });
}

/* ---------- static ---------- */
const META = `<meta name="cf-dev-token" content="${TOKEN}">`;
const exists = (rel) => stat(join(ROOT, rel)).then(() => true, () => false);
async function injectDev(html) {
  const i = html.search(/<\/head>/i);
  html = i >= 0 ? html.slice(0, i) + META + '\n' + html.slice(i) : META + '\n' + html;
  // Your own data and claim template stay out of git; load them before core/data.js when present
  const extra = [];
  for (const f of ['core/snapshot.local.js', 'core/templates.local.js']) if (await exists(f)) extra.push(`<script src="/${f}"></script>`);
  return extra.length ? html.replace('<script src="../core/data.js"></script>', () => `${extra.join('\n')}\n<script src="../core/data.js"></script>`) : html;
}
async function handleStatic(req, res, pathname) {
  if (pathname === '/') { res.writeHead(302, { location: '/app/' }).end(); return; }
  try {
    const p = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '');
    let f = join(ROOT, p);
    if (!f.startsWith(ROOT) || /(^|[/\\])\.(env|git)/.test(p) || /^[/\\]data([/\\]|$)/.test(p)) { res.writeHead(403).end('Forbidden'); return; }
    if ((await stat(f)).isDirectory()) f = join(f, 'index.html');
    let body = await readFile(f);
    if (extname(f) === '.html') body = await injectDev(body.toString('utf8'));
    res.writeHead(200, { 'content-type': TYPES[extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' }).end(body);
  } catch { res.writeHead(404).end('Not found'); }
}

http.createServer(async (req, res) => {
  try {
    if (!HOSTS.has(req.headers.host || '')) { res.writeHead(403, { 'content-type': 'text/plain' }).end('Forbidden host'); return; }
    const u = new URL(req.url, 'http://x');
    const api = u.pathname === '/ts' || u.pathname.startsWith('/ts/') || u.pathname === '/local/state';
    if (!api) return handleStatic(req, res, u.pathname);
    const origin = req.headers.origin;
    if (origin !== undefined && !ORIGINS.has(origin)) return send(res, 403, { error: 'origin not allowed', source: 'dev-proxy' });
    if (req.method === 'OPTIONS') {
      if (origin === undefined) return send(res, 400, { error: 'preflight without Origin', source: 'dev-proxy' });
      res.writeHead(204, { ...cors(req), 'access-control-allow-methods': 'GET, PUT, DELETE, POST', 'access-control-allow-headers': 'x-cf-token, content-type', 'access-control-max-age': '600' }).end();
      return;
    }
    if (!tokenOk(req.headers['x-cf-token'])) return proxyErr(res, req, 401, 'bad token', { code: 'token' });
    if (u.pathname === '/local/state') return handleLocal(req, res);
    return handleTimesheet(req, res, u.pathname, u.search);
  } catch (e) {
    console.log(`dev server error: ${e && e.name}`);
    if (!res.headersSent) send(res, 500, { error: 'dev server error', source: 'dev-proxy' });
  }
}).on('error', (e) => {
  console.error(e.code === 'EADDRINUSE' ? `Port ${PORT} is already in use. Set PORT to another one.` : `Server error: ${e.code || e.name}`);
  process.exit(1);
}).listen(PORT, '127.0.0.1', () => {
  console.log(`App on http://localhost:${PORT}/app/`);
  console.log(KEY ? `Timesheet proxy on /ts -> ${new URL(TIMESHEET_API_BASE).host} (key loaded)` : 'Timesheet proxy: no TIMESHEET_API_KEY, /ts/* answers 503');
});
