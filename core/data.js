/* Data layer. Classic script; load after core/format.js.

   setup        What this space tracks: which income streams exist, their labels, rates and pay rules.
                Muse fills it in (saveSetup). Nothing about any one person is hard-coded here; with no
                setup the app is a blank slate. Schema: docs/MUSE.md.
   CF.data      Synchronous view-models (month, year, series, upcoming) the app renders from.
   CF.actions   Async writes, named exactly like the space's server actions. core/muse.js forwards them
                to Muse; in a plain browser (local preview) they only change memory.

   All money is integer cents. Months are "YYYY-MM", days "YYYY-MM-DD". */
(function () {
  const CF = window.CF, F = CF.fmt;
  const SNAP = CF.snapshot || null; // dev only: core/snapshot.local.js (gitignored), injected by tools/serve.mjs
  const clone = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));
  const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
  const query = new URLSearchParams(location.search);

  /* ---------------- Setup ---------------- */
  const KINDS = ['job', 'gig', 'hourly', 'lumpsum', 'dividends'];
  const DEFAULTS = {
    // Monthly pay, prorated by hours worked over (weekdays × dayMinutes). Days, leave and claims live in a
    // timesheet system (the `system` label) that the space syncs with.
    // deduction: an optional contribution taken off gross pay (see deduct()). leaveTypes: [{code, name}].
    job: { label: 'Job', short: 'Job', icon: 'briefcase', monthlyPayCents: 0, dayMinutes: 480, deduction: null, system: 'Timesheet', startMonth: null, endMonth: null, leave: true, claims: true, leaveTypes: null, day: { start: '09:00', end: '18:00', breakStart: '12:00', breakEnd: '13:00' } },
    // Paid per session; optionally claimed with a monthly form (claim) and a filled-in template (claimForm).
    gig: { label: 'Sessions', short: 'Sessions', icon: 'timer', rateCents: 0, sessionMinutes: 60, venue: '', rateNote: '', claim: null, claimForm: null, presets: [] },
    // Paid by the hour. payout: 'monthly', or {label, periods:[{from, to, paidIn}]} for work paid in one block after a period.
    hourly: { label: 'Hourly work', short: 'Hourly', icon: 'hourglass', rateCents: null, unitLabel: 'Project', payout: 'monthly', presets: [] },
    // One payment a year (a bonus, grant or award), kept out of monthly comparisons.
    lumpsum: { label: 'Yearly payment', short: 'Yearly', icon: 'award', yearlyCents: 0, receiptMonth: 0 },
    // Read-only, from the income statement.
    dividends: { label: 'Dividends', short: 'Dividends', icon: 'leaf', source: '' },
  };
  const SAMPLE_SETUP = {
    version: 1, currency: 'USD',
    streams: {
      job: { label: 'Studio assistant', short: 'Studio', monthlyPayCents: 210000, dayMinutes: 450, deduction: { label: 'Pension', rate: 0.05 }, system: 'Timesheet', day: { start: '09:30', end: '17:30', breakStart: '13:00', breakEnd: '13:30' } },
      gig: { label: 'Photography', short: 'Photo', icon: 'camera', rateCents: 6000, sessionMinutes: 90, venue: 'On location', claim: { to: '', dueWorkingDay: 5, payFromDay: 20, payToDay: 25 } },
      hourly: { label: 'Tutoring', short: 'Tutoring', icon: 'book', rateCents: 2800, unitLabel: 'Student' },
      lumpsum: { label: 'Annual bonus', short: 'Bonus', yearlyCents: 300000, receiptMonth: 12 },
      dividends: { label: 'Dividends', short: 'Dividends', source: 'Brokerage' },
    },
    expenses: { label: 'Spending app', detail: '' },
  };
  const DEFAULT_LEAVE = [{ code: 'AL', name: 'Annual leave' }, { code: 'MC', name: 'Medical leave' }, { code: 'UL', name: 'Unpaid leave' }];

  function normSetup(s) {
    if (!s || typeof s !== 'object') return null;
    const src = s.streams && typeof s.streams === 'object' ? s.streams : {};
    const out = { version: 1, currency: String(s.currency || 'USD').slice(0, 6), timeZone: s.timeZone || null, paymentIdLabel: s.paymentIdLabel || 'Payment ID', streams: {}, expenses: null };
    for (const k of KINDS) {
      const v = src[k];
      if (!v || typeof v !== 'object' || v.enabled === false) continue;
      const st = { ...DEFAULTS[k], ...v, id: k };
      st.short = st.short || st.label;
      if (k === 'job') {
        st.day = { ...DEFAULTS.job.day, ...(v.day || {}) };
        st.deduction = v.deduction && typeof v.deduction === 'object' ? { label: 'Deductions', rate: 0, ...v.deduction } : null;
        st.leaveTypes = Array.isArray(v.leaveTypes) && v.leaveTypes.length ? v.leaveTypes.filter((x) => x && x.code) : DEFAULT_LEAVE;
      }
      if (k === 'hourly') st.payout = v.payout && typeof v.payout === 'object' && Array.isArray(v.payout.periods) && v.payout.periods.length ? { label: 'paid in one block', ...v.payout } : 'monthly';
      if (k === 'gig') st.claim = v.claim && typeof v.claim === 'object' ? { to: '', dueWorkingDay: null, payFromDay: null, payToDay: null, ...v.claim } : null;
      if (k === 'gig' || k === 'hourly') st.presets = Array.isArray(v.presets) ? v.presets.slice(0, 4) : [];
      out.streams[k] = st;
    }
    if (s.expenses && typeof s.expenses === 'object' && s.expenses.enabled !== false) out.expenses = { label: 'Spending', detail: '', ...s.expenses };
    return out;
  }
  const SAMPLE_N = normSetup(SAMPLE_SETUP);

  /* ---------------- State ---------------- */
  const state = {
    sample: query.get('sample') === '1',
    setup: null,        // normalised setup, or null while the space isn't set up
    rawSetup: null,     // exactly what was saved, so saveSetup round-trips unknown fields
    months: {},         // 'YYYY-MM' → { job:{timesheet,leave,expenses,pendingCount}, gig:{sessions}, hourly:{sessions}, statement }
    custom: [],         // income sources you add: {id,label,short,type,rateCents,startMonth,entries:[{id,date,amountCents,qty,note}]}
    profile: { fullName: '', bankAccount: '', paymentId: '' }, // printed on claim forms
    sync: { source: 'none', status: 'idle', at: null, error: null },
  };
  let remote = null;   // dev only: the timesheet proxy writer from core/live.js
  let persist = null;  // dev only: saves local edits to data/state.local.json through tools/serve.mjs
  const subs = new Set();
  const emit = () => subs.forEach((f) => f());
  const slot = (k) => (state.months[k] = state.months[k] || {});
  const monthCache = new Map();
  let firstRealCache;
  const changed = () => { monthCache.clear(); firstRealCache = undefined; emit(); };

  /** The setup the app shows: yours, or the sample one while sample data is on and nothing is set up. */
  const setup = () => state.setup || (state.sample ? SAMPLE_N : null);
  const S = (k) => { const s = setup(); return (s && s.streams[k]) || null; };
  function applySetup(raw) {
    state.rawSetup = raw && typeof raw === 'object' ? clone(raw) : null;
    state.setup = normSetup(state.rawSetup);
    tzReset();
  }

  /* ---------------- Clock (in the setup's time zone, else the device's) ---------------- */
  const OVERRIDE = MONTH_RE.test((query.get('today') || '').slice(0, 7)) ? query.get('today') : null;
  let fmtDay, fmtTime, day = { at: 0, v: '' };
  function tzReset() {
    const tz = (setup() && setup().timeZone) || undefined;
    try { fmtDay = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }); fmtTime = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }); }
    catch (_) { fmtDay = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }); fmtTime = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }); }
    day.at = 0;
  }
  tzReset();
  /** Today, re-read at most every 30 s; a new day clears the cached months (isNow, projections). */
  function today() {
    if (OVERRIDE) return OVERRIDE;
    const t = Date.now();
    if (t - day.at > 30000) { const v = fmtDay.format(new Date()); if (v !== day.v) { day.v = v; monthCache.clear(); } day.at = t; }
    return day.v;
  }
  const nowKey = () => today().slice(0, 7);

  /* ---------------- Pay rules ---------------- */
  function weekdays(month) {
    const { y, m } = F.parseMonth(month);
    let n = 0;
    for (let d = 1; d <= F.daysIn(month); d++) { const w = new Date(y, m, d).getDay(); if (w >= 1 && w <= 5) n++; }
    return n;
  }
  function workedMin(e) {
    const a = F.toMin(e.start), b = F.toMin(e.end);
    if (a == null || b == null) return 0;
    let n = b - a;
    const bs = F.toMin(e.breakStart), be = F.toMin(e.breakEnd);
    if (bs != null && be != null) n -= be - bs;
    return Math.max(0, n) + (e.overtimeMinutes || 0);
  }
  /** A contribution taken off gross pay, from setup.streams.job.deduction:
      {label, rate, freeUpToCents?, phaseInToCents?, phaseInRate?, capCents?, roundDownToDollar?}.
      Nothing up to freeUpToCents; then phaseInRate × (gross − freeUpToCents) up to phaseInToCents; above that,
      rate × gross, with gross capped at capCents. */
  function deduct(c, d) {
    if (!d || c <= 0) return 0;
    const free = d.freeUpToCents || 0;
    if (c <= free) return 0;
    if (d.phaseInToCents && c <= d.phaseInToCents) { const v = (d.phaseInRate || 0) * (c - free); return d.roundDownToDollar ? Math.floor(v / 100 + 1e-9) * 100 : Math.round(v); }
    return Math.round(Math.min(c, d.capCents || Infinity) * (d.rate || 0));
  }
  const dayMinutes = () => (S('job') ? S('job').dayMinutes : DEFAULTS.job.dayMinutes);
  function jobPay(month, mins) {
    const j = S('job');
    if (!j) return { gross: 0, deducted: 0, net: 0, expectedMin: 0 };
    const exp = weekdays(month) * j.dayMinutes;
    const gross = exp > 0 ? Math.round((mins / exp) * j.monthlyPayCents) : 0;
    const deducted = deduct(gross, j.deduction);
    return { gross, deducted, net: gross - deducted, expectedMin: exp };
  }
  const sessionMin = (s) => { const a = F.toMin(s.timeIn), b = F.toMin(s.timeOut); return a == null || b == null ? 0 : Math.max(0, b - a); };
  const gigFee = (s) => (s.sessionsCount || 1) * (s.rateCents || 0);
  const hourlyMin = (s) => s.minutes || sessionMin(s); // time without a start and end may be logged as minutes only
  const hourlyPay = (s) => Math.round((hourlyMin(s) / 60) * (s.rateCents || 0));

  /** When a month's gig claim is due and paid, from setup.streams.gig.claim. Null fields are not set up. */
  function gigClaim(month) {
    const g = S('gig'), c = g && g.claim;
    if (!c) return null;
    const nm = F.addMonths(month, 1), { y, m } = F.parseMonth(nm), dim = F.daysIn(nm);
    let due = null;
    if (c.dueWorkingDay > 0) for (let d = 1, wd = 0; d <= dim && !due; d++) { const w = new Date(y, m, d).getDay(); if (w >= 1 && w <= 5 && ++wd === c.dueWorkingDay) due = F.ymd(new Date(y, m, d)); }
    const at = (n) => (n > 0 ? `${nm}-${F.pad2(Math.min(n, dim))}` : null);
    const payFrom = at(c.payFromDay), payTo = at(c.payToDay || c.payFromDay);
    return { due, payFrom, payTo, to: c.to || '' };
  }
  /** For hourly work paid in one block: the period a month falls in, and when it's paid. Months are 1–12;
      a period paid in a month that comes before its end (Aug–Dec paid in Jan) is paid the next year. */
  function payoutPeriod(month) {
    const H = S('hourly'), p = H && H.payout && H.payout.periods;
    if (!p) return null;
    const { y, m } = F.parseMonth(month), mo = m + 1;
    const per = p.find((x) => (x.from <= x.to ? mo >= x.from && mo <= x.to : mo >= x.from || mo <= x.to));
    if (!per) return null;
    const startY = per.from <= per.to || mo >= per.from ? y : y - 1, endY = per.from <= per.to ? y : startY + 1;
    const payY = per.paidIn > per.to ? endY : endY + 1;
    const first = F.monthKey(startY, per.from - 1), last = F.monthKey(endY, per.to - 1);
    return { first, last, label: `${F.MONTHS[per.from - 1]}–${F.MONTHS[per.to - 1]} ${endY}`, payFrom: F.monthKey(payY, per.paidIn - 1), note: H.payout.label };
  }

  /* ---------------- Sample history (deterministic, always flagged isSample) ---------------- */
  function rng(seed) { let s = 0; for (const ch of seed) s = (s * 31 + ch.charCodeAt(0)) >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }
  const sampleCache = {};
  const addMin = (t, n) => { const v = F.toMin(t) + n; return `${F.pad2(Math.floor(v / 60) % 24)}:${F.pad2(v % 60)}`; };
  function sampleMonth(k) {
    const key = `${k}|${state.setup ? 'own' : 'demo'}`;
    if (sampleCache[key]) return sampleCache[key];
    const r = rng(k), { y, m } = F.parseMonth(k);
    const J = S('job'), G = S('gig'), H = S('hourly'), DV = S('dividends');
    const entries = [], gig = [], hourly = [];
    const jobOn = J && (!J.startMonth || k >= J.startMonth) && (!J.endMonth || k <= J.endMonth);
    const until = today();
    for (let d = 1; d <= F.daysIn(k); d++) {
      const date = `${k}-${F.pad2(d)}`, w = new Date(y, m, d).getDay();
      if (date > until) break; // sample history never runs ahead of today
      if (jobOn && w >= 1 && w <= 5 && r() > 0.12) {
        const half = r() > 0.85, dd = J.day;
        entries.push(half ? { date, start: dd.start, end: addMin(dd.start, Math.round(J.dayMinutes / 2)), breakStart: '', breakEnd: '', overtimeMinutes: 0, attendanceCode: '', privateRemarks: '' }
          : { date, start: dd.start, end: dd.end, breakStart: dd.breakStart, breakEnd: dd.breakEnd, overtimeMinutes: 0, attendanceCode: '', privateRemarks: '' });
      }
      if (G && w === 0 && r() > 0.45) { const n = r() > 0.75 ? 2 : 1, t = '14:00'; gig.push({ id: `s-${date}`, date, venue: G.venue || 'On location', timeIn: t, timeOut: addMin(t, G.sessionMinutes * n), sessionsCount: n, rateCents: G.rateCents || 6000, remarks: 'Shoot' }); }
      if (H && w === 2 && r() > 0.3) hourly.push({ id: `t-${date}`, date, module: `${H.unitLabel} ${1 + Math.floor(r() * 3)}`, timeIn: '18:00', timeOut: '19:30', rateCents: H.rateCents || 2800, remarks: 'Lesson' });
    }
    const cat = (name, base, spread, count) => ({ name, totalCents: Math.round((base + r() * spread) * 100), count });
    const categories = [cat('Groceries', 210, 90, 14), cat('Rent & bills', 640, 40, 3), cat('Eating out', 60, 90, 8), cat('Travel', 40, 60, 10)];
    if (r() > 0.6) categories.push(cat('Clothes', 20, 140, 2));
    if (r() > 0.5) categories.push(cat('Going out', 20, 60, 2));
    sampleCache[key] = {
      job: entries.length ? { timesheet: { entries, status: 'approved', revision: 1, syncedAt: null }, leave: null, expenses: null, pendingCount: 0 } : null,
      gig: { sessions: gig },
      hourly: { sessions: hourly },
      statement: {
        expensesStatus: 'ok', expenseCategories: categories.sort((a, b) => b.totalCents - a.totalCents),
        dividendsCents: DV && [1, 4, 7, 10].includes(m) ? Math.round((25 + r() * 60) * 100) : 0,
        investedCents: Math.round((120 + r() * 200) * 100) * (r() > 0.2 ? 1 : 0),
        expensesSyncedAt: null,
      },
      isSample: true,
    };
    return sampleCache[key];
  }
  const hasReal = (v) => !!v && ((v.job && v.job.timesheet && v.job.timesheet.entries.length > 0) || (v.gig && v.gig.sessions.length > 0) || (v.hourly && v.hourly.sessions.length > 0) || (v.statement && (v.statement.expensesStatus === 'ok' || v.statement.dividendsCents > 0)));
  /** The first month with any real data, or null. */
  function firstReal() {
    if (firstRealCache === undefined) firstRealCache = Object.keys(state.months).filter((k) => hasReal(state.months[k])).sort()[0] || null;
    return firstRealCache;
  }
  const sampleFrom = () => F.addMonths(nowKey(), -23);
  const usesSample = (k) => state.sample && k >= sampleFrom() && k <= nowKey() && (!firstReal() || k < firstReal());

  /* ---------------- Raw accessors ---------------- */
  function raw(k) {
    if (usesSample(k)) return sampleMonth(k);
    const s = state.months[k] || {};
    return { job: s.job || null, gig: s.gig || { sessions: [] }, hourly: s.hourly || { sessions: [] }, statement: s.statement || null, isSample: false };
  }

  /* ---------------- View-models ---------------- */
  const TYPE_LABEL = { 'one-off': 'One-off', monthly: 'Fixed monthly', hourly: 'Hourly', session: 'Per session' };
  function customFor(k) {
    return state.custom.map((src) => {
      let amount = 0, qty = 0;
      for (const e of src.entries) if (e.date.slice(0, 7) === k) { amount += e.amountCents; qty += e.qty || 0; }
      if (src.type === 'monthly' && src.startMonth && k >= src.startMonth && k <= nowKey()) amount += src.rateCents;
      return { id: src.id, label: src.label, short: src.short || src.label, kind: TYPE_LABEL[src.type] || 'Custom', source: 'Added by you', custom: true, amount, qty, entries: src.entries.filter((e) => e.date.slice(0, 7) === k) };
    });
  }
  function describe(k, s) {
    if (s.description) return s.description;
    if (k === 'job') return `Monthly pay · prorated by hours${s.deduction ? ` · after ${s.deduction.label}` : ''}`;
    if (k === 'gig') return `Per ${s.sessionMinutes}-min session${s.rateNote ? ` · ${s.rateNote}` : ''}`;
    if (k === 'hourly') return s.payout !== 'monthly' ? `Hourly · ${s.payout.label}` : 'Hourly';
    if (k === 'lumpsum') return 'Yearly lump sum';
    return 'Net of withholding tax';
  }
  function sourceOf(k, s) {
    if (k === 'job') return s.system;
    if (k === 'gig' || k === 'hourly') return `${s.short} log`;
    if (k === 'lumpsum') return 'Setup';
    return s.source || 'Income statement';
  }
  const streamMeta = (k) => { const s = S(k); return { id: k, label: s.label, short: s.short, icon: s.icon, kind: describe(k, s), source: sourceOf(k, s) }; };
  const builtins = () => KINDS.filter((k) => S(k)).map(streamMeta);

  function month(k) {
    if (monthCache.has(k)) return monthCache.get(k);
    const NOW = nowKey(), TODAY = today();
    const r = raw(k), st = r.statement || {}, J = S('job');
    // Job: computed from the timesheet's days
    const ts = r.job && r.job.timesheet;
    const entries = ts && Array.isArray(ts.entries) ? [...ts.entries].sort((a, b) => a.date.localeCompare(b.date)) : [];
    const wMin = F.sum(entries, workedMin);
    const pay = jobPay(k, wMin);
    const daysIn = entries.filter((e) => workedMin(e) > 0).length;
    let projected = null;
    if (J && k === NOW && daysIn) {
      const { y, m } = F.parseMonth(k);
      let left = 0;
      for (let d = +TODAY.slice(8) + 1; d <= F.daysIn(k); d++) { const w = new Date(y, m, d).getDay(); if (w >= 1 && w <= 5) left++; }
      const p = jobPay(k, wMin + left * (wMin / daysIn));
      projected = { gross: p.gross, net: p.net, daysLeft: left };
    }
    const job = {
      entries, workedMin: wMin, expectedMin: pay.expectedMin, daysIn, gross: pay.gross, deducted: pay.deducted, net: pay.net,
      monthlyPayCents: J ? J.monthlyPayCents : 0, projected,
      status: ts ? ts.status : null, revision: ts ? ts.revision : null, syncedAt: ts ? ts.syncedAt : null,
      leave: r.job ? r.job.leave : null, claims: r.job ? r.job.expenses : null,
      started: !!J && (!J.startMonth || k >= J.startMonth) && (!J.endMonth || k <= J.endMonth),
    };
    const gs = [...r.gig.sessions].sort((a, b) => (a.date + a.timeIn).localeCompare(b.date + b.timeIn));
    const gig = { sessions: gs, count: F.sum(gs, (s) => s.sessionsCount || 1), days: new Set(gs.map((s) => s.date)).size, minutes: F.sum(gs, sessionMin), fees: F.sum(gs, gigFee), claim: gigClaim(k) };
    const hs = [...r.hourly.sessions].sort((a, b) => a.date.localeCompare(b.date));
    const hourly = { sessions: hs, minutes: F.sum(hs, hourlyMin), pay: F.sum(hs, hourlyPay), rateCents: hs.length ? hs[hs.length - 1].rateCents : null, period: payoutPeriod(k) };
    const L = S('lumpsum');
    const lumpsum = { yearly: L ? L.yearlyCents : 0, receiptMonth: L ? L.receiptMonth : 0, amount: L && L.receiptMonth && +k.slice(5) === L.receiptMonth && (!L.fromYear || +k.slice(0, 4) >= L.fromYear) ? L.yearlyCents : 0 };
    const dividends = S('dividends') ? st.dividendsCents || 0 : 0;

    const amounts = { job: job.net, gig: gig.fees, hourly: hourly.pay, lumpsum: lumpsum.amount, dividends };
    const details = { job, gig, hourly, lumpsum, dividends: { amount: dividends } };
    const streams = [
      ...KINDS.filter((x) => S(x)).map((x) => ({ ...streamMeta(x), amount: amounts[x], gross: x === 'job' ? job.gross : undefined, detail: details[x] })),
      ...customFor(k),
    ];
    const income = F.sum(streams, (s) => s.amount);
    const regular = income - lumpsum.amount; // without the yearly lump sum, so months compare fairly
    const expOk = st.expensesStatus === 'ok';
    const categories = expOk ? (st.expenseCategories || []).filter((c) => c.totalCents > 0).map((c) => ({ name: c.name, amount: c.totalCents, count: c.count || 0 })).sort((a, b) => b.amount - a.amount) : [];
    const expenses = { status: st.expensesStatus || 'none', total: F.sum(categories, (c) => c.amount), categories, syncedAt: st.expensesSyncedAt || null, source: expenseSource() };
    const invested = st.investedCents || 0;
    const net = expOk ? income - expenses.total : null;
    const v = {
      key: k, label: F.monthLabel(k), long: F.monthLabel(k, { long: true }), isNow: k === NOW, isFuture: k > NOW, isSample: !!r.isSample,
      hasData: income > 0 || expenses.total > 0 || entries.length > 0,
      streams, income, regular, expenses, invested, net, kept: net == null ? null : net - invested,
      savingsRate: net != null && income > 0 ? net / income : null,
      job, gig, hourly, lumpsum, dividends,
    };
    monthCache.set(k, v);
    return v;
  }
  function expenseSource() { const e = setup() && setup().expenses; return e ? [e.label, e.detail].filter(Boolean).join(' · ') : 'Spending'; }

  /** Previous-period comparison: same keys, deltas as ratios (null when meaningless). */
  function compare(cur, prev) {
    return {
      income: F.change(cur.income, prev.income),
      regular: F.change(cur.regular, prev.regular),
      expenses: F.change(cur.expenses.total, prev.expenses.total),
      net: cur.net != null && prev.net != null ? cur.net - prev.net : null,
      byStream: Object.fromEntries(cur.streams.map((s) => { const p = prev.streams.find((x) => x.id === s.id); return [s.id, p ? F.change(s.amount, p.amount) : null]; })),
    };
  }

  const catTotals = (ms) => {
    const map = {};
    ms.forEach((m) => m.expenses.categories.forEach((c) => { map[c.name] = map[c.name] || { name: c.name, amount: 0, count: 0 }; map[c.name].amount += c.amount; map[c.name].count += c.count; }));
    return Object.values(map).sort((a, b) => b.amount - a.amount);
  };
  function year(y) {
    const NOW = nowKey();
    const keys = Array.from({ length: 12 }, (_, i) => F.monthKey(y, i));
    const months = keys.map((k) => (k > NOW ? null : month(k)));
    const live = months.filter(Boolean);
    const streamIds = [...new Set(live.flatMap((m) => m.streams.map((s) => s.id)))];
    const streams = streamIds.map((id) => {
      const first = live.find((m) => m.streams.find((s) => s.id === id)).streams.find((s) => s.id === id);
      return { id, label: first.label, short: first.short, icon: first.icon, kind: first.kind, source: first.source, custom: first.custom, amount: F.sum(live, (m) => (m.streams.find((s) => s.id === id) || {}).amount || 0), monthly: months.map((m) => (m ? (m.streams.find((s) => s.id === id) || {}).amount || 0 : null)) };
    });
    const categories = catTotals(live);
    const income = F.sum(live, (m) => m.income), regular = F.sum(live, (m) => m.regular);
    const expTotal = F.sum(categories, (c) => c.amount);
    const anyExp = live.some((m) => m.expenses.status === 'ok');
    const invested = F.sum(live, (m) => m.invested);
    const net = anyExp ? income - expTotal : null;
    const ytd = y === +NOW.slice(0, 4), L = S('lumpsum');
    return {
      year: y, key: String(y), label: ytd ? `${y} so far` : String(y), isNow: ytd, monthsElapsed: live.length, months, streams, income, regular,
      lumpsum: { amount: income - regular, yearly: L ? L.yearlyCents : 0, receiptMonth: L ? L.receiptMonth : 0 },
      expenses: { status: anyExp ? 'ok' : 'none', total: expTotal, categories, source: expenseSource() },
      invested, net, kept: net == null ? null : net - invested, savingsRate: net != null && income > 0 ? net / income : null,
      isSample: live.some((m) => m.isSample), hasData: live.some((m) => m.hasData),
    };
  }
  /** Same-months comparison for a year that's still running (Jan–Nov against Jan–Nov). */
  function yearPrev(y) {
    const cur = year(y), prev = year(y - 1);
    if (!cur.isNow) return prev;
    const n = cur.monthsElapsed;
    const ms = prev.months.slice(0, n).filter(Boolean);
    const sumBy = (f) => F.sum(ms, f);
    const categories = catTotals(ms);
    const income = sumBy((m) => m.income), regular = sumBy((m) => m.regular), exp = F.sum(categories, (c) => c.amount), invested = sumBy((m) => m.invested);
    const any = ms.some((m) => m.expenses.status === 'ok');
    const net = any ? income - exp : null;
    return { ...prev, label: `${y - 1} same months`, monthsElapsed: ms.length, income, regular, invested, net, kept: net == null ? null : net - invested,
      savingsRate: net != null && income > 0 ? net / income : null,
      expenses: { ...prev.expenses, total: exp, categories, status: any ? 'ok' : 'none' },
      streams: prev.streams.map((s) => ({ ...s, amount: F.sum(s.monthly.slice(0, n), (x) => x || 0) })) };
  }

  function series(endKey, n) { return Array.from({ length: n }, (_, i) => month(F.addMonths(endKey, i - n + 1))); }
  function range() {
    const NOW = nowKey();
    let first = Object.keys(state.months).filter((k) => k <= NOW && month(k).hasData).sort()[0] || NOW; // a month with only a lump sum counts too
    const J = S('job');
    if (J && J.startMonth && J.startMonth < first) first = J.startMonth;
    for (const s of state.custom) for (const e of s.entries) if (e.date.slice(0, 7) < first) first = e.date.slice(0, 7);
    if (state.sample) first = sampleFrom() < first ? sampleFrom() : first;
    return { first: first < NOW ? first : NOW, last: NOW };
  }
  const plural = (n, w) => `${n} ${n === 1 ? w : w + 's'}`;
  function upcoming() {
    const NOW = nowKey(), TODAY = today(), m = month(NOW), prev = month(F.addMonths(NOW, -1)), out = [];
    const G = S('gig'), H = S('hourly'), J = S('job'), L = S('lumpsum');
    if (G && m.gig.fees && m.gig.claim) {
      const c = m.gig.claim;
      if (c.due) out.push({ id: 'gig-claim', stream: 'gig', title: `Submit ${F.monthLabel(NOW, { year: false })} ${G.short} claim`, sub: [c.to ? `to ${c.to}` : null, plural(m.gig.count, 'session')].filter(Boolean).join(' · '), date: c.due, amount: m.gig.fees, kind: 'todo' });
      if (c.payFrom) out.push({ id: 'gig-pay', stream: 'gig', title: `${G.short} payout`, sub: c.payTo && c.payTo !== c.payFrom ? `${F.shortDate(c.payFrom)}–${F.shortDate(c.payTo)}` : F.shortDate(c.payFrom), date: c.payFrom, amount: m.gig.fees, kind: 'in' });
    }
    if (G && prev.gig.fees && prev.gig.claim && prev.gig.claim.payFrom && TODAY < (prev.gig.claim.payTo || prev.gig.claim.payFrom)) {
      const c = prev.gig.claim;
      out.push({ id: 'gig-pay-prev', stream: 'gig', title: `${G.short} payout (${F.monthLabel(prev.key, { year: false })})`, sub: c.payTo && c.payTo !== c.payFrom ? `${F.shortDate(c.payFrom)}–${F.shortDate(c.payTo)}` : F.shortDate(c.payFrom), date: c.payFrom, amount: prev.gig.fees, kind: 'in' });
    }
    const per = H && payoutPeriod(NOW);
    if (per) { // everything earned in this period is paid together, later
      let owed = 0;
      for (let k = per.first; k <= NOW; k = F.addMonths(k, 1)) owed += month(k).hourly.pay;
      if (owed) out.push({ id: 'hourly-pay', stream: 'hourly', title: `${H.short} pay for ${per.label}`, sub: `${per.note}, from ${F.monthLabel(per.payFrom)}`, date: `${per.payFrom}-01`, amount: owed, kind: 'in', estimate: true });
    }
    if (J && m.job.started && m.job.entries.length) out.push({ id: 'job-pay', stream: 'job', title: `${J.short} pay`, sub: m.job.projected ? 'estimate at your current pace' : J.deduction ? `after ${J.deduction.label}` : 'so far this month', date: `${NOW}-${F.daysIn(NOW)}`, amount: (m.job.projected || m.job).net, kind: 'in', estimate: true });
    if (L && L.yearlyCents && !L.receiptMonth) out.push({ id: 'lumpsum-month', stream: 'lumpsum', title: `When does your ${L.label} land?`, sub: `Pick the month the ${F.money(L.yearlyCents)} arrives`, date: null, amount: L.yearlyCents, kind: 'setup' });
    return out.sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999'));
  }

  /* ---------------- Writes (in memory; core/muse.js sends them to Muse first) ---------------- */
  const done = (v = { ok: true }) => Promise.resolve(v);
  function upsert(list, entry) { const i = list.findIndex((x) => x.id === entry.id); i >= 0 ? (list[i] = entry) : list.push(entry); }
  let persistT = null;
  const changedLocal = () => { changed(); if (persist) { clearTimeout(persistT); persistT = setTimeout(() => persist(exportLocal()), 250); } };
  const system = () => (S('job') && S('job').system) || 'your timesheet';
  const KEY_OF = { timesheet: (e) => e.date, leave: (e) => e.id, expenses: (e) => e.id };
  const FORM_KINDS = Object.keys(KEY_OF);
  function jobSlot(k) { const m = slot(k); m.job = m.job || { pendingCount: 0 }; return m.job; }
  /** One timesheet-form write. Dev remote → revision-checked PUT/DELETE; otherwise edit the in-memory form. */
  async function formWrite(kind, k, op, id, entry) {
    if (!FORM_KINDS.includes(kind)) return { ok: false, error: 'Unknown form' };
    const form = jobSlot(k)[kind] || null;
    if (form && form.status && form.status !== 'draft') return { ok: false, error: `This ${kind === 'timesheet' ? 'timesheet' : kind === 'leave' ? 'leave form' : 'claims form'} is ${form.status.replace(/_/g, ' ')} on ${system()}, so it is read-only.` };
    if (remote && remote.write) {
      state.sync.status = 'syncing'; emit();
      const r = await remote.write({ kind, month: k, op, id, entry, expectedRevision: form ? form.revision : 0 });
      state.sync.status = r.ok || r.conflict ? 'ok' : 'error'; state.sync.error = r.ok || r.conflict ? null : r.error; state.sync.at = new Date().toISOString();
      if (r.form) ingestForm(k, kind, r.form); else changed();
      return r;
    }
    const f = jobSlot(k)[kind] = form || { entries: [], status: 'draft', revision: 0, syncedAt: null };
    f.entries = f.entries.filter((e) => KEY_OF[kind](e) !== id);
    if (op === 'put') f.entries.push(entry);
    f.revision = (f.revision || 0) + 1;
    changedLocal();
    return { ok: true };
  }
  /** Ingest a timesheet-system form ({month, kind, revision, status, data, updatedAt, leaveBalances?}). */
  function ingestForm(k, kind, form) {
    const j = jobSlot(k), prev = j[kind];
    const base = { entries: (form.data && form.data.entries) || [], status: form.status, revision: form.revision, remoteUpdatedAt: form.updatedAt, syncedAt: new Date().toISOString() };
    if (kind === 'leave') Object.assign(base, { balances: form.leaveBalances || (prev && prev.balances) || [], allowances: (form.data && form.data.allowances) || [], otherType: (form.data && form.data.otherType) || '' });
    j[kind] = base;
    changed();
  }
  const sessionsIn = (part) => Object.values(state.months).map((x) => x[part]).filter(Boolean);
  function saveSession(part, entry) {
    sessionsIn(part).forEach((x) => (x.sessions = x.sessions.filter((y) => y.id !== entry.id)));
    const s = slot(entry.date.slice(0, 7));
    s[part] = s[part] || { sessions: [] };
    upsert(s[part].sessions, entry);
    changedLocal();
    return done();
  }
  function deleteSession(part, id) { sessionsIn(part).forEach((x) => (x.sessions = x.sessions.filter((y) => y.id !== id))); changedLocal(); return done(); }

  /** Everything, in the shape `loadAll` returns (also what dev mode saves to data/state.local.json). */
  function exportAll() {
    return { version: 2, setup: clone(state.rawSetup), profile: clone(state.profile), sources: clone(state.custom), months: clone(state.months), syncedAt: state.sync.at };
  }
  /** Only what has no other home in dev mode (the timesheet forms come from the proxy). */
  function exportLocal() {
    const gig = {}, hourly = {};
    for (const [k, v] of Object.entries(state.months)) { if (v.gig && v.gig.sessions.length) gig[k] = v.gig.sessions; if (v.hourly && v.hourly.sessions.length) hourly[k] = v.hourly.sessions; }
    return { version: 2, savedAt: new Date().toISOString(), setup: state.rawSetup, profile: state.profile, custom: state.custom, gig, hourly };
  }
  function importLocal(o) {
    if (!o || o.version !== 2) return;
    if (o.setup) applySetup(o.setup);
    if (o.profile) state.profile = { ...state.profile, ...o.profile };
    if (Array.isArray(o.custom)) state.custom = o.custom;
    for (const [k, list] of Object.entries(o.gig || {})) slot(k).gig = { sessions: list };
    for (const [k, list] of Object.entries(o.hourly || {})) slot(k).hourly = { sessions: list };
    changed();
  }
  /** Take what Muse's `loadAll` returned. Months not mentioned are left as they are. */
  function hydrate(d) {
    if (!d || typeof d !== 'object') return;
    if ('setup' in d) applySetup(d.setup);
    if (d.profile && typeof d.profile === 'object') state.profile = { ...state.profile, ...d.profile };
    if (Array.isArray(d.sources)) state.custom = d.sources.filter((s) => s && s.id).map((s) => ({ ...s, entries: Array.isArray(s.entries) ? s.entries : [] }));
    if (d.months && typeof d.months === 'object') {
      for (const [k, v] of Object.entries(d.months)) {
        if (!MONTH_RE.test(k) || !v || typeof v !== 'object') continue;
        const s = slot(k);
        if (v.job !== undefined) s.job = v.job;
        for (const part of ['gig', 'hourly']) if (v[part] !== undefined) s[part] = { sessions: (v[part] && Array.isArray(v[part].sessions) ? v[part].sessions : []) };
        if (v.statement !== undefined) s.statement = v.statement;
      }
    }
    if (d.syncedAt) state.sync.at = d.syncedAt;
    changed();
  }
  if (SNAP) { hydrate(SNAP); state.sync = { source: 'snapshot', status: 'idle', at: SNAP.capturedAt || null, error: null }; }

  const actions = {
    loadAll: async () => exportAll(),
    saveSetup: async ({ setup: s }) => { applySetup(s); Object.keys(sampleCache).forEach((k) => delete sampleCache[k]); changedLocal(); return done(); },
    saveProfile: async ({ fullName = '', bankAccount = '', paymentId = '' } = {}) => { state.profile = { fullName, bankAccount, paymentId }; changedLocal(); return done(); },
    saveGigSession: async ({ entry }) => saveSession('gig', entry),
    deleteGigSession: async ({ id }) => deleteSession('gig', id),
    saveHourlySession: async ({ entry }) => saveSession('hourly', entry),
    deleteHourlySession: async ({ id }) => deleteSession('hourly', id),
    /* ---- the job's timesheet, leave and claims forms ---- */
    saveWorkEntry: async ({ month: k, entry, previousDate }) => {
      if (previousDate && previousDate !== entry.date) { const r = await formWrite('timesheet', k, 'delete', previousDate); if (!r.ok) return r; }
      return formWrite('timesheet', k, 'put', entry.date, entry);
    },
    deleteWorkEntry: async ({ month: k, date }) => formWrite('timesheet', k, 'delete', date),
    saveLeaveEntry: async ({ month: k, entry }) => formWrite('leave', k, 'put', entry.id, entry),
    deleteLeaveEntry: async ({ month: k, id }) => formWrite('leave', k, 'delete', id),
    saveExpenseEntry: async ({ month: k, entry }) => formWrite('expenses', k, 'put', entry.id, entry),
    deleteExpenseEntry: async ({ month: k, id }) => formWrite('expenses', k, 'delete', id),
    uploadAttachment: async ({ kind, month: k, file }) => (remote && remote.upload ? remote.upload({ kind, month: k, file }) : done({ ok: true, id: F.uid('att'), name: file && file.name, local: true })),
    refresh: async ({ month: k } = {}) => {
      if (remote && remote.refresh) return remote.refresh({ month: k });
      state.sync.at = new Date().toISOString(); changed(); return done();
    },
    /* ---- income sources you add yourself ---- */
    saveIncomeSource: async ({ source }) => { const ex = state.custom.find((s) => s.id === source.id); ex ? Object.assign(ex, source) : state.custom.push({ entries: [], ...source }); changedLocal(); return done(); },
    deleteIncomeSource: async ({ id }) => { state.custom = state.custom.filter((s) => s.id !== id); changedLocal(); return done(); },
    saveIncomeEntry: async ({ sourceId, entry }) => { const s = state.custom.find((x) => x.id === sourceId); if (!s) return done({ ok: false, error: 'Unknown source' }); upsert(s.entries, entry); changedLocal(); return done(); },
    deleteIncomeEntry: async ({ sourceId, id }) => { const s = state.custom.find((x) => x.id === sourceId); if (s) s.entries = s.entries.filter((e) => e.id !== id); changedLocal(); return done(); },
  };

  CF.actions = actions;
  CF.data = {
    get today() { return today(); }, get now() { return nowKey(); },
    month, year, yearPrev, compare, series, range, upcoming, firstReal,
    setup, configured: () => !!state.setup, rawSetup: () => clone(state.rawSetup), stream: S, builtins, kinds: KINDS, defaults: DEFAULTS,
    custom: () => state.custom,
    sample: () => state.sample,
    setSample(on) { state.sample = !!on; tzReset(); changed(); },
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
    leaveTypes: () => ((S('job') || {}).leaveTypes || DEFAULT_LEAVE),
    leaveName: (code) => { const t = ((S('job') || {}).leaveTypes || DEFAULT_LEAVE).find((x) => x.code === code); return t ? t.name : code === 'PH' ? 'Public holiday' : code; },
    rules: { workedMin, deduct, jobPay, sessionMin, gigFee, hourlyMin, hourlyPay, payoutPeriod, weekdays, gigClaim, dayMinutes },
    nowTime: () => fmtTime.format(new Date()), todayLive: () => today(),
    profile: () => state.profile,
    sync: () => state.sync, setSync(p) { Object.assign(state.sync, p); emit(); },
    setRemote(r) { remote = r; }, hasRemote: () => !!remote,
    setPersist(fn) { persist = fn; }, exportLocal, importLocal, exportAll, hydrate, ingestForm,
    form: (k, kind) => (state.months[k] && state.months[k].job && state.months[k].job[kind]) || null,
    venues() { const v = new Set(); const G = S('gig'); if (G && G.venue) v.add(G.venue); sessionsIn('gig').forEach((x) => x.sessions.forEach((s) => s.venue && v.add(s.venue))); return [...v]; },
    lastRate(part) {
      let r = null;
      Object.keys(state.months).sort().forEach((k) => { const s = state.months[k][part]; if (s && s.sessions.length) r = s.sessions[s.sessions.length - 1].rateCents; });
      const st = S(part);
      return r != null ? r : st && st.rateCents ? st.rateCents : null;
    },
  };
})();
