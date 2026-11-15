/* Shared formatting + date helpers. Classic script (no modules) so every design
   can be inlined into ONE self-contained HTML file, the same shape a Muse space ships as.
   All money in the data layer is integer cents, exactly like the Muse actions. */
(function () {
  const CF = (window.CF = window.CF || {});

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const nf0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
  const nf2 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  /** money(12345) → "$123"; {cents:true} → "$123.45"; {compact:true} → "$1.2k"; {sign:true} → "+$123" */
  function money(c, { cents = false, sign = false, compact = false } = {}) {
    if (c == null || Number.isNaN(c)) return '—';
    const v = c / 100;
    const neg = v < -0.004;
    const a = Math.abs(v);
    let s;
    if (compact && a >= 1000) {
      const k = a / 1000;
      s = (k >= 100 ? Math.round(k) : k.toFixed(1).replace(/\.0$/, '')) + 'k';
    } else s = cents ? nf2.format(a) : nf0.format(Math.round(a));
    return (neg ? '−' : sign && v > 0.004 ? '+' : '') + '$' + s;
  }
  /** Split for big display numbers: {sign, whole, dec} */
  function moneyParts(c) {
    const a = Math.abs(c || 0);
    return { sign: c < 0 ? '−' : '', whole: nf0.format(Math.floor(a / 100)), dec: String(a % 100).padStart(2, '0') };
  }
  function pct(v, { sign = false, digits = 0 } = {}) {
    if (v == null || !Number.isFinite(v)) return '—';
    const s = Math.abs(v * 100).toFixed(digits);
    return (v < 0 ? '−' : sign && v > 0 ? '+' : '') + s + '%';
  }
  /** Relative change, null when there's no meaningful base (avoids "+∞%"). */
  function change(cur, prev) {
    if (prev == null || cur == null || Math.abs(prev) < 100) return null;
    return (cur - prev) / Math.abs(prev);
  }

  const pad2 = (n) => String(n).padStart(2, '0');
  const monthKey = (y, m0) => `${y}-${pad2(m0 + 1)}`;
  const parseMonth = (k) => { const [y, m] = k.split('-').map(Number); return { y, m: m - 1 }; };
  function addMonths(k, n) {
    const { y, m } = parseMonth(k);
    const t = y * 12 + m + n;
    return monthKey(Math.floor(t / 12), ((t % 12) + 12) % 12);
  }
  const monthDiff = (a, b) => { const A = parseMonth(a), B = parseMonth(b); return (B.y - A.y) * 12 + (B.m - A.m); };
  const parseYmd = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d, 12); };
  const ymd = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const daysIn = (k) => { const { y, m } = parseMonth(k); return new Date(y, m + 1, 0).getDate(); };
  function monthLabel(k, { long = false, year = true, short = false } = {}) {
    const { y, m } = parseMonth(k);
    return `${(long ? MONTHS_LONG : MONTHS)[m]}${year ? (short ? " '" + String(y).slice(2) : ' ' + y) : ''}`;
  }
  function dayLabel(s, { long = false } = {}) {
    const d = parseYmd(s);
    return long ? `${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d.getDay()]} ${d.getDate()} ${MONTHS_LONG[d.getMonth()]}` : `${DOW[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
  }
  const shortDate = (s) => { const d = parseYmd(s); return `${d.getDate()} ${MONTHS[d.getMonth()]}`; };
  const toMin = (t) => { if (!t) return null; const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  function fmtTime(t) {
    if (!t) return '';
    const [h, m] = t.split(':').map(Number);
    return `${h % 12 || 12}${m ? ':' + pad2(m) : ''}${h >= 12 ? 'pm' : 'am'}`;
  }
  /** 150 → "2.5h", 45 → "45m" */
  function hours(min, { short = false } = {}) {
    if (!min) return '0h';
    if (min < 60 && short) return `${min}m`;
    const h = min / 60;
    return `${Number.isInteger(h) ? h : parseFloat(h.toFixed(2))}h`;
  }
  function ago(iso, now = Date.now()) {
    if (!iso) return 'never';
    const s = Math.max(0, (now - new Date(iso).getTime()) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.round(s / 60)}m ago`;
    if (s < 86400) return `${Math.round(s / 3600)}h ago`;
    return `${Math.round(s / 86400)}d ago`;
  }
  const sum = (a, f = (x) => x) => a.reduce((t, x) => t + (f(x) || 0), 0);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const uid = (p = 'id') => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

  /** Tiny DOM builder: h('div.card#id', {onclick, style:{}, 'aria-label':''}, children...) */
  function h(sel, props, ...kids) {
    const m = sel.match(/^([a-z0-9-]+)?((?:[.#][\w-]+)*)$/i);
    const el = document.createElement((m && m[1]) || 'div');
    if (m && m[2]) for (const p of m[2].match(/[.#][\w-]+/g)) p[0] === '.' ? el.classList.add(p.slice(1)) : (el.id = p.slice(1));
    if (props != null && (typeof props !== 'object' || props instanceof Node || Array.isArray(props))) { kids.unshift(props); props = null; }
    for (const k in props || {}) {
      const v = props[k];
      if (v == null || v === false) continue;
      if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'class') el.className += ' ' + v;
      else if (k in el && k !== 'list' && k !== 'form') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    const add = (c) => { if (c == null || c === false) return; if (Array.isArray(c)) c.forEach(add); else el.append(c instanceof Node ? c : document.createTextNode(String(c))); };
    kids.forEach(add);
    return el;
  }

  CF.fmt = { MONTHS, MONTHS_LONG, DOW, money, moneyParts, pct, change, pad2, monthKey, parseMonth, addMonths, monthDiff, parseYmd, ymd, daysIn, monthLabel, dayLabel, shortDate, toMin, fmtTime, hours, ago, sum, clamp, uid, esc, reducedMotion };
  CF.h = h;
})();
