// Zero-dependency mock of a timesheet API, for write tests. core/live.js expects these shapes:
//   GET  /me                                   {userId, fullName, workEmail, scopes[]}
//   GET  /months/{m}/{kind}                    {month, kind, revision, status, data, updatedAt, leaveBalances? (leave only)}
//   PUT  /months/{m}/{kind}/entries/{id}       {expectedRevision, entry}  -> 200 Form (no leaveBalances)
//   DELETE same path                           {expectedRevision}         -> 200 Form (no leaveBalances)
//   POST /attachments (multipart kind, month, file) -> 201 {id, name, contentType, size, sha256, createdAt}
//   GET  /attachments/{id}                     -> the file
// Bearer check, 60 req/min per key (429 + Retry-After), draft-only edits (409 when signed), revision checks (409),
// entry limits (31 / 12 / 26, 400), strict entry validation (unknown fields rejected), JSON-only mutations (415).
//
// Standalone: `node tools/mock-timesheets.mjs` on 127.0.0.1:5175 (MOCK_PORT), key from MOCK_TIMESHEET_KEY.
// Test control (same Bearer): POST /__mock/forms/{m}/{kind} with {status?, bumpRevision?}.
import http from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export const DEFAULT_KEY = 'ts_test_mock_key_not_real';
const KINDS = ['timesheet', 'leave', 'expenses'];
const LIMIT = { timesheet: 31, leave: 12, expenses: 26 };
const LEAVE_TYPES = ['AL', 'MC', 'UL'];
const CODES = ['', ...LEAVE_TYPES, 'PH'];
const MONTH_RE = /^20[0-9]{2}-(0[1-9]|1[0-2])$/;
const DATE_RE = /^20[0-9]{2}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/;
const TIME_RE = /^(|([01][0-9]|2[0-3]):[0-5][0-9])$/;
const ID_RE = /^[a-zA-Z0-9_-]{1,80}$/;
const SCOPES = ['timesheet:read', 'timesheet:write', 'leave:read', 'leave:write', 'expenses:read', 'expenses:write'];

class ApiError extends Error { constructor(status, msg, headers) { super(msg); this.status = status; this.headers = headers || {}; } }
const bad = (msg) => { throw new ApiError(400, msg); };

/* ---------- validation (strict, like a real API: unknown fields and values are rejected) ---------- */
const validDate = (s, month) => {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number), t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCMonth() === m - 1 && t.getUTCDate() === d && s.slice(0, 7) === month;
};
const toMin = (t) => (t ? +t.slice(0, 2) * 60 + +t.slice(3) : null);
const text = (s, max, name) => {
  if (typeof s !== 'string' || s !== s.trim() || !s.length || s.length > max || /[\u0000-\u001f\u007f]/.test(s)) bad(`${name} must be 1 to ${max} characters of trimmed text.`);
};
function onlyKeys(o, keys) { for (const k of Object.keys(o)) if (!keys.includes(k)) bad(`Unknown field: ${k}.`); for (const k of keys) if (!(k in o)) bad(`Missing field: ${k}.`); }
function attachments(ids, store) {
  if (!Array.isArray(ids) || ids.length > 10 || new Set(ids).size !== ids.length || ids.some((x) => typeof x !== 'string' || !ID_RE.test(x))) bad('attachmentIds must be up to 10 unique IDs.');
  for (const id of ids) if (!store.has(id)) throw new ApiError(404, 'Document not found.');
}
function validate(kind, e, month, store) {
  if (!e || typeof e !== 'object' || Array.isArray(e)) bad('Entry must be an object.');
  if (kind === 'timesheet') {
    onlyKeys(e, ['date', 'start', 'end', 'breakStart', 'breakEnd', 'overtimeMinutes', 'attendanceCode', 'privateRemarks']);
    if (!validDate(e.date, month)) bad('Choose a valid date within the reporting month.');
    for (const k of ['start', 'end', 'breakStart', 'breakEnd']) if (typeof e[k] !== 'string' || !TIME_RE.test(e[k])) bad(`${k} must be HH:MM or empty.`);
    if (!!e.start !== !!e.end || !!e.breakStart !== !!e.breakEnd) bad('Start/end and break start/end must be paired.');
    if (e.start && toMin(e.end) <= toMin(e.start)) bad('End must be after start; overnight shifts are not supported.');
    if (e.breakStart && toMin(e.breakEnd) <= toMin(e.breakStart)) bad('Break end must be after break start.');
    if (!Number.isInteger(e.overtimeMinutes) || e.overtimeMinutes < 0 || e.overtimeMinutes > 1439) bad('overtimeMinutes must be 0 to 1439.');
    if (!CODES.includes(e.attendanceCode)) bad('Unknown attendance code.');
    if (typeof e.privateRemarks !== 'string' || e.privateRemarks.length > 2000) bad('privateRemarks must be at most 2000 characters.');
  } else if (kind === 'leave') {
    onlyKeys(e, ['id', 'type', 'from', 'to', 'days', 'reason', 'attachmentIds']);
    if (typeof e.id !== 'string' || !ID_RE.test(e.id)) bad('Invalid entry ID.');
    if (!LEAVE_TYPES.includes(e.type)) bad('Unknown leave type.');
    if (!validDate(e.from, month) || !validDate(e.to, month) || e.to < e.from) bad('Leave dates must be valid, in order and within the reporting month.');
    const span = (Date.parse(e.to) - Date.parse(e.from)) / 864e5 + 1;
    if (typeof e.days !== 'number' || e.days < 0.5 || e.days > 366 || (e.days * 2) % 1 || e.days > span) bad('Leave days use half-day increments and cannot exceed the date span.');
    text(e.reason, 120, 'Reason');
    attachments(e.attachmentIds, store);
  } else {
    onlyKeys(e, ['id', 'date', 'description', 'amountCents', 'attachmentIds']);
    if (typeof e.id !== 'string' || !ID_RE.test(e.id)) bad('Invalid entry ID.');
    if (!validDate(e.date, month)) bad('Choose a valid date within the reporting month.');
    text(e.description, 240, 'Description');
    if (!Number.isInteger(e.amountCents) || e.amountCents < 1 || e.amountCents > 100000000) bad('amountCents must be a whole number of cents from 1 to 100000000.');
    attachments(e.attachmentIds, store);
  }
}

