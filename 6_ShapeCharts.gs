/**
 * File 6: ShapeCharts.gs
 * Grafik, tabel dan kartu rekomendasi digambar dengan shape Google Slides lewat
 * layanan lanjutan "Google Slides API" (1 batchUpdate per slide, jauh lebih cepat dari SlidesApp).
 *
 * WAJIB: Editor Apps Script > Services (+) > Google Slides API > Add (identifier: Slides).
 *
 * Gaya mengikuti design system SawitPRO CBR: Plus Jakarta Sans, seri aktual hijau (#007200),
 * acuan/standar hijau muda, puncak/outlier oranye (warning), nilai negatif merah (danger),
 * kisi abu (divider), kartu tint bersudut membulat dengan garis border 1px, tabel header hijau.
 */

const CH = { PAD_LEFT: 38, PAD_TOP: 26, PAD_RIGHT: 6, PAD_BOTTOM: 42, FONT_SIZE: 8.4, BAR_RATIO: 0.62 };   // label grafik min. 15px

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return { red: parseInt(h.substr(0, 2), 16) / 255, green: parseInt(h.substr(2, 2), 16) / 255, blue: parseInt(h.substr(4, 2), 16) / 255 };
}
function PT(v) { return { magnitude: v, unit: 'PT' }; }
function solid(hex) { return { solidFill: { color: { rgbColor: hexToRgb(hex) } } }; }

/* ------------------------------------------------------------------------- */
/* Pembangun request batch                                                   */
/* ------------------------------------------------------------------------- */

function SlideBatch(pageId, prefix) {
  this.page = pageId;
  this.prefix = String(prefix).replace(/[^A-Za-z0-9_]/g, '_');
  this.n = 0;
  this.req = [];
  this.groupIds = [];
}

SlideBatch.prototype.id = function () { return `${this.prefix}_${Utilities.getUuid().slice(0, 6)}_${this.n++}`; };

SlideBatch.prototype.props = function (l, t, w, h, sy) {
  return {
    pageObjectId: this.page,
    size: { width: PT(Math.max(w, 0.01)), height: PT(Math.max(h, 0.01)) },
    transform: { scaleX: 1, scaleY: sy || 1, translateX: l, translateY: t, shearX: 0, shearY: 0, unit: 'PT' }
  };
};

SlideBatch.prototype.rect = function (l, t, w, h, color, kind, noGroup) {
  if (!(w > 0) || !(h > 0)) return null;
  const id = this.id();
  this.req.push({ createShape: { objectId: id, shapeType: kind || 'RECTANGLE', elementProperties: this.props(l, t, w, h) } });
  this.req.push({ updateShapeProperties: { objectId: id,
    shapeProperties: { shapeBackgroundFill: solid(color), outline: { propertyState: 'NOT_RENDERED' } },
    fields: 'shapeBackgroundFill.solidFill.color,outline.propertyState' } });
  if (!noGroup) this.groupIds.push(id);
  return id;
};

/** Kartu CBR: sudut membulat, isi tint, garis border 1px (opts.fill / opts.border bisa diganti). */
SlideBatch.prototype.card = function (l, t, w, h, opts) {
  const o = opts || {}, C = DECK_CONFIG.COLOR;
  if (!(w > 0) || !(h > 0)) return null;
  const id = this.id();
  this.req.push({ createShape: { objectId: id, shapeType: o.shape || 'ROUND_RECTANGLE', elementProperties: this.props(l, t, w, h) } });
  const outline = o.border === null ? { propertyState: 'NOT_RENDERED' }
    : { outlineFill: solid(o.border || C.BORDER), weight: PT(0.75), propertyState: 'RENDERED' };
  this.req.push({ updateShapeProperties: { objectId: id,
    shapeProperties: { shapeBackgroundFill: solid(o.fill || C.TINT), outline },
    fields: 'shapeBackgroundFill.solidFill.color,outline' } });
  if (o.group) this.groupIds.push(id);
  return id;
};

SlideBatch.prototype.dot = function (cx, cy, d, color) { return this.rect(cx - d / 2, cy - d / 2, d, d, color, 'ELLIPSE'); };

/** Kotak teks. o: {size, color, bold, font, weight, align START|CENTER|END, valign TOP|MIDDLE|BOTTOM, lineSpacing} */
SlideBatch.prototype.text = function (str, l, t, w, h, o) {
  o = o || {};
  const id = this.id();
  const txt = String(str === null || str === undefined || str === '' ? ' ' : str);
  // Kompensasi jarak dalam kotak teks Google Slides (7,2pt kiri-kanan, 3,6pt atas-bawah)
  // Kotak diperbesar ke semua sisi sebesar jarak dalamnya, sehingga AREA TEKS = (l, t, w, h) rancangan.
  const I = DECK_CONFIG.TEXT_INSET;
  this.req.push({ createShape: { objectId: id, shapeType: 'TEXT_BOX', elementProperties: this.props(l - I.X, t - I.Y, w + 2 * I.X, h + 2 * I.Y) } });
  this.texts = this.texts || [];
  this.texts.push({ id, txt, x: l, y: t, w, h, size: o.size || CH.FONT_SIZE, heavy: (o.weight || 0) >= 700 || !!o.bold, ls: (o.lineSpacing || 100) / 100, nowrap: !!o.nowrap });
  this.req.push({ insertText: { objectId: id, text: txt } });
  const W = DECK_CONFIG.WEIGHT;
  const style = { fontSize: PT(o.size || CH.FONT_SIZE), foregroundColor: { opaqueColor: { rgbColor: hexToRgb(o.color || DECK_CONFIG.COLOR.INK) } },
    weightedFontFamily: { fontFamily: o.font || DECK_CONFIG.FONT.BODY, weight: o.weight || (o.bold ? W.TITLE : W.BODY) } };
  const fields = 'fontSize,foregroundColor,weightedFontFamily';
  this.req.push({ updateTextStyle: { objectId: id, textRange: { type: 'ALL' }, style, fields } });
  this.req.push({ updateParagraphStyle: { objectId: id, textRange: { type: 'ALL' },
    style: { alignment: o.align || 'CENTER', lineSpacing: o.lineSpacing || 100, spaceAbove: PT(0), spaceBelow: PT(0) },
    fields: 'alignment,lineSpacing,spaceAbove,spaceBelow' } });
  this.req.push({ updateShapeProperties: { objectId: id, shapeProperties: { contentAlignment: o.valign || 'MIDDLE' }, fields: 'contentAlignment' } });
  if (!o.noGroup) this.groupIds.push(id);
  return id;
};

/**
 * Satu kotak teks dengan beberapa gaya (mis. angka KPI besar + satuan kecil di garis dasar yang sama).
 * segs: [{text, size, weight, color}]; o: {align, valign, noGroup}
 */
SlideBatch.prototype.richText = function (segs, l, t, w, h, o) {
  o = o || {};
  const first = segs[0];
  const id = this.text(segs.map(x => x.text).join(''), l, t, w, h,
    Object.assign({}, o, { size: first.size, weight: first.weight, color: first.color }));
  // catat lebar gabungan untuk pemeriksaan "Text fit"
  const rec = this.texts[this.texts.length - 1];
  rec.mixedW = segs.reduce((a, sg) => a + estWidth(sg.text, sg.size, sg.weight >= 700), 0);
  rec.size = Math.max.apply(null, segs.map(sg => sg.size));
  let pos = 0;
  segs.forEach(sg => {
    const len = sg.text.length;
    if (len && pos > 0) this.req.push({ updateTextStyle: { objectId: id, textRange: { type: 'FIXED_RANGE', startIndex: pos, endIndex: pos + len },
      style: { fontSize: PT(sg.size), foregroundColor: { opaqueColor: { rgbColor: hexToRgb(sg.color) } },
        weightedFontFamily: { fontFamily: DECK_CONFIG.FONT.BODY, weight: sg.weight } },
      fields: 'fontSize,foregroundColor,weightedFontFamily' } });
    pos += len;
  });
  return id;
};

