// Reference backend: every server action the app calls, in memory, in plain JavaScript.
// It's the executable version of docs/MUSE.md: a Muse space implements the same actions over its own
// tables (and its own sync jobs for a timesheet system, spending and dividends). tools/test-muse.mjs runs
// the real app code against it.
//
// Wire format (what Muse's frame does): POST ./actions {action, args, actionCallId} → {data} or {error}.
// Money is integer cents. Months are "YYYY-MM", days "YYYY-MM-DD".

export function createBackend(seed = {}) {
  const db = {
    setup: null,                                            // the setup object (docs/MUSE.md), or null
    profile: { fullName: '', bankAccount: '', paymentId: '' }, // printed on claim forms
    sources: [],                                            // [{id, label, short, type, rateCents, startMonth, entries:[...]}]
    gig: [],                                                // [{id, date, venue, timeIn, timeOut, sessionsCount, rateCents, remarks}]
    hourly: [],                                             // [{id, date, module, timeIn, timeOut, minutes?, rateCents, remarks}]
    job: {},                                                // {'YYYY-MM': {timesheet, leave, expenses}} (forms: {entries, status, revision})
    statement: {},                                          // {'YYYY-MM': {expensesStatus, expenseCategories, expensesSyncedAt, investedCents, dividendsCents}}
    claimTemplate: null,                                    // base64 of a claim form .xlsx, if the person has one
    ...structuredClone(seed),
  };
  const monthOf = (d) => d.slice(0, 7);
  const inRange = (k, a) => (!a.from || k >= a.from) && (!a.to || k <= a.to);
  const upsert = (list, e) => { const i = list.findIndex((x) => x.id === e.id); if (i >= 0) list[i] = e; else list.push(e); };
  const form = (k, kind) => { db.job[k] = db.job[k] || {}; return (db.job[k][kind] = db.job[k][kind] || { entries: [], status: 'draft', revision: 0 }); };
  function formWrite(kind, key, k, op, id, entry) {
    const f = form(k, kind);
    if (f.status !== 'draft') throw new Error(`This ${kind} form is ${f.status} and can't be changed`);
    f.entries = f.entries.filter((e) => e[key] !== id);
    if (op === 'put') f.entries.push(entry);
    f.revision += 1;
    return { ok: true };
  }

  const actions = {
    /** Everything the app shows, for months from..to (both optional). One call per screen load. */
    loadAll({ from, to } = {}) {
      const a = { from, to }, months = {};
      const at = (k) => (months[k] = months[k] || {});
      for (const s of db.gig) if (inRange(monthOf(s.date), a)) (at(monthOf(s.date)).gig ||= { sessions: [] }).sessions.push(s);
      for (const s of db.hourly) if (inRange(monthOf(s.date), a)) (at(monthOf(s.date)).hourly ||= { sessions: [] }).sessions.push(s);
      for (const [k, v] of Object.entries(db.job)) if (inRange(k, a)) at(k).job = v;
      for (const [k, v] of Object.entries(db.statement)) if (inRange(k, a)) at(k).statement = v;
      return { setup: db.setup, profile: db.profile, sources: db.sources, months, syncedAt: new Date().toISOString() };
    },
    saveSetup({ setup }) { db.setup = setup; return { ok: true }; },
    saveProfile({ fullName = '', bankAccount = '', paymentId = '' }) { db.profile = { fullName, bankAccount, paymentId }; return { ok: true }; },

    saveGigSession({ entry }) { upsert(db.gig, entry); return { ok: true }; },
    deleteGigSession({ id }) { db.gig = db.gig.filter((s) => s.id !== id); return { ok: true }; },
    saveHourlySession({ entry }) { upsert(db.hourly, entry); return { ok: true }; },
    deleteHourlySession({ id }) { db.hourly = db.hourly.filter((s) => s.id !== id); return { ok: true }; },

    // The job's forms. A real space writes these through to its timesheet system and returns its errors.
    saveWorkEntry({ month, entry, previousDate }) {
      if (previousDate && previousDate !== entry.date) formWrite('timesheet', 'date', month, 'delete', previousDate);
      return formWrite('timesheet', 'date', month, 'put', entry.date, entry);
    },
    deleteWorkEntry({ month, date }) { return formWrite('timesheet', 'date', month, 'delete', date); },
    saveLeaveEntry({ month, entry }) { return formWrite('leave', 'id', month, 'put', entry.id, entry); },
    deleteLeaveEntry({ month, id }) { return formWrite('leave', 'id', month, 'delete', id); },
    saveExpenseEntry({ month, entry }) { return formWrite('expenses', 'id', month, 'put', entry.id, entry); },
    deleteExpenseEntry({ month, id }) { return formWrite('expenses', 'id', month, 'delete', id); },
    uploadAttachment({ kind, month, name, type, base64 }) {
      if (!['leave', 'expenses'].includes(kind) || !/^\d{4}-\d{2}$/.test(month || '')) throw new Error('Unknown form');
      if (!base64) throw new Error('Empty file');
      return { ok: true, id: `att-${Date.now().toString(36)}`, name, type };
    },

    saveIncomeSource({ source }) {
      const { entries, ...meta } = source;
      const ex = db.sources.find((s) => s.id === meta.id);
      if (ex) Object.assign(ex, meta); else db.sources.push({ ...meta, entries: [] });
      return { ok: true };
    },
    deleteIncomeSource({ id }) { db.sources = db.sources.filter((s) => s.id !== id); return { ok: true }; },
    saveIncomeEntry({ sourceId, entry }) { const s = db.sources.find((x) => x.id === sourceId); if (!s) throw new Error('Unknown source'); upsert(s.entries, entry); return { ok: true }; },
    deleteIncomeEntry({ sourceId, id }) { const s = db.sources.find((x) => x.id === sourceId); if (s) s.entries = s.entries.filter((e) => e.id !== id); return { ok: true }; },

    /** Pull fresh data from the outside services (timesheet system, spending, dividends). May return loadAll's shape. */
    refresh() { return { ok: true }; },
    getClaimTemplate() { return db.claimTemplate ? { base64: db.claimTemplate } : null; },
  };

  return {
    db, actions,
    /** One request, the way Muse answers it. */
    handle(action, args) {
      if (!Object.hasOwn(actions, action)) return { error: `Unknown action: ${action}` };
      try { return { data: structuredClone(actions[action](args || {}) ?? { ok: true }) }; } catch (e) { return { error: e.message }; } // a copy, as over the wire
    },
  };
}
