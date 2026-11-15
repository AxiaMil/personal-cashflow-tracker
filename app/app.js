/* Cashflow (Pocket): income, work and spending in one Muse space.
   Four places behind one navbar:
     Home   what you earned (a yearly lump sum is kept apart so months compare fairly), spending, what's coming up
     Work   each job, per-session gig and hourly job you have: pay, days, leave, claims and session logs
     Money  income by month, year on year, money flow and spending by category
     More   sync, Excel exports and settings
   What exists, and what it's called, comes from the setup Muse fills in (CF.data.setup()); with none, the app
   starts blank. Phone: a Liquid Glass tab bar with a round + beside it, pull to sync. Laptop: a full-width
   navbar. State lives in memory (Muse spaces have no storage or routing); everything that must last goes
   through CF.actions, which core/muse.js sends to the space's server actions. */
(function () {
  'use strict';
  const CF = window.CF, F = CF.fmt, h = CF.h, D = CF.data, UI = CF.ui, V = CF.viz, FM = CF.forms, A = CF.actions;
  const mqWide = matchMedia('(min-width: 1024px)');
  const wide = () => mqWide.matches;
  const reduced = () => F.reducedMotion();

  /* ---------------- Icons (inline SVG only; Muse spaces can't load icon fonts) ---------------- */
  const IC = {
    home: '<path d="M4.5 10.2 12 4l7.5 6.2v8.3a1.5 1.5 0 0 1-1.5 1.5h-3.5v-5.5h-5V20H6a1.5 1.5 0 0 1-1.5-1.5z"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    chart: '<path d="M4.5 19.5h15"/><path d="M7.5 16v-4.5M12 16V7M16.5 16v-6.5"/>',
    more: '<circle cx="5.5" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="18.5" cy="12" r="1.6" fill="currentColor" stroke="none"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    chevL: '<path d="M14.5 5.5 8 12l6.5 6.5"/>',
    chevR: '<path d="m9.5 5.5 6.5 6.5-6.5 6.5"/>',
    briefcase: '<rect x="3.5" y="7.5" width="17" height="12" rx="3"/><path d="M9 7.5V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1.5M3.5 13h17"/>',
    waves: '<path d="M3 8.5c1.6 0 2.4-1.5 4.5-1.5s2.9 1.5 4.5 1.5 2.4-1.5 4.5-1.5 2.9 1.5 4.5 1.5M3 13c1.6 0 2.4-1.5 4.5-1.5s2.9 1.5 4.5 1.5 2.4-1.5 4.5-1.5 2.9 1.5 4.5 1.5M3 17.5c1.6 0 2.4-1.5 4.5-1.5s2.9 1.5 4.5 1.5 2.4-1.5 4.5-1.5 2.9 1.5 4.5 1.5"/>',
    cap: '<path d="m2.5 9.5 9.5-4.5 9.5 4.5-9.5 4.5z"/><path d="M6.5 11.5v4.2c0 1.3 2.5 2.8 5.5 2.8s5.5-1.5 5.5-2.8v-4.2M21.5 9.5v5"/>',
    camera: '<path d="M3.5 8.5A1.5 1.5 0 0 1 5 7h2.6l1.5-2.2h5.8L16.4 7H19a1.5 1.5 0 0 1 1.5 1.5v9.5A1.5 1.5 0 0 1 19 19.5H5A1.5 1.5 0 0 1 3.5 18z"/><circle cx="12" cy="13" r="3.5"/>',
    book: '<path d="M12 6.8C10.2 5.5 7.7 4.8 4.5 4.8v13c3.2 0 5.7.7 7.5 2 1.8-1.3 4.3-2 7.5-2v-13c-3.2 0-5.7.7-7.5 2zM12 6.8v13"/>',
    award: '<circle cx="12" cy="9" r="5.5"/><path d="m8.5 13.3-1.5 7.2 5-2.6 5 2.6-1.5-7.2"/>',
    leaf: '<path d="M12 20.5V12"/><path d="M12 12c0-3.6 2.6-6.2 7.2-6.2 0 4.1-2.6 6.2-7.2 6.2z"/><path d="M12 14.6c0-2.9-2.1-4.9-6.6-4.9 0 3.4 2.1 4.9 6.6 4.9z"/>',
    coin: '<circle cx="12" cy="12" r="8.5"/><path d="M14.6 9.4c-.5-.9-1.5-1.4-2.6-1.4-1.5 0-2.6.8-2.6 2 0 2.8 5.4 1.3 5.4 4 0 1.2-1.2 2-2.8 2-1.2 0-2.3-.5-2.8-1.4M12 6.5V8M12 16v1.5"/>',
    timer: '<circle cx="12" cy="13.5" r="7"/><path d="M12 13.5V10M9.5 3.5h5M12 3.5v3M18.2 7.3l1.3-1.3"/>',
    hourglass: '<path d="M7 3.5h10M7 20.5h10M8 3.5c0 4 4 5.5 4 8.5s-4 4.5-4 8.5M16 3.5c0 4-4 5.5-4 8.5s4 4.5 4 8.5"/>',
    refresh: '<path d="M19.5 10.5A7.7 7.7 0 0 0 6 7.2L4.5 9M4.5 4.5V9H9M4.5 13.5A7.7 7.7 0 0 0 18 16.8l1.5-1.8M19.5 19.5V15H15"/>',
    mark: '<rect x="3" y="3" width="18" height="18" rx="6.5"/><path d="M7 14c1.7-3.4 3.4-3.4 5 0s3.3 3.4 5 0"/>',
    download: '<path d="M12 4.5v10M7.5 10.5 12 15l4.5-4.5M5 19.5h14"/>',
    check: '<path d="m5.5 12.5 4 4 9-9"/>',
    leave: '<path d="M4 12a8 8 0 0 1 16 0z"/><path d="M12 12v6a2 2 0 0 1-4 0"/>',
    receipt: '<path d="M6.5 3.5h11v17l-2.75-1.8-2.75 1.8-2.75-1.8-2.75 1.8z"/><path d="M9.5 8h5M9.5 11.5h5M9.5 15h3"/>',
    user: '<circle cx="12" cy="8.5" r="3.7"/><path d="M5 19.5c1.1-3.3 3.8-5 7-5s5.9 1.7 7 5"/>',
    bag: '<path d="M5.5 8.5h13l-.9 11h-11.2z"/><path d="M9 8.5V7a3 3 0 0 1 6 0v1.5"/>',
    clip: '<path d="M15.5 7.5 8.6 14.4a2 2 0 0 0 2.8 2.8l7-7a3.5 3.5 0 0 0-5-5l-7 7a5 5 0 0 0 7.1 7.1l6-6"/>',
    sliders: '<path d="M4 7.5h9M17 7.5h3M4 16.5h3M11 16.5h9"/><circle cx="15" cy="7.5" r="2"/><circle cx="9" cy="16.5" r="2"/>',
    file: '<path d="M6.5 3.5h7l4 4v13h-11z"/><path d="M13.5 3.5v4h4M9.5 12.5l5 5M14.5 12.5l-5 5"/>',
    // filled variants for the selected tab (Apple: prefer filled symbols in tab bars)
    homeOn: '<path d="M4.5 10.2 12 4l7.5 6.2v8.3a1.5 1.5 0 0 1-1.5 1.5h-3.5v-5.5h-5V20H6a1.5 1.5 0 0 1-1.5-1.5z" fill="currentColor"/>',
    clockOn: (id) => `<defs><mask id="${id}"><rect width="24" height="24" fill="#fff"/><path d="M12 7.2V12l3.2 2.1" stroke="#000" stroke-width="2.1" fill="none"/></mask></defs><circle cx="12" cy="12" r="9.3" fill="currentColor" stroke="none" mask="url(#${id})"/>`,
    chartOn: '<rect x="5" y="11.5" width="3.8" height="8.5" rx="1.3" fill="currentColor" stroke="none"/><rect x="10.1" y="4.5" width="3.8" height="15.5" rx="1.3" fill="currentColor" stroke="none"/><rect x="15.2" y="8.5" width="3.8" height="11.5" rx="1.3" fill="currentColor" stroke="none"/>',
    moreOn: '<circle cx="5.5" cy="12" r="2" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="2" fill="currentColor" stroke="none"/><circle cx="18.5" cy="12" r="2" fill="currentColor" stroke="none"/>',
  };
  let icN = 0;
  const icon = (n, s = 20, sw = 1.8) => { const d = IC[n]; return h('span.pk-ic', { 'aria-hidden': 'true', html: `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${typeof d === 'function' ? d(`pkm${++icN}`) : d || ''}</svg>` }); };

  /* ---------------- Helpers ---------------- */
  const KINDS = new Set(D.kinds);
  const WORK = ['job', 'gig', 'hourly'];
  const workKinds = () => WORK.filter((k) => D.stream(k));
  const DEF_IC = { job: 'briefcase', gig: 'timer', hourly: 'hourglass', lumpsum: 'award', dividends: 'leaf' };
  const sid = (id) => (KINDS.has(id) ? id : 'custom');
  const icOf = (id) => { const s = D.stream(id); return s && IC[s.icon] ? s.icon : DEF_IC[id] || 'coin'; };
  const scol = (id) => `var(--s-${sid(id)})`;
  const tint = (el, id) => { el.style.setProperty('--sc', scol(id)); el.style.setProperty('--on', `var(--on-${sid(id)})`); return el; };
  const money = (c, o) => F.money(c, o);
  const cents = (c) => F.money(c, { cents: true });
  const monLong = (k) => F.monthLabel(k, { long: true, year: false });
  const plural = (n, w, p = w + 's') => `${n} ${n === 1 ? w : p}`;
  const today = () => D.todayLive();
  const daysFrom = (date) => Math.round((F.parseYmd(date) - F.parseYmd(today())) / 864e5);
  function rel(date) {
    const n = daysFrom(date);
    if (n === 0) return 'today';
    if (n === 1) return 'tomorrow';
    if (n === -1) return 'yesterday';
    return n < 0 ? `${-n} days ago` : `in ${n} days`;
  }
  // Spending categories get colours in the order they first appear (biggest first), so they stay put
  // while you move between months. A catch-all such as "Other" is always grey.
  const CAT = {};
  const catColor = (name) => {
    if (/^(other|others|misc|miscellaneous|uncategori[sz]ed)$/i.test(name)) return 'var(--cat-6)';
    if (!CAT[name]) { const n = Object.keys(CAT).length; CAT[name] = n < 5 ? n + 1 : 6; } // past five, the small ones go grey
    return `var(--cat-${CAT[name]})`;
  };
  const lastDay = (k) => `${k}-${F.pad2(F.daysIn(k))}`;
  const defaultDate = (k) => (k === today().slice(0, 7) ? today() : k < today() ? lastDay(k) : `${k}-01`);
  const status = (s) => (s ? s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()) : 'Not synced');
  const chg = (r) => (r == null || Math.abs(r) < 0.005 ? null : Math.abs(r) >= 10 ? `${r > 0 ? '+' : '−'}${Math.round(Math.abs(r))}×` : F.pct(r, { sign: true }));
  const fmtWhole = (c) => { const p = F.moneyParts(c); return `${p.sign}$${p.whole}`; };
  const fmtDec = (c) => `.${F.moneyParts(c).dec}`;

  /* ---------------- State ---------------- */
  const st = { tab: 'home', job: '', wk: D.now, booted: false, lump: false, scroll: {}, enter: true, sheet: null, lastKey: null, lastMode: null, lastWk: null, swiped: false, moved: 0, wkMoved: 0 };
  const memo = new Map(); // last value shown per slot, so numbers tick from it
  let bag = [], mounts = [];
  const mount = (fn) => mounts.push(fn);
  const flush = () => { const m = mounts; mounts = []; m.forEach((fn) => { const r = fn(); if (r && r.destroy) bag.push(r); }); };
  function tick(el, slot, value, fmt) { if (memo.has(slot)) el.dataset.v = memo.get(slot); UI.countTo(el, value, fmt); memo.set(slot, value); }

  const P = UI.period({ onChange: () => render() });
  const clampPeriod = () => { const b = P.bounds(); if (P.key < b.first) P.key = b.first; if (P.key > b.last) P.key = b.last; };
  // Work months: from the job's start (if it has one) to one month ahead, so leave can be planned
  const wkBounds = () => {
    const J = D.stream('job'), r = D.range();
    if (st.job !== 'job' || !J) return { first: r.first, last: D.now };
    return { first: J.startMonth ? (J.startMonth < D.now ? J.startMonth : D.now) : r.first, last: F.addMonths(D.now, 1) };
  };
  const clampWk = () => { const b = wkBounds(); if (st.wk < b.first) st.wk = b.first; if (st.wk > b.last) st.wk = b.last; };
  function stepWk(n) { const b = wkBounds(), k = F.addMonths(st.wk, n); if (k < b.first || k > b.last) return false; st.wk = k; UI.haptic(4); render(); return true; }

  /* ---------------- Comparisons in plain words ---------------- */
  function base() { if (P.mode === 'month') return monLong(F.addMonths(P.key, -1)); return P.key === D.now.slice(0, 4) ? 'the same months last year' : String(+P.key - 1); }
  function vs(cur, prev, prevHas, { good = 'up' } = {}) {
    if (!prevHas) return { text: P.mode === 'month' ? `Nothing in ${base()} to compare with` : `No ${+P.key - 1} income to compare with`, tone: 'flat', dir: 0 };
    const d = cur - prev;
    if (Math.abs(d) < 100) return { text: `About the same as ${base()}`, tone: 'flat', dir: 0 };
    const up = d > 0;
    return { text: `${money(Math.abs(d))} ${up ? 'more' : 'less'} than ${base()}`, tone: up === (good === 'up') ? 'good' : 'bad', dir: up ? 1 : -1 };
  }
  const deltaEl = (d, cls = '') => (d ? h('p.pk-delta', { class: `is-${d.tone} ${cls}` }, d.dir ? h('span.pk-delta-a', { 'aria-hidden': 'true' }, d.dir > 0 ? '↑' : '↓') : null, d.text) : null);

  /* ---------------- Small building blocks ---------------- */
  const secHead = (title, sub, right) => h('div.pk-sec-h', h('div', h('h2.pk-h2', title), sub ? h('p.pk-sec-sub', sub) : null), right || null);
  const sec = (title, sub, right, ...kids) => h('section.pk-sec', secHead(title, sub, right), ...kids);
  const btn = (label, fn, kind = 'secondary', ic, extra = {}) => h('button.pk-btn', { type: 'button', class: `is-${kind}`, onclick: fn, ...extra }, ic ? icon(ic, 17, 2.1) : null, h('span', label));
  const link = (label, fn) => h('button.pk-link', { type: 'button', onclick: fn }, label);
  const tile = (id) => h('span.pk-tile', { class: `is-${sid(id)}` }, icon(icOf(id), 17, 2)); // a stream's tile
  const tileIc = (name) => h('span.pk-tile', { class: `is-${name}` }, icon(name, 17, 2));
  const kv = (k, v) => h('div.pk-kv-row', h('span', k), h('strong.num', v));
  const dateTile = (date) => { const d = F.parseYmd(date); return h('span.pk-dtile', { 'aria-hidden': 'true' }, h('span', F.DOW[d.getDay()]), h('strong.num', d.getDate())); };
  const rowSwipe = (main, actions) => (actions && actions.length ? UI.swipeRow(main, actions) : main);
  async function undoable(run, undo, msg) {
    const r = await run();
    if (r && r.ok === false) { UI.toast(r.error || "That didn't work"); return; }
    UI.haptic(10);
    UI.toast(msg, { action: { label: 'Undo', fn: undo }, ms: 4500 });
  }

  /* ---------------- Shell ---------------- */
  const app = document.getElementById('app');
  const announcer = h('p.pk-vh', { 'aria-live': 'polite' });
  /* Liquid Glass layout (iOS 26/27, iPadOS-style on laptops): content runs edge to edge; controls float above it on glass.
     - phone: a big title that tightens as you scroll; the tab bar at the bottom with a round + beside it (thumb reach);
       sync is pull-down, so nothing floats at the top
     - laptop: a conventional full-width navbar: logo, text links for the sections, sync status and Add on the right */
  const TABS = [{ id: 'home', label: 'Home', ic: 'home' }, { id: 'work', label: 'Work', ic: 'clock' }, { id: 'money', label: 'Money', ic: 'chart' }, { id: 'more', label: 'More', ic: 'more' }];
  const navIc = (t, s) => { const off = icon(t.ic, s, 1.8), on = icon(`${t.ic}On`, s, 1.8); off.classList.add('pk-ic-off'); on.classList.add('pk-ic-on'); return h('span.pk-nav-ic', off, on); };
  const navBtn = (t, cls, s) => h(`button.${cls}`, { type: 'button', 'data-tab': t.id, onclick: () => go(t.id) }, navIc(t, s), h('span.pk-nav-l', t.label));
  const tabsEl = h('nav.pk-tabs', { 'aria-label': 'Sections' }, h('span.pk-tab-ind', { 'aria-hidden': 'true' }), TABS.map((t) => navBtn(t, 'pk-tab', 24)));
  const addBtn = h('button.pk-act.is-add', { type: 'button', 'aria-label': 'Add', 'aria-haspopup': 'menu', onclick: (e) => openAddMenu(e.currentTarget) }, icon('plus', 22, 2.2), h('span.pk-act-l', 'Add'));
  const syncBtn = h('button.pk-act.pk-sync', { type: 'button', onclick: () => syncNow() });
  const actions = h('div.pk-actions', syncBtn);
  const dock = h('div.pk-dock', tabsEl);
  const lt = h('h1.pk-lt');
  const tabSlot = h('div.pk-tabslot');
  const top = h('header.pk-top', lt, tabSlot, actions);
  const view = h('div.pk-view');
  app.append(h('main.pk-main', top, view), h('div.pk-edge.is-top', { 'aria-hidden': 'true' }), h('div.pk-edge.is-bottom', { 'aria-hidden': 'true' }), dock, announcer);

  // persistent controls (kept across renders so their thumbs slide instead of jumping)
  const segBtn = (m, label) => h('button.pk-seg-btn', { type: 'button', role: 'radio', 'data-m': m, onclick: () => { if (P.mode !== m) { UI.haptic(5); P.setMode(m); } } }, label);
  const seg = h('div.pk-seg', { role: 'radiogroup', 'aria-label': 'Show by' }, h('span.pk-seg-thumb', { 'aria-hidden': 'true' }), segBtn('month', 'Month'), segBtn('year', 'Year'));
  // The work switcher is rebuilt only when the set of work kinds (or their names) changes, so its thumb slides
  const jobSeg = h('div.pk-job', { role: 'radiogroup', 'aria-label': 'Work' });
  function syncJobSeg(kinds) {
    const sig = kinds.map((k) => `${k}:${D.stream(k).short}`).join('|');
    if (jobSeg.dataset.sig !== sig) {
      jobSeg.dataset.sig = sig;
      jobSeg.replaceChildren(h('span.pk-job-thumb', { 'aria-hidden': 'true' }), ...kinds.map((j) => h('button.pk-job-btn', { type: 'button', role: 'radio', 'data-j': j, onclick: () => { if (st.job !== j) { UI.haptic(5); st.job = j; st.enter = true; clampWk(); render(); } } }, h('i', { 'aria-hidden': 'true' }), D.stream(j).short)));
      jobSeg.style.setProperty('--n', String(kinds.length));
    }
    jobSeg.dataset.j = st.job;
    jobSeg.style.setProperty('--ji', String(Math.max(0, kinds.indexOf(st.job))));
    jobSeg.querySelectorAll('.pk-job-btn').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.j === st.job)));
  }
  const heroHost = h('div.pk-hero-host');
  const calHost = h('div.pk-cal-host');

  // swipes: months on the hero card, the Money period bar and the Work calendar
  const periodSwipe = (el, follow) => UI.swipe(el, { onPrev: () => { st.swiped = true; P.prev(); }, onNext: () => { st.swiped = true; P.next(); }, canPrev: () => P.canPrev(), canNext: () => P.canNext(), follow });
  periodSwipe(heroHost, () => heroHost.querySelector('.pk-hero-card'));
  UI.swipe(calHost, { onPrev: () => { st.swiped = true; stepWk(-1); }, onNext: () => { st.swiped = true; stepWk(1); }, canPrev: () => F.addMonths(st.wk, -1) >= wkBounds().first, canNext: () => F.addMonths(st.wk, 1) <= wkBounds().last, follow: () => calHost.querySelector('.cf-cal') });
  // trackpads: one page per horizontal two-finger swipe
  function wheelPager(el, prev, next) {
    let acc = 0, lock = 0, last = 0;
    el.addEventListener('wheel', (e) => {
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
      e.preventDefault();
      const now = performance.now();
      if (now < lock) { lock = now + 260; return; }
      if (now - last > 260) acc = 0;
      last = now; acc += e.deltaX;
      if (Math.abs(acc) > 60) { acc > 0 ? next() : prev(); acc = 0; lock = now + 400; }
    }, { passive: false });
  }
  wheelPager(heroHost, () => P.prev(), () => P.next());
  wheelPager(calHost, () => stepWk(-1), () => stepWk(1));

  function go(tab, { job, wk, toTop } = {}) {
    if (job) st.job = job;
    if (wk) st.wk = wk;
    if (tab === st.tab && !job && !wk) { scrollTo({ top: 0, behavior: reduced() ? 'auto' : 'smooth' }); return; } // tap the current tab: back to top
    st.scroll[st.tab] = scrollY;
    const changed = tab !== st.tab;
    st.tab = tab; st.enter = true;
    UI.haptic(5);
    clampWk();
    render();
    scrollTo(0, toTop || !changed ? 0 : st.scroll[tab] || 0);
    if (changed) announcer.textContent = TABS.find((t) => t.id === tab).label;
  }

  /* ---------------- Sync ---------------- */
  const inMuse = () => !!(CF.muse && CF.muse.active);
  function syncState() {
    const s = D.sync(), J = D.stream('job');
    if (!st.booted) return { tone: 'busy', text: 'Loading', long: 'Loading your data' };
    if (s.status === 'syncing') return { tone: 'busy', text: 'Syncing', long: J ? `Syncing with ${J.system}` : 'Syncing' };
    if (s.status === 'error') return { tone: 'bad', text: 'Sync failed', long: s.error || 'The last sync failed' };
    if (inMuse() || D.hasRemote()) return { tone: 'ok', text: `Synced ${F.ago(s.at)}`, long: `Synced ${F.ago(s.at)}` };
    if (s.source === 'snapshot') return { tone: 'flat', text: 'Saved copy', long: s.at ? `Saved copy from ${F.shortDate(s.at.slice(0, 10))}` : 'Saved copy' };
    return { tone: 'flat', text: 'Preview', long: 'Local preview: nothing here is saved' };
  }
  let syncing = false;
  async function syncNow() {
    if (syncing) return;
    syncing = true; UI.haptic(6);
    const live = inMuse() || D.hasRemote();
    let res;
    try { res = await A.refresh({ month: st.tab === 'work' ? st.wk : D.now }); } catch (e) { res = { ok: false, error: e.message }; }
    syncing = false;
    const bad = res && res.ok === false;
    UI.toast(bad ? res.error || 'Sync failed' : live ? 'Up to date' : 'This is a local preview, so there is nothing to sync');
  }

  /* ---------------- Header + nav ---------------- */
  function renderChrome() {
    app.dataset.tab = st.tab;
    app.classList.toggle('is-wide', wide());
    app.querySelectorAll('[data-tab]').forEach((b) => { const on = b.dataset.tab === st.tab; b.classList.toggle('is-on', on); if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
    tabsEl.style.setProperty('--ti', String(TABS.findIndex((t) => t.id === st.tab)));
    seg.dataset.mode = P.mode;
    seg.querySelectorAll('.pk-seg-btn').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.m === P.mode)));
    const ss = syncState();
    syncBtn.className = `pk-act pk-sync is-${ss.tone}`;
    syncBtn.replaceChildren(icon('refresh', 20, 2), h('i.pk-dot', { 'aria-hidden': 'true' }), h('span.pk-act-l', { 'aria-hidden': 'true' }, ss.text)); // the label shows on laptops
    syncBtn.setAttribute('aria-label', `${ss.long}. Sync now`);
    syncBtn.title = ss.long;
    // laptop: tabs centred in the top bar, + beside sync; phone: tabs at the bottom with + beside them
    const W = wide();
    if (W && tabsEl.parentNode !== tabSlot) tabSlot.append(tabsEl);
    if (!W && tabsEl.parentNode !== dock) dock.prepend(tabsEl);
    const addHome = W ? actions : dock;
    if (addBtn.parentNode !== addHome) addHome.append(addBtn);
    const key = W ? 'brand' : st.tab;
    if (lt.dataset.k !== key) {
      lt.dataset.k = key;
      if (W) lt.replaceChildren(h('span.pk-brand', icon('mark', 22, 1.9), h('span', 'Cashflow')));
      else lt.textContent = { home: 'Cashflow', work: 'Work', money: 'Money', more: 'More' }[st.tab];
    }
    requestAnimationFrame(onScrollNow);
  }

  /* ---------------- Tab bar: press lifts the selection into a lens you can drag across tabs ---------------- */
  const rootEl = document.documentElement;
  let muteTab = 0;
  (function lens() {
    let s = null;
    const cellW = (r) => (r.width - 8) / TABS.length;
    tabsEl.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || wide()) return;
      if (e.clientX < 24 || e.clientX > innerWidth - 24) return; // the Muse app's back gesture owns the edges
      const r = tabsEl.getBoundingClientRect();
      s = { id: e.pointerId, x0: e.clientX, r, cell: cellW(r), drag: false, i: -1 };
      tabsEl.classList.add('is-press');
    });
    tabsEl.addEventListener('pointermove', (e) => {
      if (!s || e.pointerId !== s.id) return;
      if (!s.drag) {
        if (Math.abs(e.clientX - s.x0) < 8) return;
        s.drag = true; tabsEl.classList.add('is-drag');
        try { tabsEl.setPointerCapture(e.pointerId); } catch (_) {}
      }
      const max = s.r.width - 8 - s.cell;
      let x = e.clientX - s.r.left - 4 - s.cell / 2;
      if (x < 0) x *= 0.25; else if (x > max) x = max + (x - max) * 0.25; // rubber-band past the ends
      tabsEl.style.setProperty('--lx', `${x.toFixed(1)}px`);
      const i = Math.max(0, Math.min(TABS.length - 1, Math.round(x / s.cell)));
      if (i !== s.i) { s.i = i; tabsEl.querySelectorAll('.pk-tab').forEach((b, j) => b.classList.toggle('is-lens', j === i)); UI.haptic(3); }
    });
    const end = (e) => {
      if (!s || e.pointerId !== s.id) return;
      const was = s; s = null;
      tabsEl.classList.remove('is-press', 'is-drag');
      tabsEl.querySelectorAll('.is-lens').forEach((b) => b.classList.remove('is-lens'));
      if (!was.drag) return;
      muteTab = performance.now() + 400;
      tabsEl.style.removeProperty('--lx');
      if (was.i >= 0 && TABS[was.i].id !== st.tab) go(TABS[was.i].id); else UI.haptic(3);
    };
    tabsEl.addEventListener('pointerup', end);
    tabsEl.addEventListener('pointercancel', end);
    tabsEl.addEventListener('click', (e) => { if (performance.now() < muteTab) { e.preventDefault(); e.stopImmediatePropagation(); } }, true);
  })();

  /* ---------------- Add menu: glass that grows out of the + button (iOS 26/27 menus morph from their control) ---------------- */
  function openAddMenu(anchor) {
    if (document.querySelector('.pk-menu-root')) return;
    UI.haptic(8);
    const r = anchor.getBoundingClientRect();
    const right = r.left + r.width / 2 > innerWidth / 2;
    const m = D.month(D.now);
    const item = (title, sub, k, ic, fn) => tint(h('button.pk-mi', { type: 'button', role: 'menuitem', onclick: () => { close(); setTimeout(fn, 200); } },
      h('span.pk-mi-t', h('strong', title), sub ? h('span', sub) : null), h('span.pk-mi-ic', icon(ic, 19, 2))), k);
    const sep = () => h('div.pk-mi-sep', { role: 'separator' });
    const J = D.stream('job'), G = D.stream('gig'), H = D.stream('hourly'), groups = [];
    if (J) groups.push([
      item(`${J.short} day`, `${J.label} · ${J.system}`, 'job', 'clock', () => FM.workDay({ date: D.today, entry: m.job.entries.find((x) => x.date === D.today), status: m.job.status || 'draft' })),
      J.leave ? item('Leave', 'Annual, medical and more', 'job', 'leave', () => FM.leave()) : null,
      J.claims ? item('Work claim', 'Expense with a receipt', 'job', 'receipt', () => FM.claim()) : null]);
    const work = [G ? item(`${G.short} session`, `${G.label} · per ${G.sessionMinutes} min`, 'gig', icOf('gig'), () => FM.gig()) : null,
      H ? item(`${H.short} session`, H.payout && H.payout !== 'monthly' ? `Hourly · ${H.payout.label}` : 'Hourly', 'hourly', icOf('hourly'), () => FM.hourly()) : null].filter(Boolean);
    if (work.length) groups.push(work);
    groups.push([...D.custom().map((x) => item(x.label, x.type === 'monthly' ? 'Fixed monthly' : 'Log a payment', 'custom', 'coin', () => FM.incomeEntry({ sourceId: x.id }))),
      item('New income source', 'Anything else that pays you', 'custom', 'plus', () => FM.incomeSource())]);
    const menu = h('div.pk-menu', { role: 'menu', 'aria-label': 'Add' }, groups.map((g, i) => [i ? sep() : null, ...g.filter(Boolean)]));
    const catcher = h('div.pk-menu-catch');
    const rootM = h('div.pk-menu-root', catcher, menu);
    const up = r.top > innerHeight / 2;
    const ox = right ? `calc(100% - ${r.width / 2}px)` : `${r.width / 2}px`;
    Object.assign(menu.style, { [right ? 'right' : 'left']: `${right ? innerWidth - r.right : r.left}px` });
    if (up) Object.assign(menu.style, { bottom: `${innerHeight - r.top + 10}px`, maxHeight: `${Math.max(240, r.top - 26)}px`, transformOrigin: `${ox} calc(100% + ${r.height / 2 + 10}px)` });
    else Object.assign(menu.style, { top: `${r.bottom + 8}px`, maxHeight: `${Math.max(240, innerHeight - r.bottom - 24)}px`, transformOrigin: `${ox} ${-r.height / 2 - 8}px` });
    document.body.append(rootM);
    anchor.classList.add('is-morphing');
    anchor.setAttribute('aria-expanded', 'true');
    requestAnimationFrame(() => requestAnimationFrame(() => rootM.classList.add('is-open')));
    setTimeout(() => { const f = menu.querySelector('.pk-mi'); f && f.focus({ preventScroll: true }); }, 60);
    let done = false;
    function close() {
      if (done) return; done = true;
      rootM.classList.remove('is-open'); rootM.classList.add('is-closing');
      anchor.setAttribute('aria-expanded', 'false');
      removeEventListener('keydown', onKey, true);
      setTimeout(() => { rootM.remove(); anchor.classList.remove('is-morphing'); }, reduced() ? 0 : 260);
      anchor.focus({ preventScroll: true });
    }
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); close(); return; }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      const items = [...menu.querySelectorAll('.pk-mi')], i = items.indexOf(document.activeElement);
      items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
    }
    addEventListener('keydown', onKey, true);
    catcher.addEventListener('pointerdown', (e) => { e.preventDefault(); close(); });
  }

  /* ---------------- Month strip: tap a month instead of stepping with arrows ---------------- */
  const chipLabel = (k) => { if (k.length === 4) return k; const { y, m } = F.parseMonth(k); return F.MONTHS[m] + (y !== +D.now.slice(0, 4) ? ` '${String(y).slice(2)}` : ''); };
  function strip(keys, sel, { now, sample, aria, onPick }) {
    const el = h('div.pk-strip', { role: 'tablist', 'aria-label': aria, 'data-noswipe': '' }, keys.map((k) => h('button.pk-chip', {
      type: 'button', role: 'tab', 'aria-selected': String(k === sel), 'aria-label': k.length === 4 ? k : F.monthLabel(k, { long: true }),
      class: [k === sel ? 'is-on' : '', k === now ? 'is-now' : '', sample && sample(k) ? 'is-sample' : ''].filter(Boolean).join(' '),
      onclick: () => { if (k !== sel) { UI.haptic(4); onPick(k); } },
    }, chipLabel(k))));
    mount(() => { const b = el.querySelector('.is-on'); if (b) el.scrollLeft = b.offsetLeft - (el.clientWidth - b.offsetWidth) / 2; });
    return el;
  }
  function periodStrip() {
    const b = P.bounds(), keys = [];
    if (P.mode === 'month') for (let k = b.first; k <= b.last; k = F.addMonths(k, 1)) keys.push(k);
    else for (let y = +b.first; y <= +b.last; y++) keys.push(String(y));
    return strip(keys, P.key, { now: P.mode === 'month' ? D.now : D.now.slice(0, 4), sample: P.mode === 'month' ? (k) => D.month(k).isSample : null, aria: P.mode === 'month' ? 'Month' : 'Year', onPick: (k) => P.goto(P.mode, k) });
  }
  function workStrip() {
    const b = wkBounds(), keys = [];
    for (let k = b.first; k <= b.last; k = F.addMonths(k, 1)) keys.push(k);
    return strip(keys, st.wk, { now: D.now, aria: 'Month', onPick: (k) => { st.wk = k; render(); } });
  }

  /* ================= HOME ================= */
  const isBlank = () => !D.configured() && !D.sample() && !D.custom().length;
  function viewHome() {
    if (isBlank()) return welcome();
    const v = P.view(), pv = P.prevView();
    renderHero(v, pv);
    return h('div.pk-home', h('div.pk-col', periodBar(), heroHost, streamsSection(v, pv)), h('div.pk-col', spendSection(v), upcomingSection()));
  }
  // Month / Year switch and the month chips share one row in the content (toolbars hold actions, not filters)
  const periodBar = () => h('div.pk-period', seg, periodStrip());

  /** Nothing set up yet: say so plainly, and offer the two ways in. */
  function welcome() {
    return h('div.pk-home.is-blank', h('article.pk-card.pk-welcome',
      h('span.pk-welcome-mark', { 'aria-hidden': 'true' }, icon('mark', 28, 1.8)),
      h('h2.pk-welcome-t', 'Nothing set up yet'),
      h('p.pk-welcome-p', 'Muse can set this space up from what it already knows about you: your jobs, how each one pays, and where your spending is tracked.'),
      h('div.pk-btnrow', btn('Set up with Muse', museSheet, 'primary'), btn('Add an income source', () => FM.incomeSource(), 'secondary', 'plus')),
      h('button.pk-link.pk-welcome-demo', { type: 'button', onclick: () => { D.setSample(true); UI.toast('Showing sample data. Turn it off in More.'); } }, 'Look around with sample data')));
  }
  /** What to tell Muse. The app can't type into Muse's chat, so it shows the words and a copy button. */
  const MUSE_ASK = 'Set up my Cashflow space from what you know about me: my currency and time zone, each job and how it pays (rate, hours, start month, anything taken off my pay, claim rules, when it pays out), any yearly payment like a bonus, and where my spending and dividends come from. Save it with saveSetup, and ask me about anything you are not sure of.';
  function museSheet() {
    const box = h('textarea.pk-ask', { readOnly: true, rows: 7, 'aria-label': 'Message for Muse' });
    box.value = MUSE_ASK;
    const copy = async () => {
      try { await navigator.clipboard.writeText(MUSE_ASK); UI.toast('Copied. Paste it into the space chat.'); }
      catch (_) { box.focus(); box.select(); UI.toast('Selected. Copy it, then paste it into the space chat.'); }
    };
    UI.sheet({ title: 'Set up with Muse', sub: 'Send this in the space chat', body: h('div.pk-sd', box, h('p.pk-note', 'Muse saves your setup with the saveSetup action. Your jobs, labels and rates live in your space, not in the app.')), footer: [h('span.cf-grow'), h('button.cf-btn.is-primary', { type: 'button', onclick: copy }, 'Copy')], cls: 'pk-ss' });
  }

  function renderHero(v, pv) {
    const card = heroCard(v, pv);
    heroHost.replaceChildren(card);
    if (st.moved && !st.swiped && !reduced()) card.classList.add(st.moved > 0 ? 'enter-next' : 'enter-prev');
  }
  function heroCard(v, pv) {
    const yr = P.mode === 'year';
    const card = h('article.pk-hero-card', { class: v.isSample ? 'is-sample' : '' });
    const title = yr ? (v.isNow ? `${v.year} so far` : String(v.year)) : v.long;
    card.append(h('div.pk-hc-top', h('div.pk-hc-t', h('span.pk-hc-k', 'Earned'), h('h2.pk-hc-title', title, v.isSample ? h('span.pk-tag', 'Sample') : null))));

    const whole = h('span.pk-whole'), dec = h('span.pk-dec');
    tick(whole, 'hero-w', v.regular, fmtWhole); tick(dec, 'hero-d', v.regular, fmtDec);
    card.append(h('div.pk-hc-big.num', { 'aria-label': cents(v.regular) }, whole, dec));

    const hasPrev = pv.hasData && pv.regular > 0;
    const line = v.regular > 0 || hasPrev ? deltaEl(vs(v.regular, pv.regular, hasPrev)) : h('p.pk-delta.is-flat', yr ? `Nothing logged in ${v.year} yet` : `Nothing logged in ${monLong(v.key)} yet`);
    const extra = [];
    if (yr) {
      const n = v.months.filter((m) => m && m.regular > 0).length;
      if (n) extra.push(h('p.pk-hc-note', `${money(v.regular / n)} a month on average, across ${plural(n, 'month')} with income`));
    } else if (v.isNow && v.job.projected) {
      const est = v.regular - v.job.net + v.job.projected.net;
      extra.push(h('p.pk-hc-note', 'On pace for ', h('strong.num', `≈ ${money(est)}`), ` by ${F.shortDate(lastDay(v.key))}`));
    }
    card.append(line, ...extra);

    const parts = v.streams.filter((s) => s.id !== 'lumpsum' && s.amount > 0);
    card.append(h('div.pk-hc-bar', parts.length ? V.stack(parts.map((s) => ({ id: s.id, value: s.amount, color: scol(s.id), label: s.short })), { height: 6, gap: 3 }) : h('span.pk-hc-bar-empty')));
    if (parts.length) card.append(h('div.pk-hc-legend', parts.map((s) => h('button.pk-hc-li', { type: 'button', onclick: () => openStream(s.id) }, h('i', { style: { background: scol(s.id) } }), h('span', s.short), h('strong.num', money(s.amount))))));
    const lc = lumpChip(v);
    if (lc) card.append(lc);
    return card;
  }
  /** A yearly lump sum lives beside income, never inside it, so one big month doesn't skew the rest. */
  function lumpChip(v) {
    const L = D.stream('lumpsum');
    if (!L) return null;
    const m = L.receiptMonth, amt = v.lumpsum ? v.lumpsum.amount : 0;
    const text = amt > 0 ? [h('strong.num', `+${money(amt)}`), ` ${L.label}, kept out of this total`]
      : m ? `${L.short} ${money(L.yearlyCents)} lands in ${F.MONTHS_LONG[m - 1]}` : `${L.label} · ${money(L.yearlyCents)} a year`;
    return h('button.pk-hc-lump', { type: 'button', onclick: () => (m ? openSheet('lumpsum') : FM.lumpsum()) }, icon(icOf('lumpsum'), 15, 2), h('span', text), h('span.pk-hc-lump-go', m ? 'Details' : 'Set month'));
  }

  function streamsSection(v, pv) {
    const order = (s) => (s.custom ? 10 : D.kinds.indexOf(s.id));
    const list = v.streams.filter((s) => s.id !== 'lumpsum').sort((a, b) => (b.amount > 0) - (a.amount > 0) || (a.amount > 0 ? b.amount - a.amount : order(a) - order(b)));
    const prev = new Map(pv.streams.map((s) => [s.id, s]));
    const n = list.filter((s) => s.amount > 0).length;
    const rows = list.map((s) => streamRow(s, prev.get(s.id), v, pv));
    rows.push(h('button.pk-srow.is-new', { type: 'button', onclick: () => FM.incomeSource() }, h('span.pk-tile.is-new', icon('plus', 16, 2.2)), h('span.pk-srow-main', h('strong', 'Add an income source'), h('span', 'Tuition, prizes, anything that pays you'))));
    return sec('Income streams', n ? `${plural(n, 'stream')} paid you ${P.mode === 'month' ? 'in ' + monLong(v.key) : v.isNow ? 'this year' : 'in ' + v.year}` : 'Nothing has paid out yet', null, h('div.pk-card.pk-list', rows));
  }
  function streamSub(s, v) {
    const k = sid(s.id), ms = P.mode === 'year' ? v.months.filter(Boolean) : [v];
    if (k === 'job') {
      const J = D.stream('job'), mins = F.sum(ms, (m) => m.job.workedMin);
      if (mins) return `${F.hours(mins)} worked${J.deduction ? ` · after ${J.deduction.label}` : ''}`;
      return P.mode === 'month' && J.startMonth && v.key < J.startMonth ? `Starts ${F.monthLabel(J.startMonth)}` : 'No days keyed in yet';
    }
    if (k === 'gig') { const n = F.sum(ms, (m) => m.gig.count); return n ? plural(n, 'session') : 'No sessions logged'; }
    if (k === 'hourly') { const mins = F.sum(ms, (m) => m.hourly.minutes); return mins ? `${F.hours(mins)} · hourly` : 'Nothing logged'; }
    if (k === 'dividends') { const D2 = D.stream('dividends'); return D2 && D2.source ? `From ${D2.source}` : 'Net of withholding tax'; }
    return s.kind;
  }
  function streamRow(s, ps, v, pv) {
    const on = s.amount > 0;
    const c = on && ps && ps.amount > 0 && pv.hasData ? chg(F.change(s.amount, ps.amount)) : null;
    return tint(h('button.pk-srow', { type: 'button', class: on ? '' : 'is-idle', onclick: () => openStream(s.id) },
      tile(s.id),
      h('span.pk-srow-main', h('strong', s.label), h('span', streamSub(s, v))),
      h('span.pk-srow-r', h('strong.num', on ? money(s.amount, { cents: P.mode === 'month' }) : '—'), c ? h('span.pk-chg', { class: c[0] === '−' ? 'is-down' : 'is-up' }, c) : null),
      icon('chevR', 15, 2)), s.id);
  }

  const spendName = () => { const E = D.setup() && D.setup().expenses; return E ? E.label : null; };
  function spendSection(v) {
    const ex = v.expenses, ok = ex.status === 'ok', name = spendName();
    if (!name && !ok) return null; // no spending source in this space
    const left = v.regular - ex.total;
    const sub = ok ? (ex.total ? `${money(Math.abs(left))} ${left >= 0 ? 'left after spending' : 'more than you earned'}` : 'Nothing spent') : ex.status === 'error' ? `Couldn't reach ${name}` : `Syncing from ${name}`;
    const cats = ok && ex.categories.length ? V.stack(ex.categories.map((c) => ({ id: c.name, value: c.amount, color: catColor(c.name), label: c.name })), { height: 4, gap: 2 }) : null;
    return sec('Spending', ex.source, null,
      h('button.pk-card.pk-spend', { type: 'button', onclick: () => go('money', { toTop: false }) },
        h('span.pk-spend-row', tileIc('bag'), h('span.pk-srow-main', h('strong.num', ok ? money(ex.total, { cents: P.mode === 'month' }) : '—'), h('span', sub)), icon('chevR', 15, 2)),
        cats ? h('span.pk-spend-bar', cats) : null));
  }

  function upcomingSection() {
    const rows = D.upcoming().map((it) => {
      const d = it.date ? F.parseYmd(it.date) : null;
      const t = tint(h('span.pk-utile', { 'aria-hidden': 'true' }, d ? [h('span', F.MONTHS[d.getMonth()]), h('strong.num', d.getDate())] : icon(icOf(it.stream), 17, 2)), it.stream);
      const right = it.kind === 'setup' ? h('span.pk-uright', h('span.pk-link', 'Set up'))
        : h('span.pk-uright', h('strong.num', { class: it.kind === 'in' ? 'is-in' : '' }, `${it.estimate ? '≈ ' : ''}${it.kind === 'in' ? '+' : ''}${money(it.amount)}`), h('span', it.date ? rel(it.date) : ''));
      return h('button.pk-urow', { type: 'button', onclick: () => upAction(it) }, t, h('span.pk-srow-main', h('strong', it.title), h('span', it.sub)), right);
    });
    return sec('Coming up', null, null, rows.length ? h('div.pk-card.pk-list', rows) : h('div.pk-card.pk-empty', h('p', 'Nothing due. Claims, payouts and reminders show up here.')));
  }
  function upAction(it) {
    if (it.kind === 'setup' && it.stream === 'lumpsum') return FM.lumpsum();
    if (WORK.includes(it.stream)) return go('work', { job: it.stream, wk: D.now, toTop: true });
    openStream(it.stream);
  }

  /* ================= WORK ================= */
  function viewWork() {
    const kinds = workKinds();
    if (!kinds.length) return h('div.pk-work', h('div.pk-card.pk-empty', h('p', 'No work is set up yet. A job, per-session work or hourly work shows up here once Muse sets it up.'), btn('Set up with Muse', museSheet)));
    if (!kinds.includes(st.job)) { st.job = kinds[0]; clampWk(); }
    syncJobSeg(kinds);
    const m = D.month(st.wk);
    const body = st.job === 'job' ? workJob(m) : st.job === 'gig' ? workGig(m) : workHourly(m);
    return h('div.pk-work', kinds.length > 1 ? jobSeg : null, ...body);
  }
  const monthBar = () => h('div.pk-mhead', h('h2.pk-h2', F.monthLabel(st.wk, { long: true })), workStrip());

  /* ---------- Job: pay, days, leave, claims, timesheet sync ---------- */
  function workJob(m) {
    const it = m.job, J = D.stream('job');
    const out = [monthBar()];
    if (!it.started && !it.entries.length) {
      const msg = J.startMonth && m.key < J.startMonth ? `${J.label} starts in ${F.monthLabel(J.startMonth, { long: true })}, so there's no timesheet for ${m.long}.` : `${J.label} had ended by ${m.long}.`;
      out.push(h('div.pk-card.pk-empty', h('p', msg)));
      return out;
    }
    out.push(h('div.pk-grid2', h('div.pk-col', payCard(m), daysCard(m)), h('div.pk-col', J.leave ? leaveCard(m) : null, J.claims ? claimsCard(m) : null, systemCard(m))));
    return out;
  }

  function payCard(m) {
    const it = m.job, J = D.stream('job');
    const frac = it.expectedMin ? it.workedMin / it.expectedMin : 0;
    let pace = null; // where a full-time pace would be by today
    if (m.key === today().slice(0, 7) && it.expectedMin) {
      const { y, m: mo } = F.parseMonth(m.key);
      let n = 0;
      for (let d = 1; d <= +today().slice(8); d++) { const w = new Date(y, mo, d).getDay(); if (w >= 1 && w <= 5) n++; }
      pace = Math.min(1, (n * J.dayMinutes) / it.expectedMin);
    }
    const net = h('span.num'); tick(net, `pay-${m.key}`, it.net, cents);
    const step = (label, c, cls = '') => h('div.pk-chain-step', { class: cls }, h('span', label), h('strong.num', cents(c)));
    const ded = J.deduction, dl = ded && ded.label;
    const dedNote = !ded ? null : ded.freeUpToCents && it.gross <= ded.freeUpToCents ? `No ${dl} until your gross passes ${money(ded.freeUpToCents)} in a month. You're ${cents(ded.freeUpToCents - it.gross)} under.` : it.deducted ? `${cents(it.deducted)} of your gross goes to ${dl} (${F.pct(it.deducted / it.gross)}).` : null;
    return h('section.pk-card.pk-pay',
      h('div.pk-card-h', h('div', h('p.pk-k', `${monLong(m.key)} pay`), h('p.pk-pay-net', net, ded ? h('span', ` after ${dl}`) : null)), link(`${money(it.monthlyPayCents)}/month`, () => FM.payRate())),
      ded ? h('div.pk-chain', step('Gross', it.gross), h('span.pk-chain-op', '−'), step(dl, it.deducted), h('span.pk-chain-op', '='), step('You get', it.net, 'is-net')) : null,
      h('div.pk-hours',
        h('div.pk-hours-h', h('span', h('strong.num', F.hours(it.workedMin)), ` of ${F.hours(it.expectedMin)}`), h('span.num', F.pct(frac))),
        h('div.pk-progress', { role: 'img', 'aria-label': `${F.pct(frac)} of this month's expected hours${pace != null ? `; full-time pace by today is ${F.pct(pace)}` : ''}` },
          h('span.pk-progress-fill', { style: { width: `${Math.min(100, frac * 100)}%` } }), pace != null ? h('span.pk-progress-mark', { style: { left: `${pace * 100}%` } }) : null),
        h('p.pk-note', `${plural(it.daysIn, 'day')} keyed in · ${D.rules.weekdays(m.key)} weekdays × ${F.hours(J.dayMinutes)}${pace != null ? ' · the tick is full-time pace by today' : ''}`)),
      it.projected ? h('div.pk-proj', h('span', 'At this pace'), h('strong.num', cents(it.projected.net)), h('span', `${ded ? `after ${dl} ` : ''}by ${F.shortDate(lastDay(m.key))}${ded ? ` · ${cents(it.projected.gross)} gross` : ''}`)) : null,
      dedNote ? h('p.pk-note', dedNote) : null);
  }

  function daysCard(m) {
    const it = m.job, J = D.stream('job'), ro = it.status && it.status !== 'draft', t = today();
    let gaps = 0;
    const cal = V.calendar(m.key, {
      today: t,
      cell: (date) => {
        const e = it.entries.find((x) => x.date === date), w = F.parseYmd(date).getDay();
        if (e) {
          const mins = D.rules.workedMin(e);
          if (e.attendanceCode && !mins) return { cls: 'is-leave', body: h('span.pk-calv', e.attendanceCode), label: `${F.dayLabel(date, { long: true })}: ${e.attendanceCode}` };
          return { cls: mins >= J.dayMinutes - 30 ? 'is-full' : 'is-part', body: h('span.pk-calv.num', F.hours(mins)), label: `${F.dayLabel(date, { long: true })}: ${F.hours(mins)} worked` };
        }
        if (w >= 1 && w <= 5 && date < t) { gaps++; return { cls: 'is-gap', label: `${F.dayLabel(date, { long: true })}: not keyed in` }; }
        return {};
      },
      onTap: (date) => FM.workDay({ date, entry: it.entries.find((x) => x.date === date), status: it.status || 'draft' }),
    });
    calHost.replaceChildren(cal);
    if (st.wkMoved && !st.swiped && !reduced()) cal.classList.add(st.wkMoved > 0 ? 'enter-next' : 'enter-prev');
    const legend = h('div.pk-legend', [['is-full', 'Full'], ['is-part', 'Part'], ['is-leave', 'Leave'], ['is-gap', 'Missing']].map(([c, l]) => h('span', h('i', { class: c }), l)));
    return h('section.pk-card.pk-days', h('div.pk-card-h', h('h3.pk-h3', 'Days'), legend), calHost,
      h('p.pk-note', ro ? `This timesheet is ${status(it.status).toLowerCase()} on ${J.system}, so days are read-only.` : gaps ? `${plural(gaps, 'weekday')} so far with nothing keyed in. Tap a day to fill it in, swipe for other months.` : 'Tap a day to key it in or change it. Swipe for other months.'));
  }

  function leaveCard(m) {
    const lv = m.job.leave, ro = lv && lv.status && lv.status !== 'draft';
    const bal = (lv && lv.balances) || [], entries = ((lv && lv.entries) || []).slice().sort((a, b) => a.from.localeCompare(b.from));
    const tiles = bal.length ? h('div.pk-leave', bal.map((b) => h('div.pk-leave-tile', h('span', D.leaveName(b.type)), h('strong.num', String(b.balance)), h('span', `of ${b.entitlement} days left`)))) : null;
    const rows = entries.map((e) => rowSwipe(
      h('button.pk-lrow', { type: 'button', onclick: () => FM.leave({ entry: e }) }, dateTile(e.from),
        h('span.pk-lmain', h('strong', `${D.leaveName(e.type)} · ${plural(e.days, 'day')}`), h('span', [e.from === e.to ? null : `${F.shortDate(e.from)} – ${F.shortDate(e.to)}`, e.reason].filter(Boolean).join(' · ') || 'No reason given')),
        e.attachmentIds && e.attachmentIds.length ? icon('clip', 15, 2) : null, icon('chevR', 15, 2)),
      ro ? [] : [{ label: 'Delete', cls: 'is-danger', fn: () => undoable(() => A.deleteLeaveEntry({ month: m.key, id: e.id }), () => A.saveLeaveEntry({ month: m.key, entry: e }), 'Leave removed') }]));
    return h('section.pk-card.pk-leavecard',
      h('div.pk-card-h', h('h3.pk-h3', 'Leave'), ro ? h('span.pk-badge', status(lv.status)) : link('Apply leave', () => FM.leave({ month: m.key }))),
      tiles, rows.length ? h('div.pk-list.is-flush', rows) : h('p.pk-note', lv ? `No leave in ${monLong(m.key)}.` : `Leave syncs from ${D.stream('job').system}.`));
  }

  function claimsCard(m) {
    const cl = m.job.claims, ro = cl && cl.status && cl.status !== 'draft';
    const entries = ((cl && cl.entries) || []).slice().sort((a, b) => a.date.localeCompare(b.date));
    const total = F.sum(entries, (e) => e.amountCents);
    const rows = entries.map((e) => rowSwipe(
      h('button.pk-lrow', { type: 'button', onclick: () => FM.claim({ entry: e }) }, dateTile(e.date),
        h('span.pk-lmain', h('strong', e.description), h('span', e.attachmentIds && e.attachmentIds.length ? 'Receipt attached' : 'No receipt yet')),
        h('span.pk-lamt.num', cents(e.amountCents))),
      ro ? [] : [{ label: 'Delete', cls: 'is-danger', fn: () => undoable(() => A.deleteExpenseEntry({ month: m.key, id: e.id }), () => A.saveExpenseEntry({ month: m.key, entry: e }), 'Claim removed') }]));
    return h('section.pk-card.pk-claims',
      h('div.pk-card-h', h('div', h('h3.pk-h3', 'Claims'), entries.length ? h('p.pk-card-sub', `${cents(total)} to be reimbursed`) : null), ro ? h('span.pk-badge', status(cl.status)) : link('New claim', () => FM.claim({ month: m.key }))),
      rows.length ? h('div.pk-list.is-flush', rows) : h('p.pk-note', `No work expenses in ${monLong(m.key)}.`));
  }

  function systemCard(m) {
    const ss = syncState(), J = D.stream('job');
    const forms = [['timesheet', 'Timesheet'], J.leave ? ['leave', 'Leave'] : null, J.claims ? ['expenses', 'Claims'] : null].filter(Boolean);
    const rows = forms.map(([k, label]) => { const f = D.form(m.key, k); return kv(label, f ? `${status(f.status)}${f.revision != null ? ` · rev ${f.revision}` : ''}` : 'Not synced'); });
    return h('section.pk-card.pk-sys',
      h('div.pk-card-h', h('h3.pk-h3', J.system), h('span.pk-syncline', { class: `is-${ss.tone}`, title: ss.long }, h('i', { 'aria-hidden': 'true' }), ss.text)),
      h('div.pk-kv', rows),
      h('div.pk-btnrow', btn('Sync now', syncNow, 'secondary', 'refresh'), btn('Export hours', () => exportFile('job', m.key), 'secondary', 'download')));
  }

  /* ---------- Gig: the month's claim and its sessions ---------- */
  function workGig(m) {
    const G = D.stream('gig'), g = m.gig, c = g.claim, p = D.profile();
    const ready = !!(p.fullName && (p.bankAccount || p.paymentId));
    const amt = h('span.num'); tick(amt, `gig-${m.key}`, g.fees, cents);
    const dates = c && (c.due || c.payFrom) ? h('div.pk-claim-dates',
      c.due ? h('div', h('span', daysFrom(c.due) >= 0 ? 'Submit by' : 'Was due'), h('strong', F.dayLabel(c.due)), h('em', daysFrom(c.due) >= 0 ? rel(c.due) : 'past')) : null,
      c.payFrom ? h('div', h('span', 'Paid'), h('strong', c.payTo && c.payTo !== c.payFrom ? `${F.shortDate(c.payFrom)} – ${F.shortDate(c.payTo)}` : F.shortDate(c.payFrom)), h('em', daysFrom(c.payTo || c.payFrom) < 0 ? 'should be in' : rel(c.payFrom))) : null) : null;
    const how = c ? [`${G.claimForm ? 'Your claim form' : 'A claim workbook'} (.xlsx), filled in.`, c.to ? ` Send it to ${c.to}${G.claim.dueWorkingDay ? ` by the ${ordinal(G.claim.dueWorkingDay)} working day of next month` : ''}.` : ''].join('') : 'A log of the month\'s sessions (.xlsx).';
    const claim = tint(h('section.pk-card.pk-claim',
      h('div.pk-card-h', h('div', h('p.pk-k', `${monLong(m.key)} ${c ? 'claim' : 'pay'}`), h('p.pk-claim-amt', amt)), h('span.pk-claim-meta', `${plural(g.count, 'session')} · ${F.hours(g.minutes)}`)),
      dates,
      c ? h('button.pk-claim-who', { type: 'button', onclick: () => FM.claimProfile() }, icon('user', 16, 2), h('span', ready ? [p.fullName, p.paymentId ? `${D.setup().paymentIdLabel} ${p.paymentId}` : null].filter(Boolean).join(' · ') : 'Your name and bank details'), h('span.pk-link', ready ? 'Edit' : 'Add')) : null,
      h('div.pk-btnrow', btn(c ? 'Download claim' : 'Download log', () => exportClaim(m.key), 'primary', 'download', { disabled: !g.sessions.length })),
      h('p.pk-note', how)), 'gig');
    const rows = g.sessions.map((x) => rowSwipe(
      h('button.pk-lrow', { type: 'button', onclick: () => FM.gig({ session: x }) }, dateTile(x.date),
        h('span.pk-lmain', h('strong', x.remarks || `${G.short} session`), h('span', [`${F.fmtTime(x.timeIn)}–${F.fmtTime(x.timeOut)}`, x.sessionsCount > 1 ? `${x.sessionsCount} sessions` : null, x.venue].filter(Boolean).join(' · '))),
        h('span.pk-lamt.num', cents(D.rules.gigFee(x)))),
      [{ label: 'Next week', cls: 'is-alt', fn: () => repeatSession('gig', x) }, { label: 'Delete', cls: 'is-danger', fn: () => undoable(() => A.deleteGigSession({ id: x.id }), () => A.saveGigSession({ entry: x }), 'Session deleted') }]));
    const list = h('section.pk-card.pk-sessions',
      h('div.pk-card-h', h('h3.pk-h3', 'Sessions'), link('Log session', () => FM.gig({ date: defaultDate(m.key) }))),
      rows.length ? h('div.pk-list.is-flush', rows) : h('p.pk-note', `No sessions in ${monLong(m.key)} yet.`),
      rows.length ? h('p.pk-note.pk-hint', 'Swipe a session left to copy it to next week or delete it.') : null);
    return [monthBar(), h('div.pk-grid2', h('div.pk-col', claim), h('div.pk-col', list))];
  }
  const ordinal = (n) => { const t = n % 100; return `${n}${t >= 11 && t <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th'}`; };
  function exportClaim(k) {
    const G = D.stream('gig'), p = D.profile();
    if (G.claim && !p.fullName) { FM.claimProfile({ onSaved: () => setTimeout(() => exportFile('gigClaim', k), 320) }); UI.toast('Add your details for the claim first'); return; }
    exportFile('gigClaim', k);
  }

  /* ---------- Hourly ---------- */
  function workHourly(m) {
    const H = D.stream('hourly'), t = m.hourly, rate = t.rateCents || D.lastRate('hourly');
    const amt = h('span.num'); tick(amt, `hourly-${m.key}`, t.pay, cents);
    const when = t.period ? `${t.period.note.charAt(0).toUpperCase()}${t.period.note.slice(1)}, from ${F.monthLabel(t.period.payFrom, { long: true })}, for all of ${t.period.label}. ` : '';
    const summary = tint(h('section.pk-card.pk-tasum',
      h('div.pk-card-h', h('div', h('p.pk-k', `${monLong(m.key)} ${H.short} pay`), h('p.pk-claim-amt', amt)), h('span.pk-claim-meta', `${F.hours(t.minutes)} · ${plural(t.sessions.length, 'session')}`)),
      h('p.pk-note', when, rate ? `Your rate is ${cents(rate)} an hour; change it on any session.` : "You'll set your hourly rate on the first session."),
      h('div.pk-btnrow', btn('Log session', () => FM.hourly({ date: defaultDate(m.key) }), 'primary', 'plus'), btn('Export log', () => exportFile('hourly', m.key), 'secondary', 'download', { disabled: !t.sessions.length }))), 'hourly');
    const rows = t.sessions.map((x) => rowSwipe(
      h('button.pk-lrow', { type: 'button', onclick: () => FM.hourly({ session: x }) }, dateTile(x.date),
        h('span.pk-lmain', h('strong', [x.module || H.short, x.remarks].filter(Boolean).join(' · ')), h('span', [x.timeIn ? `${F.fmtTime(x.timeIn)}–${F.fmtTime(x.timeOut)}` : null, F.hours(D.rules.hourlyMin(x))].filter(Boolean).join(' · '))),
        h('span.pk-lamt.num', cents(D.rules.hourlyPay(x)))),
      [{ label: 'Next week', cls: 'is-alt', fn: () => repeatSession('hourly', x) }, { label: 'Delete', cls: 'is-danger', fn: () => undoable(() => A.deleteHourlySession({ id: x.id }), () => A.saveHourlySession({ entry: x }), 'Session deleted') }]));
    const list = h('section.pk-card.pk-sessions', h('div.pk-card-h', h('h3.pk-h3', 'Sessions')), rows.length ? h('div.pk-list.is-flush', rows) : h('p.pk-note', `No sessions in ${monLong(m.key)}.`));
    return [monthBar(), h('div.pk-grid2', h('div.pk-col', summary), h('div.pk-col', list))];
  }
  async function repeatSession(kind, x) {
    const d = F.parseYmd(x.date); d.setDate(d.getDate() + 7);
    const entry = { ...x, id: F.uid(kind), date: F.ymd(d) };
    const save = kind === 'gig' ? A.saveGigSession : A.saveHourlySession, del = kind === 'gig' ? A.deleteGigSession : A.deleteHourlySession;
    await undoable(() => save({ entry }), () => del({ id: entry.id }), `Copied to ${F.dayLabel(entry.date)}`);
  }

  /* ================= MONEY ================= */
  function viewMoney() {
    const v = P.view(), pv = P.prevView();
    const L = D.stream('lumpsum');
    const sw = L ? h('button.pk-switch', { type: 'button', role: 'switch', 'aria-checked': String(st.lump), onclick: () => { st.lump = !st.lump; UI.haptic(5); render(); } }, h('span.pk-switch-k', { 'aria-hidden': 'true' }), `Include the ${L.label}`) : null;
    return h('div.pk-money', periodBar(), sw, h('div.pk-grid2.is-money', h('div.pk-col', P.mode === 'month' ? trendMonths(v) : trendYears(v), flowSection(v, pv)), h('div.pk-col', spendCard(v, pv))));
  }
  const withLump = () => st.lump && !!D.stream('lumpsum');
  const incOf = (m) => (withLump() ? m.income : m.regular);
  const inStreams = (m) => m.streams.filter((s) => s.amount > 0 && (withLump() || s.id !== 'lumpsum'));
  function streamLegend(ms) {
    const ids = [...new Set(ms.flatMap((m) => inStreams(m).map((s) => s.id)))];
    const first = (id) => ms.map((m) => m.streams.find((s) => s.id === id)).find(Boolean);
    return ids.length ? h('div.pk-legend', ids.map((id) => h('span', h('i', { style: { background: scol(id) } }), first(id).short))) : null;
  }
  function trendMonths(v) {
    const end = P.key >= F.addMonths(D.now, -11) ? D.now : F.addMonths(P.key, 5) > D.now ? D.now : F.addMonths(P.key, 5);
    const ms = D.series(end, 12), b = D.range();
    const items = ms.map((m) => ({ key: m.key, label: F.MONTHS[+m.key.slice(5) - 1], title: m.long, stacks: inStreams(m).map((s) => ({ id: s.id, value: s.amount, color: scol(s.id) })), down: 0, net: null, sample: m.isSample }));
    const chart = h('div.pk-chart');
    mount(() => V.bars(chart, { items, selected: P.key, upOnly: true, valueLabel: true, height: wide() ? 220 : 180, barW: 20, ariaLabel: 'Income by month, last 12 months. Tap a month to open it.', onSelect: (k) => { if (k >= b.first && k <= b.last && k !== P.key) { UI.haptic(5); P.goto('month', k); } } }));
    const withInc = ms.filter((m) => incOf(m) > 0);
    const avg = withInc.length ? F.sum(withInc, incOf) / withInc.length : 0;
    const best = withInc.slice().sort((a, c) => incOf(c) - incOf(a))[0];
    const summary = withInc.length >= 2
      ? h('p.pk-summary', 'You average ', h('strong.num', money(avg)), ` a month across ${plural(withInc.length, 'month')} with income. Best: ${best.long}, ${money(incOf(best))}.`)
      : h('p.pk-summary', withInc.length ? `Only ${withInc[0].long} has income in this window.` : 'No income in this window yet.');
    const fr = D.firstReal(), L = D.stream('lumpsum');
    const note = !D.sample() && withInc.length <= 2 ? h('p.pk-note', `${fr ? `Your data starts in ${F.monthLabel(fr, { long: true })}. ` : ''}Sample history (in More) previews a full year.`) : ms.some((m) => m.isSample) ? h('p.pk-note', 'Faded bars are sample history, not your data.') : null;
    return sec('Income by month', `${P.label({ long: true })} highlighted${L ? ` · ${withLump() ? `including the ${L.label}` : `without the ${L.label}`}` : ''}`, null, h('div.pk-card.pk-pad', streamLegend(ms), chart, summary, note));
  }
  function trendYears(v) {
    const y = +P.key, yv = D.year(y), py = D.year(y - 1), b = D.range();
    let a = 0, c = 0;
    const cur = yv.months.map((m) => (m ? (a += incOf(m)) : null));
    const prev = py.months.map((m) => (m ? (c += incOf(m)) : null));
    const chart = h('div.pk-chart'), pairs = h('div.pk-chart');
    mount(() => V.yoy(chart, { cur, prev, curLabel: String(y), prevLabel: String(y - 1), color: 'var(--line-in)', height: wide() ? 210 : 170, ariaLabel: `Income so far in ${y} against ${y - 1}` }));
    mount(() => V.pairs(pairs, { cur: yv.months.map((m) => (m ? incOf(m) : null)), prev: py.months.map((m) => (m ? incOf(m) : null)), height: 120, onSelect: (j) => { const k = F.monthKey(y, j); if (k >= b.first && k <= b.last) P.goto('month', k); } }));
    const i = cur.reduce((acc, x, j) => (x != null ? j : acc), -1);
    const when = yv.isNow ? 'the same months last year' : `in ${y - 1}`;
    let summary;
    if (!py.hasData || i < 0 || !prev[i]) summary = h('p.pk-summary', `No ${y - 1} income to compare with yet.`);
    else {
      const d = cur[i] - prev[i];
      summary = Math.abs(d) < 100 ? h('p.pk-summary', `You've earned about the same as ${when}.`)
        : h('p.pk-summary', "You've earned ", h('strong', { class: d >= 0 ? 'is-good' : 'is-bad' }, `${money(Math.abs(d))} ${d > 0 ? 'more' : 'less'}`), ` than ${when} (${money(cur[i])} against ${money(prev[i])}).`);
    }
    return sec('Year on year', `Running total, ${y} against ${y - 1}`, null,
      h('div.pk-card.pk-pad', chart, summary, h('div.pk-subhead', h('span', 'Month by month'), h('div.pk-legend', h('span', h('i.is-cur'), String(y)), h('span', h('i.is-prev'), String(y - 1)))), pairs,
        yv.isSample || py.isSample ? h('p.pk-note', 'Includes sample history, not your data.') : null));
  }

  function flowSection(v, pv) {
    const ex = v.expenses, inc = incOf(v);
    const sources = inStreams(v).map((s) => ({ id: s.id, label: s.label, short: s.short, value: s.amount, color: scol(s.id), delta: pv.hasData ? D.compare(v, pv).byStream[s.id] : null }));
    const outflows = ex.categories.map((c) => ({ id: `cat:${c.name}`, label: c.name, short: c.name.split(' ')[0], value: c.amount, kind: 'expense', color: catColor(c.name) }));
    if (v.invested) outflows.push({ id: 'invested', label: 'Invested', value: v.invested, kind: 'invest', color: 'var(--invest)' });
    if (!inc && !ex.total) return sec('Money flow', null, null, h('div.pk-card.pk-empty', h('p', `No money in or out for ${P.label({ long: true })}.`)));
    const chart = h('div.pk-sk'), cap = h('p.pk-skcap', { 'aria-live': 'polite' });
    const total = Math.max(inc, ex.total + v.invested, 1);
    const capDefault = () => cap.replaceChildren(ex.status !== 'ok' ? (spendName() ? `Spending is still syncing from ${spendName()}.` : 'No spending source is connected, so this only shows what came in.') : inc < ex.total + v.invested ? `${money(ex.total + v.invested - inc)} more went out than came in, so it came from savings.` : `${money(inc - ex.total - v.invested)} of ${money(inc)} was left over.`);
    const onSelect = (n) => {
      if (!n) return capDefault();
      const what = n.id === 'from-savings' ? 'covered from savings' : n.id === 'kept' ? 'left over' : n.kind === 'expense' || n.kind === 'invest' ? `${F.pct(n.value / total)} of what went out` : `${F.pct(n.value / total)} of what came in`;
      cap.replaceChildren(h('strong', n.label), ` · ${money(n.value)} · ${what}`);
    };
    capDefault();
    mount(() => V.sankey(chart, { sources, outflows, center: { label: 'Earned', value: inc }, pending: ex.status !== 'ok', pendingLabel: 'Syncing…', deficitLabel: 'From savings', surplusLabel: 'Kept', height: wide() ? 230 : 176, nodeW: wide() ? 5 : 4, fill: 0.58, maxGap: wide() ? 26 : 18, onSelect }));
    return sec('Money flow', 'What came in, and where it went. Tap a stream to focus it.', null, h('div.pk-card.pk-pad.pk-flow', chart, cap));
  }

  function spendCard(v, pv) {
    const ex = v.expenses;
    const synced = P.mode === 'month' ? (ex.syncedAt ? `synced ${F.ago(ex.syncedAt)}` : v.isSample ? 'sample data' : 'not synced yet') : `across ${plural(v.months.filter((m) => m && m.expenses.status === 'ok').length, 'month')}`;
    const totalEl = h('strong.pk-spend-total.num');
    const name = spendName();
    if (!name && ex.status !== 'ok') return sec('Spending', null, null, h('div.pk-card.pk-empty', h('p', 'No spending source is connected. Muse can link the app you track spending in.')));
    const head = secHead('Spending', `${ex.source} · ${synced}`, ex.status === 'ok' ? totalEl : null);
    if (ex.status === 'ok') tick(totalEl, 'spend', ex.total, (c) => money(c));
    const s = h('section.pk-sec', head);
    if (ex.status === 'error') { s.append(h('div.pk-card.pk-empty', h('p', `Couldn't reach ${name}. Everything else is current.`), btn('Try again', syncNow))); return s; }
    if (ex.status !== 'ok') { s.append(h('div.pk-card.pk-empty', h('p', P.mode === 'month' ? `No spending from ${name} for ${v.long} yet.` : `No spending synced for ${v.year}.`))); return s; }
    if (!ex.categories.length) { s.append(h('div.pk-card.pk-empty', h('p', 'Nothing spent.'))); return s; }
    const prevCats = new Map(((pv.expenses && pv.expenses.categories) || []).map((c) => [c.name, c]));
    const cmp = pv.hasData && pv.expenses.status === 'ok';
    s.append(h('div.pk-card.pk-list', ex.categories.map((c) => {
      const share = c.amount / ex.total, pc = prevCats.get(c.name);
      const d = cmp ? c.amount - (pc ? pc.amount : 0) : null;
      const row = h('div.pk-cat',
        h('span.pk-cat-dot', { 'aria-hidden': 'true' }),
        h('span.pk-srow-main', h('strong', c.name), h('span', plural(c.count, 'item'), d != null && Math.abs(d) >= 100 ? h('span', { class: d > 0 ? 'is-bad' : 'is-good' }, ` · ${money(Math.abs(d))} ${d > 0 ? 'more' : 'less'}`) : null)),
        h('span.pk-cat-amt', h('strong.num', money(c.amount)), h('span.num', F.pct(share))),
        h('span.pk-cat-bar', { 'aria-hidden': 'true' }, h('span', { style: { width: `${Math.max(2, share * 100)}%` } })));
      row.style.setProperty('--cc', catColor(c.name));
      return row;
    })));
    return s;
  }

  /* ================= MORE ================= */
  function viewMore() {
    const k = st.wk > D.now ? D.now : st.wk, m = D.month(k), y = +D.now.slice(0, 4);
    const row = ({ ic, tone, title, sub, right, onclick, cls = '' }) => h('button.pk-srow', { type: 'button', class: cls, onclick }, h('span.pk-tile', { class: `is-${tone || ic}` }, icon(ic, 17, 1.9)), h('span.pk-srow-main', h('strong', title), sub ? h('span', sub) : null), right || icon('chevR', 15, 2));
    const ss = syncState(), exp = m.expenses, p = D.profile();
    const J = D.stream('job'), G = D.stream('gig'), H = D.stream('hourly'), L = D.stream('lumpsum'), DV = D.stream('dividends'), E = D.setup() && D.setup().expenses;
    const opts = []; for (let x = D.now; x >= D.range().first; x = F.addMonths(x, -1)) opts.push(x);
    const monthPick = h('select.pk-select', { 'aria-label': 'Month to export', onchange: (e) => { st.wk = e.target.value; render(); } }, opts.map((x) => h('option', { value: x, selected: x === k }, F.monthLabel(x))));
    const themeNow = UI.theme.forced || 'auto';
    const themeSeg = h('div.pk-mini-seg', { role: 'radiogroup', 'aria-label': 'Appearance' }, [['auto', 'Muse'], ['light', 'Light'], ['dark', 'Dark']].map(([v, l]) => h('button', { type: 'button', role: 'radio', 'aria-checked': String(themeNow === v), onclick: () => { UI.theme.set(v === 'auto' ? null : v); render(); } }, l)));
    const syncLink = h('span.pk-link', 'Sync');
    const syncRows = [
      J ? row({ ic: icOf('job'), tone: 'job', title: J.system, sub: `${ss.text} · ${F.monthLabel(k, { year: false })} ${status(m.job.status).toLowerCase()}${m.job.revision != null ? `, rev ${m.job.revision}` : ''}`, right: syncLink, onclick: syncNow }) : null,
      E ? row({ ic: 'bag', title: E.label, sub: exp.syncedAt ? `Spending synced ${F.ago(exp.syncedAt)}` : ['Spending', E.detail].filter(Boolean).join(', '), right: h('span.pk-link', 'Sync'), onclick: syncNow }) : null,
      DV && DV.source ? row({ ic: icOf('dividends'), tone: 'dividends', title: DV.source, sub: `${DV.label}, read-only here`, right: h('span') }) : null,
      !J && !E ? row({ ic: 'refresh', tone: 'sliders', title: inMuse() ? 'Muse' : 'Local preview', sub: ss.long, right: inMuse() ? syncLink : h('span'), onclick: syncNow }) : null,
    ];
    const dl = () => icon('download', 18, 2);
    const exportRows = [
      G ? row({ ic: icOf('gig'), tone: 'gig', title: `${G.short} ${G.claim ? 'claim' : 'log'}`, sub: `${F.monthLabel(k)} · ${plural(m.gig.count, 'session')} · ${cents(m.gig.fees)}`, right: dl(), onclick: () => exportClaim(k) }) : null,
      J ? row({ ic: icOf('job'), tone: 'job', title: `${J.short} hours`, sub: `${F.monthLabel(k)} · ${F.hours(m.job.workedMin)}${J.leave || J.claims ? ' · leave and claims included' : ''}`, right: dl(), onclick: () => exportFile('job', k) }) : null,
      H ? row({ ic: icOf('hourly'), tone: 'hourly', title: `${H.short} log`, sub: `${F.monthLabel(k)} · ${F.hours(m.hourly.minutes)}`, right: dl(), onclick: () => exportFile('hourly', k) }) : null,
      row({ ic: 'chart', title: `Cashflow ${y}`, sub: 'Income by stream, spending by category, month by month', right: dl(), onclick: () => exportFile('statement', y) }),
    ];
    const payRows = [
      J ? row({ ic: icOf('job'), tone: 'job', title: `${J.label} pay`, sub: `${money(J.monthlyPayCents)} a month${J.deduction ? ` before ${J.deduction.label}` : ''}, prorated by hours`, onclick: () => FM.payRate() }) : null,
      L ? row({ ic: icOf('lumpsum'), tone: 'lumpsum', title: L.label, sub: L.receiptMonth ? `${money(L.yearlyCents)} a year, lands in ${F.MONTHS_LONG[L.receiptMonth - 1]}` : `${money(L.yearlyCents)} a year · month not set`, onclick: () => FM.lumpsum() }) : null,
      G && G.claim ? row({ ic: 'user', title: 'Claim details', sub: p.fullName ? `${p.fullName} · ${p.bankAccount || 'no bank account'}` : 'Name and bank details', onclick: () => FM.claimProfile() }) : null,
      ...D.custom().map((x) => row({ ic: 'coin', tone: 'custom', title: x.label, sub: { 'one-off': 'One-off payments', monthly: `${cents(x.rateCents)} a month`, hourly: `${cents(x.rateCents)} an hour`, session: `${cents(x.rateCents)} a session` }[x.type], onclick: () => FM.incomeSource({ source: x }) })),
      row({ ic: 'plus', tone: 'new', title: 'New income source', sub: 'Anything else that pays you', onclick: () => FM.incomeSource() }),
    ];
    const sources = [J && J.system, E && E.label, DV && DV.source].filter(Boolean);
    return h('div.pk-more',
      sec('Sync', null, null, h('div.pk-card.pk-list', syncRows)),
      sec('Export to Excel', 'Files download straight from the space', monthPick, h('div.pk-card.pk-list', exportRows)),
      sec('Pay and income', null, null, h('div.pk-card.pk-list', payRows)),
      sec('Setup', null, null, h('div.pk-card.pk-list',
        row({ ic: 'sliders', title: D.configured() ? 'Change your setup' : 'Set up with Muse', sub: D.configured() ? `${plural(workKinds().length, 'kind')} of work${L ? `, ${L.label}` : ''}${E ? `, ${E.label}` : ''}. Muse edits it for you.` : 'Muse fills in your jobs and pay rules', onclick: museSheet }),
        h('button.pk-srow', { type: 'button', role: 'switch', 'aria-checked': String(D.sample()), onclick: () => { D.setSample(!D.sample()); UI.toast(D.sample() ? 'Showing sample data where you have none' : 'Showing only your own data'); } }, h('span.pk-tile.is-chart', icon('chart', 17, 1.9)), h('span.pk-srow-main', h('strong', 'Sample data'), h('span', D.configured() ? 'Fill the months before your data starts, to preview trends' : 'Look around with a made-up setup')), h('span.pk-switch-k', { 'aria-hidden': 'true' })))),
      sec('Display', null, null, h('div.pk-card.pk-list',
        h('div.pk-srow.is-static', h('span.pk-tile.is-sliders', icon('sliders', 17, 1.9)), h('span.pk-srow-main', h('strong', 'Appearance'), h('span', 'Muse follows your Muse app setting')), themeSeg))),
      h('p.pk-foot', `Runs inside your Muse space${sources.length ? `, synced with ${sources.join(', ')}` : ''}. ←/→ change month, 1–4 switch sections.`));
  }

  async function exportFile(kind, key) {
    if (!CF.xlsx || !CF.xlsx[kind]) { UI.toast("Excel export isn't available in this build"); return; }
    try {
      const out = await CF.xlsx[kind](key);
      CF.xlsx.download(out);
      UI.haptic(10);
      UI.toast(out.warnings && out.warnings.length ? `Downloaded. ${out.warnings[0]}` : `Downloaded ${out.filename}`, { ms: 3600 });
    } catch (e) { UI.toast(`Couldn't make the file: ${e.message}`); }
  }

  /* ---------------- Stream detail sheets (lump sum, dividends, your own sources, year views) ---------------- */
  function openStream(id) {
    if (WORK.includes(id) && P.mode === 'month') return go('work', { job: id, wk: P.key, toTop: true });
    openSheet(id);
  }
  function openSheet(id) {
    const s = P.view().streams.find((x) => x.id === id);
    if (!s) return;
    UI.haptic(6);
    const sh = UI.sheet({ title: s.label, sub: P.label({ long: true }), body: sheetBody(id), cls: 'pk-ss', onClose: () => { if (st.sheet && st.sheet.sh === sh) st.sheet = null; } });
    st.sheet = { id, sh };
  }
  function refreshSheet() {
    const { id, sh } = st.sheet;
    if (!sh.el.isConnected) { st.sheet = null; return; }
    const y = sh.body.scrollTop;
    sh.setBody(sheetBody(id));
    sh.body.scrollTop = y;
  }
  const group = (title, ...kids) => h('section.pk-g', title ? h('h3.pk-h3', title) : null, ...kids);
  function sheetBody(id) {
    const v = P.view(), s = v.streams.find((x) => x.id === id);
    if (!s) return h('div.pk-sd', h('p.pk-note', 'This source has no data for this period.'));
    const k = sid(id);
    const head = h('div.pk-sdhead', tile(id), h('div', h('p.pk-sd-amt.num', money(s.amount, { cents: P.mode === 'month' })), h('p.pk-note', s.custom ? 'A source you added' : `${s.kind} · from ${s.source}`)));
    const parts = P.mode === 'year' ? yearDetail(s, v) : k === 'lumpsum' ? lumpDetail(v) : k === 'dividends' ? divDetail(v) : customDetail(s);
    return tint(h('div.pk-sd', head, ...parts.filter(Boolean)), id);
  }
  function lumpDetail(v) {
    const sc = v.lumpsum, m = sc.receiptMonth;
    return [group(null, h('div.pk-kv', kv('Per year', money(sc.yearly)), kv('Lands in', m ? F.MONTHS_LONG[m - 1] : 'Not set'), kv(`In ${monLong(v.key)}`, money(sc.amount))),
      h('p.pk-note', 'It counts as income in the month it lands, but Home and the trends leave it out so one big month doesn\'t skew the rest. Turn it on in Money to see it.')),
    h('div.pk-btnrow', btn(m ? 'Change amount or month' : 'Set the month it lands', () => FM.lumpsum(), 'primary'))];
  }
  function divDetail(v) {
    const DV = D.stream('dividends'), hist = D.series(v.key, 12).filter((m) => m.dividends > 0).reverse();
    return [group('Last 12 months', hist.length ? h('div.pk-kv', hist.map((m) => kv(m.label + (m.isSample ? ' · sample' : ''), cents(m.dividends)))) : h('p.pk-note', 'No dividends in the last 12 months.')), h('p.pk-note', `${DV && DV.source ? `Synced from ${DV.source}, net` : 'Net'} of withholding tax. Read-only here.`)];
  }
  function customDetail(s) {
    const src = D.custom().find((x) => x.id === s.id);
    if (!src) return [h('p.pk-note', 'This source was removed.')];
    const entries = (s.entries || []).slice().sort((a, b) => a.date.localeCompare(b.date));
    return [group('Entries', entries.length ? h('div.pk-list.is-flush', entries.map((e) => h('button.pk-lrow', { type: 'button', onclick: () => FM.incomeEntry({ sourceId: s.id, entry: e }) }, dateTile(e.date), h('span.pk-lmain', h('strong', e.note || src.label), h('span', e.qty ? `${e.qty} ${src.type === 'hourly' ? 'h' : e.qty === 1 ? 'session' : 'sessions'}` : 'Payment')), h('span.pk-lamt.num', cents(e.amountCents))))) : h('p.pk-note', src.type === 'monthly' ? `Pays ${cents(src.rateCents)} automatically each month.` : 'Nothing logged this month.')),
      h('div.pk-btnrow', src.type !== 'monthly' ? btn('Log a payment', () => FM.incomeEntry({ sourceId: s.id }), 'primary', 'plus') : null, btn('Edit source', () => FM.incomeSource({ source: src })))];
  }
  /** Year view of one stream: only months that actually had something, never a column of empty rows. */
  function yearDetail(s, v) {
    const k = sid(s.id), vals = s.monthly || [];
    const live = v.months.map((m, i) => (m && vals[i] > 0 ? { m, amt: vals[i] } : null)).filter(Boolean);
    if (!live.length) return [h('p.pk-note', `Nothing from ${s.label} in ${v.year}${v.isNow ? ' so far' : ''}.`)];
    const max = Math.max(...live.map((x) => x.amt));
    const extra = (m) => (k === 'gig' ? plural(m.gig.count, 'session') : k === 'hourly' ? F.hours(m.hourly.minutes) : k === 'job' ? F.hours(m.job.workedMin) : '');
    const rows = live.map(({ m, amt }) => h('button.pk-yrow', { type: 'button', class: m.isSample ? 'is-sample' : '', onclick: () => { st.sheet && st.sheet.sh.close(); if (WORK.includes(k)) go('work', { job: k, wk: m.key, toTop: true }); else P.goto('month', m.key); } },
      h('span.pk-yrow-m', F.MONTHS[+m.key.slice(5) - 1]), h('span.pk-ybar', { 'aria-hidden': 'true' }, h('span', { style: { width: `${(amt / max) * 100}%` } })), h('span.pk-yrow-x', extra(m)), h('strong.num', money(amt))));
    const quiet = v.months.filter(Boolean).length - live.length;
    return [group('Month by month', h('div.pk-ylist', rows), h('p.pk-note', `${quiet ? `${plural(quiet, 'month')} with nothing ${quiet === 1 ? 'is' : 'are'} left out. ` : ''}Tap a month to open it.`)),
      k === 'lumpsum' ? h('div.pk-btnrow', btn('Change amount or month', () => FM.lumpsum(), 'primary')) : null];
  }

  /* ---------------- Render ---------------- */
  /** Shown only until the first load answers: the layout's shape, no fake numbers. */
  const skeleton = () => h('div.pk-skel', { 'aria-busy': 'true', 'aria-label': 'Loading' }, h('div.pk-skel-b.is-bar'), h('div.pk-skel-b.is-hero'), h('div.pk-skel-b.is-list'));
  function render() {
    if (!st.booted) { renderChrome(); if (!view.firstChild) view.replaceChildren(skeleton()); return; }
    clampPeriod(); clampWk();
    st.moved = st.lastKey != null && st.lastMode === P.mode && st.lastKey !== P.key ? (P.key > st.lastKey ? 1 : -1) : 0;
    st.wkMoved = st.lastWk != null && st.lastWk !== st.wk ? (st.wk > st.lastWk ? 1 : -1) : 0;
    if (st.lastKey !== P.key || st.lastMode !== P.mode) { if (st.lastKey != null) announcer.textContent = P.label({ long: true }); }
    const sy = scrollY;
    bag.forEach((b) => b.destroy()); bag = [];
    renderChrome();
    const node = { home: viewHome, work: viewWork, money: viewMoney, more: viewMore }[st.tab]();
    view.replaceChildren(node);
    if (st.enter && !reduced()) {
      [...node.children].forEach((c, i) => c.style.setProperty('--i', String(Math.min(i, 8))));
      view.classList.remove('is-enter'); void view.offsetWidth; view.classList.add('is-enter');
    } else view.classList.remove('is-enter'); // data refreshes swap content in place, without replaying the entrance
    st.enter = false;
    flush();
    if (Math.abs(scrollY - sy) > 1) scrollTo(0, sy);
    if (st.sheet) refreshSheet();
    st.lastKey = P.key; st.lastMode = P.mode; st.lastWk = st.wk; st.swiped = false;
  }

  D.subscribe(render);
  mqWide.addEventListener('change', render);
  UI.theme.onChange(() => render());
  addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target.closest && e.target.closest('input,textarea,select,[contenteditable]')) return;
    if (document.querySelector('.cf-sheet-root')) return;
    const i = ['1', '2', '3', '4'].indexOf(e.key);
    if (i >= 0) { go(TABS[i].id); return; }
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const n = e.key === 'ArrowLeft' ? -1 : 1;
    if (st.tab === 'work') stepWk(n); else if (st.tab === 'home' || st.tab === 'money') n < 0 ? P.prev() : P.next();
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); }); // back from the background: maybe a new day
  /* Scrolling: the scroll-edge blur appears once content is under the header, and the big title tightens. */
  let scrolled = false, scrollRaf = 0;
  function onScrollNow() {
    const s = scrollY > 2;
    if (s !== scrolled) { scrolled = s; rootEl.classList.toggle('is-scrolled', s); }
  }
  addEventListener('scroll', () => { if (!scrollRaf) scrollRaf = requestAnimationFrame(() => { scrollRaf = 0; onScrollNow(); }); }, { passive: true });
  UI.pull({ onRefresh: syncNow, label: 'Pull to sync', busyLabel: 'Syncing…' });
  render();
  requestAnimationFrame(() => app.classList.add('is-ready'));
  // In Muse the first load is one action call; wait for it (briefly) so the first real paint has your data
  const ready = (CF.muse && CF.muse.ready) || Promise.resolve();
  Promise.race([ready, new Promise((r) => setTimeout(r, 1500))]).then(() => { st.booted = true; st.enter = true; view.replaceChildren(); render(); });
})();