/** Label berpusat di cx (atau rata kanan/kiri terhadap cx). */
SlideBatch.prototype.label = function (str, cx, top, w, o) {
  o = o || {};
  const width = w || 50;
  const left = o.align === 'END' ? cx - width : (o.align === 'START' ? cx : cx - width / 2);
  return this.text(str, left, top, width, o.height || 14, o);
};

SlideBatch.prototype.line = function (x1, y1, x2, y2, color, weight, dashed) {
  const id = this.id();
  const l = Math.min(x1, x2), w = Math.abs(x2 - x1), h = Math.abs(y2 - y1);
  const rising = (x2 - x1) * (y2 - y1) < 0;   // naik ke kanan -> balik sumbu Y
  const top = rising ? Math.max(y1, y2) : Math.min(y1, y2);
  this.req.push({ createLine: { objectId: id, lineCategory: 'STRAIGHT', elementProperties: this.props(l, top, w, h, rising ? -1 : 1) } });
  const lp = { lineFill: solid(color), weight: PT(weight || 0.75) };
  let fields = 'lineFill.solidFill.color,weight';
  if (dashed) { lp.dashStyle = 'DASH'; fields += ',dashStyle'; }
  this.req.push({ updateLineProperties: { objectId: id, lineProperties: lp, fields } });
  this.groupIds.push(id);
  return id;
};

/**
 * Tabel bergaya DataTable SawitPRO. data[0] = header.
 * o: {colWidths: [rasio], fontSize, headerSize, rowHeight}
 */
SlideBatch.prototype.table = function (l, t, w, data, o) {
  o = o || {};
  const C = DECK_CONFIG.COLOR, T = DECK_CONFIG.TYPE;
  const rows = data.length, cols = data[0].length;
  const rowH = o.rowHeight || 25;   // 18px × 1,35 + padding 12px atas-bawah
  const id = this.id();
  this.req.push({ createTable: { objectId: id, rows, columns: cols, elementProperties: {
    pageObjectId: this.page, size: { width: PT(w), height: PT(rowH * rows) },
    transform: { scaleX: 1, scaleY: 1, translateX: l, translateY: t, unit: 'PT' } } } });
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const loc = { rowIndex: r, columnIndex: c };
      const txt = String(data[r][c] === '' || data[r][c] === null || data[r][c] === undefined ? '-' : data[r][c]);
      this.req.push({ insertText: { objectId: id, cellLocation: loc, text: txt } });
      this.tableLinks = this.tableLinks || [];
      const lk = c === 0 && r > 0 && o.rowLinks && o.rowLinks[r - 1];
      if (lk && lk.pageId) this.tableLinks.push({ id, loc, txt, lk });
      // kolom angka rata kanan (sp-num), termasuk header-nya
      if ((o.numCols || []).indexOf(c) >= 0) this.req.push({ updateParagraphStyle: { objectId: id, cellLocation: loc, textRange: { type: 'ALL' },
        style: { alignment: 'END' }, fields: 'alignment' } });
      // DataTable CBR: header ExtraBold putih di hijau; kolom pertama SemiBold ink; kolom lain Medium muted
      const W = DECK_CONFIG.WEIGHT;
      const weight = r === 0 ? W.HEAVY : (c === 0 ? W.STRONG : W.BODY);
      // ▲ hijau / ▼ merah (sp-up / sp-down)
      const delta = r > 0 && /^[▲▼]/.test(txt) ? (txt[0] === '▲' ? C.GREEN : C.DANGER) : null;
      const color = r === 0 ? C.ON_GREEN : (c === 0 ? C.INK : delta || (o.cellColor && o.cellColor(r, c, txt)) || C.MUTED);
      this.req.push({ updateTextStyle: { objectId: id, cellLocation: loc, textRange: { type: 'ALL' },
        style: { weightedFontFamily: { fontFamily: DECK_CONFIG.FONT.BODY, weight },  // ukuran: table-head / body CBR
          fontSize: PT(r === 0 ? (o.headerSize || T.TABLE_HEADER) : (o.fontSize || T.TABLE_CELL)),
          foregroundColor: { opaqueColor: { rgbColor: hexToRgb(color) } } },
        fields: 'weightedFontFamily,fontSize,foregroundColor' } });
      // header dua baris: baris kedua = keterangan kecil 14px SemiBold ("Agu 26" / "pembanding")
      const nl = txt.indexOf('\n');
      if (r === 0 && nl > 0) this.req.push({ updateTextStyle: { objectId: id, cellLocation: loc, textRange: { type: 'FIXED_RANGE', startIndex: nl + 1, endIndex: txt.length },
        style: { fontSize: PT(T.TABLE_SMALL), weightedFontFamily: { fontFamily: DECK_CONFIG.FONT.BODY, weight: W.STRONG } }, fields: 'fontSize,weightedFontFamily' } });
      if (delta) this.req.push({ updateTextStyle: { objectId: id, cellLocation: loc, textRange: { type: 'ALL' },
        style: { weightedFontFamily: { fontFamily: DECK_CONFIG.FONT.BODY, weight: W.TITLE } }, fields: 'weightedFontFamily' } });
    }
    this.req.push({ updateTableCellProperties: { objectId: id,
      tableRange: { location: { rowIndex: r, columnIndex: 0 }, rowSpan: 1, columnSpan: cols },
      tableCellProperties: { tableCellBackgroundFill: solid(r === 0 ? C.GREEN : (r % 2 === 1 ? C.TINT : C.SURFACE)), contentAlignment: 'MIDDLE' },
      fields: 'tableCellBackgroundFill.solidFill.color,contentAlignment' } });
  }
  this.req.push({ updateTableBorderProperties: { objectId: id,
    tableRange: { location: { rowIndex: 0, columnIndex: 0 }, rowSpan: rows, columnSpan: cols },
    borderPosition: 'ALL', tableBorderProperties: { tableBorderFill: solid(C.BORDER), weight: PT(0.75) },
    fields: 'tableBorderFill.solidFill.color,weight' } });
  if (o.colWidths) {
    const sum = o.colWidths.reduce((a, b) => a + b, 0);
    o.colWidths.forEach((cw, i) => this.req.push({ updateTableColumnProperties: { objectId: id, columnIndices: [i],
      tableColumnProperties: { columnWidth: PT(w * cw / sum) }, fields: 'columnWidth' } }));
  }
  this.req.push({ updateTableRowProperties: { objectId: id, rowIndices: [...Array(rows).keys()].slice(o.headerHeight ? 1 : 0),
    tableRowProperties: { minRowHeight: PT(rowH) }, fields: 'minRowHeight' } });
  if (o.headerHeight) this.req.push({ updateTableRowProperties: { objectId: id, rowIndices: [0],
    tableRowProperties: { minRowHeight: PT(o.headerHeight) }, fields: 'minRowHeight' } });
  // tautan internal di sel kolom pertama (mis. "→ hlm 14"): teks tautan hijau tebal
  (this.tableLinks || []).filter(x => x.id === id).forEach(x => {
    const from = Math.max(0, x.txt.indexOf(x.lk.label || ''));
    this.req.push({ updateTextStyle: { objectId: id, cellLocation: x.loc,
      textRange: x.lk.label ? { type: 'FIXED_RANGE', startIndex: from, endIndex: from + x.lk.label.length } : { type: 'ALL' },
      style: { link: { pageObjectId: x.lk.pageId }, foregroundColor: { opaqueColor: { rgbColor: hexToRgb(C.GREEN) } }, underline: false,
        weightedFontFamily: { fontFamily: DECK_CONFIG.FONT.BODY, weight: DECK_CONFIG.WEIGHT.HEAVY } },
      fields: 'link,foregroundColor,underline,weightedFontFamily' } });
  });
  return id;
};

SlideBatch.prototype.flush = function (presId) {
  if (this.groupIds.length > 1) {
    this.req.push({ groupObjects: { groupObjectId: this.id(), childrenObjectIds: this.groupIds } });
  }
  for (let i = 0; i < this.req.length; i += 400) {
    Slides.Presentations.batchUpdate({ requests: this.req.slice(i, i + 400) }, presId);
  }
};

