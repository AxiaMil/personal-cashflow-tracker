/* Excel export → CF.xlsx. Classic script, no dependencies, no network.
   gigClaim fills YOUR claim form when the setup describes one (streams.gig.claimForm: which cell takes
   what) and the space has the template (Muse action getClaimTemplate, or core/templates.local.js in dev).
   It edits the sheet XML in place, so every style, merge, drawing and column width survives. Without a
   template it builds a clean claim workbook instead, as job / hourly / statement always do.
   Zip in and out uses the browser's (De)CompressionStream('deflate-raw'); CRC32 is computed here.
   Money in the data layer is integer cents: it becomes dollars only when written into a cell. */
(function () {
  const CF = window.CF, F = CF.fmt;
  const MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const enc = new TextEncoder(), dec = new TextDecoder();

  /* ---------- zip ---------- */
  const CRC = new Uint32Array(256).map((_, n) => { for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1; return n; });
  const crc32 = (b) => { let c = -1; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  const pipe = async (bytes, stream) => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());

  /** Parse a zip's central directory → Map(name → {method, crc, usize, raw}); raw = the entry's compressed bytes, untouched. */
  function unzip(buf) {
    const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    let e = buf.length - 22;
    while (e >= 0 && v.getUint32(e, true) !== 0x06054b50) e--;
    if (e < 0) throw new Error('Template is not a zip file');
    const out = new Map();
    for (let i = 0, p = v.getUint32(e + 16, true), n = v.getUint16(e + 10, true); i < n; i++) {
      const nl = v.getUint16(p + 28, true), lo = v.getUint32(p + 42, true);
      const start = lo + 30 + v.getUint16(lo + 26, true) + v.getUint16(lo + 28, true);
      out.set(dec.decode(buf.subarray(p + 46, p + 46 + nl)), { method: v.getUint16(p + 10, true), crc: v.getUint32(p + 16, true), usize: v.getUint32(p + 24, true), raw: buf.subarray(start, start + v.getUint32(p + 20, true)) });
      p += 46 + nl + v.getUint16(p + 30, true) + v.getUint16(p + 32, true);
    }
    return out;
  }
  async function readText(z, name) {
    const f = z.get(name);
    if (!f) throw new Error(`Template has no ${name}`);
    if (f.method !== 0 && f.method !== 8) throw new Error(`Unsupported zip method ${f.method} for ${name}`);
    return dec.decode(f.method ? await pipe(f.raw, new DecompressionStream('deflate-raw')) : f.raw);
  }

  /** Build a zip Blob. entries: [name, string | Uint8Array | unzip() entry (copied as-is, no recompression)] */
  async function zip(entries) {
    const d = new Date();
    const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    const files = [], dir = [];
    let off = 0;
    for (const [name, src] of entries) {
      let f = src;
      if (!src.raw) {
        const data = typeof src === 'string' ? enc.encode(src) : src;
        f = { method: 8, crc: crc32(data), usize: data.length, raw: await pipe(data, new CompressionStream('deflate-raw')) };
      }
      const nm = enc.encode(name), lh = new Uint8Array(30), lv = new DataView(lh.buffer);
      lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, 0x0800, true); lv.setUint16(8, f.method, true);
      lv.setUint16(10, time, true); lv.setUint16(12, date, true); lv.setUint32(14, f.crc, true);
      lv.setUint32(18, f.raw.length, true); lv.setUint32(22, f.usize, true); lv.setUint16(26, nm.length, true);
      const ch = new Uint8Array(46), cv = new DataView(ch.buffer); // central header repeats local bytes 4–29 at 6–31
      cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); ch.set(lh.subarray(4, 30), 6); cv.setUint32(42, off, true);
      files.push(lh, nm, f.raw); dir.push(ch, nm);
      off += 30 + nm.length + f.raw.length;
    }
    const end = new Uint8Array(22), ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, entries.length, true); ev.setUint16(10, entries.length, true);
    ev.setUint32(12, dir.reduce((t, b) => t + b.length, 0), true); ev.setUint32(16, off, true);
    return new Blob([...files, ...dir, end], { type: MIME });
  }

  /* ---------- cells ---------- */
  const esc = (s) => String(s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const colName = (i) => { let s = ''; for (i++; i; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s; return s; }; // 0 → A
  const colIndex = (ref) => [...ref.match(/^[A-Z]+/)[0]].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
  const serial = (ymd) => { const [y, m, d] = ymd.split('-').map(Number); return (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 864e5; };
  const round2 = (x) => Math.round(x * 100) / 100;
  const dow = (ymd) => F.DOW[F.parseYmd(ymd).getDay()];
  /** One <c>: numbers → <v>, text → inline string (so sharedStrings.xml never changes). */
  const cellXml = (ref, v, s) => `<c r="${ref}"${s == null ? '' : ` s="${s}"`}${typeof v === 'number' ? `><v>${v}</v>` : ` t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is>`}</c>`;

  /* ---------- Gig claim, on your own template ---------- */
  const ampm = (t) => { const [h, m] = t.split(':').map(Number); return `${h % 12 || 12}:${F.pad2(m)} ${h < 12 ? 'AM' : 'PM'}`; };
  const safeName = (s) => String(s).replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
  const fileName = (pattern, vars) => safeName(String(pattern).replace(/\{(\w+)\}/g, (_, k) => (vars[k] == null ? '' : vars[k]))) + (/\.xlsx$/i.test(pattern) ? '' : '.xlsx');

  /** Replace (or insert, in column order) the given cells inside their rows. cells: {ref: [value, s]} */
  function putCells(xml, cells) {
    const rows = {};
    for (const [ref, c] of Object.entries(cells)) (rows[ref.replace(/^[A-Z]+/, '')] ||= []).push([ref, c]);
    xml = xml.replace(/<row r="(\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g, (m, r, attrs, body = '') => {
      if (!rows[r]) return m;
      for (const [ref, [v, s]] of rows[r]) {
        const c = cellXml(ref, v, s), re = new RegExp(`<c r="${ref}"[^>]*?(?:/>|>[\\s\\S]*?</c>)`);
        if (re.test(body)) { body = body.replace(re, () => c); continue; }
        const next = [...body.matchAll(/<c r="([A-Z]+)\d+"/g)].find((x) => colIndex(x[1]) > colIndex(ref));
        body = next ? body.slice(0, next.index) + c + body.slice(next.index) : body + c;
      }
      delete rows[r];
      return `<row r="${r}"${attrs}>${body}</row>`;
    });
    if (Object.keys(rows).length) throw new Error(`The claim template has no row ${Object.keys(rows).join(', ')}`);
    return xml;
  }

  let templateCache = null;
  async function claimTemplate() {
    if (CF.templates && CF.templates.claim) return CF.templates.claim;
    if (templateCache) return templateCache;
    if (CF.muse && CF.muse.active && CF.muse.claimTemplate) templateCache = await CF.muse.claimTemplate().catch(() => null);
    return templateCache;
  }

  /** form = setup.streams.gig.claimForm: {sheet?, header:{name,bank,paymentId,month}, rows:{first,count},
      columns:{date,day,venue,timeIn,timeOut,sessions,hours,rate,fee,remarks}, totals:{row,hours,fee},
      rate:'hourly'|'session', time:'12h'|'24h', filename}. Every key is optional except rows.first. */
  async function fillTemplate(k, form, b64) {
    const m = CF.data.month(k), R = CF.data.rules, G = CF.data.stream('gig'), p = CF.data.profile() || {}, warnings = [];
    const z = unzip(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
    const SHEET = form.sheet || 'xl/worksheets/sheet1.xml', BOOK = 'xl/workbook.xml';
    const [sheet, wb, styles] = await Promise.all([SHEET, BOOK, 'xl/styles.xml'].map((n) => readText(z, n)));
    const FIRST = +form.rows.first, LINES = +(form.rows.count || 30);
    const col = form.columns || {}, head = form.header || {}, tot = form.totals || {};

    // Keep every cell's own style. Where a row's cell has a plain "General" style but gets a date or money,
    // borrow the first line's style for that column (same font/border/fill, only the number format differs).
    const S = Object.fromEntries([...sheet.matchAll(/<c r="([A-Z]+\d+)"([^>]*?)\/?>/g)].map((x) => [x[1], (x[2].match(/\bs="(\d+)"/) || [])[1]]));
    const numFmt = [...styles.match(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/)[1].matchAll(/<xf\b[^>]*/g)].map((x) => +((x[0].match(/numFmtId="(\d+)"/) || [])[1] || 0));
    const cells = {};
    const put = (ref, v, formatted) => {
      if (!ref || v == null || v === '') return;
      const base = S[ref.replace(/\d+$/, FIRST)], s = ref in S ? S[ref] : base;
      cells[ref] = [v, formatted && !numFmt[s] ? base : s];
    };

    const name = String(p.fullName || '').trim(), bank = String(p.bankAccount || '').trim(), payId = String(p.paymentId || '').trim();
    put(head.bank, bank); put(head.name, name); put(head.paymentId, payId); put(head.month, serial(`${k}-01`));
    if (head.name && !name) warnings.push('No full name in your claim details, so that line is blank.');
    if (head.bank && !bank) warnings.push('No bank account in your claim details, so that line is blank.');
    if (head.paymentId && !payId) warnings.push(`No ${CF.data.setup().paymentIdLabel} in your claim details, so that line is blank.`);

    const all = m.gig.sessions, lines = all.slice(0, LINES);
    if (!all.length) warnings.push(`No sessions logged for ${m.label}.`);
    if (all.length > LINES) {
      const rest = all.slice(LINES);
      warnings.push(`The form has ${LINES} lines but ${m.label} has ${all.length} entries: the last ${rest.length} (${F.money(F.sum(rest, R.gigFee), { cents: true })}) are not on it and need a second form.`);
    }
    const t12 = form.time !== '24h', unit = G.sessionMinutes / 60;
    let hours = 0, fees = 0;
    lines.forEach((s, i) => {
      const r = FIRST + i, n = s.sessionsCount || 1, std = G.sessionMinutes * n, span = R.sessionMin(s);
      const h = round2((span && span !== std ? span : std) / 60); // the standard length unless the logged times say otherwise
      const at = (c) => (c ? `${c}${r}` : null);
      put(at(col.date), serial(s.date), true); put(at(col.day), dow(s.date)); put(at(col.venue), s.venue);
      put(at(col.timeIn), s.timeIn && (t12 ? ampm(s.timeIn) : s.timeIn)); put(at(col.timeOut), s.timeOut && (t12 ? ampm(s.timeOut) : s.timeOut));
      put(at(col.sessions), n); put(at(col.hours), h);
      put(at(col.rate), form.rate === 'hourly' ? s.rateCents / 100 / unit : s.rateCents / 100, true);
      put(at(col.fee), R.gigFee(s) / 100, true); put(at(col.remarks), s.remarks);
      hours += h; fees += R.gigFee(s);
    });
    if (tot.row) { put(tot.hours && `${tot.hours}${tot.row}`, round2(hours)); put(tot.fee && `${tot.fee}${tot.row}`, fees / 100); }

    const edits = {
      // Open at the top of the form, and recalculate any formulas on open.
      [SHEET]: putCells(sheet.replace(/(<sheetView\b[^>]*?) topLeftCell="[^"]*"/, '$1'), cells),
      [BOOK]: /<calcPr\b/.test(wb)
        ? wb.replace(/<calcPr\b([^>]*?)\s*\/>/, (_, a) => `<calcPr${a.replace(/\s+fullCalcOnLoad="[^"]*"/, '')} fullCalcOnLoad="1"/>`)
        : wb.replace(/(<\/sheets>(?:\s*<definedNames>[\s\S]*?<\/definedNames>)?)/, '$1<calcPr fullCalcOnLoad="1"/>'),
    };
    if (z.has('xl/calcChain.xml')) {
      edits['[Content_Types].xml'] = (await readText(z, '[Content_Types].xml')).replace(/<Override[^>]*PartName="\/xl\/calcChain\.xml"[^>]*\/>/, '');
      edits['xl/_rels/workbook.xml.rels'] = (await readText(z, 'xl/_rels/workbook.xml.rels')).replace(/<Relationship[^>]*Target="[^"]*calcChain\.xml"[^>]*\/>/, '');
    }
    const blob = await zip([...z.keys()].filter((n) => n !== 'xl/calcChain.xml').map((n) => [n, n in edits ? edits[n] : z.get(n)]));
    const filename = fileName(form.filename || `${G.label} claim - {name} - {month}`, { name: name || 'Claim', month: m.label, label: G.label });
    return { blob, filename, warnings };
  }

  /* ---------- Clean workbooks from scratch ---------- */
  // Cell = [value, style]; value null/'' leaves a styled blank. Styles: h header · t text · d date · tm time
  // · m money · hr hours, bold variants tB mB hrB for totals, L a bold label without a border.
  const XF = [['', 0, 0, 0], ['h', 0, 1, 1, 1], ['t', 0, 0, 1], ['d', 164, 0, 1], ['tm', 20, 0, 1], ['m', 165, 0, 1], ['hr', 2, 0, 1],
    ['tB', 0, 1, 1], ['mB', 165, 1, 1], ['hrB', 2, 1, 1], ['L', 0, 1, 0]];
  const XFI = Object.fromEntries(XF.map((x, i) => [x[0], i]));
  const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  const NS = 'http://schemas.openxmlformats.org';
  const MAIN = `${NS}/spreadsheetml/2006/main`, REL = `${NS}/officeDocument/2006/relationships`;
  const edge = (side) => `<${side} style="thin"><color rgb="FFBFBFBF"/></${side}>`;
  const STYLES = `${XML}<styleSheet xmlns="${MAIN}">`
    + '<numFmts count="2"><numFmt numFmtId="164" formatCode="d mmm yyyy"/><numFmt numFmtId="165" formatCode="$#,##0.00"/></numFmts>'
    + '<fonts count="2"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font></fonts>'
    + '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF0F0F0"/><bgColor indexed="64"/></patternFill></fill></fills>'
    + `<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border>${['left', 'right', 'top', 'bottom'].map(edge).join('')}<diagonal/></border></borders>`
    + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
    + `<cellXfs count="${XF.length}">${XF.map(([, fmt, b, bd, fill]) => `<xf numFmtId="${fmt}" fontId="${b}" fillId="${fill ? 2 : 0}" borderId="${bd}" xfId="0"${fmt ? ' applyNumberFormat="1"' : ''}${b ? ' applyFont="1"' : ''}${fill ? ' applyFill="1"' : ''}${bd ? ' applyBorder="1"' : ''}/>`).join('')}</cellXfs>`
    + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';

  const hdr = (names) => names.map((n) => [n, 'h']);
  const txt = (v, b) => [v == null ? '' : String(v), b ? 'tB' : 't'];
  const num = (v, b) => [v, b ? 'tB' : 't'];
  const date = (ymd) => [ymd ? serial(ymd) : null, 'd'];
  const time = (t) => [t ? F.toMin(t) / 1440 : null, 'tm'];
  const money = (cents, b) => [cents == null ? null : cents / 100, b ? 'mB' : 'm'];
  const hrs = (min, b) => [min == null ? null : min / 60, b ? 'hrB' : 'hr'];
  const blank = (style, n = 1) => Array.from({ length: n }, () => [null, style]);

  /** {cols:[widths], rows:[[cell]], merges?:['A1:B1'], freezeCols?:n}: header row 1 is always frozen. */
  function sheetXml({ cols, rows, merges = [], freezeCols = 0 }) {
    const tl = colName(freezeCols) + 2, pane = freezeCols ? 'bottomRight' : 'bottomLeft';
    const cell = (ref, [v, k]) => (v == null || v === '' ? (XFI[k] ? `<c r="${ref}" s="${XFI[k]}"/>` : '') : cellXml(ref, v, XFI[k] || null));
    const data = rows.map((row, r) => (row && row.length ? `<row r="${r + 1}">${row.map((c, i) => (c ? cell(colName(i) + (r + 1), c) : '')).join('')}</row>` : '')).join('');
    return `${XML}<worksheet xmlns="${MAIN}" xmlns:r="${REL}">`
      + `<sheetViews><sheetView workbookViewId="0"><pane${freezeCols ? ` xSplit="${freezeCols}"` : ''} ySplit="1" topLeftCell="${tl}" activePane="${pane}" state="frozen"/><selection pane="${pane}" activeCell="${tl}" sqref="${tl}"/></sheetView></sheetViews>`
      + `<sheetFormatPr defaultRowHeight="15"/><cols>${cols.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>`
      + `<sheetData>${data}</sheetData>${merges.length ? `<mergeCells count="${merges.length}">${merges.map((ref) => `<mergeCell ref="${ref}"/>`).join('')}</mergeCells>` : ''}`
      + '<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>';
  }
  function book(sheets) {
    const CT = 'application/vnd.openxmlformats-officedocument.spreadsheetml', RELS = `${NS}/package/2006/relationships`;
    return zip([
      ['[Content_Types].xml', `${XML}<Types xmlns="${NS}/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>`
        + `<Override PartName="/xl/workbook.xml" ContentType="${CT}.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="${CT}.styles+xml"/>`
        + sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="${CT}.worksheet+xml"/>`).join('') + '</Types>'],
      ['_rels/.rels', `${XML}<Relationships xmlns="${RELS}"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
      ['xl/workbook.xml', `${XML}<workbook xmlns="${MAIN}" xmlns:r="${REL}"><bookViews><workbookView/></bookViews><sheets>${sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`],
      ['xl/_rels/workbook.xml.rels', `${XML}<Relationships xmlns="${RELS}">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${REL}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="${REL}/styles" Target="styles.xml"/></Relationships>`],
      ['xl/styles.xml', STYLES],
      ...sheets.map((s, i) => [`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s)]),
    ]);
  }

  /* ---------- Gig claim, as a clean workbook (when there's no template) ---------- */
  async function gigClaim(k) {
    const G = CF.data.stream('gig');
    if (!G) throw new Error('No per-session work is set up');
    const form = G.claimForm && G.claimForm.rows && G.claimForm.rows.first ? G.claimForm : null;
    if (form) {
      const b64 = await claimTemplate();
      if (b64) return fillTemplate(k, form, b64);
    }
    const m = CF.data.month(k), R = CF.data.rules, p = CF.data.profile() || {}, c = m.gig.claim;
    const rows = [
      hdr(['Date', 'Day', 'Venue', 'Time in', 'Time out', 'Sessions', 'Hours', 'Rate', 'Fee', 'Remarks']),
      ...m.gig.sessions.map((s) => [date(s.date), txt(dow(s.date)), txt(s.venue), time(s.timeIn), time(s.timeOut), num(s.sessionsCount || 1), hrs(R.sessionMin(s) || G.sessionMinutes * (s.sessionsCount || 1)), money(s.rateCents), money(R.gigFee(s)), txt(s.remarks)]),
      [txt('Total', true), ...blank('tB', 4), num(m.gig.count, true), hrs(m.gig.minutes, true), [null, 'tB'], money(m.gig.fees, true), [null, 'tB']],
      [],
      [['Claim details', 'L']],
    ];
    const details = [['Month', txt(m.long)], ['Name', txt(p.fullName)], ['Bank account', txt(p.bankAccount)], [CF.data.setup() ? CF.data.setup().paymentIdLabel : 'Payment ID', txt(p.paymentId)]];
    if (c && c.to) details.push(['Send to', txt(c.to)]);
    if (c && c.due) details.push(['Due', date(c.due)]);
    const merges = [];
    for (const [label, v] of details) { const r = rows.length + 1; rows.push([txt(label, true), [null, 'tB'], v, ...blank(v[1], 2)]); merges.push(`A${r}:B${r}`, `C${r}:E${r}`); }
    const warnings = [];
    if (form) warnings.push("This space has no claim template yet, so it's a plain claim workbook.");
    if (!p.fullName) warnings.push('Add your name in claim details to put it on the form.');
    return { blob: await book([{ name: 'Claim', cols: [12, 6, 20, 9, 9, 9, 8, 10, 10, 32], rows, merges }]), filename: fileName(`${G.label} claim - ${m.label}`, {}), warnings };
  }

  /* ---------- Job: days, leave and claims ---------- */
  async function job(k) {
    const m = CF.data.month(k), I = m.job, R = CF.data.rules, J = CF.data.stream('job');
    if (!J) throw new Error('No job is set up');
    const rows = [
      hdr(['Date', 'Day', 'Start', 'End', 'Break start', 'Break end', 'Overtime min', 'Hours', 'Code', 'Remarks']),
      ...I.entries.map((e) => [date(e.date), txt(dow(e.date)), time(e.start), time(e.end), time(e.breakStart), time(e.breakEnd), num(e.overtimeMinutes || 0), hrs(R.workedMin(e)), txt(e.attendanceCode), txt(e.privateRemarks ?? e.remarks)]),
      [txt('Total', true), ...blank('tB', 5), num(F.sum(I.entries, (e) => e.overtimeMinutes), true), hrs(I.workedMin, true), ...blank('tB', 2)],
      [],
      [['Summary', 'L']],
    ];
    const summary = [['Hours worked', hrs(I.workedMin)], ['Expected hours', hrs(I.expectedMin)], ['Full-month pay', money(I.monthlyPayCents)], ['Gross pay', money(I.gross)]];
    if (J.deduction) summary.push([J.deduction.label, money(I.deducted)]);
    summary.push(['Net pay', money(I.net, true)]);
    if (I.status) summary.push([`${J.system} status`, txt(`${I.status.replace(/_/g, ' ')} · revision ${I.revision}`)]);
    const merges = [];
    for (const [label, v] of summary) {
      const r = rows.length + 1;
      rows.push([txt(label, true), [null, 'tB'], v, ...blank(v[1], 2)]);
      merges.push(`A${r}:B${r}`, `C${r}:E${r}`);
    }
    const sheets = [{ name: 'Timesheet', cols: [12, 7, 8, 8, 11, 10, 13, 8, 7, 40], rows, merges }];

    const leave = I.leave && I.leave.entries ? [...I.leave.entries].sort((a, b) => String(a.from).localeCompare(String(b.from))) : [];
    if (leave.length) sheets.push({ name: 'Leave', cols: [8, 12, 12, 7, 44], rows: [
      hdr(['Type', 'From', 'To', 'Days', 'Reason']),
      ...leave.map((e) => [txt(e.type), date(e.from), date(e.to), num(e.days), txt(e.reason)]),
      [txt('Total', true), ...blank('tB', 2), num(F.sum(leave, (e) => e.days), true), [null, 'tB']],
    ] });
    const claims = I.claims && I.claims.entries ? [...I.claims.entries].sort((a, b) => String(a.date).localeCompare(String(b.date))) : [];
    if (claims.length) sheets.push({ name: 'Claims', cols: [12, 44, 12], rows: [
      hdr(['Date', 'Description', 'Amount']),
      ...claims.map((e) => [date(e.date), txt(e.description), money(e.amountCents)]),
      [txt('Total', true), [null, 'tB'], money(F.sum(claims, (e) => e.amountCents), true)],
    ] });
    return { blob: await book(sheets), filename: fileName(`${J.short} hours - ${m.label}`, {}) };
  }

  /* ---------- Hourly work ---------- */
  async function hourly(k) {
    const m = CF.data.month(k), R = CF.data.rules, H = CF.data.stream('hourly');
    if (!H) throw new Error('No hourly work is set up');
    const rows = [
      hdr(['Date', 'Day', H.unitLabel, 'Time in', 'Time out', 'Hours', 'Rate', 'Pay', 'Remarks']),
      ...m.hourly.sessions.map((s) => [date(s.date), txt(dow(s.date)), txt(s.module), time(s.timeIn), time(s.timeOut), hrs(R.hourlyMin(s)), money(s.rateCents), money(R.hourlyPay(s)), txt(s.remarks)]),
      [txt('Total', true), ...blank('tB', 4), hrs(m.hourly.minutes, true), [null, 'tB'], money(m.hourly.pay, true), [null, 'tB']],
    ];
    return { blob: await book([{ name: `${H.short} log`.slice(0, 31), cols: [12, 6, 14, 9, 9, 8, 10, 10, 32], rows }]), filename: fileName(`${H.short} log - ${m.label}`, {}) };
  }

  /* ---------- Yearly cashflow statement ---------- */
  async function statement(y) {
    const Y = CF.data.year(y), months = Y.months;
    const ok = (m) => m && m.expenses.status === 'ok';
    const total = (vals) => (vals.some((v) => v != null) ? F.sum(vals) : null); // a column of blanks totals to blank, not $0

    const ov = months.map((m, i) => {
      if (!m) return { label: F.monthLabel(F.monthKey(y, i)), vals: [null, null, null, null, null], note: '' };
      const sch = m.lumpsum.amount;
      return { label: m.label, vals: [m.income, sch, m.income - sch, ok(m) ? m.expenses.total : null, m.net], note: m.isSample ? 'Sample data' : ok(m) ? '' : 'Spending not synced' };
    });
    const L = CF.data.stream('lumpsum'), lname = L ? L.label : 'yearly payment';
    const overview = [
      hdr(['Month', 'Income', `of which ${lname}`, `Income excl. ${lname}`, 'Spent', 'Net', 'Note']),
      ...ov.map((o) => [txt(o.label), ...o.vals.map((v) => money(v)), txt(o.note)]),
      [txt('Total', true), ...[0, 1, 2, 3, 4].map((j) => money(total(ov.map((o) => o.vals[j])), true)), [null, 'tB']],
    ];

    const monthHdr = (first) => hdr([first, ...F.MONTHS, 'Total']);
    const income = [
      monthHdr('Stream'),
      ...Y.streams.map((s) => [txt(s.label), ...s.monthly.map((v) => money(v)), money(s.amount)]),
      [txt('Total', true), ...months.map((m) => money(m ? m.income : null, true)), money(Y.income, true)],
    ];
    const spending = [
      monthHdr('Category'),
      ...Y.expenses.categories.map((c) => [txt(c.name), ...months.map((m) => money(ok(m) ? (m.expenses.categories.find((x) => x.name === c.name) || { amount: 0 }).amount : null)), money(c.amount)]),
      [txt('Total', true), ...months.map((m) => money(ok(m) ? m.expenses.total : null, true)), money(total(months.map((m) => (ok(m) ? m.expenses.total : null))), true)],
    ];
    const wide = (first) => [first, ...Array(12).fill(10), 12];
    return {
      blob: await book([
        { name: 'Overview', cols: [11, 12, 24, 24, 12, 12, 20], rows: overview },
        { name: 'Income', cols: wide(22), rows: income, freezeCols: 1 },
        { name: 'Spending', cols: wide(22), rows: spending, freezeCols: 1 },
      ]),
      filename: `Cashflow ${y}.xlsx`,
    };
  }

  /** Save a {blob, filename} (Muse spaces allow downloads). */
  function download({ blob, filename }) {
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = filename; a.style.display = 'none';
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  CF.xlsx = { gigClaim, job, hourly, statement, download };
})();