/* ---------- tiny multipart parser (enough for kind, month, file) ---------- */
function multipart(buf, ct) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(ct || '');
  if (!m) bad('Invalid multipart body.');
  const sep = Buffer.from('--' + (m[1] || m[2])), parts = {};
  let i = buf.indexOf(sep);
  while (i >= 0) {
    const start = i + sep.length;
    if (buf.slice(start, start + 2).toString() === '--') break;
    const next = buf.indexOf(sep, start);
    if (next < 0) break;
    const part = buf.slice(start + 2, next - 2); // drop leading CRLF and trailing CRLF
    const he = part.indexOf('\r\n\r\n');
    const head = part.slice(0, he).toString('utf8'), body = part.slice(he + 4);
    const name = /name="([^"]*)"/i.exec(head), filename = /filename="([^"]*)"/i.exec(head), type = /content-type:\s*([^\r\n]+)/i.exec(head);
    if (name) parts[name[1]] = filename ? { filename: filename[1], type: type ? type[1].trim() : '', body } : body.toString('utf8');
    i = next;
  }
  return parts;
}
const sniff = (b) => (b.slice(0, 4).toString() === '%PDF' ? 'application/pdf' : b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff ? 'image/jpeg' : b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ? 'image/png' : null);

/* ---------- the mock ---------- */
export function createMock({ key = process.env.MOCK_TIMESHEET_KEY || DEFAULT_KEY, ratePerMin = 60 } = {}) {
  const forms = new Map(), files = new Map(), hits = [], log = [];
  const allowances = [
    { type: 'AL', entitlement: 12, openingUsed: 0, trackingStartDate: '2026-01-05' },
    { type: 'MC', entitlement: 10, openingUsed: 0, trackingStartDate: '2026-01-05' },
  ];
  const day = (date, start, end, bs, be, remark = '') => ({ date, start, end, breakStart: bs, breakEnd: be, overtimeMinutes: 0, attendanceCode: '', privateRemarks: remark });
  function reset() {
    forms.clear(); files.clear(); hits.length = 0; log.length = 0;
    forms.set('2026-11/timesheet', { month: '2026-11', kind: 'timesheet', revision: 3, status: 'draft', data: { entries: [
      day('2026-11-02', '09:00', '17:30', '12:30', '13:00'),
      day('2026-11-03', '09:00', '17:30', '12:30', '13:00', 'Mock remark'),
      day('2026-11-04', '09:00', '13:00', '', ''),
    ] }, updatedAt: '2026-11-04T10:00:00.000Z' });
    forms.set('2026-11/leave', { month: '2026-11', kind: 'leave', revision: 1, status: 'draft', data: { entries: [], allowances: allowances.map((a) => ({ ...a })), otherType: '' }, updatedAt: '2026-11-02T01:00:00.000Z' });
    forms.set('2026-11/expenses', { month: '2026-11', kind: 'expenses', revision: 1, status: 'draft', data: { entries: [] }, updatedAt: '2026-11-02T01:00:00.000Z' });
  }
  reset();
  const blank = (month, kind) => ({ month, kind, revision: 0, status: 'draft', data: kind === 'leave' ? { entries: [], allowances: [], otherType: '' } : { entries: [] }, updatedAt: null });
  const getForm = (month, kind) => forms.get(`${month}/${kind}`) || blank(month, kind);
  const putForm = (f) => forms.set(`${f.month}/${f.kind}`, f);
  function balances() {
    return allowances.map((a) => {
      let taken = a.openingUsed;
      for (const f of forms.values()) if (f.kind === 'leave') for (const e of f.data.entries) if (e.type === a.type && e.from >= a.trackingStartDate) taken += e.days;
      return { type: a.type, entitlement: a.entitlement, openingUsed: a.openingUsed, trackingStartDate: a.trackingStartDate, taken, balance: a.entitlement - taken };
    });
  }
  const view = (f, withBalances) => { const o = JSON.parse(JSON.stringify(f)); if (withBalances && f.kind === 'leave') o.leaveBalances = balances(); return o; };

  function rate() {
    const now = Date.now();
    while (hits.length && now - hits[0] >= 60_000) hits.shift();
    if (hits.length >= api.ratePerMin) throw new ApiError(429, 'Rate limit exceeded. Wait for Retry-After seconds.', { 'retry-after': String(hits.length ? Math.max(1, Math.ceil((hits[0] + 60_000 - now) / 1000)) : 60) });
    hits.push(now);
  }
  const readBody = (req, limit) => new Promise((resolve, reject) => {
    const chunks = []; let n = 0;
    req.on('data', (c) => { n += c.length; if (n > limit) reject(new ApiError(413, 'Request exceeds 256 KiB JSON or 10 MB file limit.')); else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks))); req.on('error', reject);
  });
  async function json(req) {
    if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) throw new ApiError(415, 'Use application/json for entry mutations.');
    const b = await readBody(req, 256 * 1024);
    try { return JSON.parse(b.toString('utf8')); } catch { bad('Invalid JSON.'); }
  }

  async function route(req) {
    const u = new URL(req.url, 'http://mock');
    const p = u.pathname.replace(/^\/api\/v1/, '');
    const auth = req.headers.authorization || '';
    if (auth !== `Bearer ${key}`) throw new ApiError(401, 'Invalid or inactive API credential.');
    rate();
    if (u.search) bad('Query parameters are not supported on this endpoint.');
    let m;
    if (req.method === 'POST' && (m = /^\/__mock\/forms\/([^/]+)\/([^/]+)$/.exec(p))) {
      const patch = await json(req), f = view(getForm(m[1], m[2]));
      if (patch.status) f.status = patch.status;
      if (patch.bumpRevision) f.revision += 1;
      putForm(f);
      return [200, view(f, true)];
    }
    if (req.method === 'GET' && p === '/me') return [200, { userId: 'usr_mock_0001', fullName: 'Mock User', workEmail: 'user@example.test', scopes: SCOPES }];
    if ((m = /^\/months\/([^/]+)\/([^/]+)(?:\/entries\/([^/]+))?$/.exec(p))) {
      const [, month, kind, rawId] = m;
      if (!MONTH_RE.test(month)) bad('Choose a valid reporting month.');
      if (!KINDS.includes(kind)) bad('Invalid option: expected one of "timesheet"|"leave"|"expenses"');
      if (!rawId) { if (req.method !== 'GET') throw new ApiError(404, 'API route not found.'); return [200, view(getForm(month, kind), true)]; }
      const id = decodeURIComponent(rawId);
      if (!ID_RE.test(id)) bad('Invalid entry ID.');
      if (req.method !== 'PUT' && req.method !== 'DELETE') throw new ApiError(404, 'API route not found.');
      const body = await json(req);
      if (!body || typeof body !== 'object' || !Number.isInteger(body.expectedRevision) || body.expectedRevision < 0) bad('expectedRevision must be a whole number.');
      const keyOf = (e) => (kind === 'timesheet' ? e.date : e.id);
      if (req.method === 'PUT') {
        onlyKeys(body, ['expectedRevision', 'entry']);
        validate(kind, body.entry, month, files);
        if (keyOf(body.entry) !== id) bad('Entry ID must match the body.');
      } else onlyKeys(body, ['expectedRevision']);
      const f = view(getForm(month, kind));
      if (f.status !== 'draft') throw new ApiError(409, 'This form is signed. Reopen it on the website before editing.');
      if (body.expectedRevision !== f.revision) throw new ApiError(409, 'Revision conflict. Fetch the latest form and reconcile.');
      const i = f.data.entries.findIndex((e) => keyOf(e) === id);
      if (req.method === 'PUT') {
        if (i < 0 && f.data.entries.length >= LIMIT[kind]) bad(`Form capacity reached: at most ${LIMIT[kind]} entries.`);
        if (i >= 0) f.data.entries[i] = body.entry; else f.data.entries.push(body.entry);
        if (kind === 'timesheet') f.data.entries.sort((a, b) => a.date.localeCompare(b.date));
      } else {
        if (i < 0) throw new ApiError(404, 'Entry not found.');
        f.data.entries.splice(i, 1);
      }
      f.revision += 1; f.updatedAt = new Date().toISOString();
      putForm(f);
      return [200, view(f, false)];
    }
    if (req.method === 'POST' && p === '/attachments') {
      const ct = req.headers['content-type'] || '';
      if (!/^multipart\/form-data/i.test(ct)) throw new ApiError(415, 'Use multipart/form-data for uploads.');
      const parts = multipart(await readBody(req, 10.5 * 1024 * 1024), ct);
      if (parts.kind !== 'leave' && parts.kind !== 'expenses') bad('Invalid option: expected one of "leave"|"expenses"');
      if (!MONTH_RE.test(parts.month || '')) bad('Choose a valid reporting month.');
      const file = parts.file;
      if (!file || typeof file !== 'object' || !file.body.length) bad('Attach a file.');
      if (file.body.length > 10 * 1024 * 1024) throw new ApiError(413, 'Request exceeds 256 KiB JSON or 10 MB file limit.');
      const type = sniff(file.body);
      if (!type) throw new ApiError(415, 'Upload a PDF, JPEG or PNG file.');
      const a = { id: 'att_' + randomBytes(8).toString('hex'), name: file.filename || 'attachment', contentType: type, size: file.body.length, sha256: createHash('sha256').update(file.body).digest('hex'), createdAt: new Date().toISOString() };
      files.set(a.id, { ...a, kind: parts.kind, month: parts.month, body: file.body });
      return [201, a];
    }
    if (req.method === 'GET' && (m = /^\/attachments\/([^/]+)$/.exec(p))) {
      const a = files.get(decodeURIComponent(m[1]));
      if (!a) throw new ApiError(404, 'Document not found.');
      return [200, a.body, { 'content-type': a.contentType }];
    }
    throw new ApiError(404, 'API route not found.');
  }

  const server = http.createServer(async (req, res) => {
    let status, body, headers = {};
    try { [status, body, headers = {}] = await route(req); }
    catch (e) { status = e instanceof ApiError ? e.status : 500; body = { error: e instanceof ApiError ? e.message : 'Service error.' }; headers = (e && e.headers) || {}; }
    const u = new URL(req.url, 'http://mock');
    log.push({ method: req.method, path: u.pathname, status, auth: (req.headers.authorization || '') === `Bearer ${key}`, headerNames: Object.keys(req.headers).sort() });
    if (Buffer.isBuffer(body)) res.writeHead(status, { 'cache-control': 'no-store', ...headers }).end(body);
    else res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers }).end(JSON.stringify(body));
  });

  const api = {
    server, log, ratePerMin,
    listen: (port = 5175) => new Promise((r, j) => { server.once('error', j); server.listen(port, '127.0.0.1', () => r(api)); }),
    close: () => new Promise((r) => { server.closeAllConnections && server.closeAllConnections(); server.close(() => r()); }),
    reset,
    form: (month, kind) => view(getForm(month, kind), true),
    /** Change a form behind the client's back (status, revision, entries), without the API's checks. */
    patch(month, kind, fn) { const f = view(getForm(month, kind)); fn(f); putForm(f); return view(f, true); },
    resetRate: () => { hits.length = 0; },
  };
  return api;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.MOCK_PORT || 5175);
  const mock = createMock();
  await mock.listen(port);
  console.log(`Mock timesheet API on http://127.0.0.1:${port} (Bearer key: ${process.env.MOCK_TIMESHEET_KEY ? 'from MOCK_TIMESHEET_KEY' : 'the DEFAULT_KEY in this file'})`);
}