/* ------------------------------------------------------------------------- */
/* Skala & kerangka                                                          */
/* ------------------------------------------------------------------------- */

/** Skala sumbu "bagus" (kelipatan 1/2/2.5/5 × 10^k) termasuk nilai negatif. */
function niceScale(minVal, maxVal) {
  const lo = Math.min(0, minVal), hi = Math.max(0, maxVal);
  const span = (hi - lo || 1) * 1.12;
  const raw = span / 5;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw);
  const min = lo < 0 ? Math.floor((lo * 1.12) / step) * step : 0;
  const max = Math.ceil((hi * 1.12 || step) / step) * step;
  const ticks = [];
  for (let v = min; v <= max + step / 2; v += step) ticks.push(Number(v.toFixed(6)));
  return { min, max, ticks };
}

function chFrame(b, series, scale, axisFmt) {
  const A = DECK_CONFIG.LAYOUT.CONTENT, C = DECK_CONFIG.COLOR;
  const x0 = A.left + CH.PAD_LEFT, y0 = A.top + CH.PAD_TOP;
  const pw = A.width - CH.PAD_LEFT - CH.PAD_RIGHT;
  const ph = A.height - CH.PAD_TOP - CH.PAD_BOTTOM;
  const yb = y0 + ph;
  const step = pw / series.length;
  const yOf = v => yb - ph * ((v - scale.min) / (scale.max - scale.min));

  scale.ticks.forEach(t => {
    const y = yOf(t);
    if (t !== 0) b.line(x0, y, x0 + pw, y, C.DIVIDER, 0.75);
    b.label(axisFmt(t), x0 - 2, y - 7, 46, { align: 'END' });
  });
  b.line(x0, yOf(0), x0 + pw, yOf(0), C.MUTED, 0.75);

  series.forEach((s, i) => b.label(BULAN_PENDEK[s.p.m], x0 + step * (i + 0.5), yb + 2, Math.max(step, 26)));
  let start = 0;
  for (let i = 1; i <= series.length; i++) {
    if (i === series.length || series[i].p.y !== series[start].p.y) {
      b.label(String(series[start].p.y), x0 + step * ((start + i) / 2), yb + 17, 60, { weight: DECK_CONFIG.WEIGHT.HEAVY, color: C.GREEN });
      if (i < series.length) b.line(x0 + step * i, yb + 4, x0 + step * i, yb + 34, C.BORDER, 0.75);
      start = i;
    }
  }
  return { x0, y0, pw, ph, yb, step, yOf };
}

function chLegend(b, items) {
  const A = DECK_CONFIG.LAYOUT.CONTENT;
  let x = A.left + CH.PAD_LEFT + 6;
  const y = A.top + 7;
  items.forEach(it => {
    if (it.type === 'bar') b.rect(x, y - 4, 10, 8, it.color);
    else b.line(x, y, x + 16, y, it.color, 2, it.dashed);
    const w = it.name.length * 4.8 + 18;
    b.label(it.name, x + 20, y - 7, w, { align: 'START', color: DECK_CONFIG.COLOR.MUTED });
    x += 20 + w + 8;
  });
}

function scaled(series, div) { return series.map(s => (s && s.value !== null && s.value !== undefined ? s.value / div : null)); }
function finite(arr) { return arr.filter(v => v !== null && isFinite(v)); }

/* ------------------------------------------------------------------------- */
/* Grafik                                                                    */
/* ------------------------------------------------------------------------- */

/**
 * Bar chart bulanan: tertinggi oranye, negatif merah.
 * o: {scale, labelFmt, axisFmt, extraLines:[{series, color, dashed}], legend}
 */
function drawBarChart(b, series, o) {
  o = o || {};
  const C = DECK_CONFIG.COLOR, div = o.scale || 1;
  const vals = scaled(series, div);
  const extra = (o.extraLines || []).map(l => scaled(l.series, div));
  const all = finite(vals.concat.apply(vals, extra));
  if (!all.length) return;
  const scale = niceScale(Math.min.apply(null, all), Math.max.apply(null, all));
  const f = chFrame(b, series, scale, o.axisFmt || (v => fmt(v, 0)));
  const maxV = Math.max.apply(null, finite(vals));
  const bw = f.step * CH.BAR_RATIO, y0 = f.yOf(0), lf = o.labelFmt || (x => fmt(x, 2));

  vals.forEach((v, i) => {
    const cx = f.x0 + f.step * (i + 0.5);
    if (v === null) { b.label('n/a', cx, y0 - 16, 40, { color: C.MUTED }); return; }
    const y = f.yOf(v);
    const color = v < 0 ? C.DANGER : (v === maxV ? C.WARNING : C.GREEN);   // negatif merah, puncak oranye
    b.rect(cx - bw / 2, Math.min(y, y0), bw, Math.abs(y0 - y), color);
    b.label(lf(v), cx, v < 0 ? y + 1 : y - 15, Math.max(f.step + 8, 36), { bold: true });
  });
  (o.extraLines || []).forEach((l, k) => drawPolyline(b, f, extra[k], l.color, l.dashed, null));
  if (o.legend) chLegend(b, o.legend);
}

/** Line chart bulanan. lines: [{series, color, dashed, labels}] */
function drawLineChart(b, lines, o) {
  o = o || {};
  const div = o.scale || 1;
  const data = lines.map(l => scaled(l.series, div));
  const all = finite([].concat.apply([], data));
  if (!all.length) return;
  const scale = niceScale(Math.min.apply(null, all), Math.max.apply(null, all));
  const f = chFrame(b, lines[0].series, scale, o.axisFmt || (v => fmt(v, 0)));
  lines.forEach((l, k) => drawPolyline(b, f, data[k], l.color, l.dashed, l.labels ? (o.labelFmt || (x => fmt(x, 1))) : null));
  if (o.legend) chLegend(b, o.legend);
}

function drawPolyline(b, f, vals, color, dashed, labelFmt) {
  const pts = vals.map((v, i) => (v === null ? null : { x: f.x0 + f.step * (i + 0.5), y: f.yOf(v), v }));
  for (let i = 1; i < pts.length; i++) {
    if (pts[i - 1] && pts[i]) b.line(pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y, color, 2, dashed);
  }
  pts.forEach((p, i) => {
    if (!p) return;
    // titik tanpa tetangga (mis. data 1 bulan) tetap terlihat, termasuk seri acuan putus-putus
    const isolated = !pts[i - 1] && !pts[i + 1];
    if (labelFmt || isolated) b.dot(p.x, p.y, labelFmt ? 6 : 5, color);
    if (labelFmt) b.label(labelFmt(p.v), p.x, p.y - 19, Math.max(f.step + 8, 36), { bold: true });
  });
}

/** Bar horizontal (komposisi upkeep), terbesar oranye di atas. items: [{name, value, pct}] */
function drawHBarChart(b, items, o) {
  o = o || {};
  const A = DECK_CONFIG.LAYOUT.CONTENT, C = DECK_CONFIG.COLOR, div = o.scale || 1;
  const rows = items.slice(0, 10);
  if (!rows.length) return;
  const labelW = 120, x0 = A.left + labelW, pw = A.width - labelW - 95;
  const rowH = Math.min(40, (A.height - 20) / rows.length);
  const maxV = Math.max.apply(null, rows.map(r => r.value / div));
  rows.forEach((r, i) => {
    const v = r.value / div, y = A.top + 12 + i * rowH, w = maxV > 0 ? pw * v / maxV : 0;
    b.label(r.name, x0 - 6, y, labelW - 6, { align: 'END', height: rowH * 0.7, size: 8.4 });
    b.rect(x0, y + rowH * 0.1, w, rowH * 0.5, i === 0 ? C.WARNING : C.GREEN);
    b.label(`${(o.labelFmt || (x => fmt(x, 2)))(v)} (${fmt(r.pct, 0)}%)`, x0 + w + 4, y, 90, { align: 'START', bold: true, height: rowH * 0.7 });
  });
  b.line(x0, A.top + 8, x0, A.top + 12 + rows.length * rowH, C.MUTED, 0.75);
}

