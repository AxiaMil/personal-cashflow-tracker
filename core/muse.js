/* Muse bridge. Load after core/data.js and core/live.js.

   Inside a Muse space every server action is a POST to ./actions with {action, args, actionCallId}. Muse's
   frame tunnels it to the space's backend and the answer comes back as {data} or {error}. This file:
     1. loads everything in ONE call at start (loadAll), so the first paint already has your data and the
        app never fires a request per month;
     2. sends every write in CF.actions to Muse first, and only changes the screen once Muse says ok
        (then applies it locally, so there's no second round trip);
     3. reloads quietly when you come back to the space after a while;
     4. does nothing outside Muse: a local preview, the dev server (which has its own proxy) or a file:// open.

   CF.muse = { ready: Promise<CF.muse>, active, error, call(action, args), reload(months?) }
   The full contract (setup schema, every action and its shape) is in docs/MUSE.md. */
(function () {
  const CF = window.CF, D = CF.data, F = CF.fmt;
  const muse = { ready: null, active: false, error: null, call, reload };
  CF.muse = muse;

  const dev = !!document.querySelector('meta[name="cf-dev-token"]');
  if (dev || location.protocol === 'file:' || typeof fetch !== 'function') { muse.ready = Promise.resolve(muse); return; }

  /* ---------- transport (the same request Muse's own generated spaces make) ---------- */
  function endpoint() {
    try { const u = new URL(location.href); u.hash = ''; u.search = ''; return new URL('./actions', u).toString(); }
    catch (_) { return './actions'; }
  }
  let seq = 0;
  const timeout = (ms, what) => new Promise((_, no) => setTimeout(() => no(new Error(`${what} took too long. Check your connection and try again.`)), ms));
  async function call(action, args = {}, { wait = 20000 } = {}) {
    const id = `cf-${Date.now().toString(36)}-${(++seq).toString(36)}`;
    const res = await Promise.race([
      fetch(endpoint(), { method: 'POST', headers: { 'content-type': 'application/json', 'x-request-id': id }, body: JSON.stringify({ action, args: args || {}, actionCallId: id }) }),
      timeout(wait, action === 'loadAll' ? 'Loading' : 'Saving'),
    ]);
    if (!(res.headers.get('content-type') || '').includes('json')) throw Object.assign(new Error(`No actions endpoint (${res.status})`), { noEndpoint: true });
    const j = await res.json();
    if (j && typeof j === 'object' && 'error' in j && j.error) throw new Error(typeof j.error === 'string' ? j.error : j.error.message || `${action} failed`);
    if (!res.ok) throw new Error(`${action} failed (${res.status})`);
    return j && typeof j === 'object' && 'data' in j ? j.data : j;
  }

  /* ---------- loading ---------- */
  // Three years back covers year-on-year; one month ahead lets you plan leave.
  const span = () => ({ from: F.addMonths(D.now, -35), to: F.addMonths(D.now, 1) });
  let lastLoad = 0, loading = null;
  /** Re-read from Muse: the usual window, or just the given months. Concurrent calls share one request. */
  function reload(months) {
    const args = months && months.length ? { from: months.slice().sort()[0], to: months.slice().sort().pop() } : span();
    const key = `${args.from}|${args.to}`;
    if (loading && loading.key === key) return loading.p;
    const p = call('loadAll', args).then((d) => { lastLoad = Date.now(); D.hydrate(d); muse.error = null; return d; })
      .finally(() => { if (loading && loading.p === p) loading = null; });
    loading = { key, p };
    return p;
  }

  /* ---------- writes: Muse first, then the screen ---------- */
  const WRITES = ['saveSetup', 'saveProfile', 'saveGigSession', 'deleteGigSession', 'saveHourlySession', 'deleteHourlySession',
    'saveWorkEntry', 'deleteWorkEntry', 'saveLeaveEntry', 'deleteLeaveEntry', 'saveExpenseEntry', 'deleteExpenseEntry',
    'saveIncomeSource', 'deleteIncomeSource', 'saveIncomeEntry', 'deleteIncomeEntry'];
  const FORMS = new Set(['saveWorkEntry', 'deleteWorkEntry', 'saveLeaveEntry', 'deleteLeaveEntry', 'saveExpenseEntry', 'deleteExpenseEntry']);
  const toBase64 = (file) => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1] || ''); r.onerror = () => no(new Error('That file could not be read.')); r.readAsDataURL(file); });

  function wire() {
    const A = CF.actions, mem = { ...A };
    for (const name of WRITES) {
      A[name] = async (args = {}) => {
        let r;
        try { r = await call(name, args); } catch (e) { return { ok: false, error: e.message || 'Muse could not save that.' }; }
        if (r && r.ok === false) return r;
        await mem[name](args);
        if (r && typeof r === 'object' && (r.months || 'setup' in r)) D.hydrate(r); // the backend sent fresh data back
        else if (FORMS.has(name) && args.month) reload([args.month]).catch(() => {}); // pick up the new revision and status
        return { ...(r && typeof r === 'object' ? r : {}), ok: true };
      };
    }
    A.uploadAttachment = async ({ kind, month, file }) => {
      if (!file) return { ok: false, error: 'Choose a file first.' };
      if (file.size > 10 * 1024 * 1024) return { ok: false, error: 'Attachments can be up to 10 MB.' };
      try {
        const r = await call('uploadAttachment', { kind, month, name: file.name || 'attachment', type: file.type || '', base64: await toBase64(file) }, { wait: 60000 });
        return r && r.id ? { ...r, ok: true } : { ok: false, error: (r && r.error) || 'Muse did not return an attachment id.' };
      } catch (e) { return { ok: false, error: e.message }; }
    };
    A.refresh = async ({ month } = {}) => {
      D.setSync({ status: 'syncing' });
      try {
        const r = await call('refresh', { month: month || D.now }, { wait: 45000 });
        if (r && typeof r === 'object' && r.months) { lastLoad = Date.now(); D.hydrate(r); } else await reload();
        D.setSync({ status: 'ok', at: new Date().toISOString(), error: null });
        return { ok: true };
      } catch (e) { D.setSync({ status: 'error', error: e.message }); return { ok: false, error: e.message }; }
    };
    muse.claimTemplate = async () => { const r = await call('getClaimTemplate', {}, { wait: 30000 }); return typeof r === 'string' ? r : r && r.base64; };
  }

  /* ---------- start ---------- */
  muse.ready = (async () => {
    try {
      const d = await call('loadAll', span(), { wait: 15000 });
      muse.active = true; wire();
      lastLoad = Date.now();
      D.hydrate(d);
      D.setSync({ source: 'muse', status: 'ok', at: (d && d.syncedAt) || new Date().toISOString(), error: null });
    } catch (e) {
      if (e.noEndpoint || (e && e.name === 'TypeError')) return muse; // not inside Muse: stay a local preview
      // Inside Muse, but loadAll failed (or the space doesn't have it yet): writes still go to Muse.
      muse.active = true; muse.error = e.message; wire();
      D.setSync({ source: 'muse', status: 'error', error: `Couldn't load from Muse: ${e.message}` });
    }
    return muse;
  })();

  // Back in the space after a minute or more (Muse keeps spaces alive in the background): refresh quietly.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden || !muse.active || Date.now() - lastLoad < 60000) return;
    reload().then(() => D.setSync({ status: 'ok', at: new Date().toISOString(), error: null })).catch(() => {});
  });
})();
