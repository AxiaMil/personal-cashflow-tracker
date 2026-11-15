/* Interaction kit tuned for Muse spaces:
   - theme follows the host (data-hatch-color-scheme / "hatch:space:theme" message), falls back to the OS
   - swipes never start at the screen edges (that's the Muse app's back gesture) and lock to one axis
   - sheets sit inside Muse's header (--header-height) and bottom chrome (--bottom-padding + safe area)
   - no page navigation, no storage: everything is in-document state */
(function () {
  const CF = window.CF, F = CF.fmt, h = CF.h;
  const root = document.documentElement;
  const isPhone = () => matchMedia('(max-width: 719px)').matches;
  // Chrome logs an error when vibrate() runs before the first tap, so only buzz once the user has interacted.
  const haptic = (ms = 8) => { try { const ua = navigator.userActivation; if (navigator.vibrate && (!ua || ua.hasBeenActive)) navigator.vibrate(ms); } catch (e) {} };

  /* ---------- Theme ---------- */
  const ACCENTS = { blue: '#3b82f6', green: '#22a06b', red: '#e5484d', purple: '#8e4ec6', pink: '#d6409f', orange: '#f76b15', monochrome: '#6b6b6b' };
  const theme = {
    listeners: new Set(),
    forced: new URLSearchParams(location.search).get('scheme'),
    resolve() {
      return this.forced || root.getAttribute('data-hatch-color-scheme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    },
    apply() {
      const s = this.resolve();
      if (root.dataset.scheme !== s) { root.dataset.scheme = s; this.listeners.forEach((f) => f(s)); }
      const acc = root.getAttribute('data-hatch-accent');
      if (acc && ACCENTS[acc]) root.style.setProperty('--host-accent', ACCENTS[acc]);
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.content = getComputedStyle(root).getPropertyValue('--bg').trim() || meta.content;
    },
    set(s) { this.forced = s; this.apply(); },
    toggle() { this.set(this.resolve() === 'dark' ? 'light' : 'dark'); },
    onChange(f) { this.listeners.add(f); },
    init() {
      this.apply();
      matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => this.apply());
      new MutationObserver(() => this.apply()).observe(root, { attributes: true, attributeFilter: ['data-hatch-color-scheme', 'data-hatch-accent'] });
      // Muse host pushes {type:"hatch:space:theme", version:1, colorScheme, accentColor}
      addEventListener('message', (e) => {
        const d = e.data;
        if (!d || d.type !== 'hatch:space:theme' || d.version !== 1) return;
        if (d.colorScheme) root.setAttribute('data-hatch-color-scheme', d.colorScheme);
        if (d.accentColor) root.setAttribute('data-hatch-accent', d.accentColor);
      });
    },
  };

  /* ---------- Horizontal swipe (month/year paging) ---------- */
  function swipe(el, { onPrev, onNext, canPrev = () => true, canNext = () => true, follow, threshold = 56, edge = 24 } = {}) {
    el.style.touchAction = 'pan-y';
    let st = null;
    const target = () => (typeof follow === 'function' ? follow() : follow) || el;
    const reset = (t) => { t.style.transition = 'transform .32s cubic-bezier(.2,.9,.25,1), opacity .32s'; t.style.transform = ''; t.style.opacity = ''; };
    el.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' || e.button !== 0) return;
      if (e.clientX < edge || e.clientX > innerWidth - edge) return; // leave the edges to the Muse app
      if (e.target.closest('input,textarea,select,[data-noswipe]')) return;
      st = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId, lock: null, dx: 0 };
    });
    el.addEventListener('pointermove', (e) => {
      if (!st || e.pointerId !== st.id) return;
      const dx = e.clientX - st.x, dy = e.clientY - st.y;
      if (!st.lock) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        st.lock = Math.abs(dx) > Math.abs(dy) * 1.15 ? 'x' : 'y';
        if (st.lock === 'x') { try { el.setPointerCapture(e.pointerId); } catch (_) {} target().style.transition = 'none'; }
      }
      if (st.lock !== 'x') return;
      const can = dx > 0 ? canPrev() : canNext();
      st.dx = can ? dx : dx * 0.28; // rubber-band when there's nowhere to go
      const t = target();
      t.style.transform = `translate3d(${st.dx}px,0,0)`;
      t.style.opacity = String(1 - Math.min(0.35, Math.abs(st.dx) / 900));
    });
    const end = (e) => {
      if (!st || e.pointerId !== st.id) return;
      const s0 = st; st = null;
      if (s0.lock !== 'x') return;
      const t = target();
      const v = s0.dx / Math.max(1, performance.now() - s0.t);
      const go = (Math.abs(s0.dx) > threshold || Math.abs(v) > 0.45) && (s0.dx > 0 ? canPrev() : canNext());
      if (!go) return reset(t);
      haptic();
      const dir = s0.dx > 0 ? 1 : -1;
      if (F.reducedMotion()) { t.style.transform = ''; t.style.opacity = ''; return dir > 0 ? onPrev() : onNext(); }
      t.style.transition = 'transform .16s ease-in, opacity .16s';
      t.style.transform = `translate3d(${dir * 46}%,0,0)`; t.style.opacity = '0';
      setTimeout(() => {
        dir > 0 ? onPrev() : onNext();
        const t2 = target();
        t2.style.transition = 'none'; t2.style.transform = `translate3d(${-dir * 26}%,0,0)`; t2.style.opacity = '0';
        requestAnimationFrame(() => requestAnimationFrame(() => reset(t2)));
      }, 150);
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', (e) => { if (st && e.pointerId === st.id) { reset(target()); st = null; } });
  }

  /* ---------- Swipe-to-reveal rows: drag a row left to show its actions (one open at a time) ---------- */
  let openRow = null;
  document.addEventListener('pointerdown', (e) => { if (openRow && !openRow.wrap.contains(e.target)) openRow.close(); }, true);
  function swipeRow(main, actions, { edge = 24 } = {}) {
    const acts = h('div.cf-sr-acts', { 'aria-hidden': 'true' }, actions.map((a) => h('button.cf-sr-act', { type: 'button', tabindex: '-1', class: a.cls || '', onclick: (e) => { e.stopPropagation(); close(false); a.fn(); } }, a.label)));
    const wrap = h('div.cf-sr', acts, main);
    main.classList.add('cf-sr-main');
    main.style.touchAction = 'pan-y';
    let st = null, x = 0, W = 0, mute = 0;
    const set = (v, anim) => { x = v; main.style.transition = anim ? 'transform .38s var(--cf-ease)' : 'none'; main.style.transform = v ? `translate3d(${v}px,0,0)` : ''; wrap.classList.toggle('is-open', v < -1); };
    const api = { wrap, close: () => close() };
    function open() { if (openRow && openRow !== api) openRow.close(); set(-W, !F.reducedMotion()); openRow = api; haptic(6); }
    function close(anim = true) { set(0, anim && !F.reducedMotion()); if (openRow === api) openRow = null; }
    main.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' || e.button !== 0) return;
      if (e.clientX < edge || e.clientX > innerWidth - edge) return; // the Muse app's back gesture lives at the edges
      W = acts.offsetWidth;
      const t = performance.now();
      st = { x0: e.clientX, y0: e.clientY, base: x, id: e.pointerId, lock: null, lx: e.clientX, lt: t, v: 0 };
    });
    main.addEventListener('pointermove', (e) => {
      if (!st || e.pointerId !== st.id) return;
      const dx = e.clientX - st.x0, dy = e.clientY - st.y0;
      if (!st.lock) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        st.lock = Math.abs(dx) > Math.abs(dy) * 1.2 ? 'x' : 'y';
        if (st.lock === 'x') { try { main.setPointerCapture(e.pointerId); } catch (_) {} }
      }
      if (st.lock !== 'x') return;
      let v = st.base + dx;
      if (v > 0) v *= 0.2; else if (v < -W) v = -W + (v + W) * 0.25; // rubber-band past either end
      const t = performance.now(); st.v = (e.clientX - st.lx) / Math.max(1, t - st.lt); st.lx = e.clientX; st.lt = t;
      set(v, false);
    });
    const end = (e) => {
      if (!st || e.pointerId !== st.id) return;
      const s0 = st; st = null;
      if (s0.lock !== 'x') return;
      mute = performance.now() + 400; // the click that follows a drag isn't a tap
      (s0.v < -0.3 || (s0.v <= 0.3 && x < -W / 2)) ? open() : close();
    };
    main.addEventListener('pointerup', end);
    main.addEventListener('pointercancel', end);
    main.addEventListener('click', (e) => { if (performance.now() < mute || x < -1) { e.preventDefault(); e.stopImmediatePropagation(); if (x < -1) close(); } }, true);
    return wrap;
  }

  /* ---------- Pull to refresh (only when this document is the scroller, never fights the host page) ---------- */
  function pull({ onRefresh, label = 'Pull to sync', busyLabel = 'Syncing…' } = {}) {
    const ind = h('div.cf-pull', { 'aria-hidden': 'true' }, h('span.cf-pull-ring'), h('span.cf-pull-t', label));
    document.body.append(ind);
    let y0 = null, d = 0, busy = false;
    const scroller = document.scrollingElement || document.documentElement;
    const canPull = () => !busy && scroller.scrollTop <= 0 && scroller.scrollHeight > innerHeight + 4 && !document.querySelector('.cf-sheet-root');
    const show = (px) => { ind.style.transform = `translate3d(-50%, ${Math.min(px, 90) - 56}px, 0)`; ind.style.opacity = String(Math.min(1, px / 50)); ind.classList.toggle('is-armed', px > 64); ind.style.setProperty('--p', String(Math.min(1, px / 64))); };
    addEventListener('touchstart', (e) => { y0 = e.touches.length === 1 && canPull() ? e.touches[0].clientY : null; d = 0; }, { passive: true });
    addEventListener('touchmove', (e) => {
      if (y0 == null) return;
      const dy = e.touches[0].clientY - y0;
      if (dy <= 0 || scroller.scrollTop > 0) { if (d) show(0); y0 = dy <= 0 ? y0 : null; d = 0; return; }
      e.preventDefault();
      d = dy * 0.5; ind.style.transition = 'none'; show(d);
    }, { passive: false });
    addEventListener('touchend', async () => {
      if (y0 == null) return; y0 = null;
      ind.style.transition = '';
      if (d > 64 && onRefresh) {
        busy = true; haptic(10); ind.classList.add('is-busy'); ind.querySelector('.cf-pull-t').textContent = busyLabel; show(70);
        try { await onRefresh(); } finally { busy = false; ind.classList.remove('is-busy'); ind.querySelector('.cf-pull-t').textContent = label; show(0); }
      } else show(0);
      d = 0;
    });
    show(0);
  }

  /* ---------- Sheets: bottom sheet on phones, drawer/modal on laptops ---------- */
  let openSheets = 0;
  function sheet({ title, sub, body, footer, onClose, desktop = 'drawer', cls = '' } = {}) {
    const prevFocus = document.activeElement;
    const scrim = h('div.cf-scrim');
    const closeBtn = h('button.cf-sheet-x', { type: 'button', 'aria-label': 'Close' }, '×');
    const head = h('header.cf-sheet-head', h('div.cf-sheet-titles', h('h2.cf-sheet-title', title || ''), sub ? h('p.cf-sheet-sub', sub) : null), closeBtn);
    const bodyEl = h('div.cf-sheet-body', body);
    const panel = h('section.cf-sheet', { role: 'dialog', 'aria-modal': 'true', 'aria-label': title || 'Details', class: `${cls} ${isPhone() ? 'is-bottom' : 'is-' + desktop}`, tabindex: '-1' },
      h('div.cf-grab', { 'aria-hidden': 'true' }), head, bodyEl, footer ? h('footer.cf-sheet-foot', footer) : null);
    const wrap = h('div.cf-sheet-root', scrim, panel);
    document.body.append(wrap);
    openSheets++; root.classList.add('cf-locked');
    requestAnimationFrame(() => requestAnimationFrame(() => wrap.classList.add('is-open')));
    setTimeout(() => { const f = panel.querySelector('input:not([type=hidden]),select,textarea,button:not(.cf-sheet-x)'); (f && !isPhone() ? f : panel).focus({ preventScroll: true }); }, 60);
    let closed = false;
    function close() {
      if (closed) return; closed = true;
      wrap.classList.remove('is-open'); wrap.classList.add('is-closing');
      setTimeout(() => { wrap.remove(); if (--openSheets <= 0) { openSheets = 0; root.classList.remove('cf-locked'); } prevFocus && prevFocus.focus && prevFocus.focus({ preventScroll: true }); }, F.reducedMotion() ? 0 : 280);
      onClose && onClose();
    }
    scrim.addEventListener('click', close);
    closeBtn.addEventListener('click', close);
    panel.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
    // drag to dismiss (bottom sheet): from the grab/header anywhere, or from the body when it's scrolled to the top
    if (panel.classList.contains('is-bottom')) {
      let d = null;
      panel.addEventListener('pointerdown', (e) => {
        if (e.target.closest('input,textarea,select,button,a,[data-nodrag]')) return;
        const inBody = e.target.closest('.cf-sheet-body');
        if (inBody && bodyEl.scrollTop > 0) return;
        d = { y: e.clientY, t: performance.now(), id: e.pointerId, dy: 0, active: false };
      });
      panel.addEventListener('pointermove', (e) => {
        if (!d || e.pointerId !== d.id) return;
        const dy = e.clientY - d.y;
        if (!d.active) { if (dy > 6) { d.active = true; try { panel.setPointerCapture(e.pointerId); } catch (_) {} panel.style.transition = 'none'; } else if (dy < -4) { d = null; return; } else return; }
        d.dy = Math.max(0, dy); panel.style.transform = `translate3d(0,${d.dy}px,0)`; scrim.style.opacity = String(1 - Math.min(1, d.dy / 400));
      });
      const up = (e) => {
        if (!d || e.pointerId !== d.id) return;
        const v = d.dy / Math.max(1, performance.now() - d.t), was = d.active; d = null;
        panel.style.transition = ''; scrim.style.opacity = '';
        if (was && (v > 0.5 || panel.getBoundingClientRect().height * 0.28 < parseFloat(panel.style.transform.split(',')[1] || 0))) { haptic(); close(); }
        panel.style.transform = '';
      };
      panel.addEventListener('pointerup', up); panel.addEventListener('pointercancel', up);
    }
    return { el: panel, body: bodyEl, close, setBody(n) { bodyEl.replaceChildren(n); } };
  }

  /* ---------- Toast ---------- */
  let toastEl, toastT;
  function toast(msg, { action, ms = 2600 } = {}) {
    if (!toastEl) { toastEl = h('div.cf-toast', { role: 'status', 'aria-live': 'polite' }); document.body.append(toastEl); }
    toastEl.replaceChildren(...[h('span', msg), action ? h('button', { type: 'button', onclick: () => { action.fn(); toastEl.classList.remove('is-on'); } }, action.label) : null].filter(Boolean));
    toastEl.classList.add('is-on');
    clearTimeout(toastT); toastT = setTimeout(() => toastEl.classList.remove('is-on'), ms);
  }

  /* ---------- Numbers that tick to their new value ---------- */
  function countTo(el, cents, fmt = (v) => F.money(v)) {
    const from = el.dataset.v != null ? +el.dataset.v : cents;
    el.dataset.v = cents;
    if (from === cents || F.reducedMotion()) { el.textContent = fmt(cents); return; }
    const t0 = performance.now(), dur = 520;
    const step = (t) => { const p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3); el.textContent = fmt(Math.round(from + (cents - from) * e)); if (p < 1 && el.dataset.v == cents) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  }

  /* ---------- Period model (month ↔ year) with bounds from the data ---------- */
  function period({ onChange } = {}) {
    const p = {
      mode: 'month', key: CF.data.now,
      get year() { return +this.key.slice(0, 4); },
      bounds() { const r = CF.data.range(); return this.mode === 'month' ? r : { first: r.first.slice(0, 4), last: r.last.slice(0, 4) }; },
      canPrev() { const b = this.bounds(); return this.key > b.first; },
      canNext() { const b = this.bounds(); return this.key < b.last; },
      step(n) { if (n < 0 && !this.canPrev()) return; if (n > 0 && !this.canNext()) return; this.key = this.mode === 'month' ? F.addMonths(this.key, n) : String(+this.key + n); onChange && onChange(this); },
      prev() { this.step(-1); }, next() { this.step(1); },
      setMode(m) { if (m === this.mode) return; this.key = m === 'year' ? this.key.slice(0, 4) : (this.key === CF.data.now.slice(0, 4) ? CF.data.now : `${this.key}-12`); this.mode = m; onChange && onChange(this); },
      goto(mode, key) { this.mode = mode; this.key = key; onChange && onChange(this); },
      view() { return this.mode === 'month' ? CF.data.month(this.key) : CF.data.year(+this.key); },
      prevView() { return this.mode === 'month' ? CF.data.month(F.addMonths(this.key, -1)) : CF.data.yearPrev(+this.key); },
      label({ long = false } = {}) { return this.mode === 'month' ? F.monthLabel(this.key, { long }) : (this.key === CF.data.now.slice(0, 4) ? `${this.key} so far` : this.key); },
      compareLabel() { return this.mode === 'month' ? `vs ${F.monthLabel(F.addMonths(this.key, -1), { year: false })}` : (this.key === CF.data.now.slice(0, 4) ? `vs same months ${+this.key - 1}` : `vs ${+this.key - 1}`); },
    };
    return p;
  }

  /** ←/→ step periods on laptops (ignored while typing or when a sheet is open). */
  function keys({ left, right }) {
    addEventListener('keydown', (e) => {
      if (e.target.closest && e.target.closest('input,textarea,select,[contenteditable]')) return;
      if (document.querySelector('.cf-sheet-root')) return;
      if (e.key === 'ArrowLeft') left && left(); else if (e.key === 'ArrowRight') right && right();
    });
  }

  /** "Prototype" ribbon controls shared by all drafts: sample history + theme switch. */
  function devbar({ onSample } = {}) {
    const sampleBtn = h('button.cf-dev-btn', { type: 'button', 'aria-pressed': String(CF.data.sample()) }, 'Sample history');
    sampleBtn.addEventListener('click', () => { CF.data.setSample(!CF.data.sample()); sampleBtn.setAttribute('aria-pressed', String(CF.data.sample())); onSample && onSample(CF.data.sample()); toast(CF.data.sample() ? 'Showing sample history before Oct 2026' : 'Showing only your real Muse data'); });
    const themeBtn = h('button.cf-dev-btn', { type: 'button', 'aria-label': 'Switch light or dark' }, '◐');
    themeBtn.addEventListener('click', () => theme.toggle());
    return h('div.cf-devbar', { role: 'group', 'aria-label': 'Prototype controls' }, h('span.cf-dev-tag', 'Draft'), sampleBtn, themeBtn);
  }

  // Prototype-only: emulate Muse's frame chrome (?hh=52&bp=0) so the picker can test inset handling.
  const qp = new URLSearchParams(location.search);
  if (qp.has('hh')) root.style.setProperty('--header-height', `${+qp.get('hh') || 0}px`);
  if (qp.has('bp')) root.style.setProperty('--bottom-padding', `${+qp.get('bp') || 0}px`);

  theme.init();
  CF.ui = { isPhone, haptic, theme, swipe, swipeRow, pull, sheet, toast, countTo, period, keys, devbar, ACCENTS };
})();