/* ------------------------------------------------------------------------- */
/* Tabel & kartu kesimpulan                                                  */
/* ------------------------------------------------------------------------- */

function drawTable(b, headers, rows, o) {
  if (!rows || !rows.length) return;
  const A = DECK_CONFIG.LAYOUT.CONTENT;
  const data = [headers].concat(rows.slice(0, Math.min(9, DECK_CONFIG.MAX_TABLE_ROWS)));   // maks. ±9 baris pada 18px
  b.table(A.left, A.top, A.width, data, o);
}

/**
 * Kartu rekomendasi 2 × 2 untuk slide Kesimpulan.
 * actions: [{title, detail, priority, basis_pages}]
 */
function drawConclusionCards(b, actions, linkOf) {
  // StatusCard CBR: kartu mengikuti isi, kartu satu baris sama tinggi. Nomor dalam lingkaran hijau,
  // judul card-title ink, isi body muted, baris bawah: titik status + "Prioritas tinggi/sedang" · waktu · dasar slide.
  const C = DECK_CONFIG.COLOR, L = DECK_CONFIG.LAYOUT, T = DECK_CONFIG.TYPE, W = DECK_CONFIG.WEIGHT;
  const list = actions.slice(0, 4);
  const gap = L.CARD_GAP, P = L.CARD_PAD, cols = 2, totalW = L.RIGHT - L.MARGIN;
  const w = (totalW - gap) / cols, inner = w - 2 * P, d = 27;
  const titleW = inner - d - 5.6;
  const meta = a => {
    const pages = (a.basis_pages || []).filter(Boolean);
    const hasBtn = linkOf && pages.length && linkOf(pages[0]);   // tombol bukti menggantikan teks "Dasar: slide …"
    return [a.priority === 'tinggi' ? 'Prioritas tinggi' : 'Prioritas sedang', a.timeline || null, !hasBtn && pages.length ? `Dasar: slide ${pages.join(', ')}` : null].filter(Boolean).join(' · ');
  };
  // Produk SawitPRO: satu baris pendek, mis. "Solusi SawitPRO: Dokter Sawit (konsultasi agronomis)"
  const prodText = a => (a.product && a.product.name ? `Solusi SawitPRO: ${a.product.name}${a.product.short ? ` (${a.product.short})` : ''}` : '');
  const metaGap = 9;
  const parts = a => {
    const tH = Math.max(d, estLines(a.title, T.CARD_TITLE, titleW, true) * T.CARD_TITLE * 1.3);
    const dH = estLines(a.detail, T.BODY, inner) * T.BODY * 1.45;
    const pT = prodText(a), pH = pT ? estLines(pT, T.CAPTION, inner, true) * T.CAPTION * 1.35 : 0;
    const mH = Math.max(16, estLines(meta(a), T.CAPTION, inner - 10 - 80, true) * T.CAPTION * 1.4);
    return { tH, dH, pT, pH, mH, h: P + tH + 6.75 + dH + (pH ? 6.75 + pH : 0) + metaGap + mH + P };
  };
  // Tinggi baris = isi terpanjang di baris itu; sisa ruang sampai footer dibagi rata (tidak ada tumpang tindih)
  const rowsN = Math.ceil(list.length / cols);
  const top0 = L.BODY_TOP, avail = L.BOTTOM - top0 - gap * (rowsN - 1);
  const need = [];
  for (let r = 0; r < rowsN; r++) need.push(Math.max.apply(null, list.slice(r * cols, r * cols + cols).map(a => parts(a).h)));
  const sumNeed = need.reduce((x, y) => x + y, 0);
  const extra = Math.max(0, (avail - sumNeed) / rowsN);
  const rowH = need.map(h => h + extra);
  if (sumNeed > avail + 1) RUN_WARNINGS.push('Kartu rekomendasi: isi lebih tinggi dari ruang slide; persingkat detail rekomendasi.');
  list.forEach((a, i) => {
    const r = Math.floor(i / cols), h = rowH[r], pr = parts(a);
    const left = L.MARGIN + (i % cols) * (w + gap), top = top0 + rowH.slice(0, r).reduce((x, y) => x + y + gap, 0);
    b.card(left, top, w, h);
    const dy = top + P + (pr.tH - d) / 2;   // lingkaran nomor di tengah vertikal terhadap judul
    b.rect(left + P, dy, d, d, C.GREEN, 'ELLIPSE', true);
    b.text(String(i + 1), left + P + d / 2 - 16, dy, 32, d, { weight: W.HEAVY, size: T.TOC_TITLE, color: C.ON_GREEN, noGroup: true, nowrap: true });
    b.text(a.title, left + P + d + 5.6, top + P, titleW, pr.tH, { weight: W.HEAVY, size: T.CARD_TITLE, color: C.INK, align: 'START', valign: 'MIDDLE', lineSpacing: 115, noGroup: true });
    const dTop = top + P + pr.tH + 6.75;
    b.text(a.detail, left + P, dTop, inner, pr.dH + 2, { size: T.BODY, color: C.MUTED, align: 'START', valign: 'TOP', lineSpacing: 135, noGroup: true });
    if (pr.pT) b.text(pr.pT, left + P, dTop + pr.dH + 6.75, inner, pr.pH + 1, { size: T.CAPTION, weight: W.HEAVY, color: C.GREEN, align: 'START', valign: 'TOP', lineSpacing: 120, noGroup: true });
    // Baris bawah: titik status, teks prioritas, dan tombol lampiran sejajar di tengah satu baris
    const rowHm = pr.mH, my = top + h - P - rowHm, cy = my + rowHm / 2;
    b.rect(left + P, cy - 3, 6, 6, a.priority === 'tinggi' ? C.DANGER : C.WARNING, 'ELLIPSE', true);
    const pg = (a.basis_pages || []).filter(Boolean)[0], lk = pg && linkOf ? linkOf(pg) : null;
    const btnW = lk ? estWidth(lk.label, T.CAPTION, true) + 18 : 0;
    b.text(meta(a), left + P + 12, my, inner - 12 - (lk ? btnW + 6 : 0), rowHm, { size: T.CAPTION, weight: W.STRONG, color: C.INK, align: 'START', valign: 'MIDDLE', lineSpacing: 125, noGroup: true });
    if (lk) b.button(lk.label, left + w - P - btnW, cy - 8, btnW, 16, lk.pageId, { size: T.CAPTION });
  });
}

/* Bulan dari teks "YYYY-MM" / "MM/YYYY" (dipakai tabel mandor) */
/** "2026-11" | "11/2026" -> {y, m} */
function parseYm(s) {
  const t = String(s || '').trim();
  let m = t.match(/^(\d{4})-(\d{1,2})/);
  if (m) return { y: Number(m[1]), m: Number(m[2]) - 1 };
  m = t.match(/^(\d{1,2})[\/\-](\d{4})$/);
  if (m) return { y: Number(m[2]), m: Number(m[1]) - 1 };
  return null;
}

/* ------------------------------------------------------------------------- */
/* Mandor: bar berkelompok per mandor × 3 bulan                              */
/* ------------------------------------------------------------------------- */

/**
 * m: {periods:[{label, partial}], rows:[{name, vals:[{rate, days}|null]}]}
 * Bar = JJG/hari, label atas = nilai, label bawah = jumlah hari kerja.
 * Bulan lebih lama hijau muda -> bulan terakhir hijau tua; bulan berjalan abu-abu.
 */
