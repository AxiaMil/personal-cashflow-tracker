// End-to-end checks for the dev proxy (tools/serve.mjs), core/live.js and the timesheet mock (tools/mock-timesheets.mjs).
//   node tools/test-live.mjs            all checks, then a GET-only smoke test of the real API via the proxy
//   node tools/test-live.mjs --no-real  skip the real-API smoke test
// Every write goes to the mock on 127.0.0.1:5175. The real API only ever sees two GETs (/me and the Nov 2026
// timesheet), and only status codes and JSON key names are printed. Local state goes to a temp dir, not data/.
import { spawn } from 'node:child_process';
import http from 'node:http';
import vm from 'node:vm';
import { randomBytes } from 'node:crypto';
import { readFileSync, existsSync, mkdtempSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMock } from './mock-timesheets.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');
const REAL = !process.argv.includes('--no-real');
const MOCK_PORT = 5175, PORT = 5176, PORT_NOKEY = 5177, PORT_RATE = 5178, PORT_REAL = 5179;
const TEST_KEY = 'ts_test_' + randomBytes(16).toString('hex');
const TMP = mkdtempSync(join(tmpdir(), 'cf-live-test-'));
const STATE_FILE = join(TMP, 'state.local.json');

let passed = 0, failed = 0;
function check(name, ok, info = '') {
  ok ? passed++ : failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? `  (${info})` : ''}`);
}
const section = (t) => console.log(`\n# ${t}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/* ---------- helpers ---------- */
const leaks = [];
function raw(port, method, path, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if (text.includes(TEST_KEY) || JSON.stringify(res.headers).includes(TEST_KEY)) leaks.push(`${method} ${path}`);
        let json = null; try { json = JSON.parse(text); } catch {}
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    req.on('error', reject);
    if (body !== undefined) req.write(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
    req.end();
  });
}
const children = [];
function cleanEnv(extra) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (/^(TIMESHEET_|CF_|MOCK_)/.test(k) || k === 'PORT') delete env[k];
  return { ...env, ...extra };
}
async function startServe(port, extra) {
  const child = spawn(process.execPath, [join(ROOT, 'tools', 'serve.mjs')], { env: cleanEnv({ PORT: String(port), ...extra }), stdio: ['ignore', 'pipe', 'pipe'] });
  const out = { text: '' };
  child.stdout.on('data', (d) => (out.text += d)); child.stderr.on('data', (d) => (out.text += d));
  children.push(child);
  for (let i = 0; i < 50; i++) {
    try { const r = await raw(port, 'GET', '/app/'); if (r.status === 200) { const m = /<meta name="cf-dev-token" content="([^"]+)">/.exec(r.text); return { child, out, token: m && m[1] }; } } catch {}
    await sleep(100);
  }
  throw new Error(`serve.mjs did not start on ${port}: ${out.text.slice(0, 300)}`);
}
const stop = (s) => new Promise((r) => { if (s.child.exitCode != null) return r(); s.child.once('exit', r); s.child.kill(); });
const shape = (o) => (Array.isArray(o) ? `[${o.length}]` : o && typeof o === 'object' ? `{${Object.keys(o).join(', ')}}` : typeof o);

