// Checks for the Muse bridge (core/muse.js): the real app core runs in Node against tools/reference-backend.mjs,
// talking the same wire format Muse's frame uses. No network, no personal data.  Run: node tools/test-muse.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import vm from 'node:vm';
import { createBackend } from './reference-backend.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CORE = ['core/format.js', 'core/data.js', 'core/live.js', 'core/muse.js'].map((f) => [f, readFileSync(join(ROOT, f), 'utf8')]);
let passed = 0, failed = 0;
const check = (name, ok, detail) => { if (ok) passed++; else failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? `  (${detail})` : ''}`); };
const section = (t) => console.log(`\n# ${t}`);
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

/** A fresh page: its own globals, the app core, and a fetch that goes wherever `fetchImpl` says. */
async function page(fetchImpl, { href = 'https://space.example/run/abc', today = '2026-11-16' } = {}) {
  const calls = [];
  const g = {
    console, setTimeout, clearTimeout, URL, URLSearchParams, Intl, Promise, TextEncoder, TextDecoder,
    location: { href, search: `?today=${today}`, protocol: new URL(href).protocol },
    document: { querySelector: () => null, addEventListener() {}, hidden: false },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    FileReader: class { readAsDataURL(f) { setTimeout(() => { this.result = `data:${f.type};base64,${Buffer.from(f.text).toString('base64')}`; this.onload(); }); } },
    fetch: async (url, init) => { calls.push(JSON.parse(init.body).action); return fetchImpl(url, init); },
  };
  g.window = g; g.globalThis = g;
  const ctx = vm.createContext(g);
  for (const [f, src] of CORE) vm.runInContext(src, ctx, { filename: f });
  await g.CF.muse.ready;
  return { CF: g.CF, D: g.CF.data, A: g.CF.actions, calls };
}
/** fetch → reference backend, answering the way Muse's frame does. */
const museFetch = (be, { delay = 0 } = {}) => async (url, init) => {
  const { action, args, actionCallId } = JSON.parse(init.body);
  if (!url.endsWith('/actions') || init.method !== 'POST' || !actionCallId || init.headers['x-request-id'] !== actionCallId) return { ok: false, status: 400, headers: { get: () => 'text/plain' }, json: async () => ({}) };
  if (delay) await tick(delay);
  const out = be.handle(action, args);
  return { ok: !out.error, status: out.error ? 500 : 200, headers: { get: (n) => (n === 'content-type' ? 'application/json' : null) }, json: async () => out };
};

const SETUP = {
  version: 1, currency: 'EUR', timeZone: 'Europe/Lisbon',
  streams: {
    job: { label: 'Example job', short: 'Job', monthlyPayCents: 200000, dayMinutes: 480, deduction: { label: 'Pension', rate: 0.05 }, system: 'Example Timesheets', startMonth: '2026-09' },
    gig: { label: 'Example lessons', short: 'Lessons', rateCents: 4000, sessionMinutes: 60, claim: { to: 'claims@example.com', dueWorkingDay: 4, payFromDay: 18, payToDay: 22 } },
    hourly: { label: 'Example tutoring', short: 'Tutor', rateCents: 3000, payout: { label: 'paid after the term', periods: [{ from: 9, to: 12, paidIn: 1 }, { from: 1, to: 4, paidIn: 5 }, { from: 5, to: 8, paidIn: 9 }] } },
  },
  expenses: { label: 'Example spending app' },
};
const seed = () => ({
  setup: structuredClone(SETUP),
  gig: [{ id: 'g1', date: '2026-11-07', venue: 'Hall', timeIn: '15:00', timeOut: '16:00', sessionsCount: 1, rateCents: 4000, remarks: '' }],
  hourly: [{ id: 'h1', date: '2026-11-04', module: 'Unit 1', timeIn: '14:00', timeOut: '16:00', rateCents: 3000, remarks: '' }],
  job: { '2026-11': { timesheet: { entries: [{ date: '2026-11-02', start: '09:00', end: '18:00', breakStart: '12:00', breakEnd: '13:00', overtimeMinutes: 0, attendanceCode: '', privateRemarks: '' }], status: 'draft', revision: 1 } },
    '2026-10': { timesheet: { entries: [], status: 'approved', revision: 4 } } },
  statement: { '2026-11': { expensesStatus: 'ok', expenseCategories: [{ name: 'Food', totalCents: 12345, count: 9 }], investedCents: 0, dividendsCents: 0 } },
});