function drawMandorChart(b, m) {
  const C = DECK_CONFIG.COLOR, A = DECK_CONFIG.LAYOUT.CONTENT;
  const rows = m.rows.slice(0, 6), nP = m.periods.length;
  const rates = finite([].concat.apply([], rows.map(r => r.vals.map(v => (v ? v.rate : null)))));
  if (!rates.length) return;
  const scale = niceScale(0, Math.max.apply(null, rates));
  const x0 = A.left + CH.PAD_LEFT, y0 = A.top + CH.PAD_TOP + 6;
  const pw = A.width - CH.PAD_LEFT - CH.PAD_RIGHT, ph = A.height - CH.PAD_TOP - 6 - 50, yb = y0 + ph;
  const yOf = v => yb - ph * (v / scale.max);

  scale.ticks.forEach(t => {
    if (t > 0) b.line(x0, yOf(t), x0 + pw, yOf(t), C.DIVIDER, 0.75);
    b.label(fmt(t, 0), x0 - 2, yOf(t) - 7, 46, { align: 'END' });
  });
  b.line(x0, yb, x0 + pw, yb, C.MUTED, 0.75);

  const shades = [C.CHART_LIGHT, C.CHART_MID, C.GREEN];
  const fullIdx = m.periods.map((p, i) => (p.partial ? null : i)).filter(i => i !== null);
  const colorOf = i => (m.periods[i].partial ? C.NEUTRAL : shades[shades.length - (fullIdx.length - fullIdx.indexOf(i))] || shades[0]);
  const gw = pw / rows.length, bw = Math.min(46, (gw * 0.78) / nP);
  rows.forEach((r, g) => {
    const gx = x0 + gw * g + (gw - bw * nP) / 2;
    r.vals.forEach((v, i) => {
      const cx = gx + bw * (i + 0.5);
      if (!v || v.rate === null) { b.label('-', cx, yb - 16, bw + 10, { color: C.MUTED }); return; }
      const y = yOf(v.rate);
      b.rect(cx - bw * 0.45, y, bw * 0.9, yb - y, colorOf(i));
      b.label(fmt(v.rate, 0), cx, y - 15, bw + 14, { bold: true });
      b.label(`${fmt(v.days, 0)} hr`, cx, yb + 2, bw + 14, { size: 8.4, color: C.MUTED });
    });
    b.label(r.name, x0 + gw * (g + 0.5), yb + 18, gw - 4, { weight: DECK_CONFIG.WEIGHT.STRONG, color: C.INK, height: 26 });
  });
  chLegend(b, m.periods.map((p, i) => ({ name: p.partial ? `${p.label} (berjalan)` : p.label, type: 'bar', color: colorOf(i) })));
}

/* ------------------------------------------------------------------------- */
/* Anomali: tabel lebar penuh                                                */
/* ------------------------------------------------------------------------- */

/** rows: [{finding, evidence, argument, follow_up, pages}] (maks 5) */
function drawAnomalyTable(b, rows, linkOf) {
  const L = DECK_CONFIG.LAYOUT;
  const list = (rows || []).slice(0, 4);   // huruf 18px: maks. 4 temuan agar tidak melewati footer
  if (!list.length) return;
  // linkOf(page) -> {pageId, label} : tautan ke slide bukti di lampiran (bisa diklik)
  const links = list.map(a => { const pg = (a.pages || []).filter(Boolean)[0]; return pg && linkOf ? linkOf(pg) : null; });
  const data = [['Temuan', 'Data / bukti', 'Mengapa penting', 'Tindak lanjut']].concat(list.map((a, i) => [
    a.finding + (links[i] ? `\n${links[i].label}` : ((a.pages || []).filter(Boolean).length ? ` (slide ${a.pages.filter(Boolean).join(', ')})` : '')),
    a.evidence, a.argument, a.follow_up
  ]));
  // Tabel lebar penuh; tinggi baris diperkirakan dari isi sel terpanjang (baris tabel ikut membesar di Slides)
  const T = DECK_CONFIG.TYPE, totalW = L.RIGHT - L.MARGIN, ratios = [1.6, 2.2, 2.3, 2.0], sum = 8.1;
  const cellW = ratios.map(r => totalW * r / sum - 2 * 7.9);
  const rowH = data.slice(1).map(row => Math.max.apply(null, row.map((c, j) => estLines(c, T.TABLE_CELL, cellW[j], j === 0) * T.TABLE_CELL * 1.35)) + 13.5);
  const total = 25 + rowH.reduce((a, x) => a + x, 0);
  if (L.BODY_TOP + total > L.BOTTOM) RUN_WARNINGS.push('Tabel anomali mungkin melebihi tinggi slide; isi anomali perlu dipersingkat.');
  b.table(L.MARGIN, L.BODY_TOP, totalW, data, { colWidths: ratios, fontSize: T.TABLE_CELL, headerSize: T.TABLE_HEADER,
    rowHeight: Math.max.apply(null, rowH), headerHeight: 25, rowLinks: links });
}

/* ------------------------------------------------------------------------- */
/* Alur janjang: corong Dipanen -> Dimuat -> Masuk trip -> Terjual           */
/* ------------------------------------------------------------------------- */

function drawFlowFunnel(b, F) {
  const A = DECK_CONFIG.LAYOUT.CONTENT, C = DECK_CONFIG.COLOR;
  const n = F.stages.length;
  const labelW = 92, valueW = 100, x0 = A.left + labelW, pw = A.width - labelW - valueW;
  const rowH = Math.min(52, (A.height - 10) / (n * 1.55));
  const gapH = rowH * 0.55;
  const max = Math.max.apply(null, F.stages.map(s => s.total)) || 1;
  let y = A.top + 8;
  F.stages.forEach((st, i) => {
    const w = Math.max(2, pw * st.total / max);
    const left = x0 + (pw - w) / 2;
    b.label(st.name, x0 - 6, y, labelW - 6, { align: 'END', height: rowH, size: 10.1, weight: DECK_CONFIG.WEIGHT.STRONG, color: C.INK });
    b.card(left, y + rowH * 0.12, w, rowH * 0.76, { fill: i === 0 ? C.GREEN : C.CHART_MID, border: null, group: true });
    // angka tahap; untuk tahap Terjual ditambah baris kecil "x tanpa berat" tepat di bawahnya (satu baris, tidak terlipat)
    b.label(fmt(st.total, 0), x0 + pw + 4, y + (st.note ? -6 : 0), valueW, { align: 'START', height: rowH, size: 10.1, weight: DECK_CONFIG.WEIGHT.HEAVY });
    if (st.note) b.text(st.note, x0 + pw + 4, y + rowH / 2 + 2, valueW, 12, { align: 'START', valign: 'TOP', size: 8.4, color: C.WARNING, weight: DECK_CONFIG.WEIGHT.HEAVY, nowrap: true });
    y += rowH;
    const step = F.steps[i];
    if (step) {
      const isWorst = F.worst && F.worst.from === step.from && step.gap > 0;
      const txt = step.gap > 0
        ? `▼ ${fmt(step.gap, 0)} jjg (${fmt(step.pct, 1)}%)${step.rp ? ` ≈ ${fmtRpRange(step.rpLow, step.rp)}` : ''}`
        : step.gap < 0 ? `▲ +${fmt(-step.gap, 0)} jjg (lebih besar dari tahap sebelumnya)` : '= seimbang';
      b.label(txt, x0 + pw / 2, y, pw, { height: gapH, size: 8.4, weight: DECK_CONFIG.WEIGHT.HEAVY, color: isWorst ? C.DANGER : (step.gap > 0 ? C.INK : C.MUTED) });
      if (isWorst) b.rect(x0 + pw / 2 - pw * 0.42, y + gapH - 2, pw * 0.84, 1.5, C.WARNING);
      y += gapH;
    }
  });
}

/* ------------------------------------------------------------------------- */
/* Kartu KPI Introduction (3–6 kartu)                                        */
/* ------------------------------------------------------------------------- */