const mock = createMock({ key: TEST_KEY, ratePerMin: 10000 });
let main, exitCode = 1;
try {
  await mock.listen(MOCK_PORT);
  main = await startServe(PORT, { TIMESHEET_API_BASE: `http://127.0.0.1:${MOCK_PORT}`, TIMESHEET_API_KEY: TEST_KEY, CF_ENV_FILE: join(TMP, 'no.env'), CF_STATE_FILE: STATE_FILE, TIMESHEET_RATE_PER_MIN: '1000', TIMESHEET_GET_CACHE_MS: '0' });
  const T = main.token;
  const auth = { 'x-cf-token': T };

  section('static files + token injection');
  {
    const page = await raw(PORT, 'GET', '/app/');
    const at = page.text.indexOf('<meta name="cf-dev-token"'), head = page.text.search(/<\/head>/i);
    check('HTML gets the token meta before </head>', page.status === 200 && !!T && T.length >= 32 && at > 0 && at < head);
    const js = await raw(PORT, 'GET', '/core/data.js');
    check('non-HTML files are served untouched', js.status === 200 && !js.text.includes('cf-dev-token'));
    check('/.env is 403', (await raw(PORT, 'GET', '/.env')).status === 403);
    check('/.git/HEAD is 403', (await raw(PORT, 'GET', '/.git/HEAD')).status === 403);
    check('/data/state.local.json is 403 (local state only via /local/state)', (await raw(PORT, 'GET', '/data/state.local.json')).status === 403);
    check('/ts/../.env resolves to the static 403', (await raw(PORT, 'GET', '/ts/../.env')).status === 403);
  }

  section('token requirement');
  {
    const none = await raw(PORT, 'GET', '/ts/me');
    check('/ts/me without x-cf-token is 401', none.status === 401 && none.json && none.json.code === 'token');
    const wrong = await raw(PORT, 'GET', '/ts/me', { headers: { 'x-cf-token': 'x'.repeat(T.length) } });
    check('/ts/me with a wrong token is 401', wrong.status === 401);
    check('/local/state without token is 401', (await raw(PORT, 'GET', '/local/state')).status === 401);
    check('PUT /local/state without token is 401', (await raw(PORT, 'PUT', '/local/state', { headers: { 'content-type': 'application/json' }, body: { version: 1 } })).status === 401);
    const ok = await raw(PORT, 'GET', '/ts/me', { headers: auth });
    check('/ts/me with the token is 200 and Me-shaped', ok.status === 200 && eq(Object.keys(ok.json), ['userId', 'fullName', 'workEmail', 'scopes']));
    const last = mock.log[mock.log.length - 1];
    check('upstream got the Bearer key', last && last.path === '/me' && last.auth === true);
    check('upstream did not get x-cf-token, origin, cookie or referer', last && !last.headerNames.some((h) => ['x-cf-token', 'origin', 'cookie', 'referer'].includes(h)), last && last.headerNames.join(' '));
  }

  section('allowlist');
  {
    const before = mock.log.length;
    const blocked = [
      ['GET', '/ts/admin'], ['GET', '/ts'], ['GET', '/ts/'], ['DELETE', '/ts/me'], ['POST', '/ts/me'], ['GET', '/ts/openapi.json'],
      ['GET', '/ts/months/2026-13/timesheet'], ['GET', '/ts/months/26-11/timesheet'], ['GET', '/ts/months/2026-11/claims'],
      ['GET', '/ts/months/2026-11/timesheet?x=1'], ['GET', '/ts/months/2026-11/timesheet/entries/2026-11-03'],
      ['PUT', '/ts/months/2026-11/timesheet/entries/bad.id'], ['PUT', '/ts/months/2026-11/timesheet/entries/a%2Fb'],
      ['PUT', '/ts/months/2026-11/timesheet'], ['GET', '/ts/attachments/a%2Fb'], ['GET', '/ts/attachments'],
      ['GET', '/ts/months/2026-11/timesheet/%2e%2e/%2e%2e/%2e%2e/admin'], ['PATCH', '/ts/months/2026-11/timesheet/entries/2026-11-03'],
      ['PUT', `/ts/months/2026-11/expenses/entries/${'a'.repeat(81)}`],
    ];
    const res = await Promise.all(blocked.map(([m, p]) => raw(PORT, m, p, { headers: { ...auth, 'content-type': 'application/json' }, body: m === 'GET' ? undefined : '{}' })));
    const wrong = blocked.filter((_, i) => res[i].status !== 403).map(([m, p], i) => `${m} ${p}`);
    check(`${blocked.length} off-list requests (e.g. GET /ts/admin) are 403`, !wrong.length, wrong.join('; '));
    check('none of them reached the upstream', mock.log.length === before);
    const ok = await raw(PORT, 'GET', '/ts/months/2026-11/timesheet', { headers: auth });
    check('GET /ts/months/2026-11/timesheet is allowed', ok.status === 200 && ok.json.kind === 'timesheet');
  }

  section('Host check (DNS rebinding) + CORS');
  {
    check('Host evil.example:5176 on /ts/me is 403', (await raw(PORT, 'GET', '/ts/me', { headers: { ...auth, host: `evil.example:${PORT}` } })).status === 403);
    check('Host evil.example:5176 on a page is 403 (token not readable via rebinding)', (await raw(PORT, 'GET', '/app/', { headers: { host: `evil.example:${PORT}` } })).status === 403);
    check('Host localhost:9999 is 403', (await raw(PORT, 'GET', '/ts/me', { headers: { ...auth, host: 'localhost:9999' } })).status === 403);
    check('Host localhost:5176 is allowed', (await raw(PORT, 'GET', '/ts/me', { headers: { ...auth, host: `localhost:${PORT}` } })).status === 200);
    const pre = await raw(PORT, 'OPTIONS', '/ts/months/2026-11/timesheet/entries/2026-11-05', { headers: { origin: 'null', 'access-control-request-method': 'PUT', 'access-control-request-headers': 'x-cf-token, content-type' } });
    check('preflight from Origin null is 204 with ACAO null', pre.status === 204 && pre.headers['access-control-allow-origin'] === 'null');
    check('preflight allows x-cf-token + content-type and PUT/DELETE/POST', /x-cf-token/.test(pre.headers['access-control-allow-headers'] || '') && /content-type/.test(pre.headers['access-control-allow-headers'] || '') && /PUT/.test(pre.headers['access-control-allow-methods'] || '') && /DELETE/.test(pre.headers['access-control-allow-methods'] || '') && /POST/.test(pre.headers['access-control-allow-methods'] || ''));
    check('preflight on /local/state from Origin null is 204', (await raw(PORT, 'OPTIONS', '/local/state', { headers: { origin: 'null', 'access-control-request-method': 'PUT' } })).status === 204);
    const evilPre = await raw(PORT, 'OPTIONS', '/ts/me', { headers: { origin: 'https://evil.example', 'access-control-request-method': 'GET' } });
    check('preflight from another origin is 403 without ACAO', evilPre.status === 403 && !evilPre.headers['access-control-allow-origin']);
    const nul = await raw(PORT, 'GET', '/ts/me', { headers: { ...auth, origin: 'null' } });
    check('GET from Origin null gets ACAO null + Vary: Origin', nul.status === 200 && nul.headers['access-control-allow-origin'] === 'null' && /origin/i.test(nul.headers.vary || ''));
    const lh = await raw(PORT, 'GET', '/ts/me', { headers: { ...auth, origin: `http://localhost:${PORT}` } });
    check('GET from http://localhost:5176 echoes that origin', lh.headers['access-control-allow-origin'] === `http://localhost:${PORT}`);
    const evil = await raw(PORT, 'GET', '/ts/me', { headers: { ...auth, origin: 'https://evil.example' } });
    check('GET from another origin is 403 even with the token', evil.status === 403 && !evil.headers['access-control-allow-origin']);
    check('GET http://localhost:5174 origin (other port) is 403', (await raw(PORT, 'GET', '/ts/me', { headers: { ...auth, origin: 'http://localhost:5174' } })).status === 403);
    const page = await raw(PORT, 'GET', '/app/', { headers: { origin: 'null' } });
    check('pages never carry CORS headers', !page.headers['access-control-allow-origin']);
    const t401 = await raw(PORT, 'GET', '/ts/me', { headers: { origin: 'null' } });
    check('401 for a missing token is readable by the sandboxed frame', t401.status === 401 && t401.headers['access-control-allow-origin'] === 'null');
  }

  section('/local/state');
  {
    const g0 = await raw(PORT, 'GET', '/local/state', { headers: auth });
    check('GET before any save is 200 null', g0.status === 200 && g0.json === null);
    const seed = { version: 2, savedAt: '2026-11-15T00:00:00.000Z', custom: [{ id: 'src-test', label: 'Test gig', short: 'Gig', type: 'one-off', rateCents: null, entries: [{ id: 'ie-1', date: '2026-11-08', amountCents: 5000, qty: null, note: '' }] }], gig: {}, hourly: {} };
    const p = await raw(PORT, 'PUT', '/local/state', { headers: { ...auth, 'content-type': 'application/json' }, body: seed });
    check('PUT saves', p.status === 200 && p.json.ok === true);
    const g1 = await raw(PORT, 'GET', '/local/state', { headers: auth });
    check('GET returns exactly what was PUT', g1.status === 200 && eq(g1.json, seed));
    check('file is chmod 600', existsSync(STATE_FILE) && (statSync(STATE_FILE).mode & 0o777) === 0o600);
    check('invalid JSON is 400', (await raw(PORT, 'PUT', '/local/state', { headers: { ...auth, 'content-type': 'application/json' }, body: '{nope' })).status === 400);
    check('a JSON array is 400', (await raw(PORT, 'PUT', '/local/state', { headers: { ...auth, 'content-type': 'application/json' }, body: '[]' })).status === 400);
    check('state is unchanged after rejected PUTs', eq((await raw(PORT, 'GET', '/local/state', { headers: auth })).json, seed));
  }

  section('no key -> 503');
  {
    const nk = await startServe(PORT_NOKEY, { TIMESHEET_API_BASE: `http://127.0.0.1:${MOCK_PORT}`, TIMESHEET_API_KEY: '', CF_ENV_FILE: join(TMP, 'no.env'), CF_STATE_FILE: STATE_FILE });
    const r = await raw(PORT_NOKEY, 'GET', '/ts/me', { headers: { 'x-cf-token': nk.token } });
    check('/ts/me is 503 {error:"no key"}', r.status === 503 && r.json && r.json.error === 'no key');
    check('each run gets its own token', nk.token && nk.token !== T);
    check('old token is rejected by the new run', (await raw(PORT_NOKEY, 'GET', '/local/state', { headers: auth })).status === 401);
    await stop(nk);
  }

  section('rate guard + GET coalescing');
  {
    const rg = await startServe(PORT_RATE, { TIMESHEET_API_BASE: `http://127.0.0.1:${MOCK_PORT}`, TIMESHEET_API_KEY: TEST_KEY, CF_ENV_FILE: join(TMP, 'no.env'), CF_STATE_FILE: STATE_FILE, TIMESHEET_RATE_PER_MIN: '3' });
    const h = { 'x-cf-token': rg.token }, before = mock.log.length;
    const three = await Promise.all([1, 2, 3].map(() => raw(PORT_RATE, 'GET', '/ts/months/2026-11/timesheet', { headers: h })));
    check('3 concurrent identical GETs all succeed', three.every((r) => r.status === 200));
    check('...and cost one upstream request', mock.log.length - before === 1, `${mock.log.length - before} sent`);
    await raw(PORT_RATE, 'GET', '/ts/months/2026-11/leave', { headers: h });
    await raw(PORT_RATE, 'GET', '/ts/months/2026-11/expenses', { headers: h });
    const fourth = await raw(PORT_RATE, 'GET', '/ts/months/2026-10/timesheet', { headers: h });
    check('the request over the per-minute budget is 429 with Retry-After', fourth.status === 429 && Number(fourth.headers['retry-after']) > 0 && fourth.json.source === 'dev-proxy');
    check('...and never reached the upstream', mock.log.length - before === 3);
    await stop(rg);
  }

  section('core/live.js end-to-end (Node, against the mock)');
  {
    let offline = false, badToken = false;
    const realFetch = globalThis.fetch;
    globalThis.window = globalThis;
    globalThis.location = { search: '?today=2026-11-15' }; // pin "now" to Nov 2026, which the mock seeds
    globalThis.matchMedia = () => ({ matches: false });
    globalThis.document = { querySelector: (sel) => (sel === 'meta[name="cf-dev-token"]' ? { getAttribute: (a) => (a === 'content' ? T : null) } : null) };
    globalThis.fetch = (u, o = {}) => {
      if (offline) return Promise.reject(new TypeError('fetch failed'));
      if (badToken) o = { ...o, headers: { ...o.headers, 'x-cf-token': 'stale-token-from-an-old-run' } };
      return realFetch(new URL(u, `http://127.0.0.1:${PORT}`), o);
    };
    const load = (f) => { const p = join(ROOT, f); if (existsSync(p)) vm.runInThisContext(readFileSync(p, 'utf8'), { filename: p }); return existsSync(p); };
    load('core/format.js');
    const hasSnap = load('core/snapshot.local.js');
    load('core/data.js');
    load('core/live.js');
    const CF = globalThis.CF, D = CF.data, A = CF.actions;
    const L = await Promise.race([CF.live.ready, sleep(10000).then(() => null)]);
    check('CF.live.ready resolves', !!L, hasSnap ? 'with snapshot.local.js' : 'without snapshot.local.js');
    check('available, status ok, remote wired', CF.live.available === true && CF.live.status === 'ok' && D.hasRemote(), `status=${CF.live.status} ${CF.live.error || ''}`);
    check('CF.live.me is Me-shaped', CF.live.me && eq(Object.keys(CF.live.me), ['userId', 'fullName', 'workEmail', 'scopes']));
    check('sync is {source:live, status:ok, at}', D.sync().source === 'live' && D.sync().status === 'ok' && !!Date.parse(D.sync().at));
    const ts = () => D.form('2026-11', 'timesheet'), mts = () => mock.form('2026-11', 'timesheet');
    check('Nov timesheet ingested (mock revision + entries)', ts() && ts().revision === mts().revision && ts().entries.length === 3 && ts().status === 'draft');
    const bal = (t) => (D.form('2026-11', 'leave').balances || []).find((b) => b.type === t) || {};
    check('Nov leave balances ingested (AL 12, MC 10)', bal('AL').balance === 12 && bal('MC').balance === 10);
    check('Nov expenses ingested (empty)', D.form('2026-11', 'expenses') && D.form('2026-11', 'expenses').entries.length === 0);
    check('previous month (Oct) forms ingested too', ['timesheet', 'leave', 'expenses'].every((k) => D.form('2026-10', k) && D.form('2026-10', k).revision === 0));
    check('month view-model reads the live timesheet', D.month('2026-11').job.entries.length === 3 && D.month('2026-11').job.revision === mts().revision);
    check('/local/state imported (custom income source)', D.custom().length === 1 && D.custom()[0].id === 'src-test');

    await A.saveGigSession({ entry: { id: 'gig-test-1', date: '2026-11-14', venue: 'Test venue', timeIn: '15:00', timeOut: '16:00', sessionsCount: 1, rateCents: 4200, remarks: '' } });
    await sleep(700);
    const st = (await raw(PORT, 'GET', '/local/state', { headers: auth })).json;
    check('a local edit is persisted to /local/state', st && st.version === 2 && (st.gig['2026-11'] || []).some((s) => s.id === 'gig-test-1') && st.custom.length === 1);

    const day = (date, extra = {}) => ({ date, start: '09:00', end: '17:30', breakStart: '12:30', breakEnd: '13:00', overtimeMinutes: 0, attendanceCode: '', privateRemarks: '', ...extra });
    let r = await A.saveWorkEntry({ month: '2026-11', entry: day('2026-11-05') });
    check('saveWorkEntry (new day) ok', r.ok && mts().data.entries.some((e) => e.date === '2026-11-05') && ts().revision === mts().revision && ts().entries.length === 4, r.error);
    r = await A.saveWorkEntry({ month: '2026-11', entry: day('2026-11-05', { overtimeMinutes: 30 }), previousDate: '2026-11-05' });
    check('saveWorkEntry (edit) ok', r.ok && mts().data.entries.find((e) => e.date === '2026-11-05').overtimeMinutes === 30 && ts().revision === mts().revision, r.error);
    r = await A.deleteWorkEntry({ month: '2026-11', date: '2026-11-05' });
    check('deleteWorkEntry ok', r.ok && !mts().data.entries.some((e) => e.date === '2026-11-05') && ts().entries.length === 3 && ts().revision === mts().revision, r.error);

    r = await A.saveLeaveEntry({ month: '2026-11', entry: { id: 'lv-test-1', type: 'AL', from: '2026-11-12', to: '2026-11-12', days: 1, reason: 'Mock leave', attachmentIds: [] } });
    check('saveLeaveEntry ok', r.ok && mock.form('2026-11', 'leave').data.entries.length === 1, r.error);
    check('leave balances refreshed after the write (AL 11 left)', bal('AL').taken === 1 && bal('AL').balance === 11 && D.form('2026-11', 'leave').revision === mock.form('2026-11', 'leave').revision);

    const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
    const up = await A.uploadAttachment({ kind: 'expenses', month: '2026-11', file: new File([PNG], 'receipt.png', { type: 'image/png' }) });
    check('uploadAttachment (multipart through the proxy) ok', up.ok && /^att_/.test(up.id) && up.name === 'receipt.png', up.error);
    const dl = await raw(PORT, 'GET', `/ts/attachments/${up.id}`, { headers: auth });
    check('GET /ts/attachments/{id} returns the same bytes', dl.status === 200 && dl.headers['content-type'] === 'image/png');
    r = await A.saveExpenseEntry({ month: '2026-11', entry: { id: 'ex-test-1', date: '2026-11-11', description: 'Mock taxi', amountCents: 1234, attachmentIds: [up.id], localOnlyField: 'stripped by live.js' } });
    check('saveExpenseEntry ok (unknown fields stripped, attachment linked)', r.ok && eq(mock.form('2026-11', 'expenses').data.entries[0], { id: 'ex-test-1', date: '2026-11-11', description: 'Mock taxi', amountCents: 1234, attachmentIds: [up.id] }), r.error);

    // Forced 409: someone edits the timesheet on the website behind the client's back.
    mock.patch('2026-11', 'timesheet', (f) => { f.revision += 1; f.data.entries[0].privateRemarks = 'edited elsewhere'; });
    let puts = mock.log.filter((x) => x.method === 'PUT').length;
    r = await A.saveWorkEntry({ month: '2026-11', entry: day('2026-11-06') });
    check('409 -> {ok:false, conflict:true} with a plain-English error', !r.ok && r.conflict === true && !r.readOnly && /changed on the timesheet API/.test(r.error), r.error);
    check('409 -> latest form re-read and ingested', ts().revision === mts().revision && ts().entries[0].privateRemarks === 'edited elsewhere');
    check('409 -> no automatic retry', mock.log.filter((x) => x.method === 'PUT').length === puts + 1 && !mts().data.entries.some((e) => e.date === '2026-11-06'));
    r = await A.saveWorkEntry({ month: '2026-11', entry: day('2026-11-06') });
    check('saving again after reconciling succeeds', r.ok && mts().data.entries.some((e) => e.date === '2026-11-06'), r.error);

    // Non-draft: the timesheet gets signed on the website.
    mock.patch('2026-11', 'timesheet', (f) => { f.status = 'signed'; });
    r = await A.saveWorkEntry({ month: '2026-11', entry: day('2026-11-09') });
    check('signed form -> {ok:false, conflict:true, readOnly:true}', !r.ok && r.conflict && r.readOnly && /read-only/.test(r.error), r.error);
    check('signed status ingested', ts().status === 'signed' && D.month('2026-11').job.status === 'signed');
    const n = mock.log.length;
    const r2 = await A.saveWorkEntry({ month: '2026-11', entry: day('2026-11-10') });
    const r3 = await A.deleteWorkEntry({ month: '2026-11', date: '2026-11-06' });
    check('further edits are refused locally without calling the API', !r2.ok && !r3.ok && /read-only/.test(r2.error) && mock.log.length === n);

    // Entry limit: the server already has 26 expenses (filled elsewhere, same revision).
    mock.patch('2026-11', 'expenses', (f) => { for (let i = f.data.entries.length; i < 26; i++) f.data.entries.push({ id: `ex-fill-${i}`, date: '2026-11-02', description: 'Filler', amountCents: 100, attachmentIds: [] }); });
    r = await A.saveExpenseEntry({ month: '2026-11', entry: { id: 'ex-test-2', date: '2026-11-12', description: 'One too many', amountCents: 500, attachmentIds: [] } });
    check('server capacity 400 -> {ok:false, limit:true} "is full"', !r.ok && r.limit && /full/.test(r.error), r.error);
    r = await A.refresh({ month: '2026-11' });
    check('refresh({month}) re-reads the forms', r.ok && D.form('2026-11', 'expenses').entries.length === 26 && D.sync().status === 'ok');
    const n2 = mock.log.length;
    r = await A.saveExpenseEntry({ month: '2026-11', entry: { id: 'ex-test-3', date: '2026-11-12', description: 'Still too many', amountCents: 500, attachmentIds: [] } });
    check('known-full form is refused before calling the API', !r.ok && r.limit && /at most 26 expenses/.test(r.error) && mock.log.length === n2, r.error);
    r = await A.saveExpenseEntry({ month: '2026-11', entry: { id: 'ex-test-1', date: '2026-11-11', description: 'Mock taxi (edited)', amountCents: 1300, attachmentIds: [up.id] } });
    check('...but editing an existing entry in a full form works', r.ok, r.error);

    offline = true;
    r = await A.saveLeaveEntry({ month: '2026-11', entry: { id: 'lv-test-2', type: 'MC', from: '2026-11-13', to: '2026-11-13', days: 1, reason: 'Mock MC', attachmentIds: [] } });
    offline = false;
    check('offline -> plain-English error, no conflict flag', !r.ok && !r.conflict && /offline/.test(r.error), r.error);

    badToken = true;
    r = await A.saveLeaveEntry({ month: '2026-11', entry: { id: 'lv-test-2', type: 'MC', from: '2026-11-13', to: '2026-11-13', days: 1, reason: 'Mock MC', attachmentIds: [] } });
    badToken = false;
    check('stale token (dev server restarted) -> "Reload the page"', !r.ok && /Reload the page/.test(r.error), r.error);

    r = await A.saveLeaveEntry({ month: '2026-11', entry: { id: 'lv-test-2', type: 'MC', from: '2026-11-13', to: '2026-11-14', days: 3, reason: 'Mock MC', attachmentIds: [] } });
    check('validation 400 -> "The timesheet API rejected this: ..."', !r.ok && /^The timesheet API rejected this: /.test(r.error), r.error);

    r = await A.refresh();
    check('refresh() with no month refreshes now + previous month', r.ok && D.sync().status === 'ok');

    // Last, because the proxy then honours the upstream Retry-After and holds further calls.
    mock.ratePerMin = 0;
    r = await A.saveLeaveEntry({ month: '2026-11', entry: { id: 'lv-test-2', type: 'MC', from: '2026-11-13', to: '2026-11-13', days: 1, reason: 'Mock MC', attachmentIds: [] } });
    check('upstream 429 -> "Too many requests ... Wait N seconds"', !r.ok && /Too many requests/.test(r.error) && /Wait \d+ seconds/.test(r.error), r.error);
    const held = await raw(PORT, 'GET', '/ts/months/2026-11/leave', { headers: auth });
    check('proxy then holds requests until Retry-After passes', held.status === 429 && held.json && held.json.source === 'dev-proxy');
    mock.ratePerMin = 10000;
    globalThis.fetch = realFetch;
  }

  section('secrets');
  check('no proxied response contained the API key', !leaks.length, leaks.join('; '));
  check('serve.mjs output never contains the key or the token', !main.out.text.includes(TEST_KEY) && !main.out.text.includes(T));
  await stop(main);

  if (REAL) {
    section('real API smoke test via the proxy (GET only; status codes and key names only)');
    const realEnv = parseEnvKey(join(ROOT, '.env'));
    if (!realEnv) console.log('SKIP  no TIMESHEET_API_KEY in .env');
    else {
      const rs = await startServe(PORT_REAL, { CF_STATE_FILE: join(TMP, 'real-state.json') }); // reads the real .env
      const h = { 'x-cf-token': rs.token };
      const me = await raw(PORT_REAL, 'GET', '/ts/me', { headers: h });
      console.log(`      GET /ts/me -> ${me.status}  keys: ${shape(me.json)}`);
      check('real /ts/me through the proxy is 200 with Me keys', me.status === 200 && eq(Object.keys(me.json || {}), ['userId', 'fullName', 'workEmail', 'scopes']));
      const ts = await raw(PORT_REAL, 'GET', '/ts/months/2026-11/timesheet', { headers: h });
      const j = ts.json || {};
      console.log(`      GET /ts/months/2026-11/timesheet -> ${ts.status}  keys: ${shape(j)}  data: ${shape(j.data)}  entries: ${j.data && Array.isArray(j.data.entries) ? j.data.entries.length : '?'}  entry keys: ${j.data && j.data.entries && j.data.entries[0] ? Object.keys(j.data.entries[0]).join(', ') : '-'}`);
      check('real timesheet through the proxy is 200 with Form keys', ts.status === 200 && eq(Object.keys(j), ['month', 'kind', 'revision', 'status', 'data', 'updatedAt']));
      const noTok = await raw(PORT_REAL, 'GET', '/ts/me');
      check('real proxy still demands the token', noTok.status === 401);
      check('real serve.mjs output never contains the key', !rs.out.text.includes(realEnv));
      check('real responses never echo the key', ![me.text, ts.text].some((t) => t.includes(realEnv)));
      await stop(rs);
    }
  }
  exitCode = failed ? 1 : 0;
} catch (e) {
  console.log(`FAIL  test run crashed: ${e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e}`);
  failed++;
} finally {
  for (const c of children) if (c.exitCode == null) c.kill();
  await mock.close();
  rmSync(TMP, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : exitCode);
}

/** Read only the key out of .env, to check it never leaks. Never printed. */
function parseEnvKey(file) {
  try { const m = /^\s*(?:export\s+)?TIMESHEET_API_KEY\s*=\s*["']?([^"'\s#]+)/m.exec(readFileSync(file, 'utf8')); return m ? m[1] : null; } catch { return null; }
}
