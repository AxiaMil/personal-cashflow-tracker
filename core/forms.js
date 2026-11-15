/* Entry sheets: gig sessions, hourly sessions, job days, leave and claims, claim details, income sources
   and the few settings you change in the app. Labels, rates and presets come from the setup
   (CF.data.setup()), never from here. Every save goes through CF.actions. The app restyles .cf-* classes. */
(function () {
  const CF = window.CF, F = CF.fmt, h = CF.h, A = CF.actions, D = CF.data;

  const field = (label, input, hint) => h('label.cf-field', h('span.cf-label', label), input, hint ? h('span.cf-hint', hint) : null);
  const input = (props) => h('input.cf-input', props);
  const money = (cents) => (cents == null ? '' : (cents / 100).toFixed(2));
  const CUR = () => (D.setup() && D.setup().currency) || 'USD';
  const S = (k) => D.stream(k) || D.defaults[k];
  const addMin = (t, n) => { const v = F.toMin(t) + n; return `${F.pad2(Math.floor(v / 60) % 24)}:${F.pad2(v % 60)}`; };
  /** Save a changed copy of the setup (Muse keeps the original's unknown fields). */
  function saveSetup(edit) {
    const raw = D.rawSetup() || { version: 1, streams: {} };
    raw.streams = raw.streams || {};
    edit(raw);
    return A.saveSetup({ setup: raw });
  }
  const toCents = (s) => { const v = Number(String(s).replace(/[^0-9.]/g, '')); return Number.isFinite(v) ? Math.round(v * 100) : NaN; };
  const err = () => h('p.cf-error', { role: 'alert', hidden: true });
  const showErr = (el, msg) => { el.textContent = msg; el.hidden = !msg; };
  function stepper(value, { min = 0, max = 99, step = 1, label, fmt = (v) => v } = {}) {
    let v = value;
    const out = h('output.cf-step-val', { 'aria-live': 'polite' }, fmt(v));
    const set = (n) => { v = F.clamp(n, min, max); out.textContent = fmt(v); wrap.dispatchEvent(new Event('input', { bubbles: true })); CF.ui.haptic(5); };
    const wrap = h('div.cf-stepper', { role: 'group', 'aria-label': label },
      h('button.cf-step', { type: 'button', 'aria-label': `Less ${label}`, onclick: () => set(v - step) }, '−'), out,
      h('button.cf-step', { type: 'button', 'aria-label': `More ${label}`, onclick: () => set(v + step) }, '+'));
    wrap.get = () => v; wrap.set = (n) => { v = n; out.textContent = fmt(v); };
    return wrap;
  }
  function chips(items, onPick) {
    return h('div.cf-chips', { 'data-noswipe': '' }, items.map((it) => h('button.cf-chip', { type: 'button', onclick: () => { onPick(it); CF.ui.haptic(5); } }, h('strong', it.label), it.sub ? h('span', it.sub) : null)));
  }
  function footer(form, { saveLabel = 'Save', onDelete } = {}) {
    const save = h('button.cf-btn.is-primary', { type: 'submit', form: form.id }, saveLabel);
    return [onDelete ? h('button.cf-btn.is-danger', { type: 'button', onclick: onDelete }, 'Delete') : null, h('span.cf-grow'), save];
  }
  async function run(btn, fn) {
    const b = btn.form ? btn : document.querySelector(`button[form="${btn.id}"]`);
    if (b) { b.disabled = true; b.dataset.label = b.textContent; b.textContent = 'Saving…'; }
    try { return await fn(); } finally { if (b) { b.disabled = false; b.textContent = b.dataset.label; } }
  }
  let formSeq = 0;

  /* ---------------- Gig session (per-session work, claimed monthly) ---------------- */
  function gig({ session, date } = {}) {
    const id = `cf-form-${++formSeq}`, G = S('gig'), len = G.sessionMinutes || 60;
    const s = session || { id: F.uid('gig'), date: date || D.today, venue: D.venues()[0] || '', timeIn: '09:00', timeOut: addMin('09:00', len), sessionsCount: 1, rateCents: D.lastRate('gig'), remarks: '' };
    const fDate = input({ type: 'date', value: s.date, required: true });
    const fVenue = input({ type: 'text', value: s.venue || '', list: `${id}-venues`, autocomplete: 'off', placeholder: 'Optional' });
    const fIn = input({ type: 'time', value: s.timeIn, step: 300, required: true });
    const fOut = input({ type: 'time', value: s.timeOut, step: 300, required: true });
    const fCount = stepper(s.sessionsCount || 1, { min: 1, max: 40, label: 'sessions', fmt: (v) => `${v} × ${len} min` });
    const fRate = input({ type: 'text', inputmode: 'decimal', value: money(s.rateCents), 'aria-label': `Rate per session in ${CUR()}` });
    const fRemarks = input({ type: 'text', value: s.remarks || '', placeholder: 'e.g. Beginner class', maxlength: 120 });
    const total = h('div.cf-total');
    const e = err();
    const recalc = () => {
      const rate = toCents(fRate.value), n = fCount.get();
      const mins = (F.toMin(fOut.value) || 0) - (F.toMin(fIn.value) || 0);
      total.replaceChildren(h('span', `${n} session${n > 1 ? 's' : ''} · ${F.hours(Math.max(0, mins))}`), h('strong', Number.isFinite(rate) ? F.money(n * rate, { cents: true }) : '—'));
    };
    const fillTimes = (start, n) => { fIn.value = start; fOut.value = addMin(start, len * n); fCount.set(n); recalc(); };
    fCount.addEventListener('input', () => fillTimes(fIn.value || '09:00', fCount.get()));
    // Presets from the setup ({label, start, sessions, remarks}), else a single and a double
    const presets = G.presets && G.presets.length ? G.presets.map((p) => ({ label: p.label, sub: `${p.start ? `${F.fmtTime(p.start)} · ` : ''}${p.sessions || 1} × ${len} min`, fn: () => { fillTimes(p.start || fIn.value || '09:00', p.sessions || 1); if (p.remarks) fRemarks.value = p.remarks; } }))
      : [{ label: 'Single', sub: `${len} min`, fn: () => fillTimes(fIn.value || '09:00', 1) }, { label: 'Double', sub: `2 × ${len} min`, fn: () => fillTimes(fIn.value || '09:00', 2) }];
    const form = h('form.cf-form', { id, novalidate: true },
      chips(presets, (c) => c.fn()),
      h('div.cf-row', field('Date', fDate), field('Sessions', fCount)),
      h('div.cf-row', field('Time in', fIn), field('Time out', fOut)),
      field('Venue', fVenue), h('datalist', { id: `${id}-venues` }, D.venues().map((v) => h('option', { value: v }))),
      h('div.cf-row', field(`Rate per session (${CUR()})`, fRate, G.rateNote || null), field('Remarks', fRemarks)),
      total, e);
    [fIn, fOut, fRate].forEach((x) => x.addEventListener('input', recalc)); recalc();
    let sh;
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const rate = toCents(fRate.value);
      if (!fDate.value) return showErr(e, 'Pick a date.');
      if (!fIn.value || !fOut.value || F.toMin(fOut.value) <= F.toMin(fIn.value)) return showErr(e, 'Time out must be after time in.');
      if (!Number.isFinite(rate) || rate < 0) return showErr(e, `Enter a rate of ${CUR()} 0 or more.`);
      showErr(e, '');
      const entry = { id: s.id, date: fDate.value, venue: fVenue.value.trim(), timeIn: fIn.value, timeOut: fOut.value, sessionsCount: fCount.get(), rateCents: rate, remarks: fRemarks.value.trim() };
      const r = await run(form, () => A.saveGigSession({ entry }));
      if (r.ok) { sh.close(); CF.ui.toast('Session saved'); } else showErr(e, r.error || 'That session could not be saved.');
    });
    const del = session ? async () => { const r = await A.deleteGigSession({ id: s.id }); if (r.ok) { sh.close(); CF.ui.toast('Session deleted'); } else showErr(e, r.error); } : null;
    sh = CF.ui.sheet({ title: session ? `Edit ${G.short} session` : `Log ${G.short} session`, sub: G.claim ? `${G.label} · goes on your monthly claim` : G.label, body: form, footer: footer(form, { onDelete: del }), cls: 'cf-s-gig' });
    return sh;
  }

  /* ---------------- Hourly session ---------------- */
  function hourly({ session, date } = {}) {
    const id = `cf-form-${++formSeq}`, H = S('hourly');
    const s = session || { id: F.uid('hr'), date: date || D.today, module: '', timeIn: '', timeOut: '', rateCents: D.lastRate('hourly'), remarks: '' };
    const fDate = input({ type: 'date', value: s.date });
    const fMod = input({ type: 'text', value: s.module || '', placeholder: 'Optional', maxlength: 40 });
    const fIn = input({ type: 'time', value: s.timeIn || '', step: 300 });
    const fOut = input({ type: 'time', value: s.timeOut || '', step: 300 });
    const fRate = input({ type: 'text', inputmode: 'decimal', value: money(s.rateCents), placeholder: 'Set your rate' });
    const fRemarks = input({ type: 'text', value: s.remarks || '', placeholder: 'Optional', maxlength: 120 });
    const total = h('div.cf-total'), e = err();
    const recalc = () => { const m = Math.max(0, (F.toMin(fOut.value) || 0) - (F.toMin(fIn.value) || 0)); const r = toCents(fRate.value); total.replaceChildren(h('span', `${F.hours(m)} × ${Number.isFinite(r) && fRate.value ? F.money(r, { cents: true }) + '/h' : 'rate not set'}`), h('strong', Number.isFinite(r) && fRate.value ? F.money(Math.round((m / 60) * r), { cents: true }) : '—')); };
    const span = (mins, label) => () => { fIn.value = fIn.value || '14:00'; fOut.value = addMin(fIn.value, mins); if (label) fRemarks.value = label; recalc(); };
    // Presets from the setup ({label, minutes}), else one and two hours
    const presets = H.presets && H.presets.length ? H.presets.map((p) => ({ label: p.label, sub: F.hours(p.minutes || 60), fn: span(p.minutes || 60, p.remarks || p.label) }))
      : [{ label: '1 hour', sub: 'from the start time', fn: span(60) }, { label: '2 hours', sub: 'from the start time', fn: span(120) }];
    const form = h('form.cf-form', { id, novalidate: true },
      chips(presets, (c) => c.fn()),
      h('div.cf-row', field('Date', fDate), field(H.unitLabel || 'Project', fMod)),
      h('div.cf-row', field('Start', fIn), field('End', fOut)),
      h('div.cf-row', field(`Rate per hour (${CUR()})`, fRate), field('Note', fRemarks)), total, e);
    [fIn, fOut, fRate].forEach((x) => x.addEventListener('input', recalc)); recalc();
    let sh;
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const rate = toCents(fRate.value);
      if (!fDate.value) return showErr(e, 'Pick a date.');
      if (!!fIn.value !== !!fOut.value || (fIn.value && F.toMin(fOut.value) <= F.toMin(fIn.value))) return showErr(e, 'Fill in both times (end after start), or leave both blank.');
      if (!fRate.value || !Number.isFinite(rate) || rate < 0) return showErr(e, `Enter your rate per hour (${CUR()} 0 or more).`);
      showErr(e, '');
      const entry = { id: s.id, date: fDate.value, module: fMod.value.trim(), timeIn: fIn.value, timeOut: fOut.value, minutes: s.minutes && !fIn.value ? s.minutes : undefined, rateCents: rate, remarks: fRemarks.value.trim() };
      if (entry.minutes === undefined) delete entry.minutes;
      const r = await run(form, () => A.saveHourlySession({ entry }));
      if (r.ok) { sh.close(); CF.ui.toast('Session saved'); } else showErr(e, r.error || 'That session could not be saved.');
    });
    const del = session ? async () => { const r = await A.deleteHourlySession({ id: s.id }); if (r.ok) { sh.close(); CF.ui.toast('Session deleted'); } else showErr(e, r.error); } : null;
    sh = CF.ui.sheet({ title: session ? `Edit ${H.short} session` : `Log ${H.short} session`, sub: H.payout && H.payout !== 'monthly' ? `${H.label} · ${H.payout.label}` : `${H.label} · hourly`, body: form, footer: footer(form, { onDelete: del }), cls: 'cf-s-hourly' });
    return sh;
  }

  /* ---------------- Job day (the timesheet the space syncs with) ---------------- */
  // Leave types come from the job's setup (setup.streams.job.leaveTypes); a day can also be a public holiday.
  const LEAVE = () => D.leaveTypes().map((x) => [x.code, x.name]);
  const CODES = () => [['', 'Worked'], ...LEAVE().filter(([c]) => c !== 'PH'), ['PH', 'Public holiday']];
  function workDay({ date, entry, draft, status = 'draft', title, sub, onSaved } = {}) {
    const id = `cf-form-${++formSeq}`;
    const ro = status !== 'draft', J = S('job'), DAY = J.day;
    const en = entry || { date, start: DAY.start, end: DAY.end, breakStart: DAY.breakStart, breakEnd: DAY.breakEnd, overtimeMinutes: 0, attendanceCode: '', privateRemarks: '', ...(draft || {}) };
    const fStart = input({ type: 'time', value: en.start, step: 300, disabled: ro }), fEnd = input({ type: 'time', value: en.end, step: 300, disabled: ro });
    const fBs = input({ type: 'time', value: en.breakStart, step: 300, disabled: ro }), fBe = input({ type: 'time', value: en.breakEnd, step: 300, disabled: ro });
    const fCode = h('select.cf-input', { disabled: ro }, CODES().map(([v, l]) => h('option', { value: v, selected: v === en.attendanceCode }, v ? `${v} · ${l}` : l)));
    const fOt = stepper(en.overtimeMinutes || 0, { min: 0, max: 1439, step: 15, label: 'overtime', fmt: (v) => (v ? `${v} min` : 'None') });
    const fRem = input({ type: 'text', value: en.privateRemarks || '', placeholder: 'e.g. WFH, office, on site', maxlength: 2000, disabled: ro });
    const total = h('div.cf-total'), e = err();
    const cur = () => ({ date: en.date || date, start: fStart.value, end: fEnd.value, breakStart: fBs.value, breakEnd: fBe.value, overtimeMinutes: fOt.get(), attendanceCode: fCode.value, privateRemarks: fRem.value.trim() });
    const recalc = () => { const m = D.rules.workedMin(cur()); const p = D.month((en.date || date).slice(0, 7)).job; total.replaceChildren(h('span', `${F.hours(m)} worked`), h('strong', `≈ ${F.money(Math.round((m / (p.expectedMin || 1)) * p.monthlyPayCents), { cents: true })}`)); };
    const preset = (a, b, bs, be) => { fStart.value = a; fEnd.value = b; fBs.value = bs; fBe.value = be; fCode.value = ''; recalc(); };
    const form = h('form.cf-form', { id, novalidate: true },
      ro ? h('p.cf-note', `This timesheet is ${status.replace(/_/g, ' ')} on ${J.system}, so it's read-only here. Reopen it there to change it.`) : draft ? null : chips([
        { label: 'Full day', sub: `${F.fmtTime(DAY.start)}–${F.fmtTime(DAY.end)} · ${F.hours(D.rules.workedMin(DAY))}`, fn: () => preset(DAY.start, DAY.end, DAY.breakStart, DAY.breakEnd) },
        { label: 'Half day', sub: `from ${F.fmtTime(DAY.start)} · ${F.hours(Math.round(J.dayMinutes / 2))}`, fn: () => preset(DAY.start, addMin(DAY.start, Math.round(J.dayMinutes / 2)), '', '') },
        { label: 'Leave / code only', sub: 'no times', fn: () => { preset('', '', '', ''); fCode.value = (LEAVE()[0] || ['PH'])[0]; recalc(); } }], (c) => c.fn()),
      h('div.cf-row', field('Start', fStart), field('End', fEnd)),
      h('div.cf-row', field('Break start', fBs), field('Break end', fBe)),
      h('div.cf-row', field('Attendance code', fCode), field('Overtime', fOt)),
      field('Private remark', fRem, 'Only you see this, it never goes into the export'), total, e);
    form.addEventListener('input', recalc); recalc();
    let sh;
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const c = cur();
      if (!!c.start !== !!c.end) return showErr(e, 'Start and end times must be filled in together.');
      if (!!c.breakStart !== !!c.breakEnd) return showErr(e, 'Break start and end must be filled in together.');
      if (c.start && F.toMin(c.end) <= F.toMin(c.start)) return showErr(e, 'End must be after start (no overnight shifts).');
      showErr(e, '');
      const r = await run(form, () => A.saveWorkEntry({ month: c.date.slice(0, 7), entry: c, previousDate: entry ? entry.date : undefined }));
      if (r.ok) { sh.close(); CF.ui.toast(`Saved to ${J.system}`); onSaved && onSaved(c); } else showErr(e, r.error || 'That day could not be saved.');
    });
    const del = entry && !ro ? async () => { const r = await A.deleteWorkEntry({ month: entry.date.slice(0, 7), date: entry.date }); if (r.ok) { sh.close(); CF.ui.toast('Day removed'); } else showErr(e, r.error); } : null;
    sh = CF.ui.sheet({ title: title || F.dayLabel(en.date || date, { long: true }), sub: sub || `${J.label} · ${J.system}`, body: form, footer: ro ? null : footer(form, { saveLabel: entry ? 'Save day' : 'Key in day', onDelete: del }), cls: 'cf-s-day' });
    return sh;
  }

  /* ---------------- Leave + claims (the job's timesheet-system forms) ---------------- */
  const weekdaysBetween = (a, b) => { let n = 0; for (let d = F.parseYmd(a); d <= F.parseYmd(b); d.setDate(d.getDate() + 1)) { const w = d.getDay(); if (w >= 1 && w <= 5) n++; } return n; };
  const readOnly = (k, kind) => { const f = D.form(k, kind); return f && f.status && f.status !== 'draft' ? f.status.replace('_', ' ') : null; };
  function fileField(label, hint) {
    const f = h('input.cf-input.cf-file', { type: 'file', accept: 'image/jpeg,image/png,application/pdf' });
    return { el: field(label, f, hint), file: () => f.files && f.files[0] };
  }
  async function attach(kind, month, picked, ids) {
    if (!picked) return { ok: true, ids };
    const r = await A.uploadAttachment({ kind, month, file: picked });
    return r.ok ? { ok: true, ids: [...ids, r.id] } : { ok: false, error: r.error || 'The file could not be uploaded.' };
  }
  function leave({ entry, month } = {}) {
    const id = `cf-form-${++formSeq}`;
    const en = entry || { id: F.uid('lv'), type: (LEAVE()[0] || [''])[0], from: month && month !== D.now ? `${month}-01` : D.today, to: '', days: 1, reason: '', attachmentIds: [] };
    if (!en.to) en.to = en.from;
    const k0 = en.from.slice(0, 7), ro = readOnly(k0, 'leave');
    const fType = h('select.cf-input', { disabled: !!ro }, LEAVE().map(([v, l]) => h('option', { value: v, selected: v === en.type }, `${v} · ${l}`)));
    const fFrom = input({ type: 'date', value: en.from, disabled: !!ro }), fTo = input({ type: 'date', value: en.to, disabled: !!ro });
    const fDays = stepper(en.days, { min: 0.5, max: 31, step: 0.5, label: 'days', fmt: (v) => `${v} day${v === 1 ? '' : 's'}` });
    const fWhy = input({ type: 'text', value: en.reason || '', placeholder: 'e.g. Family trip, flu', maxlength: 200, disabled: !!ro });
    const up = fileField('Certificate or document', en.attachmentIds && en.attachmentIds.length ? `${en.attachmentIds.length} attached already` : 'Optional, such as a medical certificate.');
    const bal = h('div.cf-total'), e = err();
    const recalc = () => {
      const b = ((D.month(fFrom.value.slice(0, 7) || D.now).job.leave || {}).balances || []).find((x) => x.type === fType.value);
      bal.replaceChildren(h('span', b ? `${fType.value} balance` : fType.value), h('strong', b ? `${b.balance} of ${b.entitlement} days` : `${fDays.get()} day${fDays.get() === 1 ? '' : 's'}`));
    };
    const syncDays = () => { if (fFrom.value && fTo.value && fTo.value >= fFrom.value) fDays.set(Math.max(0.5, weekdaysBetween(fFrom.value, fTo.value))); recalc(); };
    fFrom.addEventListener('change', () => { if (!fTo.value || fTo.value < fFrom.value) fTo.value = fFrom.value; syncDays(); });
    fTo.addEventListener('change', syncDays); fType.addEventListener('change', recalc); fDays.addEventListener('input', recalc);
    const form = h('form.cf-form', { id, novalidate: true },
      ro ? h('p.cf-note', `Your ${F.monthLabel(k0, { long: true })} leave form is ${ro} on ${S('job').system}, so it's read-only here.`) : null,
      h('div.cf-row', field('Type', fType), field('Days', fDays, 'Half days allowed')),
      h('div.cf-row', field('From', fFrom), field('To', fTo)),
      field('Reason', fWhy), ro ? null : up.el, bal, e);
    recalc();
    let sh;
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      if (!fFrom.value || !fTo.value || fTo.value < fFrom.value) return showErr(e, 'Pick a start date and an end date on or after it.');
      if (fFrom.value.slice(0, 7) !== fTo.value.slice(0, 7)) return showErr(e, 'Leave is kept per month. Log the days in each month separately.');
      const k = fFrom.value.slice(0, 7);
      showErr(e, '');
      const r = await run(form, async () => {
        const a = await attach('leave', k, up.file(), en.attachmentIds || []);
        if (!a.ok) return a;
        if (entry && k !== k0) { const d = await A.deleteLeaveEntry({ month: k0, id: en.id }); if (!d.ok) return d; }
        return A.saveLeaveEntry({ month: k, entry: { id: en.id, type: fType.value, from: fFrom.value, to: fTo.value, days: fDays.get(), reason: fWhy.value.trim(), attachmentIds: a.ids } });
      });
      if (r.ok) { sh.close(); CF.ui.toast('Leave saved'); } else showErr(e, r.error || 'That leave could not be saved.');
    });
    const del = entry && !ro ? async () => { const r = await A.deleteLeaveEntry({ month: k0, id: en.id }); if (r.ok) { sh.close(); CF.ui.toast('Leave removed'); } else showErr(e, r.error); } : null;
    sh = CF.ui.sheet({ title: entry ? 'Edit leave' : 'Apply leave', sub: `${S('job').label} · ${S('job').system}`, body: form, footer: ro ? null : footer(form, { saveLabel: entry ? 'Save' : 'Add leave', onDelete: del }), cls: 'cf-s-leave' });
    return sh;
  }
  function claim({ entry, month } = {}) {
    const id = `cf-form-${++formSeq}`;
    const en = entry || { id: F.uid('cl'), date: month && month !== D.now ? `${month}-01` : D.today, description: '', amountCents: null, attachmentIds: [] };
    const k0 = en.date.slice(0, 7), ro = readOnly(k0, 'expenses');
    const fDate = input({ type: 'date', value: en.date, disabled: !!ro });
    const fDesc = input({ type: 'text', value: en.description, placeholder: 'e.g. Taxi to a client site', maxlength: 200, disabled: !!ro });
    const fAmt = input({ type: 'text', inputmode: 'decimal', value: money(en.amountCents), placeholder: '0.00', disabled: !!ro });
    const up = fileField('Receipt', en.attachmentIds && en.attachmentIds.length ? `${en.attachmentIds.length} attached already` : 'Photo or PDF of the receipt');
    const e = err();
    const form = h('form.cf-form', { id, novalidate: true },
      ro ? h('p.cf-note', `Your ${F.monthLabel(k0, { long: true })} claims form is ${ro} on ${S('job').system}, so it's read-only here.`) : null,
      h('div.cf-row', field('Date', fDate), field(`Amount (${CUR()})`, fAmt)), field('What for', fDesc), ro ? null : up.el, e);
    let sh;
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const c = toCents(fAmt.value), k = fDate.value.slice(0, 7);
      if (!fDate.value) return showErr(e, 'Pick a date.');
      if (!fDesc.value.trim()) return showErr(e, 'Say what the claim is for.');
      if (!Number.isFinite(c) || c <= 0) return showErr(e, `Enter an amount above ${CUR()} 0.`);
      showErr(e, '');
      const r = await run(form, async () => {
        const a = await attach('expenses', k, up.file(), en.attachmentIds || []);
        if (!a.ok) return a;
        if (entry && k !== k0) { const d = await A.deleteExpenseEntry({ month: k0, id: en.id }); if (!d.ok) return d; }
        return A.saveExpenseEntry({ month: k, entry: { id: en.id, date: fDate.value, description: fDesc.value.trim(), amountCents: c, attachmentIds: a.ids } });
      });
      if (r.ok) { sh.close(); CF.ui.toast('Claim saved'); } else showErr(e, r.error || 'That claim could not be saved.');
    });
    const del = entry && !ro ? async () => { const r = await A.deleteExpenseEntry({ month: k0, id: en.id }); if (r.ok) { sh.close(); CF.ui.toast('Claim removed'); } else showErr(e, r.error); } : null;
    sh = CF.ui.sheet({ title: entry ? 'Edit claim' : 'New claim', sub: `Work expenses · ${S('job').system}`, body: form, footer: ro ? null : footer(form, { saveLabel: entry ? 'Save' : 'Add claim', onDelete: del }), cls: 'cf-s-claim' });
    return sh;
  }
  /** The details printed on a claim form: name, bank account and a payment ID (Muse: saveProfile). */
  function claimProfile({ onSaved } = {}) {
    const id = `cf-form-${++formSeq}`;
    const p = D.profile();
    const fName = input({ type: 'text', value: p.fullName || '', placeholder: 'As on your bank account', autocomplete: 'name', maxlength: 80 });
    const fBank = input({ type: 'text', value: p.bankAccount || '', placeholder: 'Bank and account number', maxlength: 60 });
    const fPay = input({ type: 'text', value: p.paymentId || '', placeholder: 'Optional', maxlength: 40 });
    const e = err();
    const form = h('form.cf-form', { id, novalidate: true }, field('Full name', fName), field('Bank account', fBank), field(D.setup() ? D.setup().paymentIdLabel : 'Payment ID', fPay), h('p.cf-note', 'These go on the claim form. They stay in your space and only leave it in the file you download.'), e);
    let sh;
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      if (!fName.value.trim()) return showErr(e, 'Your full name goes on the claim.');
      const r = await run(form, () => A.saveProfile({ fullName: fName.value.trim(), bankAccount: fBank.value.trim(), paymentId: fPay.value.trim() }));
      if (r && r.ok === false) return showErr(e, r.error || 'Those details could not be saved.');
      sh.close(); CF.ui.toast('Claim details saved'); onSaved && onSaved();
    });
    sh = CF.ui.sheet({ title: 'Claim details', sub: S('gig').label, body: form, footer: footer(form), cls: 'cf-s-profile' });
    return sh;
  }

  /* ---------------- New income source (flexible) ---------------- */
  const TYPES = [['one-off', 'One-off payments', 'Prize, gift, side gig'], ['monthly', 'Fixed monthly', 'Allowance, stipend, rent in'], ['hourly', 'Hourly', 'Tutoring, part-time shifts'], ['session', 'Per session', 'Coaching, lessons']];
  function incomeSource({ source } = {}) {
    const id = `cf-form-${++formSeq}`;
    const src = source || { id: F.uid('src'), label: '', type: 'one-off', rateCents: null, startMonth: D.now };
    const fName = input({ type: 'text', value: src.label, placeholder: 'e.g. Private tuition', required: true, maxlength: 40 });
    let type = src.type;
    const typeBtns = h('div.cf-seg', { role: 'radiogroup', 'aria-label': 'Type of income' }, TYPES.map(([v, l, sub]) => h('button.cf-seg-btn', { type: 'button', role: 'radio', 'aria-checked': String(v === type), 'data-v': v, onclick: (ev) => { type = v; typeBtns.querySelectorAll('button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.v === v))); rateLabel(); } }, h('strong', l), h('span', sub))));
    const fRate = input({ type: 'text', inputmode: 'decimal', value: money(src.rateCents), placeholder: '0.00' });
    const rateWrap = field('Amount', fRate);
    const rateLabel = () => { rateWrap.hidden = type === 'one-off'; rateWrap.querySelector('.cf-label').textContent = { monthly: `Amount per month (${CUR()})`, hourly: `Rate per hour (${CUR()})`, session: `Rate per session (${CUR()})` }[type] || 'Amount'; };
    const e = err();
    const form = h('form.cf-form', { id, novalidate: true }, field('Name', fName), h('div.cf-field', h('span.cf-label', 'How does it pay?'), typeBtns), rateWrap, h('p.cf-note', 'It shows up in your money flow, month-on-month and year-on-year as soon as it has an entry.'), e);
    rateLabel();
    let sh;
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      if (!fName.value.trim()) return showErr(e, 'Give it a name.');
      const rate = type === 'one-off' ? null : toCents(fRate.value);
      if (type !== 'one-off' && (!Number.isFinite(rate) || rate <= 0)) return showErr(e, `Enter an amount above ${CUR()} 0.`);
      const { entries, ...meta } = src;
      const r = await run(form, () => A.saveIncomeSource({ source: { ...meta, label: fName.value.trim(), short: fName.value.trim(), type, rateCents: rate, startMonth: src.startMonth || D.now } }));
      if (r.ok) { sh.close(); CF.ui.toast(source ? 'Saved' : `${fName.value.trim()} added`); if (type !== 'monthly' && !source) setTimeout(() => incomeEntry({ sourceId: src.id }), 320); } else showErr(e, r.error || 'That source could not be saved.');
    });
    const del = source ? async () => { const r = await A.deleteIncomeSource({ id: src.id }); if (r.ok === false) return showErr(e, r.error); sh.close(); CF.ui.toast('Source removed'); } : null;
    sh = CF.ui.sheet({ title: source ? 'Edit income source' : 'New income source', sub: 'Anything that pays you', body: form, footer: footer(form, { saveLabel: source ? 'Save' : 'Add source', onDelete: del }), cls: 'cf-s-src' });
    return sh;
  }
  function incomeEntry({ sourceId, entry } = {}) {
    const id = `cf-form-${++formSeq}`;
    const src = D.custom().find((s) => s.id === sourceId);
    if (!src) return;
    const en = entry || { id: F.uid('in'), date: D.today, amountCents: null, qty: src.type === 'session' ? 1 : src.type === 'hourly' ? 1 : null, note: '' };
    const fDate = input({ type: 'date', value: en.date });
    const per = src.type === 'hourly' || src.type === 'session';
    const fQty = per ? stepper(en.qty || 1, { min: 0.5, max: 200, step: src.type === 'hourly' ? 0.5 : 1, label: src.type === 'hourly' ? 'hours' : 'sessions', fmt: (v) => `${v} ${src.type === 'hourly' ? 'h' : v === 1 ? 'session' : 'sessions'}` }) : null;
    const fAmt = input({ type: 'text', inputmode: 'decimal', value: money(en.amountCents), placeholder: '0.00' });
    const fNote = input({ type: 'text', value: en.note || '', placeholder: 'Optional', maxlength: 120 });
    const total = h('div.cf-total'), e = err();
    const amount = () => (per ? Math.round(fQty.get() * src.rateCents) : toCents(fAmt.value));
    const recalc = () => total.replaceChildren(h('span', src.label), h('strong', Number.isFinite(amount()) ? F.money(amount(), { cents: true }) : '—'));
    const form = h('form.cf-form', { id, novalidate: true }, h('div.cf-row', field('Date', fDate), per ? field(src.type === 'hourly' ? 'Hours' : 'Sessions', fQty) : field(`Amount (${CUR()})`, fAmt)), field('Note', fNote), total, e);
    form.addEventListener('input', recalc); recalc();
    let sh;
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const a = amount();
      if (!Number.isFinite(a) || a <= 0) return showErr(e, `Enter an amount above ${CUR()} 0.`);
      const r = await run(form, () => A.saveIncomeEntry({ sourceId, entry: { ...en, date: fDate.value, amountCents: a, qty: per ? fQty.get() : null, note: fNote.value.trim() } }));
      if (r.ok) { sh.close(); CF.ui.toast(`${F.money(a, { cents: true })} logged`); } else showErr(e, r.error || 'That entry could not be saved.');
    });
    const del = entry ? async () => { const r = await A.deleteIncomeEntry({ sourceId, id: en.id }); if (r.ok === false) return showErr(e, r.error); sh.close(); } : null;
    sh = CF.ui.sheet({ title: entry ? 'Edit entry' : `Log ${src.label}`, sub: src.type === 'hourly' ? `${F.money(src.rateCents, { cents: true })} per hour` : src.type === 'session' ? `${F.money(src.rateCents, { cents: true })} per session` : 'One-off payment', body: form, footer: footer(form, { onDelete: del }), cls: 'cf-s-entry' });
    return sh;
  }

  /* ---------------- Settings you change in the app (everything else is set up through Muse) ---------------- */
  function payRate() {
    const id = `cf-form-${++formSeq}`, J = S('job');
    const fPay = input({ type: 'text', inputmode: 'decimal', value: money(J.monthlyPayCents) });
    const total = h('div.cf-total'), e = err();
    const recalc = () => { const c = toCents(fPay.value); total.replaceChildren(h('span', J.deduction ? `After ${J.deduction.label} (full month)` : 'Full month'), h('strong', Number.isFinite(c) ? F.money(c - D.rules.deduct(c, J.deduction), { cents: true }) : '—')); };
    const form = h('form.cf-form', { id, novalidate: true }, field(`Monthly pay (${CUR()}${J.deduction ? `, before ${J.deduction.label}` : ''})`, fPay, `Prorated each month by hours worked ÷ (weekdays × ${F.hours(J.dayMinutes)})`), total, e);
    form.addEventListener('input', recalc); recalc();
    let sh;
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const c = toCents(fPay.value);
      if (!Number.isFinite(c) || c <= 0) return showErr(e, `Enter a monthly pay above ${CUR()} 0.`);
      const r = await run(form, () => saveSetup((s) => { s.streams.job = { ...(s.streams.job || {}), monthlyPayCents: c }; }));
      if (r && r.ok === false) return showErr(e, r.error || 'That could not be saved.');
      sh.close(); CF.ui.toast('Monthly pay updated');
    });
    sh = CF.ui.sheet({ title: `${J.label} pay`, body: form, footer: footer(form), cls: 'cf-s-pay' });
    return sh;
  }
  function lumpsum() {
    const id = `cf-form-${++formSeq}`, L = S('lumpsum');
    const fAmt = input({ type: 'text', inputmode: 'decimal', value: money(L.yearlyCents) });
    const fMonth = h('select.cf-input', h('option', { value: 0 }, 'Not set'), F.MONTHS_LONG.map((m, i) => h('option', { value: i + 1, selected: L.receiptMonth === i + 1 }, m)));
    const e = err();
    const form = h('form.cf-form', { id, novalidate: true }, h('div.cf-row', field(`Per year (${CUR()})`, fAmt), field('Lands in', fMonth)), h('p.cf-note', 'It counts as income in the month it lands. Home and the trends leave it out, so one big month doesn\'t skew the rest.'), e);
    let sh;
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const c = toCents(fAmt.value);
      if (!Number.isFinite(c) || c < 0) return showErr(e, `Enter a yearly amount of ${CUR()} 0 or more.`);
      const r = await run(form, () => saveSetup((s) => { s.streams.lumpsum = { ...(s.streams.lumpsum || {}), yearlyCents: c, receiptMonth: +fMonth.value }; }));
      if (r && r.ok === false) return showErr(e, r.error || 'That could not be saved.');
      sh.close(); CF.ui.toast(`${L.label} updated`);
    });
    sh = CF.ui.sheet({ title: L.label, sub: 'Yearly lump sum', body: form, footer: footer(form), cls: 'cf-s-lump' });
    return sh;
  }

  CF.forms = { gig, hourly, workDay, leave, claim, claimProfile, incomeSource, incomeEntry, payRate, lumpsum, saveSetup, CODES, LEAVE };
})();