function drawKpiCards(b, kpis, top0) {
  // KpiCard CBR: LABEL 15px Bold di atas → angka 56px + satuan 20px SemiBold satu baris → catatan 18px.
  // sp-kpi-grid mengisi sisa tinggi slide sampai footer; isi kartu di tengah vertikal; kartu satu baris sama tinggi.
  const C = DECK_CONFIG.COLOR, L = DECK_CONFIG.LAYOUT, T = DECK_CONFIG.TYPE, W = DECK_CONFIG.WEIGHT;
  const n = kpis.length, cols = n === 4 ? 4 : Math.min(3, n), rows = Math.ceil(n / cols);
  const totalW = L.RIGHT - L.MARGIN, gap = L.CARD_GAP, P = L.CARD_PAD;
  const w = (totalW - gap * (cols - 1)) / cols, inner = w - 2 * P;
  const sizeOf = k => {
    const room = inner - (k.unit ? estWidth(k.unit, T.KPI_UNIT, true) + 5.6 : 0);
    if (estWidth(k.value, T.KPI_VALUE, true) <= room) return T.KPI_VALUE;
    if (estWidth(k.value, T.KPI_COMPACT, true) <= room) return T.KPI_COMPACT;
    RUN_WARNINGS.push(`Nilai KPI "${k.value}" terlalu panjang; pindahkan skala ke satuan (mis. "4,6" + "ribu ton").`);
    return T.KPI_COMPACT;
  };
  const contentH = k => T.KPI_LABEL * 1.3 + 4.5 + sizeOf(k) * 1.05 + 4.5 + estLines(k.note, T.BODY, inner) * T.BODY * 1.45;
  const start = top0 || L.BODY_TOP;
  const cardH = (L.BOTTOM - start - gap * (rows - 1)) / rows;            // grid mengisi sampai footer
  if (Math.max.apply(null, kpis.map(contentH)) + 2 * P > cardH) RUN_WARNINGS.push('Kartu KPI: isi lebih tinggi dari ruang; persingkat paragraf pembuka atau catatan KPI.');
  kpis.forEach((k, i) => {
    const r = Math.floor(i / cols);
    const left = L.MARGIN + (i % cols) * (w + gap), top = start + r * (cardH + gap);
    b.card(left, top, w, cardH);
    const ch = contentH(k);
    let y = top + (cardH - ch) / 2;                                        // isi di tengah vertikal
    b.text(String(k.name || '').toUpperCase(), left + P, y, inner, T.KPI_LABEL * 1.3, { size: T.KPI_LABEL, weight: W.TITLE, color: C.MUTED, align: 'START', valign: 'TOP', noGroup: true });
    y += T.KPI_LABEL * 1.3 + 4.5;
    const vs = sizeOf(k);
    const segs = [{ text: String(k.value), size: vs, weight: W.HEAVY, color: C.GREEN }];
    if (k.unit) segs.push({ text: ' ' + k.unit, size: T.KPI_UNIT, weight: W.STRONG, color: C.MUTED });
    b.richText(segs, left + P, y, inner, vs * 1.05, { align: 'START', valign: 'BOTTOM', noGroup: true, nowrap: true });
    y += vs * 1.05 + 4.5;
    // Baris pembanding (target / standar / bulan lalu / batas wajar): tebal; hijau = baik, merah = perlu perhatian
    const noteColor = k.tone === 'good' ? C.GREEN : k.tone === 'bad' ? C.DANGER : C.INK;
    b.text(k.note || ' ', left + P, y, inner, estLines(k.note, T.BODY, inner) * T.BODY * 1.45, { size: T.BODY, weight: W.STRONG, color: noteColor, align: 'START', valign: 'TOP', lineSpacing: 135, noGroup: true });
  });
}

/* ------------------------------------------------------------------------- */
/* Daftar isi: kartu agenda bernomor (2 kolom)                               */
/* ------------------------------------------------------------------------- */

/** items: [{title, desc, pages: 'Slide 4–8'}] */
/**
 * Daftar Isi = AgendaItem CBR dalam sp-toc: dua kolom (1–5 kiri, 6–10 kanan); baris MEREGANG mengisi slide
 * sampai footer (tidak ada area kosong di bawah). Lingkaran nomor 52px, judul 21px, deskripsi 17px satu baris,
 * pill kuning sama lebar (min. 112px) dan tidak pernah terlipat; nomor & pill di tengah vertikal.
 */
function drawToc(b, items) {
  const C = DECK_CONFIG.COLOR, L = DECK_CONFIG.LAYOUT, T = DECK_CONFIG.TYPE, W = DECK_CONFIG.WEIGHT;
  const n = items.length, cols = n > 5 ? 2 : 1, rows = Math.ceil(n / cols);
  const totalW = L.RIGHT - L.MARGIN, gapX = L.CARD_GAP, gapY = L.TOC_ROW_GAP;
  const padX = 11.25, gapIn = 9;                                         // padding 12px 20px, jarak 16px
  const w = (totalW - gapX * (cols - 1)) / cols;
  const d = 27, pillH = 8.4 * 1.2 + 9;                                   // lingkaran 48px; pill 15px + padding 8px
  const pillW = Math.max(63, Math.max.apply(null, items.map(it => estWidth(it.pages, T.PILL, true))) + 2 * 9 + 4);
  const textW = w - padX - d - gapIn - gapIn - pillW - padX;
  const titleH = it => estLines(it.title, T.TOC_TITLE, textW, true) * T.TOC_TITLE * 1.3;
  const descH = it => estLines(it.desc, T.TOC_DESC, textW) * T.TOC_DESC * 1.4;
  const top0 = L.BODY_TOP;
  const rowH = (L.BOTTOM - top0 - (rows - 1) * gapY) / rows;               // baris meregang sampai footer
  const need = Math.max.apply(null, items.map(it => Math.max(d, titleH(it) + 2.25 + descH(it)))) + 2 * 6.75;
  if (need > rowH) RUN_WARNINGS.push('Daftar isi: isi baris lebih tinggi dari ruang yang tersedia; persingkat deskripsi bagian.');
  items.forEach((it, i) => {
    const col = cols === 2 ? Math.floor(i / rows) : 0, row = cols === 2 ? i % rows : i;
    const left = L.MARGIN + col * (w + gapX), top = top0 + row * (rowH + gapY), cy = top + rowH / 2;
    b.card(left, top, w, rowH);
    b.rect(left + padX, cy - d / 2, d, d, C.GREEN, 'ELLIPSE', true);
    b.text(String(i + 1), left + padX + d / 2 - 22, cy - d / 2, 44, d, { weight: W.HEAVY, size: T.AGENDA_NUM, color: C.ON_GREEN, noGroup: true, nowrap: true });
    const tx = left + padX + d + gapIn, tH = titleH(it), dH = descH(it), bh = tH + 2.25 + dH;
    b.text(it.title, tx, cy - bh / 2, textW, tH, { weight: W.HEAVY, size: T.TOC_TITLE, color: C.INK, align: 'START', valign: 'TOP', lineSpacing: 115, noGroup: true });
    b.text(it.desc, tx, cy - bh / 2 + tH + 2.25, textW, dH, { size: T.TOC_DESC, color: C.MUTED, align: 'START', valign: 'TOP', lineSpacing: 125, noGroup: true });
    const px = left + w - padX - pillW;
    b.card(px, cy - pillH / 2, pillW, pillH, { fill: C.YELLOW, border: null });
    b.text(it.pages, px - 10, cy - pillH / 2, pillW + 20, pillH, { weight: W.HEAVY, size: T.PILL, color: C.INK, noGroup: true, nowrap: true });
  });
}

/* ------------------------------------------------------------------------- */
/* Bar bertumpuk bulanan (komposisi biaya, janjang terjual berberat/tanpa)    */
/* ------------------------------------------------------------------------- */

/**
 * parts: [{name, series, color}] ditumpuk dari bawah; label total di atas batang.
 * o: {scale, labelFmt, axisFmt}
 */
