/* Shared SVG charts. No dependencies, no external assets (Muse spaces can't load CDNs).
   Every chart takes colours as CSS strings (e.g. 'var(--s-gig)') so each design keeps its own palette,
   re-renders on resize, and respects prefers-reduced-motion. */
(function () {
  const CF = window.CF, F = CF.fmt;
  const NS = 'http://www.w3.org/2000/svg';
  function s(tag, attrs, ...kids) {
    const el = document.createElementNS(NS, tag);
    for (const k in attrs || {}) if (attrs[k] != null && attrs[k] !== false) el.setAttribute(k, attrs[k]);
    kids.flat().forEach((c) => c != null && el.append(c instanceof Node ? c : document.createTextNode(String(c))));
    return el;
  }
  /** Attach a renderer to an element; re-run on width change. Returns {update(opts), destroy()} */
  function responsive(el, render, opts) {
    let last = 0, cur = opts, first = true;
    const run = () => { const w = Math.round(el.clientWidth); if (!w) return; last = w; el.replaceChildren(render(w, cur, first)); first = false; };
    const ro = new ResizeObserver(() => { if (Math.round(el.clientWidth) !== last) run(); });
    ro.observe(el); run();
    return { update(o) { cur = { ...cur, ...o }; run(); }, destroy() { ro.disconnect(); }, el };
  }
  const anim = (first) => first && !F.reducedMotion();

  /* ---------------- Sankey: sources → centre → outflows ---------------- */
  function sankey(el, opts) { return responsive(el, sankeySvg, opts); }
  function sankeySvg(W, o, first) {
    const fmt = o.fmt || ((v) => F.money(v));
    const compact = W < 560;
    const nodeW = o.nodeW || (compact ? 8 : 12);
    let src = o.sources.filter((n) => n.value > 0).map((n) => ({ ...n, side: 'L' }));
    let out = o.outflows.filter((n) => n.value > 0).map((n) => ({ ...n, side: 'R' }));
    const sumL = F.sum(src, (n) => n.value), sumR = F.sum(out, (n) => n.value);
    if (o.pending) out = [{ id: 'pending', label: o.pendingLabel || 'Expenses syncing…', value: Math.max(sumL, 1), kind: 'pending', side: 'R' }];
    else if (sumR > sumL) src.push({ id: 'from-savings', label: o.deficitLabel || 'From savings', value: sumR - sumL, kind: 'deficit', side: 'L', sub: 'covers the gap' });
    else if (sumL > sumR) out.push({ id: 'kept', label: o.surplusLabel || 'Kept', value: sumL - sumR, kind: 'save', side: 'R' });
    const T = Math.max(F.sum(src, (n) => n.value), F.sum(out, (n) => n.value), 1);
    const nMax = Math.max(src.length, out.length, 1);
    const minGap = compact ? 30 : 36;
    const gap = compact ? 8 : 12;
    const top0 = compact ? 46 : 56; // room for the centre label
    const H = Math.max(o.height || (compact ? 230 : 300), nMax * minGap + 8);
    const labelL = o.labelL || (compact ? Math.min(98, W * 0.27) : 170);
    const labelR = o.labelR || (compact ? Math.min(112, W * 0.31) : 190);
    const xL = labelL, xC = W / 2 - nodeW / 2, xR = W - labelR - nodeW;
    const fill = o.fill || 1; // < 1 draws thinner ribbons and spreads the nodes over the height
    const k = ((H - gap * (nMax - 1)) * fill) / T;
    const maxGap = o.maxGap || (compact ? 22 : 30);
    // thin ribbons leave the centre bar short: pull everything up so the centre label isn't floating in empty space
    const top = fill < 1 ? Math.max(18, top0 - (H - T * k) / 2) : top0;
    const place = (nodes) => {
      nodes.forEach((n) => { n.h = Math.max(1.5, n.value * k); });
      const sumH = F.sum(nodes, (n) => n.h);
      const g = fill < 1 && nodes.length > 1 ? Math.min(maxGap, Math.max(gap, (H - sumH) / (nodes.length - 1))) : gap;
      let y = top + (H - sumH - g * (nodes.length - 1)) / 2;
      nodes.forEach((n) => { n.y = y; y += n.h + g; });
    };
    place(src); place(out);
    const cH = T * k, cY = top + (H - cH) / 2;
    const color = (n) => n.color || (n.kind === 'deficit' ? 'var(--sk-deficit, #c56b5a)' : n.kind === 'save' ? 'var(--sk-save, #4e9a51)' : n.kind === 'pending' ? 'var(--dim, #888)' : 'var(--accent, #4b7bec)');
    const svg = s('svg', { class: 'cf-sk' + (anim(first) ? ' cf-enter' : ''), viewBox: `0 0 ${W} ${H + top + 8}`, width: W, height: H + top + 8, role: 'img', 'aria-label': o.ariaLabel || 'Money flow: income sources into total income, then out to spending, investments and savings' });
    const defs = s('defs');
    svg.append(defs);
    const flows = s('g', { class: 'cf-sk-flows' });
    const nodesG = s('g', { class: 'cf-sk-nodes' });
    const labels = s('g', { class: 'cf-sk-labels' });
    svg.append(flows, nodesG, labels);
    const ribbon = (x0, y0, x1, y1, h) => { const m = (x1 - x0) / 2; return `M${x0} ${y0}C${x0 + m} ${y0},${x1 - m} ${y1},${x1} ${y1}L${x1} ${y1 + h}C${x1 - m} ${y1 + h},${x0 + m} ${y0 + h},${x0} ${y0 + h}Z`; };
    let off = cY, i = 0;
    for (const n of src) {
      const gid = `g${Math.random().toString(36).slice(2, 8)}`;
      defs.append(s('linearGradient', { id: gid, x1: 0, x2: 1 }, s('stop', { offset: 0, 'stop-color': color(n), 'stop-opacity': n.kind === 'deficit' ? 0.3 : 0.42 }), s('stop', { offset: 1, 'stop-color': color(n), 'stop-opacity': 0.16 })));
      flows.append(s('path', { class: 'cf-sk-flow' + (n.kind === 'deficit' ? ' is-deficit' : ''), 'data-id': n.id, d: ribbon(xL + nodeW, n.y, xC, off, n.h), fill: `url(#${gid})`, style: `--i:${i++}` }));
      off += n.h;
    }
    off = cY;
    for (const n of out) {
      const gid = `g${Math.random().toString(36).slice(2, 8)}`;
      defs.append(s('linearGradient', { id: gid, x1: 0, x2: 1 }, s('stop', { offset: 0, 'stop-color': color(n), 'stop-opacity': 0.14 }), s('stop', { offset: 1, 'stop-color': color(n), 'stop-opacity': n.kind === 'pending' ? 0.12 : 0.42 })));
      flows.append(s('path', { class: 'cf-sk-flow' + (n.kind === 'pending' ? ' is-pending' : ''), 'data-id': n.id, d: ribbon(xC + nodeW, off, xR, n.y, n.h), fill: `url(#${gid})`, style: `--i:${i++}` }));
      off += n.h;
    }
    const allNodes = [...src, ...out];
    for (const n of allNodes) nodesG.append(s('rect', { class: 'cf-sk-node' + (n.kind ? ' is-' + n.kind : ''), 'data-id': n.id, x: n.side === 'L' ? xL : xR, y: n.y, width: nodeW, height: n.h, rx: Math.min(3, nodeW / 3), fill: color(n) }));
    nodesG.append(s('rect', { class: 'cf-sk-node is-center', x: xC, y: cY, width: nodeW, height: cH, rx: Math.min(3, nodeW / 3), fill: o.centerColor || 'var(--text)' }));
    // labels with collision relaxation
    const relax = (nodes) => {
      const ys = nodes.map((n) => n.y + n.h / 2);
      for (let j = 1; j < ys.length; j++) if (ys[j] - ys[j - 1] < minGap) ys[j] = ys[j - 1] + minGap;
      const over = ys.length ? ys[ys.length - 1] - (top + H - 10) : 0;
      if (over > 0) { ys[ys.length - 1] -= over; for (let j = ys.length - 2; j >= 0; j--) if (ys[j + 1] - ys[j] < minGap) ys[j] = ys[j + 1] - minGap; }
      nodes.forEach((n, j) => (n.ly = ys[j]));
    };
    relax(src); relax(out);
    const trunc = (t, max) => (t.length > max ? t.slice(0, max - 1) + '…' : t);
    for (const n of allNodes) {
      const L = n.side === 'L';
      const x = L ? xL - 8 : xR + nodeW + 8;
      const anchor = L ? 'end' : 'start';
      const g = s('g', { class: 'cf-sk-label' + (n.kind ? ' is-' + n.kind : ''), 'data-id': n.id });
      const maxChars = Math.floor((L ? labelL : labelR) / (compact ? 6.4 : 7.2));
      g.append(s('text', { x, y: n.ly - 3, 'text-anchor': anchor, class: 'cf-sk-name' }, trunc(n.short && compact ? n.short : n.label, maxChars)));
      const val = s('text', { x, y: n.ly + 12, 'text-anchor': anchor, class: 'cf-sk-val' }, fmt(n.value));
      if (n.delta != null && !compact) val.append(s('tspan', { class: 'cf-sk-delta ' + (n.delta >= 0 ? 'up' : 'down'), dx: 5 }, F.pct(n.delta, { sign: true })));
      else if (n.sub && !compact) val.append(s('tspan', { class: 'cf-sk-sub', dx: 5 }, n.sub));
      g.append(val);
      if (Math.abs(n.ly - (n.y + n.h / 2)) > 4) {
        const ex = L ? xL - 2 : xR + nodeW + 2, lx = L ? xL - 6 : xR + nodeW + 6;
        g.append(s('path', { class: 'cf-sk-leader', d: `M${ex} ${n.y + n.h / 2}L${lx} ${n.ly}`, fill: 'none' }));
      }
      labels.append(g);
    }
    const c = o.center || {};
    labels.append(s('text', { x: xC + nodeW / 2, y: cY - (compact ? 24 : 30), 'text-anchor': 'middle', class: 'cf-sk-cname' }, c.label || 'Income'));
    labels.append(s('text', { x: xC + nodeW / 2, y: cY - 8, 'text-anchor': 'middle', class: 'cf-sk-cval' }, c.value != null ? fmt(c.value) : fmt(sumL)));
    // interaction: highlight a node's flows; tap to select (and again to clear)
    let sel = o.selected || null;
    const apply = (id) => {
      svg.classList.toggle('has-sel', !!id);
      svg.querySelectorAll('[data-id]').forEach((e) => e.classList.toggle('on', e.getAttribute('data-id') === id));
    };
    if (sel) apply(sel);
    svg.addEventListener('pointerover', (e) => { if (e.pointerType !== 'mouse') return; const t = e.target.closest('[data-id]'); apply(t ? t.getAttribute('data-id') : sel); });
    svg.addEventListener('pointerleave', () => apply(sel));
    svg.addEventListener('click', (e) => {
      const t = e.target.closest('[data-id]');
      const id = t ? t.getAttribute('data-id') : null;
      sel = id && id !== sel ? id : null; apply(sel);
      o.onSelect && o.onSelect(sel ? allNodes.find((n) => n.id === sel) : null);
    });
    return svg;
  }

  /* ---------------- Diverging month bars: income stacked up, spending down ---------------- */
  function bars(el, opts) { return responsive(el, barsSvg, opts); }
  function barsSvg(W, o, first) {
    const items = o.items, n = items.length, H = o.height || 180, labH = 22;
    const ups = items.map((it) => F.sum(it.stacks, (x) => x.value));
    const maxUp = Math.max(1, ...ups), maxDown = Math.max(1, ...items.map((it) => it.down || 0));
    const share = o.upOnly ? 1 : F.clamp(maxUp / (maxUp + maxDown), 0.5, 0.78);
    const base = (H - labH) * share;
    const kUp = (base - (o.valueLabel ? 22 : 8)) / maxUp, kDn = (H - labH - base - 6) / maxDown;
    const slot = W / n, bw = Math.min(o.barW || 26, slot * 0.58);
    const svg = s('svg', { class: 'cf-bars' + (anim(first) ? ' cf-enter' : ''), viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img', 'aria-label': o.ariaLabel || 'Income and spending by month' });
    svg.append(s('line', { class: 'cf-base', x1: 0, x2: W, y1: base, y2: base }));
    items.forEach((it, i) => {
      const cx = slot * i + slot / 2, x = cx - bw / 2;
      const g = s('g', { class: 'cf-bar' + (it.key === o.selected ? ' is-sel' : '') + (it.sample ? ' is-sample' : '') + (it.future ? ' is-future' : ''), 'data-key': it.key, style: `--i:${i}` });
      g.append(s('rect', { class: 'cf-hit', x: slot * i, y: 0, width: slot, height: H, fill: 'transparent' }));
      let y = base;
      const segs = it.stacks.filter((x) => x.value > 0);
      const upG = s('g', { class: 'cf-up' });
      segs.forEach((seg, j) => {
        const hh = seg.value * kUp; y -= hh;
        const last = j === segs.length - 1, r = Math.min(4, bw / 3, hh);
        upG.append(s('path', { fill: seg.color, d: last ? `M${x} ${y + hh}V${y + r}Q${x} ${y} ${x + r} ${y}H${x + bw - r}Q${x + bw} ${y} ${x + bw} ${y + r}V${y + hh}Z` : `M${x} ${y}h${bw}v${hh}h${-bw}Z` }));
      });
      g.append(upG);
      if (it.down) {
        const hh = it.down * kDn, r = Math.min(4, bw / 3, hh);
        g.append(s('g', { class: 'cf-down' }, s('path', { fill: o.downColor || 'var(--neg)', d: `M${x} ${base + 1}H${x + bw}V${base + 1 + hh - r}Q${x + bw} ${base + 1 + hh} ${x + bw - r} ${base + 1 + hh}H${x + r}Q${x} ${base + 1 + hh} ${x} ${base + 1 + hh - r}Z` })));
      }
      if (it.net != null && o.showNet !== false) {
        const ny = it.net >= 0 ? base - it.net * kUp : base + Math.min(-it.net * kDn, H - labH - base);
        g.append(s('circle', { class: 'cf-net' + (it.net < 0 ? ' neg' : ''), cx, cy: ny, r: Math.max(2.5, Math.min(4, bw / 5)) }));
      }
      if (o.valueLabel && it.key === o.selected && ups[i] > 0) g.append(s('text', { class: 'cf-bval', x: cx, y: base - ups[i] * kUp - 7, 'text-anchor': 'middle' }, F.money(ups[i], { compact: true })));
      const lab = slot < 30 ? it.label.slice(0, 1) : it.label;
      g.append(s('text', { class: 'cf-blab', x: cx, y: H - 6, 'text-anchor': 'middle' }, lab));
      g.append(s('title', {}, `${it.title || it.label}: in ${F.money(ups[i])}, out ${F.money(it.down || 0)}`));
      svg.append(g);
    });
    svg.addEventListener('click', (e) => { const g = e.target.closest('.cf-bar'); if (g && o.onSelect) o.onSelect(g.getAttribute('data-key')); });
    return svg;
  }

  /* ---------------- Year-on-year cumulative lines ---------------- */
  function yoy(el, opts) { return responsive(el, yoySvg, opts); }
  function yoySvg(W, o, first) {
    const H = o.height || 170, padT = 14, padB = 22, padR = o.endLabels === false ? 6 : 64;
    const vals = [...o.cur, ...o.prev].filter((v) => v != null);
    const max = Math.max(1, ...vals) * 1.08;
    const X = (i) => 4 + (i / 11) * (W - padR - 8);
    const Y = (v) => padT + (1 - v / max) * (H - padT - padB);
    const path = (arr) => arr.map((v, i) => (v == null ? '' : `${i === 0 || arr[i - 1] == null ? 'M' : 'L'}${X(i).toFixed(1)} ${Y(v).toFixed(1)}`)).join('');
    const svg = s('svg', { class: 'cf-yoy' + (anim(first) ? ' cf-enter' : ''), viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img', 'aria-label': o.ariaLabel || 'Cumulative income this year versus last year' });
    const gid = `y${Math.random().toString(36).slice(2, 8)}`;
    svg.append(s('defs', {}, s('linearGradient', { id: gid, x1: 0, x2: 0, y1: 0, y2: 1 }, s('stop', { offset: 0, 'stop-color': o.color || 'var(--accent)', 'stop-opacity': 0.22 }), s('stop', { offset: 1, 'stop-color': o.color || 'var(--accent)', 'stop-opacity': 0 }))));
    [0.5, 1].forEach((f) => svg.append(s('line', { class: 'cf-grid', x1: 0, x2: W - padR + 4, y1: Y(max / 1.08 * f), y2: Y(max / 1.08 * f) })));
    const lastCur = o.cur.reduce((a, v, i) => (v != null ? i : a), -1);
    if (lastCur >= 0) svg.append(s('path', { class: 'cf-yoy-area', d: path(o.cur) + `L${X(lastCur)} ${Y(0)}L${X(0)} ${Y(0)}Z`, fill: `url(#${gid})` }));
    svg.append(s('path', { class: 'cf-yoy-prev', d: path(o.prev), fill: 'none' }));
    svg.append(s('path', { class: 'cf-yoy-cur', d: path(o.cur), fill: 'none', stroke: o.color || 'var(--accent)' }));
    const lastPrev = o.prev.reduce((a, v, i) => (v != null ? i : a), -1);
    const fmt = o.fmt || ((v) => F.money(v, { compact: true }));
    const ends = [];
    if (lastCur >= 0) { svg.append(s('circle', { class: 'cf-yoy-dot', cx: X(lastCur), cy: Y(o.cur[lastCur]), r: 4, fill: o.color || 'var(--accent)' })); ends.push({ y: Y(o.cur[lastCur]), t: o.curLabel || 'This year', v: fmt(o.cur[lastCur]), c: 'cur', x: X(lastCur) }); }
    if (lastPrev >= 0) ends.push({ y: Y(o.prev[lastPrev]), t: o.prevLabel || 'Last year', v: fmt(o.prev[lastPrev]), c: 'prev', x: X(lastPrev) });
    if (o.endLabels !== false) {
      ends.sort((a, b) => a.y - b.y);
      if (ends.length === 2 && ends[1].y - ends[0].y < 26) ends[1].y = ends[0].y + 26;
      ends.forEach((e) => { svg.append(s('text', { class: 'cf-yoy-end ' + e.c, x: W - padR + 10, y: e.y - 1 }, e.v)); svg.append(s('text', { class: 'cf-yoy-endt ' + e.c, x: W - padR + 10, y: e.y + 11 }, e.t)); });
    }
    F.MONTHS.forEach((m, i) => { if (W > 420 || i % 2 === 0) svg.append(s('text', { class: 'cf-blab' + (i === lastCur ? ' is-now' : ''), x: X(i), y: H - 5, 'text-anchor': 'middle' }, W > 420 ? m : m[0])); });
    return svg;
  }

  /* ---------------- Paired monthly bars (this year vs last) ---------------- */
  function pairs(el, opts) { return responsive(el, pairsSvg, opts); }
  function pairsSvg(W, o, first) {
    const H = o.height || 150, padB = 20;
    const max = Math.max(1, ...o.cur.filter((v) => v != null), ...o.prev.filter((v) => v != null));
    const slot = W / 12, bw = Math.min(10, slot * 0.3);
    const svg = s('svg', { class: 'cf-pairs' + (anim(first) ? ' cf-enter' : ''), viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img', 'aria-label': 'Monthly income, this year next to last year' });
    for (let i = 0; i < 12; i++) {
      const cx = slot * i + slot / 2;
      const g = s('g', { class: 'cf-bar' + (o.selected === i ? ' is-sel' : ''), 'data-i': i, style: `--i:${i}` });
      g.append(s('rect', { class: 'cf-hit', x: slot * i, y: 0, width: slot, height: H, fill: 'transparent' }));
      const bar = (v, x, cls) => { if (v == null) return; const hh = Math.max(v > 0 ? 2 : 0, (v / max) * (H - padB - 8)); g.append(s('rect', { class: cls, x, y: H - padB - hh, width: bw, height: hh, rx: Math.min(3, bw / 2) })); };
      bar(o.prev[i], cx - bw - 1, 'cf-p-prev'); bar(o.cur[i], cx + 1, 'cf-p-cur');
      g.append(s('text', { class: 'cf-blab', x: cx, y: H - 5, 'text-anchor': 'middle' }, slot < 30 ? F.MONTHS[i][0] : F.MONTHS[i]));
      svg.append(g);
    }
    svg.append(s('line', { class: 'cf-base', x1: 0, x2: W, y1: H - padB, y2: H - padB }));
    svg.addEventListener('click', (e) => { const g = e.target.closest('.cf-bar'); if (g && o.onSelect) o.onSelect(+g.getAttribute('data-i')); });
    return svg;
  }

  /* ---------------- Small pieces ---------------- */
  function spark(values, { w = 80, h = 24, color = 'currentColor', fill = true } = {}) {
    const v = values.map((x) => x || 0), max = Math.max(1, ...v);
    const X = (i) => (i / Math.max(1, v.length - 1)) * (w - 2) + 1, Y = (x) => h - 2 - (x / max) * (h - 4);
    const d = v.map((x, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(x).toFixed(1)}`).join('');
    return s('svg', { class: 'cf-spark', viewBox: `0 0 ${w} ${h}`, width: w, height: h, 'aria-hidden': 'true' },
      fill ? s('path', { d: d + `L${X(v.length - 1)} ${h}L1 ${h}Z`, fill: color, opacity: 0.12 }) : null,
      s('path', { d, fill: 'none', stroke: color, 'stroke-width': 1.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }),
      s('circle', { cx: X(v.length - 1), cy: Y(v[v.length - 1]), r: 2.2, fill: color }));
  }
  function ring(frac, { size = 64, stroke = 7, color = 'var(--accent)', track = 'var(--track, rgba(127,127,127,.18))', label } = {}) {
    const r = (size - stroke) / 2, c = 2 * Math.PI * r, f = F.clamp(frac || 0, 0, 1);
    return s('svg', { class: 'cf-ring', viewBox: `0 0 ${size} ${size}`, width: size, height: size, role: 'img', 'aria-label': label || `${Math.round(f * 100)}%` },
      s('circle', { cx: size / 2, cy: size / 2, r, fill: 'none', stroke: track, 'stroke-width': stroke }),
      s('circle', { class: 'cf-ring-val', cx: size / 2, cy: size / 2, r, fill: 'none', stroke: color, 'stroke-width': stroke, 'stroke-linecap': 'round', 'stroke-dasharray': `${c * f} ${c}`, transform: `rotate(-90 ${size / 2} ${size / 2})` }));
  }
  /** Horizontal proportion bar. items: [{id,value,color,label}] */
  function stack(items, { height = 10, gap = 2 } = {}) {
    const tot = F.sum(items, (x) => x.value) || 1;
    return CF.h('div.cf-stack', { style: { display: 'flex', gap: gap + 'px', height: height + 'px' }, role: 'img', 'aria-label': items.map((x) => `${x.label} ${F.pct(x.value / tot)}`).join(', ') },
      items.filter((x) => x.value > 0).map((x) => CF.h('span', { style: { flex: `${x.value} 1 0`, background: x.color, borderRadius: '3px', minWidth: '3px' }, title: `${x.label}: ${F.money(x.value)}` })));
  }
  /** Month calendar grid, Monday first. cell(date, inMonth) → {cls, body (Node|string), label} */
  function calendar(k, { cell, onTap, today = CF.data.today } = {}) {
    const { y, m } = F.parseMonth(k);
    const lead = (new Date(y, m, 1).getDay() + 6) % 7;
    const grid = CF.h('div.cf-cal', { role: 'grid', 'aria-label': `${F.monthLabel(k, { long: true })} calendar` });
    ['M', 'T', 'W', 'T', 'F', 'S', 'S'].forEach((d, i) => grid.append(CF.h('div.cf-cal-dow', { 'aria-hidden': 'true', class: i > 4 ? 'is-we' : '' }, d)));
    for (let i = 0; i < lead; i++) grid.append(CF.h('div.cf-cal-pad', { 'aria-hidden': 'true' }));
    for (let d = 1; d <= F.daysIn(k); d++) {
      const date = `${k}-${F.pad2(d)}`, w = new Date(y, m, d).getDay();
      const c = (cell && cell(date)) || {};
      const btn = CF.h('button.cf-cal-day', { type: 'button', 'data-date': date, 'aria-label': c.label || F.dayLabel(date, { long: true }), class: [c.cls, w === 0 || w === 6 ? 'is-we' : '', date === today ? 'is-today' : '', date > today ? 'is-future' : ''].filter(Boolean).join(' ') },
        CF.h('span.cf-cal-num', d), c.body || null);
      if (onTap) btn.addEventListener('click', () => onTap(date));
      grid.append(btn);
    }
    return grid;
  }

  CF.viz = { sankey, bars, yoy, pairs, spark, ring, stack, calendar, svg: s };
})();