try {
  section('start-up inside Muse');
  const be = createBackend(seed());
  const { D, A, CF, calls } = await page(museFetch(be));
  check('the bridge switches on', CF.muse.active === true);
  check('start-up costs exactly one action call (loadAll)', calls.length === 1 && calls[0] === 'loadAll', calls.join(','));
  check('the setup arrives', D.configured() && D.stream('gig').label === 'Example lessons' && D.stream('job').system === 'Example Timesheets');
  const m = D.month('2026-11');
  check('sessions, days and spending arrive', m.gig.sessions.length === 1 && m.hourly.sessions.length === 1 && m.job.entries.length === 1 && m.expenses.total === 12345);
  check('pay rules use the setup (8h day, rates)', m.job.expectedMin === 21 * 480 && m.gig.fees === 4000 && m.hourly.pay === 6000);
  check('the deduction comes off gross pay', m.job.deducted === Math.round(m.job.gross * 0.05) && m.job.net === m.job.gross - m.job.deducted);
  const tiers = { label: 'Tax', rate: 0.1, freeUpToCents: 100000, phaseInToCents: 150000, phaseInRate: 0.3, capCents: 500000, roundDownToDollar: true };
  check('deduction tiers: free, phase-in (rounded down), rate, cap', [90000, 120000, 130050, 200000, 600000].map((c) => D.rules.deduct(c, tiers)).join() === '0,6000,9000,20000,50000');
  check('hourly pay waits for the end of its period', m.hourly.period && m.hourly.period.first === '2026-09' && m.hourly.period.payFrom === '2027-01' && D.rules.payoutPeriod('2027-03').payFrom === '2027-05');
  check('claim dates follow the setup', m.gig.claim && m.gig.claim.due === '2026-12-04' && m.gig.claim.payFrom === '2026-12-18' && m.gig.claim.payTo === '2026-12-22');
  check('leave types default to a short generic list', D.leaveTypes().map((x) => x.code).join() === 'AL,MC,UL' && D.leaveName('MC') === 'Medical leave');
  check('sync shows Muse, ok', D.sync().source === 'muse' && D.sync().status === 'ok');

  section('writes go to Muse first');
  let n = calls.length;
  let r = await A.saveGigSession({ entry: { id: 'g2', date: '2026-11-14', venue: 'Hall', timeIn: '15:00', timeOut: '17:00', sessionsCount: 2, rateCents: 4000, remarks: 'Double' } });
  check('a saved session reaches the backend', r.ok && be.db.gig.length === 2);
  check('...and shows at once, without a reload', D.month('2026-11').gig.sessions.length === 2 && calls.length === n + 1);
  r = await A.deleteGigSession({ id: 'g2' });
  check('deletes reach the backend and the screen', r.ok && be.db.gig.length === 1 && D.month('2026-11').gig.sessions.length === 1);
  n = calls.length;
  r = await A.saveWorkEntry({ month: '2026-11', entry: { date: '2026-11-03', start: '09:00', end: '13:00', breakStart: '', breakEnd: '', overtimeMinutes: 0, attendanceCode: '', privateRemarks: '' } });
  await tick(5);
  check('a timesheet day is saved, then that month is re-read for its revision', r.ok && be.db.job['2026-11'].timesheet.entries.length === 2 && calls.slice(n).join(',') === 'saveWorkEntry,loadAll' && D.form('2026-11', 'timesheet').revision === 2, calls.slice(n).join(','));
  r = await A.saveWorkEntry({ month: '2026-10', entry: { date: '2026-10-20', start: '09:00', end: '18:00', breakStart: '', breakEnd: '', overtimeMinutes: 0, attendanceCode: '', privateRemarks: '' } });
  check('when Muse refuses, the error comes back and nothing changes', r.ok === false && /approved/.test(r.error) && D.month('2026-10').job.entries.length === 0, r.error);
  r = await A.saveSetup({ setup: { ...structuredClone(SETUP), streams: { ...structuredClone(SETUP.streams), lumpsum: { label: 'Example bonus', yearlyCents: 300000, receiptMonth: 12 } } } });
  check('saveSetup round-trips', r.ok && be.db.setup.streams.lumpsum.label === 'Example bonus' && D.stream('lumpsum').yearlyCents === 300000);
  r = await A.saveIncomeSource({ source: { id: 'src-1', label: 'Prize', short: 'Prize', type: 'one-off', rateCents: null, startMonth: '2026-11' } });
  r = r.ok && (await A.saveIncomeEntry({ sourceId: 'src-1', entry: { id: 'e1', date: '2026-11-10', amountCents: 5000, qty: null, note: '' } }));
  check('your own income sources work end to end', r.ok && be.db.sources[0].entries.length === 1 && D.month('2026-11').streams.find((s) => s.id === 'src-1').amount === 5000);
  r = await A.saveProfile({ fullName: 'A Person', bankAccount: '000', paymentId: '' });
  check('claim details are saved', r.ok && be.db.profile.fullName === 'A Person' && D.profile().fullName === 'A Person');
  r = await A.uploadAttachment({ kind: 'expenses', month: '2026-11', file: { name: 'r.png', type: 'image/png', size: 3, text: 'png' } });
  check('attachments go up as base64 and come back with an id', r.ok && /^att-/.test(r.id));
  n = calls.length;
  r = await A.refresh({ month: '2026-11' });
  check('refresh asks Muse to sync, then re-reads', r.ok && calls.slice(n).join(',') === 'refresh,loadAll' && D.sync().status === 'ok', calls.slice(n).join(','));

  section('a blank space');
  const blank = await page(museFetch(createBackend()));
  check('no setup means a blank slate', blank.CF.muse.active && !blank.D.configured() && blank.D.month('2026-11').streams.length === 0);
  check('...that still takes your own income sources', (await blank.A.saveIncomeSource({ source: { id: 's', label: 'Gift', type: 'one-off', rateCents: null } })).ok && blank.D.custom().length === 1);

  section('a space that has not implemented the actions yet');
  const half = createBackend(); delete half.actions.loadAll;
  const p3 = await page(museFetch(half));
  check('it still counts as Muse, and says what failed', p3.CF.muse.active && p3.D.sync().status === 'error' && /Unknown action: loadAll/.test(p3.D.sync().error), p3.D.sync().error);

  section('outside Muse');
  const html = async () => ({ ok: false, status: 404, headers: { get: () => 'text/html' }, json: async () => { throw new Error('not json'); } });
  const p4 = await page(html);
  check('a page with no actions endpoint stays a local preview', p4.CF.muse.active === false && p4.D.sync().source !== 'muse');
  check('...where writes only change memory', (await p4.A.saveGigSession({ entry: { id: 'x', date: '2026-11-05', timeIn: '10:00', timeOut: '11:00', sessionsCount: 1, rateCents: 1000 } })).ok && p4.D.month('2026-11').gig.sessions.length === 1);
  const p5 = await page(async () => { throw new TypeError('fetch failed'); });
  check('a network failure at start also falls back to a local preview', p5.CF.muse.active === false);
  const p6 = await page(museFetch(createBackend(seed())), { href: 'file:///Users/x/cashflow.html' });
  check('a file:// open never calls out', p6.CF.muse.active === false && p6.calls.length === 0);
} catch (e) {
  failed++;
  console.log(`FAIL  crashed: ${e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : e}`);
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