function drawStackedBarChart(b, parts, o) {
  o = o || {};
  const C = DECK_CONFIG.COLOR, div = o.scale || 1;
  const base = parts[0].series;
  const vals = parts.map(pt => base.map(x => { const v = valAt(pt.series, x.p); return v === null || v === undefined ? 0 : v / div; }));
  const totals = base.map((_, i) => vals.reduce((a, arr) => a + Math.max(0, arr[i]), 0));
  if (!totals.some(v => v > 0)) return;
  const scale = niceScale(0, Math.max.apply(null, totals));
  const f = chFrame(b, base, scale, o.axisFmt || (v => fmt(v, 0)));
  const bw = f.step * CH.BAR_RATIO;
  base.forEach((x, i) => {
    const cx = f.x0 + f.step * (i + 0.5);
    let acc = 0;
    parts.forEach((pt, k) => {
      const v = Math.max(0, vals[k][i]);
      if (!v) return;
      const yTop = f.yOf(acc + v), yBot = f.yOf(acc);
      b.rect(cx - bw / 2, yTop, bw, yBot - yTop, pt.color);
      acc += v;
    });
    if (totals[i] > 0) b.label((o.labelFmt || (v => fmt(v, 0)))(totals[i]), cx, f.yOf(totals[i]) - 15, Math.max(f.step + 8, 36), { weight: DECK_CONFIG.WEIGHT.HEAVY });
  });
  chLegend(b, parts.map(pt => ({ name: pt.name, type: 'bar', color: pt.color })));
}

/* ------------------------------------------------------------------------- */
/* Tombol tautan antar-slide (bisa diklik di mode presentasi & editor)        */
/* ------------------------------------------------------------------------- */

/**
 * Tombol pill: satu shape bersudut bulat berisi teks, dengan tautan ke slide lain (pageObjectId).
 * o.variant: 'primary' (hijau, teks putih) | 'secondary' (tint, garis border, teks hijau)
 */
SlideBatch.prototype.button = function (label, l, t, w, h, pageId, o) {
  o = o || {};
  const C = DECK_CONFIG.COLOR, W = DECK_CONFIG.WEIGHT;
  const primary = o.variant !== 'secondary';
  const id = this.id();
  this.req.push({ createShape: { objectId: id, shapeType: 'ROUND_RECTANGLE', elementProperties: this.props(l, t, w, h) } });
  const props = { shapeBackgroundFill: solid(primary ? C.GREEN : C.TINT), contentAlignment: 'MIDDLE',
    outline: primary ? { propertyState: 'NOT_RENDERED' } : { outlineFill: solid(C.BORDER), weight: PT(0.75), propertyState: 'RENDERED' } };
  let fields = 'shapeBackgroundFill.solidFill.color,contentAlignment,outline';
  if (pageId) { props.link = { pageObjectId: pageId }; fields += ',link'; }
  this.req.push({ updateShapeProperties: { objectId: id, shapeProperties: props, fields } });
  this.req.push({ insertText: { objectId: id, text: label } });
  this.req.push({ updateTextStyle: { objectId: id, textRange: { type: 'ALL' },
    style: { fontSize: PT(o.size || DECK_CONFIG.TYPE.PILL), foregroundColor: { opaqueColor: { rgbColor: hexToRgb(primary ? C.ON_GREEN : C.GREEN) } },
      weightedFontFamily: { fontFamily: DECK_CONFIG.FONT.BODY, weight: W.HEAVY } },
    fields: 'fontSize,foregroundColor,weightedFontFamily' } });
  this.req.push({ updateParagraphStyle: { objectId: id, textRange: { type: 'ALL' }, style: { alignment: o.align || 'CENTER' }, fields: 'alignment' } });
  this.texts = this.texts || [];
  this.texts.push({ id, txt: label, x: l, y: t, w: w - 14.4, h: h, size: o.size || DECK_CONFIG.TYPE.PILL, heavy: true, ls: 1, nowrap: true });
  return id;
};

/** Lebar tombol yang cukup untuk teksnya (+ padding & jarak dalam). */
function buttonWidth(label, size) { return estWidth(label, size || DECK_CONFIG.TYPE.PILL, true) + 22; }

/**
 * Slide ringkasan: label "DETAIL DI LAMPIRAN" + tombol ke setiap slide lampiran, di bawah kartu INSIGHT.
 * items: [{label, pageId}]; top: y mulai (di bawah kartu insight)
 */
function drawDetailButtons(b, items, top) {
  const C = DECK_CONFIG.COLOR, L = DECK_CONFIG.LAYOUT, T = DECK_CONFIG.TYPE, I = L.INSIGHT;
  if (!items.length) return;
  b.text('DETAIL DI LAMPIRAN', I.left, top, I.width, T.EYEBROW * 1.3, { size: T.EYEBROW, weight: DECK_CONFIG.WEIGHT.HEAVY, color: C.GREEN, align: 'START', valign: 'TOP', noGroup: true });
  let y = top + T.EYEBROW * 1.3 + 5;
  const h = 19, gap = 5.6;
  const rowsAvail = Math.max(1, Math.floor((L.BOTTOM - y + gap) / (h + gap)));
  const cols = items.length > rowsAvail ? 2 : 1;
  const w = (I.width - (cols - 1) * 5.6) / cols;
  items.forEach((it, i) => {
    const col = cols === 2 ? i % 2 : 0, row = cols === 2 ? Math.floor(i / 2) : i;
    const label = cols === 2 ? it.short : it.label;
    b.button(label, I.left + col * (w + 5.6), y + row * (h + gap), w, h, it.pageId, { variant: 'secondary', align: 'START' });
  });
  const rowsUsed = cols === 2 ? Math.ceil(items.length / 2) : items.length;
  if (y + rowsUsed * (h + gap) - gap > L.BOTTOM + 1) RUN_WARNINGS.push('Tombol lampiran melebihi batas bawah slide; persingkat insight ringkasan.');
}

/** Slide lampiran: tombol kembali ke slide ringkasan & ke Daftar Lampiran (baris footer, tengah-kanan). */
function drawBackButtons(b, back, index) {
  const L = DECK_CONFIG.LAYOUT, T = DECK_CONFIG.TYPE;
  let x = L.RIGHT - 40;   // sisakan ruang untuk nomor halaman
  const y = L.FOOTER_TOP - 3, h = 16;
  [index, back].filter(Boolean).forEach(it => {
    const w = buttonWidth(it.label, T.CAPTION);
    x -= w + 6;
    b.button(it.label, x, y, w, h, it.pageId, { variant: it.primary ? 'primary' : 'secondary', size: T.CAPTION });
  });
}

/**
 * Daftar Lampiran: dua kolom; per tema satu label kecil, lalu baris tautan "A3  Luas panen ...... hlm 14".
 * groups: [{title, items:[{code, title, page, pageId}]}]
 * - Tombol kode selebar kode terpanjang (mis. "A22"), jadi kode dua digit tidak pernah terlipat.
 * - Tema tidak pernah dipotong di tengah; pembagian kolom dipilih yang paling seimbang.
 * - Tinggi baris menyesuaikan jumlah lampiran agar kolom tidak melewati footer (min. 15pt).
 */
