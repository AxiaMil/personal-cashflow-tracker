/* Live timesheet API link for local development. Load after core/data.js.
   tools/serve.mjs puts <meta name="cf-dev-token"> into every page it serves and proxies /ts/* (adding the
   API key server-side) and /local/state. Without that meta, which is the case in Muse and in dist/*.html,
   this file does nothing: Muse's own server actions do the timesheet sync there.

   CF.live = { ready: Promise<CF.live>, available, me, status, error, local, refresh({month}) }
     status: 'off' (no dev server) | 'connecting' | 'ok' | 'error' | 'no-key'
     available: true once /ts/me answered and CF.data.setRemote() is wired
     local: true once /local/state answered and CF.data.setPersist() is wired */
(function () {
  const CF = window.CF;
  const live = { ready: null, available: false, me: null, status: 'off', error: null, local: false, refresh };
  CF.live = live;

  const meta = typeof document !== 'undefined' && document.querySelector ? document.querySelector('meta[name="cf-dev-token"]') : null;
  const TOKEN = meta && meta.getAttribute('content');
  if (!TOKEN || !CF || !CF.data || typeof fetch !== 'function') { live.ready = Promise.resolve(live); return; }

  const D = CF.data, F = CF.fmt;
  const KINDS = ['timesheet', 'leave', 'expenses'];
  const MONTH_RE = /^20[0-9]{2}-(0[1-9]|1[0-2])$/, ID_RE = /^[A-Za-z0-9_-]{1,80}$/;
  const LIMIT = { timesheet: 31, leave: 12, expenses: 26 };
  const NOUN = { timesheet: 'timesheet', leave: 'leave form', expenses: 'expense claim' };
  const ENTRY_NOUN = { timesheet: 'days', leave: 'leave entries', expenses: 'expenses' };
  const KEY_OF = { timesheet: (e) => e && e.date, leave: (e) => e && e.id, expenses: (e) => e && e.id };
  // The API rejects unknown fields (additionalProperties: false), so send exactly the schema's fields.
  const FIELDS = {
    timesheet: { date: '', start: '', end: '', breakStart: '', breakEnd: '', overtimeMinutes: 0, attendanceCode: '', privateRemarks: '' },
    leave: { id: '', type: '', from: '', to: '', days: 0, reason: '', attachmentIds: [] },
    expenses: { id: '', date: '', description: '', amountCents: 0, attachmentIds: [] },
  };
  const clean = (kind, e) => Object.fromEntries(Object.entries(FIELDS[kind]).map(([k, d]) => [k, e[k] == null ? d : e[k]]));

  /* ---------- transport ---------- */
  async function call(method, path, { json, body } = {}) {
    const headers = { 'x-cf-token': TOKEN };
    if (json !== undefined) { headers['content-type'] = 'application/json'; body = JSON.stringify(json); }
    let r;
    try { r = await fetch(path, { method, headers, body, cache: 'no-store', credentials: 'omit' }); }
    catch { return { ok: false, status: 0, data: null }; }
    let data = null;
    if ((r.headers.get('content-type') || '').includes('json')) { try { data = await r.json(); } catch { data = null; } }
    return { ok: r.ok, status: r.status, data, retryAfter: Number(r.headers.get('retry-after')) || null };
  }

  /** Plain-English message for a failed call. */
  function explain(r, kind) {
    const d = r.data || {}, msg = typeof d.error === 'string' ? d.error : '';
    const proxy = d.source === 'dev-proxy';
    if (r.status === 0) return "Can't reach the timesheet API: you look offline, or the dev server stopped. Nothing was saved.";
    if (r.status === 401 && proxy) return 'The dev server restarted, so this page lost its session. Reload the page to reconnect.';
    if (r.status === 401) return "The timesheet API didn't accept the API key. It may have expired or been revoked: make a new one on the website and put it in .env.";
    if (r.status === 403 && proxy) return 'The dev proxy blocked that request.';
    if (r.status === 403) return "This API key isn't allowed to do that. Check its scopes on the timesheet website.";
    if (r.status === 404) return msg && !/route/i.test(msg) ? `Timesheet API: ${msg}` : "That entry wasn't found on the timesheet API. It may have been deleted elsewhere.";
    if (r.status === 413) return kind === 'upload' ? 'That file is too big. Attachments can be up to 10 MB.' : 'That entry is too large to save.';
    if (r.status === 415) return kind === 'upload' ? 'Only PDF, JPEG or PNG files can be attached.' : 'The timesheet API rejected the request format.';
    if (r.status === 429) { const s = r.retryAfter || d.retryAfter; return `Too many requests to the timesheet API in the last minute. Wait ${s ? s + ' seconds' : 'a minute'} and try again.`; }
    if (r.status === 503 && proxy) return 'There is no timesheet API key in .env, so live sync is off.';
    if (r.status === 400 && /capacity|limit|maximum|too many|full/i.test(msg) && LIMIT[kind]) return limitMsg(kind);
    if (r.status === 400) return msg ? `The timesheet API rejected this: ${msg}` : 'The timesheet API rejected this entry.';
    if (r.status >= 500) return "The timesheet API had a problem, so it isn't clear whether that saved. The latest version has been loaded: check it before trying again.";
    return msg || `The timesheet API answered ${r.status}.`;
  }
  const limitMsg = (kind) => `This ${NOUN[kind]} is full: the timesheet API allows at most ${LIMIT[kind]} ${ENTRY_NOUN[kind]} a month.`;
  const readOnlyMsg = (kind, status) => `This ${NOUN[kind]} is ${String(status).replace('_', ' ')} on the timesheet API, so it is read-only. Reopen it on the website to change it.`;

  /* ---------- forms ---------- */
  /** Make sure ingestForm gets {month, kind, revision, status, data:{entries,…}, updatedAt, leaveBalances?}.
      The real API already returns exactly this; the guards only cover partial or odd responses. */
  function normalise(f, month, kind) {
    if (!f || typeof f !== 'object') return null;
    const data = f.data && typeof f.data === 'object' ? { ...f.data } : {};
    if (!Array.isArray(data.entries)) data.entries = Array.isArray(f.entries) ? f.entries : [];
    if (kind === 'leave') { if (!Array.isArray(data.allowances)) data.allowances = []; if (typeof data.otherType !== 'string') data.otherType = ''; }
    const out = { month: f.month || month, kind: f.kind || kind, revision: Number.isInteger(f.revision) ? f.revision : 0, status: f.status || 'draft', data, updatedAt: f.updatedAt == null ? null : f.updatedAt };
    if (Array.isArray(f.leaveBalances)) out.leaveBalances = f.leaveBalances;
    return out;
  }
  // Only GET leave includes leaveBalances, so a leave mutation's response is never the whole picture.
  const isFull = (f, kind) => !!f && Array.isArray(f.data.entries) && (kind !== 'leave' || Array.isArray(f.leaveBalances));
  async function getForm(month, kind) {
    const r = await call('GET', `/ts/months/${month}/${kind}`);
    if (!r.ok) return { ok: false, r };
    const form = normalise(r.data, month, kind);
    return form ? { ok: true, form } : { ok: false, r: { ...r, ok: false, status: 502 } };
  }

  /* ---------- remote for CF.data.setRemote ---------- */
  async function write({ kind, month, op, id, entry, expectedRevision }) {
    if (!KINDS.includes(kind) || !MONTH_RE.test(month || '')) return { ok: false, error: 'Unknown timesheet form.' };
    if (!ID_RE.test(String(id || ''))) return { ok: false, error: 'That entry has an ID the timesheet API cannot store (letters, digits, - and _ only, up to 80).' };
    if (op !== 'put' && op !== 'delete') return { ok: false, error: 'Unknown change.' };
    let payload;
    if (op === 'put') {
      if (!entry || typeof entry !== 'object') return { ok: false, error: 'Nothing to save.' };
      payload = clean(kind, entry);
      if (KEY_OF[kind](payload) !== id) return { ok: false, error: kind === 'timesheet' ? "The day's date doesn't match the entry being saved." : "The entry's ID doesn't match the entry being saved." };
      const cur = D.form(month, kind);
      if (cur && Array.isArray(cur.entries) && cur.entries.length >= LIMIT[kind] && !cur.entries.some((e) => KEY_OF[kind](e) === id)) return { ok: false, limit: true, error: limitMsg(kind) };
    }
    const path = `/ts/months/${month}/${kind}/entries/${id}`;
    const body = op === 'put' ? { expectedRevision: expectedRevision || 0, entry: payload } : { expectedRevision: expectedRevision || 0 };
    const r = await call(op === 'put' ? 'PUT' : 'DELETE', path, { json: body });

    if (r.ok) {
      let form = normalise(r.data, month, kind);
      if (!isFull(form, kind)) {
        const g = await getForm(month, kind);
        if (g.ok && (!form || g.form.revision >= form.revision)) form = g.form;
        else if (form && kind === 'leave') { const prev = D.form(month, kind); form.leaveBalances = (prev && prev.balances) || []; }
      }
      if (!form) return { ok: true }; // saved, but nothing to show: data.js re-renders and the next refresh catches up
      return { ok: true, form };
    }
    if (r.status === 409) {
      // Revision conflict or a signed form. Never retry: load the latest and let the person decide.
      const g = await getForm(month, kind);
      if (g.ok) D.ingestForm(month, kind, g.form);
      const status = g.ok ? g.form.status : null;
      if (status && status !== 'draft') return { ok: false, conflict: true, readOnly: true, error: readOnlyMsg(kind, status) };
      return { ok: false, conflict: true, error: `This ${NOUN[kind]} changed on the timesheet API since it was loaded (the website or another device). The latest version is now showing: check it and save again.`, detail: (r.data && r.data.error) || null };
    }
    if (r.status === 0 || r.status >= 500) {
      // The write may or may not have landed. Reconcile by reading; don't retry.
      const g = await getForm(month, kind);
      if (g.ok) D.ingestForm(month, kind, g.form);
      return { ok: false, uncertain: r.status !== 0, error: r.status === 0 ? explain(r, kind) : explain({ status: 500, data: null }, kind) };
    }
    return { ok: false, status: r.status, limit: r.status === 400 && /capacity|limit|maximum|too many|full/i.test((r.data && r.data.error) || ''), error: explain(r, kind) };
  }

  async function upload({ kind, month, file }) {
    if (kind !== 'leave' && kind !== 'expenses') return { ok: false, error: 'Attachments go on leave or expense entries only.' };
    if (!MONTH_RE.test(month || '')) return { ok: false, error: 'Unknown month.' };
    if (!file) return { ok: false, error: 'Choose a file first.' };
    const fd = new FormData();
    fd.append('kind', kind);
    fd.append('month', month);
    fd.append('file', file, file.name || 'attachment');
    const r = await call('POST', '/ts/attachments', { body: fd });
    if (!r.ok || !r.data || !r.data.id) return { ok: false, error: r.ok ? 'The timesheet API did not return an attachment ID.' : explain(r, 'upload') };
    return { ok: true, id: r.data.id, name: r.data.name || file.name || '', contentType: r.data.contentType, size: r.data.size };
  }

  let refreshing = null;
  /** Re-read all three forms for `month`, or for the current and previous month when no month is given. */
  function refresh({ month } = {}) {
    const months = month ? [month] : [D.now, F.addMonths(D.now, -1)];
    if (months.some((m) => !MONTH_RE.test(m))) return Promise.resolve({ ok: false, error: 'Unknown month.' });
    const key = months.join(',');
    if (refreshing && refreshing.key === key) return refreshing.p;
    D.setSync({ status: 'syncing' });
    const p = Promise.all(months.flatMap((m) => KINDS.map((k) => getForm(m, k).then((g) => ({ m, k, g }))))).then((res) => {
      res.forEach(({ m, k, g }) => g.ok && D.ingestForm(m, k, g.form));
      const bad = res.find((x) => !x.g.ok);
      if (bad) {
        const error = explain(bad.g.r, bad.k);
        D.setSync({ source: 'live', status: 'error', error });
        return { ok: false, error };
      }
      D.setSync({ source: 'live', status: 'ok', at: new Date().toISOString(), error: null });
      return { ok: true };
    }).finally(() => { if (refreshing && refreshing.p === p) refreshing = null; });
    refreshing = { key, p };
    return p;
  }

  /* ---------- local-only state (setup, sessions, your income sources, claim details) ---------- */
  // Saves are serialised and coalesced: at most one PUT in flight, and the newest state always wins.
  let saving = false, queued = null;
  async function persist(obj) {
    queued = obj;
    if (saving) return;
    saving = true;
    while (queued) {
      const o = queued; queued = null;
      const r = await call('PUT', '/local/state', { json: o });
      live.localError = r.ok ? null : explain(r, 'local');
    }
    saving = false;
  }

  /* ---------- boot ---------- */
  live.status = 'connecting';
  live.ready = (async () => {
    try {
      const ls = await call('GET', '/local/state');
      if (ls.ok) { if (ls.data) D.importLocal(ls.data); D.setPersist(persist); live.local = true; }

      const me = await call('GET', '/ts/me');
      if (!me.ok) {
        live.status = me.status === 503 ? 'no-key' : 'error';
        live.error = explain(me, 'me');
        if (live.status === 'error') D.setSync({ status: 'error', error: live.error }); // no key just means no live sync: stay a quiet preview
        return live;
      }
      live.me = me.data;
      live.available = true;
      D.setRemote({ write, upload, refresh });

      const r = await refresh();
      live.status = r.ok ? 'ok' : 'error';
      live.error = r.ok ? null : r.error;
    } catch (e) {
      live.status = 'error';
      live.error = 'Live sync failed to start.';
    }
    return live;
  })();
})();