function drawAppendixIndex(b, groups) {
  const C = DECK_CONFIG.COLOR, L = DECK_CONFIG.LAYOUT, T = DECK_CONFIG.TYPE, W = DECK_CONFIG.WEIGHT;
  const gs = groups.filter(g => g.items.length);
  if (!gs.length) return;
  const headH = 17, avail = L.BOTTOM - L.BODY_TOP;
  const colHeight = (arr, lh) => arr.reduce((a, g) => a + headH + g.items.length * lh, 0);

  // 1. Pembagian kolom paling seimbang tanpa memisah tema
  let best = { k: gs.length, h: Infinity };
  for (let k = 1; k <= gs.length; k++) {
    const h = Math.max(colHeight(gs.slice(0, k), 19), colHeight(gs.slice(k), 19));
    if (h < best.h) best = { k, h };
  }
  const cols = [gs.slice(0, best.k), gs.slice(best.k)];

  // 2. Tinggi baris: 19pt, diperkecil bila kolom terpanjang melewati footer (min. 15pt)
  const fitLine = cols.map(col => {
    const n = col.reduce((a, g) => a + g.items.length, 0);
    return n ? (avail - col.length * headH) / n : 19;
  });
  const lineH = Math.max(15, Math.min(19, Math.min.apply(null, fitLine)));
  if (Math.max(colHeight(cols[0], lineH), colHeight(cols[1], lineH)) > avail + 1) RUN_WARNINGS.push('Daftar lampiran terlalu panjang; sebagian baris melewati batas bawah.');

  // 3. Lebar tombol kode mengikuti kode terpanjang
  const codes = [].concat.apply([], gs.map(g => g.items.map(it => String(it.code))));
  const longest = codes.reduce((a, c) => (c.length > a.length ? c : a), '');
  const codeW = Math.max(30, buttonWidth(longest, T.CAPTION));
  const colW = (L.RIGHT - L.MARGIN - L.CARD_GAP) / 2, pageW = 44;

  cols.forEach((col, ci) => {
    const left = L.MARGIN + ci * (colW + L.CARD_GAP);
    let y = L.BODY_TOP;
    col.forEach(g => {
      b.text(g.title.toUpperCase(), left, y + 4, colW, T.EYEBROW * 1.3, { size: T.EYEBROW, weight: W.HEAVY, color: C.GREEN, align: 'START', valign: 'TOP', noGroup: true });
      y += headH;
      g.items.forEach(x => {
        b.card(left, y + 1, colW, lineH - 3, { fill: C.TINT, border: null });
        b.button(String(x.code), left + 4, y + 3, codeW, lineH - 7, x.pageId, { size: T.CAPTION });
        const tx = left + 4 + codeW + 8;
        const tId = b.text(x.title, tx, y + 1, colW - (tx - left) - pageW - 8, lineH - 3, { size: T.BODY, weight: W.STRONG, color: C.INK, align: 'START', valign: 'MIDDLE', noGroup: true, nowrap: true });
        b.req.push({ updateTextStyle: { objectId: tId, textRange: { type: 'ALL' }, style: { link: { pageObjectId: x.pageId }, underline: false, foregroundColor: { opaqueColor: { rgbColor: hexToRgb(C.INK) } } }, fields: 'link,underline,foregroundColor' } });
        b.text(`hlm ${x.page}`, left + colW - pageW - 6, y + 1, pageW, lineH - 3, { size: T.CAPTION, color: C.MUTED, align: 'END', valign: 'MIDDLE', noGroup: true, nowrap: true });
        y += lineH;
      });
    });
  });
}

/* ------------------------------------------------------------------------- */
/* Agenda & Tujuan Pertemuan (slide 2)                                        */
/* ------------------------------------------------------------------------- */

/**
 * Kiri: kartu agenda bernomor (judul, deskripsi satu baris, durasi; judul dapat diklik ke slide terkait).
 * Kanan: kartu "Hasil yang dituju" (kuning lembut) berisi keputusan yang harus dihasilkan pertemuan + durasi total.
 * items: [{title, desc, minutes, pageId}]; outcomes: [string]
 */
function drawAgenda(b, items, outcomes) {
  const C = DECK_CONFIG.COLOR, L = DECK_CONFIG.LAYOUT, T = DECK_CONFIG.TYPE, W = DECK_CONFIG.WEIGHT;
  const A = L.CONTENT, I = L.INSIGHT;
  const list = (items || []).slice(0, 6);
  if (!list.length) return;
  const gap = L.ROW_GAP, top0 = L.BODY_TOP, avail = L.BOTTOM - top0;
  const rowH = Math.min(62, (avail - gap * (list.length - 1)) / list.length);
  const P = 11.25, d = 27, minW = 44;
  const textX = P + d + 9, textW = A.width - textX - minW - P;
  list.forEach((it, i) => {
    const top = top0 + i * (rowH + gap), cy = top + rowH / 2, left = A.left;
    b.card(left, top, A.width, rowH);
    b.rect(left + P, cy - d / 2, d, d, C.GREEN, 'ELLIPSE', true);
    b.text(String(i + 1), left + P + d / 2 - 16, cy - d / 2, 32, d, { weight: W.HEAVY, size: T.TOC_TITLE, color: C.ON_GREEN, noGroup: true, nowrap: true });
    const tH = T.CARD_TITLE * 1.25;
    const dLines = it.desc ? Math.min(2, estLines(it.desc, T.BODY, textW)) : 0, dH = dLines * T.BODY * 1.35;
    const bh = tH + (dH ? 2 + dH : 0);
    if (estWidth(it.title, T.CARD_TITLE, true) > textW) RUN_WARNINGS.push(`Agenda "${it.title}" terlalu panjang untuk satu baris.`);
    if (bh + 10 > rowH) RUN_WARNINGS.push(`Deskripsi agenda "${it.title}" terlalu panjang; persingkat menjadi satu baris.`);
    const tId = b.text(it.title, left + textX, cy - bh / 2, textW, tH, { weight: W.HEAVY, size: T.CARD_TITLE, color: C.INK, align: 'START', valign: 'TOP', noGroup: true, nowrap: true });
    if (it.pageId) b.req.push({ updateTextStyle: { objectId: tId, textRange: { type: 'ALL' },
      style: { link: { pageObjectId: it.pageId }, underline: false, foregroundColor: { opaqueColor: { rgbColor: hexToRgb(C.INK) } } },
      fields: 'link,underline,foregroundColor' } });
    if (it.desc) b.text(it.desc, left + textX, cy - bh / 2 + tH + 2, textW, dH, { size: T.BODY, color: C.MUTED, align: 'START', valign: 'TOP', lineSpacing: 120, noGroup: true });
    if (it.minutes) b.text(`${it.minutes} mnt`, left + A.width - P - minW, cy - 8, minW, 16, { size: T.CAPTION, weight: W.HEAVY, color: C.INK, align: 'END', valign: 'MIDDLE', noGroup: true, nowrap: true });
  });

  // Hasil yang dituju: keputusan yang harus disepakati di akhir pertemuan
  const oc = (outcomes || []).filter(Boolean).slice(0, 4);
  if (!oc.length) return;
  const total = list.reduce((a, it) => a + (Number(it.minutes) || 0), 0);
  const numW = 14, innerW = I.width - 2 * I.padX - numW;
  const lines = oc.map(o => estLines(o, T.BODY, innerW));
  const labelH = T.EYEBROW * 1.3 + 6.75, itemGap = 6.75, totalH = total ? 9 + T.CAPTION * 1.4 : 0;
  const need = I.padTop + labelH + lines.reduce((a, n) => a + n * T.BODY * 1.45, 0) + itemGap * (oc.length - 1) + totalH + I.padBottom;
  if (need > avail) RUN_WARNINGS.push('Kartu "Hasil yang dituju" terlalu panjang; persingkat hasil yang dituju.');
  b.card(I.left, top0, I.width, Math.min(avail, need), { fill: C.YELLOW_TINT || '#fff8d6', border: C.YELLOW });
  b.text('HASIL YANG DITUJU', I.left + I.padX, top0 + I.padTop, I.width - 2 * I.padX, T.EYEBROW * 1.3, { size: T.EYEBROW, weight: W.HEAVY, color: C.GREEN, align: 'START', valign: 'TOP', noGroup: true });
  let y = top0 + I.padTop + labelH;
  oc.forEach((o, i) => {
    const h = lines[i] * T.BODY * 1.45;
    b.text(`${i + 1}.`, I.left + I.padX, y, numW, T.BODY * 1.45, { size: T.BODY, weight: W.HEAVY, color: C.INK, align: 'START', valign: 'TOP', noGroup: true, nowrap: true });
    b.text(o, I.left + I.padX + numW, y, innerW, h, { size: T.BODY, color: C.INK, align: 'START', valign: 'TOP', lineSpacing: 135, noGroup: true });
    y += h + itemGap;
  });
  if (total) b.text(`Durasi total ${total} menit`, I.left + I.padX, y - itemGap + 9, I.width - 2 * I.padX, T.CAPTION * 1.4, { size: T.CAPTION, weight: W.STRONG, color: C.MUTED, align: 'START', valign: 'TOP', noGroup: true, nowrap: true });
}
