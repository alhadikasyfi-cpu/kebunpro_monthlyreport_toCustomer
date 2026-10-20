/**
 * File 3: TextAndDataMapper.gs
 * - Membaca setiap tabel berdasarkan TEKS HEADER. Batas akhir tabel = baris pertama yang KOSONG
 *   di seluruh kolom tabel itu (kolom tabel = sel header berurutan tanpa jeda di baris header).
 * - Metrik turunan: estimasi produksi, margin/ha, rasio upah/harga, rasio biaya/pendapatan.
 * - Analisis alur janjang (dipanen -> dimuat -> masuk trip -> terjual) dan estimasi kerugiannya.
 * - Fakta per topik + HUBUNGAN ANTAR-METRIK (rumus terverifikasi, korelasi, bulan puncak bersamaan)
 *   sebagai bahan sebab-akibat untuk Gemini.
 */

/* ------------------------------------------------------------------------- */
/* Angka & tanggal                                                           */
/* ------------------------------------------------------------------------- */

function isBlank(v) { return v === '' || v === null || v === undefined || String(v).trim() === ''; }

function parseNum(v) {
  if (isBlank(v)) return null;
  if (typeof v === 'number') return v;
  let s = String(v).trim().replace(/[^\d.,-]/g, '');
  if (!s || s === '-') return null;
  const hasDot = s.includes('.'), hasComma = s.includes(',');
  if (hasDot && hasComma) {
    // pemisah yang paling akhir = desimal: 2,910.26 (EN) atau 2.910,26 (ID)
    s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (hasComma) {
    s = /^-?\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');   // 2,831,330 | 12,5
  } else if (hasDot && (s.match(/\./g) || []).length > 1) {
    s = s.replace(/\./g, '');                                                         // 1.234.567
  }
  const n = Number(s);
  return isNaN(n) ? null : n;
}

/** Tanggal sel (Date atau teks d/m/yyyy) -> {y, m} */
const MONTH_NAMES = { jan: 0, feb: 1, mar: 2, apr: 3, mei: 4, may: 4, jun: 5, jul: 6, agu: 7, agt: 7, aug: 7, ags: 7,
  sep: 8, okt: 9, oct: 9, nov: 10, des: 11, dec: 11 };

function parseMonth(v) {
  if (v instanceof Date) return { y: v.getFullYear(), m: v.getMonth() };
  const s = String(v || '').trim();
  let mt = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if (mt) {
    const a = Number(mt[1]), b = Number(mt[2]);
    const mon = DECK_CONFIG.DATE_ORDER === 'MDY' ? a : b;
    return mon >= 1 && mon <= 12 ? { y: Number(mt[3]), m: mon - 1 } : null;
  }
  mt = s.match(/^(\d{4})[\/\-.](\d{1,2})/);
  if (mt) return { y: Number(mt[1]), m: Number(mt[2]) - 1 };
  mt = s.match(/^([A-Za-z]{3,})\.?\s+(\d{4})$/);                          // Okt 2025 | October 2025
  if (mt && MONTH_NAMES[mt[1].slice(0, 3).toLowerCase()] !== undefined) return { y: Number(mt[2]), m: MONTH_NAMES[mt[1].slice(0, 3).toLowerCase()] };
  return null;
}

function monthShort(p) { return p ? `${BULAN_PENDEK[p.m]} ${String(p.y).slice(2)}` : ''; }
function monthLong(p) { return p ? `${BULAN_PANJANG[p.m]} ${p.y}` : ''; }
function mkey(p) { return `${p.y}-${p.m}`; }

/** Format angka gaya deck: titik desimal, koma ribuan (sama seperti data sumber). */
/**
 * Format angka Indonesia (design system CBR): titik untuk ribuan, koma untuk desimal (1.842 · 4,21 · 8,2%).
 * Angka untuk mesin (tabel CSV ke Gemini) TIDAK memakai fungsi ini, tetapi num().
 */
function fmt(n, dec) {
  if (n === null || n === undefined || isNaN(n)) return '-';
  const d = dec === undefined ? 2 : dec;
  const parts = Math.abs(n).toFixed(d).split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return (n < 0 ? '-' : '') + parts.join(',');
}
/** Angka format mesin (titik desimal, tanpa pemisah ribuan) untuk data mentah. */
function num(n, dec) { return n === null || n === undefined || isNaN(n) ? '' : Number(n).toFixed(dec === undefined ? 2 : dec); }
function fmtRp(n) {
  if (n === null || n === undefined) return '-';
  const a = Math.abs(n), sign = n < 0 ? '-' : '';
  if (a >= 1e9) return `${sign}Rp${fmt(a / 1e9, 2)} miliar`;
  if (a >= 1e6) return `${sign}Rp${fmt(a / 1e6, 2)} juta`;
  return `${sign}Rp${fmt(a, 0)}`;
}
/** Rupiah dipisah angka & satuan untuk kartu KPI: {value:'736,4', unit:'juta Rp'}. */
function rpParts(n, dec) {
  const d = dec === undefined ? 1 : dec;
  if (n === null || n === undefined) return { value: '-', unit: '' };
  const a = Math.abs(n), sign = n < 0 ? '-' : '';
  if (a >= 1e9) return { value: sign + fmt(a / 1e9, d), unit: 'miliar Rp' };
  if (a >= 1e6) return { value: sign + fmt(a / 1e6, d), unit: 'juta Rp' };
  return { value: sign + fmt(a, 0), unit: 'Rp' };
}
function fmtPct(n, dec) { return n === null || n === undefined ? '-' : `${fmt(n, dec === undefined ? 1 : dec)}%`; }

/* ------------------------------------------------------------------------- */
/* Pembacaan sheet                                                           */
/* ------------------------------------------------------------------------- */

function norm(s) { return String(s || '').trim().toLowerCase(); }

function findCell(values, aliases) {
  const list = (Array.isArray(aliases) ? aliases : [aliases]).map(norm);
  for (let r = 0; r < values.length; r++) {
    for (let c = 0; c < values[r].length; c++) {
      if (list.indexOf(norm(values[r][c])) >= 0) return { r, c };
    }
  }
  // Cadangan: header dengan keterangan dalam kurung, mis. "block sale (name, luas, tahun tanam, soil type)" -> "block sale"
  const bare = v => norm(v).replace(/\s*\(.*\)\s*$/, '');
  for (let r = 0; r < values.length; r++) {
    for (let c = 0; c < values[r].length; c++) {
      if (typeof values[r][c] === 'string' && /\(.*\)\s*$/.test(values[r][c]) && list.indexOf(bare(values[r][c])) >= 0) return { r, c };
    }
  }
  return null;
}

/**
 * Kolom tabel yang berawal di (headerRow, c0): sel header berurutan tanpa jeda.
 * Baris data = mulai headerRow+1 sampai sebelum baris pertama yang kosong di SEMUA kolom tabel.
 */
function tableBounds(values, headerRow, c0) {
  // Kolom tabel = header bersambung; berhenti juga bila bertemu kolom kunci tabel lain (year_month/month)
  // karena di sheet terbaru tabel Upkeep Cost dan tabel biaya bisa bersebelahan tanpa kolom kosong.
  const monthAliases = DECK_CONFIG.HEADERS.MONTH.map(norm);
  // Berhenti juga bila header pertama muncul lagi (tabel mandor rawat/panen/muat bersebelahan: "Nama ... Nama ...").
  const first = norm(values[headerRow][c0]);
  let c1 = c0;
  while (c1 + 1 < values[headerRow].length && !isBlank(values[headerRow][c1 + 1]) &&
         norm(values[headerRow][c1 + 1]) !== first &&
         !(monthAliases.indexOf(norm(values[headerRow][c1 + 1])) >= 0 && monthAliases.indexOf(first) < 0)) c1++;
  let r1 = headerRow;
  for (let r = headerRow + 1; r < values.length; r++) {
    let empty = true;
    for (let c = c0; c <= c1; c++) if (!isBlank(values[r][c])) { empty = false; break; }
    if (empty) break;
    r1 = r;
  }
  return { c0, c1, r0: headerRow + 1, r1 };
}

/**
 * Seri bulanan untuk satu header nilai. Kolom bulan = sel 'year_month' terdekat di kiri pada baris header.
 * Mengembalikan [{p:{y,m}, label, value|null}] atau [] bila header tidak ada.
 */
function readMonthly(values, aliases, raw) {
  const h = findCell(values, aliases);
  if (!h) return [];
  let kc = -1;
  for (let c = h.c; c >= 0; c--) {
    if (DECK_CONFIG.HEADERS.MONTH.map(norm).indexOf(norm(values[h.r][c])) >= 0) { kc = c; break; }
  }
  if (kc < 0) return [];
  const b = tableBounds(values, h.r, kc);
  const out = [];
  for (let r = b.r0; r <= b.r1; r++) {
    const p = parseMonth(values[r][kc]);
    // Teks bukan tanggal setelah data bulanan = awal bagian lain (mis. "Analisis Pengeluaran"): tabel selesai
    if (!p && out.length && typeof values[r][kc] === 'string' && /[A-Za-z]{3,}/.test(values[r][kc]) && !/^[A-Za-z]{3,9}\s+\d{2,4}$/.test(values[r][kc].trim())) break;
    if (!p) {
      RUN_WARNINGS.push(`Baris ${r + 1}: bulan tidak terbaca pada tabel '${values[h.r][h.c]}', dilewati.`);
      continue;
    }
    out.push({ p, label: monthShort(p), value: raw ? String(values[r][h.c] || '') : parseNum(values[r][h.c]) });
  }
  return out;
}

/** Tabel di bawah sebuah label (mis. 'Top Mandor Panen'): header di baris berikutnya, kolom yang sama. */
function readTableBelow(display, aliases, headerAliases) {
  let l = findCell(display, aliases);
  // Cadangan: judul tabel diberi catatan (mis. "Upkeep Cost 12 bulan juga") -> cari sel header kolom pertamanya
  if (!l && headerAliases) { const h = findCell(display, headerAliases); if (h && h.r > 0) l = { r: h.r - 1, c: h.c }; }
  if (!l || l.r + 1 >= display.length || isBlank(display[l.r + 1][l.c])) return null;
  const b = tableBounds(display, l.r + 1, l.c);
  const headers = [];
  for (let c = b.c0; c <= b.c1; c++) headers.push(display[l.r + 1][c]);
  const rows = [];
  for (let r = b.r0; r <= b.r1; r++) {
    const row = [];
    for (let c = b.c0; c <= b.c1; c++) row.push(display[r][c]);
    rows.push(row);
  }
  return { headers, rows };
}

/** Gabungkan dua seri berdasarkan bulan. */
function combine(a, b, fn) {
  const map = {};
  b.forEach(x => { map[mkey(x.p)] = x.value; });
  return a.map(x => {
    const bv = map[mkey(x.p)];
    const v = x.value === null || bv === null || bv === undefined ? null : fn(x.value, bv);
    return { p: x.p, label: x.label, value: v === null || !isFinite(v) ? null : v };
  });
}

/** Nilai di kanan sebuah label (mis. 'Lokasi' | 'Dumai'). */
function valueRightOf(display, aliases, fallback) {
  const c = findCell(display, aliases);
  if (!c) return fallback || '';
  // Hanya sel tepat di kanan label. Jika kosong, dianggap tidak diisi
  // (jangan mengambil teks lain di baris yang sama, mis. judul grafik).
  const v = display[c.r][c.c + 1];
  return isBlank(v) ? (fallback || '') : String(v).trim();
}

/**
 * Cek semua file script sudah ada di proyek Apps Script. File yang belum disalin membuat fungsi tidak dikenal
 * ("... is not defined"); pesan ini menyebut nama file yang perlu ditambahkan.
 */
function checkProjectFiles() {
  const missing = [];
  if (typeof setupTemplate !== 'function') missing.push('2_TemplateBuilder.gs');
  if (typeof buildClaudePacket !== 'function') missing.push('4_ClaudeBridge.gs');
  if (typeof planDeck !== 'function') missing.push('5_MainController.gs');
  if (typeof drawCompareRows !== 'function') missing.push('6_ShapeCharts.gs');
  if (typeof detectRecommendations !== 'function') missing.push('7_RecommendationCatalog.gs');
  if (typeof marihatAt !== 'function') missing.push('8_StandarMarihat.gs');
  if (typeof buildFertilizerStatus !== 'function') missing.push('9_TanahPupuk.gs');
  if (typeof buildBlockProduction !== 'function') missing.push('10_ProduksiBlok.gs');
  if (missing.length) throw new Error(`File script belum lengkap di proyek Apps Script: ${missing.join(', ')}. ` +
    'Tambahkan file tersebut (Editor > + > Skrip, nama file sama persis tanpa ".gs") lalu tempel isinya, simpan, dan jalankan ulang.');
}

function getSheetData(sheet) {
  if (!sheet) throw new Error('Sheet tidak ditemukan. Jalankan dari Google Sheets yang aktif.');
  checkProjectFiles();
  const rng = sheet.getDataRange();
  const values = rng.getValues();
  const display = rng.getDisplayValues();
  const H = DECK_CONFIG.HEADERS;

  const d = {
    sheetName: sheet.getName(),
    title: valueRightOf(display, H.TITLE_LABEL, sheet.getName()),
    period: valueRightOf(display, H.PERIOD_LABEL, ''),
    location: valueRightOf(display, H.LOCATION_LABEL, ''),
    landClassRaw: valueRightOf(display, H.LAND_CLASS_LABEL, ''),
    sphRaw: valueRightOf(display, H.SPH_LABEL, ''),
    yield: readMonthly(values, H.YIELD),
    jjgHa: readMonthly(values, H.JJG_HA),
    luasPanen: readMonthly(values, H.LUAS_PANEN),
    hargaJual: readMonthly(values, H.HARGA_JUAL),
    totalJjg: readMonthly(values, H.TOTAL_JJG),
    tonase: readMonthly(values, H.TONASE),
    saleJjg: readMonthly(values, H.SALE_JJG),
    noWeightJjg: readMonthly(values, H.NOWEIGHT_JJG),
    blocksRaw: readMonthly(values, H.BLOCKS, true),
    blocksUnsaleRaw: readMonthly(values, H.BLOCKS_UNSALE, true),
    bjr: readMonthly(values, H.BJR),
    costUpkeep: readMonthly(values, H.COST_UPKEEP),
    costHarvest: readMonthly(values, H.COST_HARVEST),
    costLoad: readMonthly(values, H.COST_LOAD),
    costTotal: readMonthly(values, H.COST_TOTAL),
    revenueIdr: readMonthly(values, H.REVENUE_IDR),
    flowPanen: readMonthly(values, H.FLOW_PANEN),
    flowMuat: readMonthly(values, H.FLOW_MUAT),
    flowTrip: readMonthly(values, H.FLOW_TRIP),
    flowSold: readMonthly(values, H.FLOW_SOLD),
    flowSoldNoWeight: readMonthly(values, H.FLOW_SOLD_NOWEIGHT),
    inputDateRaw: valueRightOf(display, H.INPUT_DATE_LABEL, ''),
    revKg: readMonthly(values, H.REV_KG),
    upahKg: readMonthly(values, H.UPAH_KG),
    revHa: readMonthly(values, H.REV_HA),
    costHa: readMonthly(values, H.COST_HA),
    upkeep: readTableBelow(display, H.UPKEEP_LABEL, H.UPKEEP_HEADER),
    rawat: readTableBelow(display, H.RAWAT_LABEL),
    panen: readTableBelow(display, H.PANEN_LABEL),
    muat: readTableBelow(display, H.MUAT_LABEL)
  };

  // Acuan "Bulan Ini" untuk tabel mandor (tanggal input admin bila ada)
  const ip = parseMonth(d.inputDateRaw) || (d.inputDateRaw ? parseMonth(String(d.inputDateRaw).replace(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4}).*$/, '$1/$2/$3')) : null);
  MANDOR_REF_DATE = ip ? new Date(ip.y, ip.m, 15) : null;
  // panggil ulang parser mandor bila acuan berubah (tabel dibaca sebelum acuan diketahui)

  // Tabel alur terbaru: "jjg Terjual" = terjual BERBERAT, "jjg Terjual tanpa berat" terpisah.
  // Tahap "Terjual" di corong = total keduanya; porsi tanpa berat ditampilkan terpisah.
  d.flowSoldWeighted = d.flowSold;
  if (d.flowSoldNoWeight.some(x => x.value !== null)) {
    d.flowSold = d.flowSold.map(x => { const nw = valAt(d.flowSoldNoWeight, x.p);
      return { p: x.p, label: x.label, value: x.value === null && nw === null ? null : (x.value || 0) + (nw || 0) }; });
  }

  // Periode tabel upkeep per aktivitas: dicocokkan dengan biaya upkeep bulanan (satu bulan, atau total seluruh bulan)
  d.upkeepPeriod = DECK_CONFIG.UPKEEP_ACTIVITY_PERIOD;
  if (d.upkeep && d.costUpkeep.length) {
    const tot = d.upkeep.rows.reduce((a, r) => a + (parseNum(r[1]) || 0), 0);
    const near = (a, b) => !!b && Math.abs(a - b) <= Math.max(1, b * 0.005);
    const now = new Date(), curKey = mkey({ y: now.getFullYear(), m: now.getMonth() });
    const hit = d.costUpkeep.find(x => near(tot, x.value));
    if (hit) d.upkeepPeriod = mkey(hit.p) === curKey ? `${monthLong(hit.p)} (bulan berjalan, belum lengkap)` : monthLong(hit.p);
    else if (near(tot, d.costUpkeep.reduce((a, x) => a + (x.value || 0), 0))) d.upkeepPeriod = `${d.costUpkeep.length} bulan data`;
  }

  // Bulan berjalan (belum lengkap) dikeluarkan dari analisis
  d.partialMonth = null;
  if (DECK_CONFIG.EXCLUDE_CURRENT_MONTH) {
    const now = new Date();
    const cur = { y: now.getFullYear(), m: now.getMonth() };
    // semua seri bulanan (array berisi {p, value}) ikut disaring
    const seriesKeys = Object.keys(d).filter(k => Array.isArray(d[k]) && d[k].length && d[k][0] && d[k][0].p);
    if (seriesKeys.some(k => d[k].some(x => mkey(x.p) === mkey(cur)))) {
      d.partialMonth = monthLong(cur);
      // Bulan berjalan tidak dianalisis, tetapi penjualannya dipakai untuk mengecek sisa panen bulan laporan yang baru terjual
      const pv = k => valAt(d[k] || [], cur);
      if (pv('flowPanen') !== null && pv('flowSold') !== null) d.partialFlow = { p: cur, panen: pv('flowPanen'), sold: pv('flowSold') };
      seriesKeys.forEach(k => { d[k] = d[k].filter(x => mkey(x.p) !== mkey(cur)); });
      RUN_WARNINGS.push(`Data ${d.partialMonth} adalah bulan berjalan (belum lengkap) dan tidak dimasukkan ke analisis.`);
    }
  }

  // Nilai 0 yang mustahil untuk bulan panen (harga 0, yield 0, dst.) dianggap belum diinput -> kosong
  d.zeroFixes = [];
  [['yield', 'yield'], ['jjgHa', 'JJG/ha'], ['luasPanen', 'luas panen'], ['hargaJual', 'harga jual/kg'], ['totalJjg', 'total janjang'],
   ['tonase', 'tonase'], ['bjr', 'BJR'], ['revKg', 'pendapatan/kg'], ['revHa', 'pendapatan/ha'], ['revenueIdr', 'pendapatan']].forEach(([k, name]) => {
    const months = [];
    d[k] = d[k].map(x => { if (x.value === 0) { months.push(monthShort(x.p)); return { p: x.p, label: x.label, value: null }; } return x; });
    if (months.length) d.zeroFixes.push(`${name} tercatat 0 pada ${months.join(', ')} (dianggap belum diinput)`);
  });

  // Biaya/upah yang 0 di SEMUA bulan berarti belum dicatat (bukan gratis) -> dikosongkan agar margin tidak menyesatkan
  [['upahKg', 'biaya pekerja/kg'], ['costHa', 'biaya/ha'], ['costTotal', 'total biaya']].forEach(([k, name]) => {
    const vals = d[k].filter(x => x.value !== null);
    if (vals.length && vals.every(x => x.value === 0)) {
      d[k] = d[k].map(x => ({ p: x.p, label: x.label, value: null }));
      d.zeroFixes.push(`${name} tercatat 0 di seluruh periode (dianggap belum dicatat; margin dan efisiensi biaya tidak dihitung)`);
    }
  });
  // Komponen biaya bernilai 0 di semua bulan = customer belum memakai fitur pencatatan biaya itu (bukan anomali)
  d.featureNotes = [];
  [['costUpkeep', 'biaya perawatan (upkeep)'], ['costLoad', 'biaya muat'], ['costHarvest', 'biaya panen']].forEach(([k, name]) => {
    const vals = d[k].filter(x => x.value !== null);
    if (vals.length && vals.every(x => x.value === 0)) {
      d[k] = d[k].map(x => ({ p: x.p, label: x.label, value: null }));
      d.featureNotes.push(`${name} bernilai 0 di semua bulan: customer belum memakai fitur pencatatan ${name}, sehingga total biaya belum mencakup komponen ini`);
    }
  });

  // Metrik turunan
  // Produksi: pakai tonase aktual bila ada, jika tidak estimasi yield × luas panen
  d.produksiActual = d.tonase.some(x => x.value !== null);
  d.produksi = d.produksiActual ? d.tonase.map(x => ({ p: x.p, label: x.label, value: x.value }))
                                : combine(d.yield, d.luasPanen, (y, l) => y * l);
  // BJR pembanding: tonase ÷ total janjang (aktual) atau yield ÷ JJG/ha
  d.bjrImplied = d.produksiActual && d.saleJjg.some(x => x.value)
    ? combine(d.tonase, d.saleJjg, (t, n) => (n ? (t * 1000) / n : null))
    : d.produksiActual && d.totalJjg.length
    ? combine(d.tonase, d.totalJjg, (t, n) => (n ? (t * 1000) / n : null))
    : combine(d.yield, d.jjgHa, (y, j) => (j ? (y * 1000) / j : null));
  d.bjrImpliedLabel = d.produksiActual && d.saleJjg.some(x => x.value) ? 'BJR dari tonase ÷ janjang terjual dengan berat'
    : d.produksiActual ? 'BJR dari tonase ÷ total janjang' : 'BJR dari yield ÷ JJG/ha';
  // Pendapatan bulanan kebun (Rp) = tonase × 1000 × harga jual/kg
  d.revenueTotal = combine(d.produksi, d.hargaJual.length ? d.hargaJual : d.revKg, (t, h) => t * 1000 * h);
  d.revenueBasis = 'tonase × harga jual';
  if (d.revenueIdr.some(x => x.value)) { d.revenueTotal = d.revenueIdr; d.revenueBasis = 'pendapatan tercatat (tonase terjual × harga)'; }
  // Laba kotor bulanan (Rp) = pendapatan tercatat − total biaya pekerja
  d.profit = combine(d.revenueIdr, d.costTotal, (r, c) => r - c);
  d.margin = combine(d.revHa, d.costHa, (r, c) => r - c);                           // Rp/ha
  d.upahRatio = combine(d.upahKg, d.revKg, (u, r) => (r ? (u / r) * 100 : null));   // %
  d.costRatio = combine(d.costHa, d.revHa, (c, r) => (r ? (c / r) * 100 : null));   // %
  // Analisis umur blok memakai SEMUA blok (berpenjualan + tanpa penjualan) per bulan
  d.blocksSaleRaw = d.blocksRaw;
  if (d.blocksUnsaleRaw.length) {
    const keys = {};
    d.blocksRaw.concat(d.blocksUnsaleRaw).forEach(x => { keys[mkey(x.p)] = x.p; });
    d.blocksRaw = Object.keys(keys).map(k => keys[k]).sort((a, b) => a.y - b.y || a.m - b.m).map(p => {
      const a = valAt(d.blocksSaleRaw, p) || '', b2 = valAt(d.blocksUnsaleRaw, p) || '';
      return { p, label: monthShort(p), value: [a, b2].filter(x => String(x).trim()).join('; ') };
    });
  }
  d.blocks = buildBlockAnalytics(d);
  d.unsale = buildUnsaleAnalytics(d);
  d.noWeight = buildNoWeightAnalytics(d);
  d.rawatActivities = parseRawatTable(d.rawat);
  d.months = d.yield.length;
  // Bulan pertama yang belum penuh (mis. awal layanan) tidak ikut menentukan tren
  RAMP_KEY = null;
  const lpv = d.luasPanen.filter(x => x.value !== null);
  if (lpv.length >= 3) {
    const sorted = lpv.map(x => x.value).sort((a, b) => a - b), med = sorted[Math.floor(sorted.length / 2)];
    if (lpv[0].value < med * DECK_CONFIG.THRESHOLDS.FIRST_MONTH_RAMP) RAMP_KEY = mkey(lpv[0].p);
  }
  d.rampMonth = RAMP_KEY;
  const lc = String(d.landClassRaw || '').toUpperCase().match(/S[123]/);
  d.landClass = lc ? lc[0] : DECK_CONFIG.DEFAULT_LAND_CLASS;
  d.landClassAssumed = !lc;
  d.sph = parseNum(d.sphRaw) || DECK_CONFIG.SPH_DEFAULT;
  d.sphAssumed = !parseNum(d.sphRaw);
  // Jenis tanah per blok (file 9)
  d.soil = buildSoilAnalytics(d);
  // Tonase = berat janjang TERJUAL: BJR sebenarnya = tonase ÷ janjang terjual (kumulatif), dan
  // produksi panen diestimasi = janjang dipanen × BJR tersebut (untuk dibandingkan dengan standar Marihat).
  d.bjrSoldCum = null; d.bjrSoldMonthly = []; d.produksiPanen = null;
  // Penyebut BJR = janjang terjual YANG ADA BERATNYA (total_sale_jjg) bila tersedia; janjang tanpa berat tidak ikut,
  // karena tonasenya tidak tercatat. Bila kolom itu tidak ada, dipakai janjang terjual di tabel alur.
  const soldDen = d.saleJjg.some(x => x.value) ? d.saleJjg : (d.flowSoldWeighted || d.flowSold);
  d.bjrDenominator = soldDen === d.saleJjg ? 'janjang terjual yang ada beratnya' : 'janjang terjual (tabel alur)';
  if (DECK_CONFIG.TONASE_BASIS === 'terjual' && soldDen.length) {
    const ms = d.produksi.filter(x => x.value !== null && valAt(soldDen, x.p));
    const tS = ms.reduce((a, x) => a + x.value, 0), jS = ms.reduce((a, x) => a + valAt(soldDen, x.p), 0);
    if (jS) d.bjrSoldCum = (tS * 1000) / jS;
    d.bjrSoldMonthly = d.produksi.map(x => { const j = valAt(soldDen, x.p);
      return { p: x.p, label: x.label, value: x.value !== null && j ? (x.value * 1000) / j : null }; });
    if (d.bjrSoldCum && d.flowPanen.length) {
      d.produksiPanen = d.flowPanen.map(x => ({ p: x.p, label: x.label, value: x.value !== null ? (x.value * d.bjrSoldCum) / 1000 : null }));
    }
  }
  d.marihat = buildMarihat(d);
  // Rekomendasi pupuk prediksi (file 9; butuh produksi realisasi dari Marihat). Dihitung ulang di loadSheetData
  // setelah tabel hara sheet "pupuk", dosis NPK aktual, dan harga NPK dibaca.
  d.fertilizer = buildFertilizerNeed(d);
  d.npk = d.fertilizer;
  d.blockProd = buildBlockProduction(d);   // produksi per blok (file 10), bukti untuk status pupuk
  d.fertStatus = buildFertilizerStatus(d);
  d.flow = buildFlow(d);
  // Tonase = berat janjang DIPANEN: penjualan hanya dari janjang yang terjual -> tonase × (terjual ÷ dipanen) × harga
  if (DECK_CONFIG.TONASE_BASIS !== 'terjual' && d.flowSold.length && d.flowPanen.length) {
    const price = d.hargaJual.length ? d.hargaJual : d.revKg;
    d.revenueTotal = d.produksi.map(x => {
      const pn = valAt(d.flowPanen, x.p), sd = valAt(d.flowSold, x.p), h = valAt(price, x.p);
      const v = x.value !== null && pn && sd !== null && h ? x.value * (sd / pn) * 1000 * h : null;
      return { p: x.p, label: x.label, value: v };
    });
    d.revenueBasis = 'janjang terjual × BJR (tonase ÷ janjang dipanen) × harga jual';
  }
  d.snapshot = (d.months - (RAMP_KEY ? 1 : 0)) < DECK_CONFIG.MIN_MONTHS_FOR_TREND;
  d.dataPeriod = d.months ? (d.months === 1 ? monthLong(d.yield[0].p) : `${monthShort(d.yield[0].p).replace(' ', ' 20')} – ${monthShort(d.yield[d.months - 1].p).replace(' ', ' 20')}`) : '';
  d.bjrAcuan = buildBjrAcuan(d);
  d.mandorPanen = parseMandorTable(d.panen);
  d.mandorMuat = parseMandorTable(d.muat);
  d.ageMonthly = d.blocks ? d.blocks.monthly.map(m => ({ p: m.p, label: m.label, value: m.avgAge })) : [];
  return d;
}

/* ------------------------------------------------------------------------- */
/* Analisis blok (nama, luas, tahun tanam)                                   */
/* ------------------------------------------------------------------------- */

/**
 * "E4, 4.5 ha, 2010, Gambut, 342; A9, 2.48 ha, 1998, -, 87" -> [{name, ha, year|null, soil|null, jjg|null}]
 * Bagian ke-4 (jenis tanah) dan ke-5 (janjang DIPANEN di blok itu pada bulan itu) opsional;
 * "-" atau kosong = belum tercatat. Tahun 0 = belum tercatat. Janjang kosong = belum tercatat (bukan nol).
 */
function parseBlocks(text) {
  return String(text || '').split(';').map(t => t.trim()).filter(Boolean).map(t => {
    const m = t.match(/^(.*?),\s*([\d.,]+)\s*ha\s*,\s*(\d{1,4})\s*(?:,\s*(.*?))?\s*$/i);
    if (!m) return null;
    const year = Number(m[3]);
    let soil = String(m[4] || '').trim(), jjg = null;
    const j = soil.match(/^(.*?)\s*,\s*([\d.]+)\s*$/);           // "-, 342" | "Gambut, 1084"
    if (j) { soil = j[1].trim(); jjg = parseNum(j[2]); }
    return { name: m[1].trim(), ha: parseNum(m[2]) || 0, year: year >= 1950 ? year : null,
             soil: soil && !/^[-–—]+$/.test(soil) ? soil : null, jjg };
  }).filter(Boolean);
}

function ageClassOf(age) {
  if (age === null || age === undefined) return 'Tahun tanam tidak tercatat';
  const c = DECK_CONFIG.AGE_CLASSES.find(k => age >= k.min && age <= k.max);
  return c ? c.name : 'Tahun tanam tidak tercatat';
}

function buildBlockAnalytics(d) {
  if (!d.blocksRaw.length) return null;
  const refYear = d.blocksRaw[d.blocksRaw.length - 1].p.y;
  const uniq = {};
  const seenBefore = {};
  const monthly = d.blocksRaw.map(row => {
    const list = parseBlocks(row.value);
    let haSum = 0, ageHa = 0, ageHaBase = 0, oldHa = 0, newCount = 0, newHa = 0;
    // Bila janjang blok yang tercatat bulan itu sudah sama dengan total janjang kebun, isian blok tanpa janjang = 0 janjang
    const recSum = list.reduce((a, b) => a + (b.jjg || 0), 0), tot = valAt(d.totalJjg || [], row.p);
    const fullMonth = list.some(b => b.jjg !== null && b.jjg !== undefined) && tot && Math.abs(recSum - tot) <= tot * 0.01;
    list.forEach(b => {
      if (fullMonth && (b.jjg === null || b.jjg === undefined)) b.jjg = 0;
      const key = `${b.name}|${b.ha}|${b.year}`;
      if (!uniq[key]) uniq[key] = { name: b.name, ha: b.ha, year: b.year, soil: null, months: 0, jjgSum: 0, jjgMonths: 0, jjgRec: 0, jjgByMonth: {}, firstP: row.p };
      uniq[key].months++;
      if (b.soil) uniq[key].soil = b.soil;   // jenis tanah: isian terakhir yang tercatat
      if (b.jjg !== null && b.jjg !== undefined) {   // janjang dipanen per blok (bagian ke-5)
        uniq[key].jjgSum += b.jjg; uniq[key].jjgByMonth[mkey(row.p)] = (uniq[key].jjgByMonth[mkey(row.p)] || 0) + b.jjg;
        uniq[key].jjgRec++;
        if (b.jjg > 0) uniq[key].jjgMonths++;
      }
      if (!seenBefore[key] && Object.keys(seenBefore).length) { newCount++; newHa += b.ha; }
      haSum += b.ha;
      if (b.year) {
        const age = row.p.y - b.year;
        ageHa += age * b.ha; ageHaBase += b.ha;
        if (age > DECK_CONFIG.THRESHOLDS.REPLANT_AGE) oldHa += b.ha;
      }
    });
    list.forEach(b => { seenBefore[`${b.name}|${b.ha}|${b.year}`] = true; });
    return {
      p: row.p, label: row.label, count: list.length, haSum,
      avgAge: ageHaBase ? ageHa / ageHaBase : null,
      oldShare: haSum ? (oldHa / haSum) * 100 : null,
      newCount, newHa
    };
  });
  const blocks = Object.keys(uniq).map(k => {
    const b = uniq[k];
    b.age = b.year ? refYear - b.year : null;
    b.cls = ageClassOf(b.age);
    return b;
  });
  const totalHa = blocks.reduce((s, b) => s + b.ha, 0);
  const classes = DECK_CONFIG.AGE_CLASSES.map(c => c.name).concat(['Tahun tanam tidak tercatat']).map(name => {
    const arr = blocks.filter(b => b.cls === name);
    const ha = arr.reduce((s, b) => s + b.ha, 0);
    return { name, value: ha, pct: totalHa ? (ha / totalHa) * 100 : 0, count: arr.length };
  }).filter(c => c.value > 0);
  const replant = blocks.filter(b => b.age !== null && b.age > DECK_CONFIG.THRESHOLDS.REPLANT_AGE).sort((a, b) => b.ha - a.ha);
  // Blok yang janjangnya dicatat tetapi selalu 0 (tidak pernah menghasilkan) -> tidak dipakai sebagai pembagi produktivitas
  const zeroJjg = blocks.filter(b => b.jjgRec > 0 && b.jjgSum === 0);
  // Tahun tanam lebih baru dari bulan panen pertama blok itu = tahun tanam salah catat
  const yearAfterHarvest = blocks.filter(b => b.year && b.firstP && b.year > b.firstP.y);
  return { refYear, monthly, blocks, totalHa, classes, replant, zeroJjg, zeroJjgHa: zeroJjg.reduce((s, b) => s + b.ha, 0), yearAfterHarvest,
           unknownYear: blocks.filter(b => !b.year) };
}

function describeBlocks(d) {
  const B = d.blocks;
  if (!B) return 'Data blok: ANOMALI: belum tersedia.';
  const L = [`Blok dipanen (${B.blocks.length} blok unik, total ${fmt(B.totalHa, 1)} ha; umur dihitung per tahun ${B.refYear}):`];
  B.classes.forEach(c => L.push(`- ${c.name}: ${fmt(c.value, 1)} ha (${fmtPct(c.pct, 0)}, ${c.count} blok)`));
  if (B.replant.length) L.push(`- Lewat umur ekonomis (>${DECK_CONFIG.THRESHOLDS.REPLANT_AGE} th): ${B.replant.length} blok, ${fmt(B.replant.reduce((s, b) => s + b.ha, 0), 1)} ha; terbesar: ${B.replant.slice(0, 5).map(b => `${b.name} ${fmt(b.ha, 2)} ha tanam ${b.year}`).join(', ')}`);
  if (B.zeroJjg && B.zeroJjg.length) L.push(`PERLU DICEK: ${B.zeroJjg.length} blok (${fmt(B.zeroJjgHa, 1)} ha) tercantum di daftar blok tetapi janjangnya 0 di semua bulan, mis. ${B.zeroJjg.slice(0, 4).map(b => `${b.name} ${fmt(b.ha, 1)} ha`).join(', ')}; blok ini tidak dihitung dalam luas pembagi produktivitas. Pastikan blok memang belum menghasilkan atau janjangnya tercatat di blok lain.`);
  if (B.yearAfterHarvest && B.yearAfterHarvest.length) L.push(`PERLU DICEK: ${B.yearAfterHarvest.length} blok bertahun tanam setelah bulan panen pertamanya (mustahil), mis. ${B.yearAfterHarvest.slice(0, 4).map(b => `${b.name} tanam ${b.year}, dipanen sejak ${monthShort(b.firstP)}`).join(', ')}; perbaiki tahun tanam agar umur dan standar Marihat benar.`);
  if (B.unknownYear.length) L.push(`- ANOMALI: ${B.unknownYear.length} blok tanpa tahun tanam (tercatat 0): ${B.unknownYear.slice(0, 6).map(b => b.name).join(', ')}`);
  L.push('- Per bulan (jumlah blok | total ha di daftar blok | umur rata-rata tertimbang luas | % luas >25 th | blok baru pertama kali muncul):');
  B.monthly.forEach(m => L.push(`  ${m.label}: ${m.count} blok | ${fmt(m.haSum, 1)} ha | ${fmt(m.avgAge, 1)} th | ${fmtPct(m.oldShare, 0)} | ${m.newCount} blok baru (${fmt(m.newHa, 1)} ha)`));
  const sumMismatch = B.monthly.filter(m => {
    const lp = valAt(d.luasPanen, m.p);
    return lp && m.haSum && Math.abs(m.haSum / lp - 1) > DECK_CONFIG.THRESHOLDS.BLOCK_HA_MISMATCH;
  });
  if (sumMismatch.length) L.push(`- CATATAN: total ha di daftar blok berbeda >10% dari kolom luas panen pada ${sumMismatch.map(m => m.label).join(', ')} (luas panen kemungkinan menghitung rotasi/ronde panen berulang).`);
  return L.join('\n');
}

/** Tabel ringkas seluruh metrik bulanan (sekali saja di prompt, hemat token). */
function buildMonthlyTable(d) {
  const cols = [
    ['bulan', null], ['yield_ton_ha', d.yield, 2], ['jjg_ha', d.jjgHa, 2], ['bjr_kg', d.bjr, 2], ['bjr_implisit_kg', d.bjrImplied, 2],
    ['luas_panen_ha', d.luasPanen, 2], ['total_jjg', d.totalJjg, 0], [d.produksiActual ? 'tonase_aktual_ton' : 'estimasi_produksi_ton', d.produksi, 2],
    ['jjg_terjual_berberat', d.saleJjg, 0], ['jjg_terjual_tanpa_berat', d.noWeightJjg, 0],
    ['harga_jual_kg', d.hargaJual, 0], ['biaya_pekerja_kg', d.upahKg, 0], ['biaya_total_rp', d.costTotal, 0], ['pendapatan_rp', d.revenueIdr, 0], ['laba_kotor_rp', d.profit, 0], ['pendapatan_ha', d.revHa, 0], ['biaya_ha', d.costHa, 0],
    ['margin_ha', d.margin, 0], ['umur_blok_th', d.ageMonthly, 1]
  ].filter(c => !c[1] || c[1].length);
  const months = d.yield.map(x => x.p);
  const head = cols.map(c => c[0]).join(',');
  // format mesin: pemisah kolom ';', titik desimal, tanpa pemisah ribuan
  const rows = months.map(p => cols.map(c => c[1] ? num(valAt(c[1], p), c[2]) : monthShort(p)).join(';'));
  return `${head.replace(/,/g, ';')}\n${rows.join('\n')}`;
}


/* ------------------------------------------------------------------------- */
/* Mandor: perbandingan 3 bulan (2 Bulan Lalu | Bulan Lalu | Bulan Ini)      */
/* ------------------------------------------------------------------------- */

/** Label kolom periode -> {y, m}. "Bulan Ini" = bulan saat script dijalankan. */
/** Acuan "Bulan Ini" tabel mandor: tanggal input admin bila dicatat di sheet, selain itu tanggal script dijalankan. */
var MANDOR_REF_DATE = null;

function mandorPeriodMonth(label) {
  const t = norm(label);
  const now = MANDOR_REF_DATE || new Date();
  const back = t.indexOf('2 bulan lalu') >= 0 ? 2 : t.indexOf('bulan lalu') >= 0 ? 1 : t.indexOf('bulan ini') >= 0 ? 0 : null;
  if (back !== null) {
    const m = now.getMonth() - back;
    return { y: now.getFullYear() + Math.floor(m / 12), m: ((m % 12) + 12) % 12 };
  }
  return parseMonth(label) || parseYm(label);
}

/** "700.09 jjg/hari; 22 hari" -> {rate, days, total} | null */
function parseMandorCell(v) {
  const t = String(v || '').trim();
  if (!t || t === '-') return null;
  const parts = t.split(';').map(x => x.trim());
  const ratePart = parts.find(x => /jjg/i.test(x)), daysPart = parts.find(x => /hari/i.test(x) && !/jjg/i.test(x));
  const r = ratePart ? parseNum(ratePart) : null, dd = daysPart ? parseNum(daysPart) : null;
  if (r === null && dd === null) return null;
  return { rate: r, days: dd, total: r !== null && dd !== null ? r * dd : null };
}

/**
 * Tabel mandor format baru (kolom periode) -> {periods:[{label,p,partial}], rows:[{name, vals:[cell|null]}]}.
 * Format lama (Hari Kerja | Rata-rata JJG/Hari) -> dikonversi menjadi satu periode.
 */
function parseMandorTable(t) {
  if (!t || !t.rows.length) return null;
  const h = t.headers.map(norm);
  const nowKey = mkey({ y: new Date().getFullYear(), m: new Date().getMonth() });
  if (h.some(x => x.indexOf('bulan') >= 0) || h.slice(1).some(x => parseMonth(x))) {
    const periods = t.headers.slice(1).map(l => {
      const p = mandorPeriodMonth(l);
      return { label: p ? monthShort(p) : l, p, partial: !!(p && DECK_CONFIG.EXCLUDE_CURRENT_MONTH && mkey(p) === nowKey) };
    });
    const rows = t.rows.filter(r => !isBlank(r[0])).map(r => ({ name: r[0], vals: r.slice(1).map(parseMandorCell) }));
    return rows.length ? { periods, rows } : null;
  }
  const iDays = h.findIndex(x => x.indexOf('hari kerja') >= 0), iRate = h.findIndex(x => x.indexOf('jjg') >= 0);
  const rows = t.rows.filter(r => !isBlank(r[0])).map(r => {
    const rate = iRate > 0 ? parseNum(r[iRate]) : null, days = iDays > 0 ? parseNum(r[iDays]) : null;
    return { name: r[0], vals: [{ rate, days, total: rate !== null && days !== null ? rate * days : null }] };
  });
  return rows.length ? { periods: [{ label: 'Periode', p: null, partial: false }], rows } : null;
}

function describeMandor(role, m, d) {
  if (!m) return `Mandor ${role}: ANOMALI: data belum tersedia.`;
  const L = [`Mandor ${role} (kolom: ${m.periods.map(p => p.label + (p.partial ? ' = bulan berjalan, belum lengkap' : '')).join(' | ')}):`];
  m.rows.forEach(r => {
    const parts = r.vals.map((v, i) => `${m.periods[i].label}: ${v ? `${fmt(v.rate, 2)} JJG/hari × ${fmt(v.days, 0)} hari = ${fmt(v.total, 0)} JJG` : 'kosong'}`);
    L.push(`- ${r.name}: ${parts.join('; ')}`);
  });
  const full = m.periods.map((p, i) => ({ p, i })).filter(x => !x.p.partial);
  if (full.length >= 2) {
    const a = full[full.length - 2], b = full[full.length - 1];
    m.rows.forEach(r => {
      const va = r.vals[a.i], vb = r.vals[b.i];
      if (va && vb && va.rate && vb.rate) L.push(`- ${r.name}: produktivitas ${a.p.label} → ${b.p.label} ${vb.rate >= va.rate ? 'naik' : 'turun'} ${fmt(Math.abs(vb.rate / va.rate - 1) * 100, 0)}%; hari kerja ${fmt(va.days, 0)} → ${fmt(vb.days, 0)}`);
      else if (va && !vb) L.push(`- ${r.name}: ANOMALI: tidak ada data pada ${b.p.label}`);
    });
  }
  full.forEach(x => {
    const tot = m.rows.reduce((s, r) => s + ((r.vals[x.i] && r.vals[x.i].total) || 0), 0);
    const tj = x.p.p ? valAt(d.totalJjg, x.p.p) : null;
    L.push(`- total JJG mandor ${role} terdaftar ${x.p.label}: ${fmt(tot, 0)}` + (tj ? ` (${fmtPct((tot / tj) * 100, 0)} dari total janjang kebun ${fmt(tj, 0)})` : ''));
  });
  const last = full.length ? full[full.length - 1].i : 0;
  const rated = m.rows.filter(r => r.vals[last] && r.vals[last].rate);
  if (rated.length > 1) {
    const hi = rated.reduce((a, r) => (r.vals[last].rate > a.vals[last].rate ? r : a)), lo = rated.reduce((a, r) => (r.vals[last].rate < a.vals[last].rate ? r : a));
    L.push(`- selisih ${m.periods[last].label}: ${hi.name} ${fmt(hi.vals[last].rate, 2)} vs ${lo.name} ${fmt(lo.vals[last].rate, 2)} JJG/hari (${fmt(hi.vals[last].rate / lo.vals[last].rate, 1)}×)`);
  }
  if (m.periods.some(p => p.partial)) L.push('- Kolom bulan berjalan hanya pembanding awal (hari kerja masih sedikit); jangan dijadikan dasar kesimpulan tren.');
  return L.join('\n');
}

function mandorFallbackText(role, m) {
  if (!m) return `Data mandor ${role} belum tersedia.`;
  const full = m.periods.map((p, i) => ({ p, i })).filter(x => !x.p.partial);
  const li = full.length ? full[full.length - 1].i : 0;
  const rated = m.rows.filter(r => r.vals[li] && r.vals[li].rate);
  if (!rated.length) return `Data produktivitas mandor ${role} pada ${m.periods[li].label} belum tercatat.`;
  const top = rated.reduce((a, r) => (r.vals[li].rate > a.vals[li].rate ? r : a));
  return `${top.name} memimpin mandor ${role} pada ${m.periods[li].label} dengan ${fmt(top.vals[li].rate, 2)} JJG/hari selama ${fmt(top.vals[li].days, 0)} hari kerja.`;
}

/* ------------------------------------------------------------------------- */
/* Statistik & fakta                                                         */
/* ------------------------------------------------------------------------- */

function seriesStats(series) {
  const pts = (series || []).filter(s => s.value !== null);
  if (!pts.length) return null;
  const vals = pts.map(s => s.value);
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  const sd = Math.sqrt(vals.reduce((a, b) => a + (b - avg) * (b - avg), 0) / vals.length);
  let max = pts[0], min = pts[0];
  pts.forEach(s => { if (s.value > max.value) max = s; if (s.value < min.value) min = s; });
  const byYear = {};
  pts.forEach(s => { (byYear[s.p.y] = byYear[s.p.y] || []).push(s); });
  return {
    n: series.length, avg, sd, max, min,
    sum: vals.reduce((a, b) => a + b, 0),
    first: pts[0], last: pts[pts.length - 1],
    prev: pts.length > 1 ? pts[pts.length - 2] : null,
    allZero: vals.every(v => v === 0),
    constant: vals.length > 2 && vals.every(v => v === vals[0]),
    negatives: pts.filter(s => s.value < 0),
    missing: series.filter(s => s.value === null).map(s => monthLong(s.p)),
    outliers: sd > 0 ? pts.filter(s => Math.abs(s.value - avg) / sd > DECK_CONFIG.THRESHOLDS.OUTLIER_Z) : [],
    byYear
  };
}

function describeSeries(name, unit, series, f) {
  const st = seriesStats(series);
  if (!st) return `${name}: ANOMALI: data belum tersedia.`;
  const u = unit ? ` ${unit}` : '';
  const lines = [
    `${name} (${monthLong(series[0].p)} s.d. ${monthLong(series[series.length - 1].p)}):`,
    `- rata-rata ${f(st.avg)}${u}`,
    `- tertinggi ${f(st.max.value)}${u} pada ${monthLong(st.max.p)}`,
    `- terendah ${f(st.min.value)}${u} pada ${monthLong(st.min.p)}`,
    `- bulan terakhir ${monthLong(st.last.p)}: ${f(st.last.value)}${u}` +
      (st.prev ? ` (bulan sebelumnya ${f(st.prev.value)}${u})` : '')
  ];
  Object.keys(st.byYear).forEach(y => {
    const arr = st.byYear[y];
    const a = arr.reduce((s, x) => s + x.value, 0) / arr.length;
    lines.push(`- rata-rata ${BULAN_PENDEK[arr[0].p.m]}–${BULAN_PENDEK[arr[arr.length - 1].p.m]} ${y}: ${f(a)}${u}`);
  });
  lines.push(describeSignal(series));
  if (st.allZero) lines.push(`- ANOMALI: ${name} tercatat NOL di seluruh periode (kemungkinan kendala input data)`);
  else if (st.constant) lines.push(`- catatan: nilai sama setiap bulan (${f(st.first.value)}${u})`);
  if (st.negatives.length) lines.push(`- bulan bernilai NEGATIF: ${st.negatives.map(o => `${monthLong(o.p)} (${f(o.value)}${u})`).join(', ')}`);
  if (st.missing.length) lines.push(`- ANOMALI: ${name} kosong pada ${st.missing.join(', ')}`);
  if (st.outliers.length && !st.allZero) {
    lines.push(`- PERLU DICEK: ${name} menyimpang jauh dari rata-rata pada ${st.outliers.map(o => `${monthLong(o.p)} (${f(o.value)}${u})`).join(', ')}`);
  }
  return lines.join('\n');
}

function describeTable(name, table) {
  if (!table || !table.rows.length) return `${name}: ANOMALI: tabel kosong / data belum tersedia.`;
  return `${name}:\n${table.headers.join(' | ')}\n${table.rows.map(r => r.join(' | ')).join('\n')}`;
}

function fallbackInsight(name, unit, series, f) {
  return signalSentence(name, unit, series, f);
}


/* ------------------------------------------------------------------------- */
/* SINYAL: klasifikasi otomatis dengan pilihan jawaban tetap (sama untuk     */
/* semua kebun). Dipakai Gemini sebagai pegangan dan dicek ulang oleh script.*/
/* ------------------------------------------------------------------------- */

const TREND_OPTIONS = ['naik', 'turun', 'stabil', 'fluktuatif', 'data kurang'];
const POSITION_OPTIONS = ['di atas rata-rata', 'sekitar rata-rata', 'di bawah rata-rata', 'data kurang'];
const VOLATILITY_OPTIONS = ['rendah', 'sedang', 'tinggi', 'data kurang'];
const STATUS_OPTIONS = ['baik', 'perlu perhatian', 'kritis', 'data belum cukup'];

/** Kunci bulan awal yang belum penuh (diisi getSheetData); dikecualikan dari perhitungan tren. */
var RAMP_KEY = null;

function signals(series) {
  const T = DECK_CONFIG.THRESHOLDS;
  if (RAMP_KEY) series = (series || []).filter(x => mkey(x.p) !== RAMP_KEY);
  const pts = (series || []).filter(x => x.value !== null);
  const st = seriesStats(series);
  if (!st || pts.length < DECK_CONFIG.MIN_MONTHS_FOR_TREND || st.allZero) {
    return { trend: 'data kurang', position: 'data kurang', volatility: 'data kurang', slopePct: null, cv: null, vsAvg: null };
  }
  const n = pts.length, xs = pts.map((_, i) => i), ys = pts.map(p => p.value);
  const mx = (n - 1) / 2, my = st.avg;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
  const slopePct = my ? (num / den) / Math.abs(my) * 100 : 0;
  const cv = my ? (st.sd / Math.abs(my)) * 100 : 0;
  const vsAvg = my ? ((st.last.value - my) / Math.abs(my)) * 100 : 0;
  const trend = Math.abs(slopePct) >= T.TREND_PCT_PER_MONTH ? (slopePct > 0 ? 'naik' : 'turun')
    : cv >= T.CV_HIGH ? 'fluktuatif' : 'stabil';
  const volatility = cv >= T.CV_HIGH ? 'tinggi' : cv < T.CV_LOW ? 'rendah' : 'sedang';
  const position = vsAvg > T.VS_AVG_PCT ? 'di atas rata-rata' : vsAvg < -T.VS_AVG_PCT ? 'di bawah rata-rata' : 'sekitar rata-rata';
  return { trend, position, volatility, slopePct, cv, vsAvg };
}

function describeSignal(series) {
  const g = signals(series);
  if (g.trend === 'data kurang') return '- SINYAL: tren=data kurang';
  return `- SINYAL: tren=${g.trend} (kemiringan ${fmt(g.slopePct, 1)}% dari rata-rata per bulan); volatilitas=${g.volatility} (CV ${fmt(g.cv, 0)}%); bulan terakhir=${g.position} (${g.vsAvg >= 0 ? '+' : ''}${fmt(g.vsAvg, 0)}%)`;
}

const TREND_PHRASE = {
  naik: 'cenderung naik', turun: 'cenderung turun', stabil: 'relatif stabil', fluktuatif: 'naik-turun tajam', 'data kurang': 'belum cukup data untuk dilihat trennya'
};

/** Kalimat cadangan dari sinyal + statistik (generik untuk semua kebun). */
function signalSentence(name, unit, series, f) {
  const st = seriesStats(series), g = signals(series);
  if (!st) return `Data ${name.toLowerCase()} belum tersedia pada periode ini.`;
  if (st.allZero) return `${name} tercatat nol di seluruh periode, kemungkinan karena kendala input data, sehingga belum dapat dianalisis.`;
  const u = unit ? ` ${unit}` : '';
  if (st.constant || st.max.value === st.min.value) return `${name} tetap ${f(st.first.value)}${u} di seluruh periode ${monthLong(series[0].p)}–${monthLong(series[series.length - 1].p)}.`;
  let t = `${name} ${TREND_PHRASE[g.trend]} selama periode ini, tertinggi ${f(st.max.value)}${u} pada ${monthLong(st.max.p)} dan terendah ${f(st.min.value)}${u} pada ${monthLong(st.min.p)}.`;
  if (g.position !== 'data kurang') t += ` ${monthLong(st.last.p)} tercatat ${f(st.last.value)}${u}, ${g.position}.`;
  if (st.negatives.length) t += ` Nilai negatif terjadi pada ${st.negatives.map(o => monthLong(o.p)).join(', ')}.`;
  if (st.missing.length) t += ` Data ${st.missing.join(', ')} belum tercatat.`;
  return t;
}

/** Kelengkapan data per kebun: header yang tidak ada -> slide dilewati (dilaporkan, bukan diam-diam). */
function checkDataCompleteness(d) {
  const need = [
    ['ton/ha (yield)', d.yield], ['jjg/ha', d.jjgHa], ['luas panen', d.luasPanen], ['harga jual/kg', d.hargaJual],
    ['total janjang', d.totalJjg], ['total tonase hasil', d.tonase], ['daftar blok', d.blocksRaw], ['avg BJR', d.bjr],
    ['biaya pekerja per kg', d.upahKg], ['pendapatan per ha', d.revHa], ['biaya per ha', d.costHa]
  ];
  const missing = need.filter(([, s]) => !s || !s.length || s.every(x => x.value === null || x.value === '')).map(([n]) => n);
  [['upkeep cost', d.upkeep], ['mandor panen', d.panen], ['mandor muat', d.muat], ['mandor rawat', d.rawat]]
    .forEach(([n, t]) => { if (!t || !t.rows.length) missing.push(n); });
  return missing;
}


/* ------------------------------------------------------------------------- */
/* Acuan BJR menurut umur tanaman & cek kewajaran tambahan                   */
/* ------------------------------------------------------------------------- */

/** BJR standar Marihat per bulan, ditimbang luas blok yang dipanen bulan itu. min = kelas lahan kebun, max = S1. */
function buildBjrAcuan(d) {
  if (!d.blocks) return [];
  const cls = d.landClass || DECK_CONFIG.DEFAULT_LAND_CLASS;
  return d.blocksRaw.map(row => {
    let wMin = 0, wMax = 0, w = 0;
    parseBlocks(row.value).forEach(b => {
      if (!b.year) return;
      const lo = marihatAt(row.p.y - b.year, cls), hi = marihatAt(row.p.y - b.year, 'S1');
      if (lo && hi) { wMin += lo.rbt * b.ha; wMax += hi.rbt * b.ha; w += b.ha; }
    });
    return { p: row.p, label: row.label, min: w ? wMin / w : null, max: w ? wMax / w : null };
  });
}

function describeBjrAcuan(d) {
  const A = (d.bjrAcuan || []).filter(a => a.min !== null);
  if (!A.length) return '';
  // Tonase = janjang terjual: BJR di sheet (tonase ÷ janjang dipanen) bias rendah bila ada janjang yang tidak terjual,
  // jadi pembanding standar memakai BJR berbasis janjang terjual.
  const soldBasis = DECK_CONFIG.TONASE_BASIS === 'terjual' && d.bjrSoldMonthly.some(x => x.value !== null);
  const src = soldBasis ? d.bjrSoldMonthly : (d.bjr.some(x => x.value !== null) ? d.bjr : d.bjrImplied);
  const below = [], inside = [];
  A.forEach(a => {
    const v = valAt(src, a.p);
    if (v === null) return;
    if (v < a.min * (1 - DECK_CONFIG.THRESHOLDS.BJR_BELOW_ACUAN)) below.push(`${monthLong(a.p)} (${fmt(v, 2)} kg vs standar Marihat ${fmt(a.min, 1)} kg)`);
    else inside.push(a.label);
  });
  const L = [`BJR standar Marihat (${d.landClass}) sesuai umur blok yang dipanen, ditimbang luas: ${A.map(a => `${a.label} ${fmt(a.min, 1)} kg`).join(', ')}.`];
  if (below.length) L.push(`PERLU DICEK: BJR di bawah standar Marihat untuk acuan umur tanaman pada ${below.join('; ')}. Kemungkinan panen buah belum matang, brondolan tidak terkutip, bibit tidak unggul, atau pencatatan janjang/tonase keliru.`);
  else L.push('BJR berada pada atau di atas standar Marihat untuk umur tanamannya pada semua bulan.');
  return L.join('\n');
}

/** Cek kewajaran generik: bulan awal belum penuh, nilai sama berturut-turut. */
function describeDataPatterns(d) {
  const T = DECK_CONFIG.THRESHOLDS, L = [];
  const lp = d.luasPanen.filter(x => x.value !== null);
  if (lp.length >= 3) {
    const sorted = lp.map(x => x.value).sort((a, b) => a - b), med = sorted[Math.floor(sorted.length / 2)];
    if (lp[0].value < med * T.FIRST_MONTH_RAMP) L.push(`PERLU DICEK: ${monthLong(lp[0].p)} luas panen hanya ${fmt(lp[0].value, 2)} ha (median ${fmt(med, 2)} ha); kemungkinan bulan awal pencatatan/layanan belum penuh, jangan dijadikan pembanding tren.`);
  }
  [['harga jual/kg', d.hargaJual], ['upah/kg', d.upahKg]].forEach(([name, s]) => {
    let run = 1;
    for (let i = 1; i <= s.length; i++) {
      if (i < s.length && s[i].value !== null && s[i].value === s[i - 1].value) { run++; continue; }
      if (run >= T.REPEAT_SAME_MIN && run < s.length) L.push(`PERLU DICEK: ${name} persis sama (${fmt(s[i - 1].value, 2)}) selama ${run} bulan berturut-turut (${monthShort(s[i - run].p)}–${monthShort(s[i - 1].p)}); pastikan bukan isian tetap.`);
      run = 1;
    }
  });
  (d.zeroFixes || []).forEach(z => L.push(`PERLU DICEK: ${z}.`));
  // Bulan yang ada panennya tetapi tidak ada penjualan sama sekali
  const soldTot = p => (valAt(d.saleJjg, p) || 0) + (valAt(d.noWeightJjg, p) || 0);
  if (d.saleJjg.length) {
    const noSale = d.totalJjg.filter(x => x.value > 0 && soldTot(x.p) === 0);
    if (noSale.length) L.push(`PERLU DICEK: ${noSale.map(x => `${monthLong(x.p)} dipanen ${fmt(x.value, 0)} janjang tetapi tidak ada janjang terjual tercatat`).join('; ')}; cek apakah penjualan bulan itu belum diinput.`);
  }
  const price = d.hargaJual.length ? d.hargaJual : d.revKg;
  const tooHigh = [], tooLow = [];
  d.upahKg.forEach(u => {
    const h = valAt(price, u.p);
    if (u.value === null || !h) return;
    if (u.value >= h) tooHigh.push(`${monthShort(u.p)} (upah Rp${fmt(u.value, 0)} vs harga Rp${fmt(h, 0)})`);
    else if (u.value > 0 && u.value < h * 0.01) tooLow.push(`${monthShort(u.p)} (Rp${fmt(u.value, 0)})`);
  });
  if (tooHigh.length) L.push(`PERLU DICEK: upah/kg sama atau melebihi harga jual/kg pada ${tooHigh.join(', ')}; tidak wajar, kemungkinan salah input atau biaya non-panen ikut terhitung.`);
  if (tooLow.length) L.push(`PERLU DICEK: upah/kg kurang dari 1% harga jual pada ${tooLow.join(', ')}; kemungkinan pencatatan upah belum lengkap.`);
  if (d.period && d.dataPeriod && DECK_CONFIG.COVER_PERIOD_SOURCE === 'data') {
    L.push(`Periode di sheet: "${d.period}"; periode data yang dianalisis: ${d.dataPeriod} (${d.months} bulan lengkap).`);
  }
  if (d.snapshot) L.push(`MODE RINGKASAN: hanya ${d.months - (d.rampMonth ? 1 : 0)} bulan data penuh; tren belum bisa disimpulkan.`);
  return L.join('\n');
}


/* ------------------------------------------------------------------------- */
/* Janjang terjual tanpa berat, blok tanpa penjualan, aktivitas mandor rawat */
/* ------------------------------------------------------------------------- */

/**
 * Janjang terjual tanpa catatan berat: tonasenya tidak masuk total_supply_ton, sehingga pendapatan & BJR
 * kebun tampak lebih kecil. Estimasi nilai = janjang tanpa berat × BJR terjual × harga jual.
 */
function buildNoWeightAnalytics(d) {
  if (!d.noWeightJjg.some(x => x.value)) return null;
  const price = d.hargaJual.length ? d.hargaJual : d.revKg;
  // BJR/harga bulan itu bisa kosong (mis. tonase 0 dianggap belum diinput): pakai BJR kumulatif & harga rata-rata
  const ps = seriesStats(price), bjrAvg = d.bjrSoldCum || (seriesStats(d.bjr) || {}).avg || null;
  const monthly = d.noWeightJjg.map(x => {
    const sold = valAt(d.saleJjg, x.p) || 0, nw = x.value || 0, bjr = valAt(d.bjr, x.p) || bjrAvg, h = valAt(price, x.p) || (ps ? ps.avg : null);
    const share = sold + nw ? (nw / (sold + nw)) * 100 : null;
    const ton = bjr ? (nw * bjr) / 1000 : null;
    return { p: x.p, label: x.label, nw, sold, share, ton, rp: ton !== null && h ? ton * 1000 * h : null };
  });
  const nwSum = monthly.reduce((a, x) => a + x.nw, 0), soldSum = monthly.reduce((a, x) => a + x.sold, 0);
  const tonSum = monthly.reduce((a, x) => a + (x.ton || 0), 0), rpSum = monthly.reduce((a, x) => a + (x.rp || 0), 0);
  return { monthly, nwSum, soldSum, share: nwSum + soldSum ? (nwSum / (nwSum + soldSum)) * 100 : 0, tonSum, rpSum,
           worst: monthly.slice().sort((a, b) => (b.share || 0) - (a.share || 0))[0],
           series: monthly.map(x => ({ p: x.p, label: x.label, value: x.share })) };
}

function describeNoWeight(d) {
  const N = d.noWeight;
  if (!N) return 'Janjang terjual tanpa berat: kolom belum tersedia.';
  const L = [`JANJANG TERJUAL TANPA BERAT: ${fmt(N.nwSum, 0)} janjang (${fmt(N.share, 1)}% dari janjang terjual) tidak dicatat beratnya; ` +
    `tonasenya tidak masuk total tonase terjual. Estimasi tonase tidak tercatat ${fmt(N.tonSum, 1)} ton ≈ ${fmtRp(N.rpSum)} (janjang tanpa berat × BJR × harga jual).`];
  L.push(`- per bulan (tanpa berat | dengan berat | %): ${N.monthly.map(x => `${x.label} ${fmt(x.nw, 0)} | ${fmt(x.sold, 0)} | ${x.share === null ? '-' : fmt(x.share, 0) + '%'}`).join('; ')}`);
  if (N.worst && N.worst.share) L.push(`- tertinggi ${monthLong(N.worst.p)}: ${fmt(N.worst.share, 0)}% janjang terjual tanpa berat.`);
  if (N.share > DECK_CONFIG.THRESHOLDS.NOWEIGHT_PCT) L.push(`PERLU DICEK: ${fmt(N.share, 0)}% janjang terjual tanpa catatan berat (≈ ${fmtRp(N.rpSum)} tidak tercatat); BJR dan pendapatan kebun tampak lebih kecil dari sebenarnya.`);
  return L.join('\n');
}

/** Blok tanpa penjualan: berapa bulan setiap blok tidak tercatat menjual janjang. */
function buildUnsaleAnalytics(d) {
  if (!d.blocksUnsaleRaw.some(x => String(x.value || '').trim())) return null;
  const n = d.blocksUnsaleRaw.length;
  const map = {};
  d.blocksUnsaleRaw.forEach(row => parseBlocks(row.value).forEach(b => {
    const k = `${b.name}|${b.ha}|${b.year}`;
    if (!map[k]) map[k] = { name: b.name, ha: b.ha, year: b.year, soil: null, months: 0, last: null, jjg: 0 };
    map[k].months++; map[k].last = row.p;
    if (b.soil) map[k].soil = b.soil;
    if (b.jjg) map[k].jjg += b.jjg;   // janjang dipanen di blok saat blok itu tidak tercatat menjual
  }));
  const blocks = Object.keys(map).map(k => map[k]).sort((a, b) => b.months - a.months || b.ha - a.ha);
  const monthly = d.blocksUnsaleRaw.map(row => {
    const list = parseBlocks(row.value), ha = list.reduce((a, b) => a + b.ha, 0);
    const all = parseBlocks(valAt(d.blocksRaw, row.p) || ''), haAll = all.reduce((a, b) => a + b.ha, 0);
    return { p: row.p, label: row.label, count: list.length, ha, share: haAll ? (ha / haAll) * 100 : null };
  });
  const jjgTotal = blocks.reduce((a, b) => a + b.jjg, 0);
  if (jjgTotal) blocks.sort((a, b) => b.jjg - a.jjg || b.months - a.months);   // ada janjang per blok: urut janjang terbesar
  return { blocks, monthly, months: n, chronic: blocks.filter(b => b.months >= DECK_CONFIG.THRESHOLDS.UNSALE_MONTHS),
           jjgTotal, series: monthly.map(x => ({ p: x.p, label: x.label, value: x.share })) };
}

function describeUnsale(d) {
  const U = d.unsale;
  if (!U) return 'Blok tanpa penjualan: data belum tersedia.';
  const L = [`BLOK TANPA PENJUALAN (blok yang DIPANEN tetapi janjangnya tidak dijual atau tidak tercatat sampai terjual): ${U.blocks.length} blok; ${U.chronic.length} blok ≥ ${DECK_CONFIG.THRESHOLDS.UNSALE_MONTHS} bulan.`];
  L.push(`- per bulan (jumlah blok | ha | % luas blok tercatat): ${U.monthly.map(x => `${x.label} ${x.count} | ${fmt(x.ha, 1)} ha | ${x.share === null ? '-' : fmt(x.share, 0) + '%'}`).join('; ')}`);
  L.push(`- blok ${U.jjgTotal ? 'dengan janjang dipanen tanpa penjualan tercatat terbanyak' : 'paling sering tanpa penjualan'}: ${U.blocks.slice(0, 8).map(b => `${b.name} ${fmt(b.ha, 2)} ha (tanam ${b.year || '-'}) ${b.months}/${U.months} bln${U.jjgTotal ? `, ${fmt(b.jjg, 0)} jjg` : ''}`).join('; ')}`);
  if (U.jjgTotal) L.push(`- total janjang dipanen di blok saat blok itu tidak tercatat menjual: ${fmt(U.jjgTotal, 0)} janjang selama periode.`);
  if (U.chronic.length) L.push(`PERLU DICEK: ${U.chronic.length} blok (${fmt(U.chronic.reduce((a, b) => a + b.ha, 0), 1)} ha) dipanen tetapi tidak tercatat menjual janjang selama ≥ ${DECK_CONFIG.THRESHOLDS.UNSALE_MONTHS} bulan; cek janjang tertinggal/restan di blok itu atau penjualan yang tidak dicatat per blok.`);
  return L.join('\n');
}

/**
 * Mandor rawat (format baru): "17 hari; Pemupukan (25.2 SACK/hari), Pruning (173.75 POKOK/hari)".
 * -> {periods, rows:[{name, vals:[{days, acts:[{name, rate, unit}]}|null]}]}
 */
function parseRawatTable(t) {
  if (!t || !t.rows.length || t.headers.length < 2) return null;
  const nowKey = mkey({ y: new Date().getFullYear(), m: new Date().getMonth() });
  const periods = t.headers.slice(1).map(l => {
    const p = mandorPeriodMonth(l);
    return { label: p ? monthShort(p) : l, p, partial: !!(p && DECK_CONFIG.EXCLUDE_CURRENT_MONTH && mkey(p) === nowKey) };
  });
  const cell = v => {
    const s = String(v || '').trim();
    if (!s || s === '-') return null;
    const dm = s.match(/(\d+)\s*hari/i);
    const acts = [];
    const re = /([^,;()]+?)\s*\(([\d.,]+)\s*([A-Za-z]+)\s*\/\s*hari\)/g;
    let m; while ((m = re.exec(s)) !== null) acts.push({ name: m[1].trim(), rate: parseNum(m[2]), unit: m[3].toLowerCase() });
    return dm || acts.length ? { days: dm ? Number(dm[1]) : null, acts } : null;
  };
  const rows = t.rows.filter(r => !isBlank(r[0])).map(r => ({ name: String(r[0]).trim(), vals: r.slice(1).map(cell) }));
  if (!rows.some(r => r.vals.some(v => v && (v.acts.length || v.days)))) return null;   // format lama (hari rawat saja)
  return { periods, rows };
}

function describeRawat(d) {
  const R = d.rawatActivities;
  if (!R) return describeTable('Top mandor rawat', d.rawat);
  const L = [`Mandor rawat (kolom: ${R.periods.map(p => p.label + (p.partial ? ' = bulan berjalan' : '')).join(' | ')}):`];
  R.rows.forEach(r => L.push(`- ${r.name}: ` + r.vals.map((v, i) => `${R.periods[i].label}: ${v ? `${v.days || '-'} hari; ${v.acts.map(a => `${a.name} ${fmt(a.rate, 2)} ${a.unit}/hari`).join(', ') || 'aktivitas tidak dirinci'}` : 'kosong'}`).join(' | ')));
  return L.join('\n');
}

/** Baris tabel mandor rawat untuk slide: bulan penuh terakhir + pembanding. */
function rawatTableRows(d) {
  const R = d.rawatActivities;
  if (!R) return null;
  const full = R.periods.map((p, i) => ({ p, i })).filter(x => !x.p.partial);
  const last = full[full.length - 1], prev = full[full.length - 2];
  if (!last) return null;
  const headers = ['Mandor', `${last.p.label}\nhari kerja`].concat(prev ? [`${prev.p.label}\nhari kerja`] : []).concat([`Aktivitas utama\n${last.p.label}`]);
  const rows = R.rows.map(r => {
    const v = r.vals[last.i], pv = prev ? r.vals[prev.i] : null;
    const acts = v && v.acts.length ? v.acts.slice(0, 2).map(a => `${a.name} ${fmt(a.rate, 1)} ${a.unit}/hr`).join('; ') + (v.acts.length > 2 ? ` +${v.acts.length - 2}` : '') : '-';
    return [r.name, v && v.days ? String(v.days) : '-'].concat(prev ? [pv && pv.days ? String(pv.days) : '-'] : []).concat([acts]);
  });
  return { headers, rows, numCols: prev ? [1, 2] : [1] };
}

/* ------------------------------------------------------------------------- */
/* Hubungan antar-metrik (bahan sebab-akibat)                                */
/* ------------------------------------------------------------------------- */

function pairValues(a, b) {
  const map = {};
  b.forEach(x => { map[mkey(x.p)] = x.value; });
  const xs = [], ys = [];
  a.forEach(x => {
    const bv = map[mkey(x.p)];
    if (x.value !== null && bv !== null && bv !== undefined) { xs.push(x.value); ys.push(bv); }
  });
  return { xs, ys };
}

function pearson(a, b) {
  const { xs, ys } = pairValues(a, b);
  const n = xs.length;
  if (n < 4) return null;
  const mx = xs.reduce((s, v) => s + v, 0) / n, my = ys.reduce((s, v) => s + v, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : null;
}

function strength(r) {
  const a = Math.abs(r);
  const dir = r > 0 ? 'searah' : 'berlawanan';
  return a >= DECK_CONFIG.THRESHOLDS.CORR_STRONG ? `kuat, ${dir}` : a >= DECK_CONFIG.THRESHOLDS.CORR_MEDIUM ? `sedang, ${dir}` : 'lemah / tidak berhubungan';
}

/** Cek rumus target ≈ a × b × k di semua bulan (selisih ≤ 2%). */
function identityHolds(target, a, b, k) {
  const ab = combine(a, b, (x, y) => x * y * k);
  const { xs, ys } = pairValues(target, ab);
  if (xs.length < 3) return false;
  return xs.every((t, i) => ys[i] && Math.abs(t / ys[i] - 1) <= 0.02);
}

function valAt(series, p) {
  const x = p && series.find(z => mkey(z.p) === mkey(p));
  return x ? x.value : null;
}

/** Rata-rata selisih relatif antara dua seri (%). */
function meanRelDiff(a, b) {
  const { xs, ys } = pairValues(a, b);
  if (xs.length < 3) return null;
  // selisih karena pembulatan angka kecil (mis. 0,01 vs 0,014) tidak dihitung sebagai ketidakcocokan
  const tol = (x, y) => Math.abs(x - y) <= 0.006 + 0.005 * Math.abs(y);
  return xs.reduce((s, x, i) => s + (ys[i] && !tol(x, ys[i]) ? Math.abs(x / ys[i] - 1) : 0), 0) / xs.length * 100;
}

function describeRelations(d) {
  const L = [];
  const price = d.hargaJual.length ? d.hargaJual : d.revKg;

  // Konsistensi rumus
  // Format terbaru: yield_jjg_per_ha = janjang TERJUAL ÷ luas panen; format lama: janjang dipanen ÷ luas panen
  const jjgBase = d.saleJjg.some(x => x.value) ? d.saleJjg : d.totalJjg;
  const jjgCheck = meanRelDiff(d.jjgHa, combine(jjgBase, d.luasPanen, (t, l) => (l ? t / l : null)));
  if (jjgCheck !== null) L.push(jjgCheck <= DECK_CONFIG.THRESHOLDS.CONSISTENCY_PCT.JJG
    ? `KONSISTEN: JJG/ha = janjang ${jjgBase === d.saleJjg ? 'terjual' : 'dipanen'} ÷ luas panen di semua bulan.`
    : `TIDAK KONSISTEN (${fmt(jjgCheck, 0)}%): JJG/ha ≠ janjang ${jjgBase === d.saleJjg ? 'terjual' : 'dipanen'} ÷ luas panen.`);
  if (d.produksiActual) {
    const yCheck = meanRelDiff(d.yield, combine(d.tonase, d.luasPanen, (t, l) => (l ? t / l : null)));
    if (yCheck !== null) L.push(yCheck <= DECK_CONFIG.THRESHOLDS.CONSISTENCY_PCT.YIELD
      ? 'KONSISTEN: yield = tonase hasil ÷ luas panen di semua bulan (tonase adalah produksi aktual).'
      : `TIDAK KONSISTEN (${fmt(yCheck, 0)}%): yield ≠ tonase hasil ÷ luas panen.`);
  }
  const bjrCheck = meanRelDiff(d.bjr, d.bjrImplied);
  if (bjrCheck !== null) L.push(bjrCheck <= DECK_CONFIG.THRESHOLDS.CONSISTENCY_PCT.BJR
    ? `KONSISTEN: BJR di data sejalan dengan ${d.bjrImpliedLabel} (selisih rata-rata ${fmt(bjrCheck, 1)}%). Yield = JJG/ha × BJR ÷ 1000, jadi naik-turun yield dijelaskan oleh JJG/ha dan BJR.`
    : `ANOMALI DATA: BJR di data tidak cocok dengan ${d.bjrImpliedLabel} (selisih rata-rata ${fmt(bjrCheck, 0)}%). Gunakan BJR hitungan untuk menjelaskan yield; sumber data BJR perlu diselaraskan.`);
  // Bila pendapatan rupiah tercatat, bandingkan langsung dengan tonase × harga (tanpa pembulatan yield per ha)
  const revCheck = d.revenueIdr.some(x => x.value)
    ? meanRelDiff(d.revenueIdr, combine(d.tonase, price, (t, h) => t * 1000 * h))
    : meanRelDiff(d.revHa, combine(d.yield, price, (y, h) => y * 1000 * h));
  if (revCheck !== null) L.push(revCheck <= DECK_CONFIG.THRESHOLDS.CONSISTENCY_PCT.REVENUE
    ? 'KONSISTEN: pendapatan/ha = yield × 1000 × harga jual/kg.'
    : `ANOMALI DATA: pendapatan/ha tidak cocok dengan yield × 1000 × harga jual/kg (selisih rata-rata ${fmt(revCheck, 0)}%); tabel pengeluaran kemungkinan belum diperbarui mengikuti data produksi terbaru.`);

  [['yield', 'BJR implisit', d.yield, d.bjrImplied], ['yield', 'JJG/ha', d.yield, d.jjgHa],
   ['yield', 'umur rata-rata blok dipanen', d.yield, d.ageMonthly], ['luas panen', 'total janjang', d.luasPanen, d.totalJjg],
   ['pendapatan/ha', 'yield', d.revHa, d.yield], ['pendapatan/ha', 'harga jual/kg', d.revHa, price],
   ['margin/ha', 'biaya/ha', d.margin, d.costHa]].forEach(([a, b, sa, sb]) => {
    const r = pearson(sa, sb);
    if (r !== null) L.push(`Korelasi ${a} vs ${b}: r = ${fmt(r, 2)} (${strength(r)}).`);
  });
  const peaks = [['yield', d.yield], ['JJG/ha', d.jjgHa], ['BJR', d.bjr], ['luas panen', d.luasPanen], ['pendapatan/ha', d.revHa],
                 ['biaya/ha', d.costHa], ['estimasi produksi', d.produksi], ['umur blok', d.ageMonthly]]
    .map(([n, s]) => { const st = seriesStats(s); return st ? { n, max: monthLong(st.max.p), min: monthLong(st.min.p) } : null; })
    .filter(Boolean);
  if (peaks.length) {
    L.push('Bulan tertinggi per metrik: ' + peaks.map(p => `${p.n}=${p.max}`).join(', ') + '.');
    L.push('Bulan terendah per metrik: ' + peaks.map(p => `${p.n}=${p.min}`).join(', ') + '.');
  }
  const m = seriesStats(d.margin);
  if (m && m.negatives.length) {
    L.push(`Margin/ha NEGATIF pada: ${m.negatives.map(x =>
      `${monthLong(x.p)} (pendapatan ${fmtRp(valAt(d.revHa, x.p))}, biaya ${fmtRp(valAt(d.costHa, x.p))})`).join(', ')}.`);
  }
  const u = seriesStats(d.upahKg);
  if (u) L.push(`Upah/kg berubah dari Rp${fmt(u.first.value, 0)} (${monthLong(u.first.p)}) ke Rp${fmt(u.last.value, 0)} (${monthLong(u.last.p)}).`);
  if (d.blocks) {
    const jump = d.blocks.monthly.filter(x => x.haSum && x.newHa / x.haSum > DECK_CONFIG.THRESHOLDS.NEW_BLOCK_SHARE);
    if (jump.length) L.push(`Lonjakan blok baru: ${jump.map(x => `${monthLong(x.p)} +${x.newCount} blok (${fmt(x.newHa, 0)} ha)`).join(', ')}; menjelaskan perubahan luas panen dan total janjang di bulan tersebut.`);
  }
  const ac = describeBjrAcuan(d); if (ac) L.push(ac);
  if (d.marihat) L.push(describeMarihat(d));
  if (d.flow) L.push(describeFlow(d));
  if (d.featureNotes && d.featureNotes.length) L.push('CATATAN FITUR (bukan anomali): ' + d.featureNotes.join('; ') + '.');
  if (d.noWeight) L.push(describeNoWeight(d));
  if (d.unsale) L.push(describeUnsale(d));
  if (d.profit && d.profit.some(x => x.value !== null)) {
    const pS = seriesStats(d.profit);
    L.push(`LABA KOTOR SEBELUM BIAYA MATERIAL (pendapatan tercatat − biaya pekerja: perawatan, panen, muat; belum termasuk pupuk, pestisida, bahan): rata-rata ${fmtRp(pS.avg)} per bulan; terendah ${fmtRp(pS.min.value)} pada ${monthLong(pS.min.p)}; tertinggi ${fmtRp(pS.max.value)} pada ${monthLong(pS.max.p)}.` +
      (pS.negatives.length ? ` Rugi pada ${pS.negatives.map(x => monthLong(x.p)).join(', ')}.` : ''));
  }
  const pt = describeDataPatterns(d); if (pt) L.push(pt);
  // Pengeluaran: cakupan bulan berbeda?
  const lastProd = d.yield.length ? d.yield[d.yield.length - 1].p : null, lastCost = d.revHa.length ? d.revHa[d.revHa.length - 1].p : null;
  if (lastProd && lastCost && mkey(lastProd) !== mkey(lastCost)) L.push(`CATATAN: data produksi sampai ${monthLong(lastProd)}, data pengeluaran sampai ${monthLong(lastCost)}.`);
  return L.join('\n');
}

/* ------------------------------------------------------------------------- */
/* KPI, scorecard, tabel                                                     */
/* ------------------------------------------------------------------------- */

/** Rupiah ringkas untuk kartu KPI (1 desimal): Rp736.4 jt, Rp10.9 M. */
function fmtRpShort(n) {
  if (n === null || n === undefined) return '-';
  const a = Math.abs(n), sign = n < 0 ? '-' : '';
  if (a >= 1e9) return `${sign}Rp${fmt(a / 1e9, 1)} miliar`;
  if (a >= 1e6) return `${sign}Rp${fmt(a / 1e6, 1)} juta`;
  return `${sign}Rp${fmt(a, 0)}`;
}

/** Rentang rupiah ringkas: Rp265–545 juta */
function fmtRpRange(lo, hi) {
  if (!lo) return fmtRpShort(hi);
  if (hi >= 1e9 && lo >= 1e9) return `Rp${fmt(lo / 1e9, 1)}–${fmt(hi / 1e9, 1)} miliar`;
  if (hi >= 1e6 && lo >= 1e6) return `Rp${fmt(lo / 1e6, 0)}–${fmt(hi / 1e6, 0)} juta`;
  return `${fmtRpShort(lo)}–${fmtRpShort(hi)}`;
}

/**
 * Daftar KPI yang bisa dipilih lewat DECK_CONFIG.KPIS (komponen KpiCard CBR).
 * Setiap fungsi mengembalikan {name, value, unit, note} atau null bila datanya tidak ada:
 *   name  = label kecil HURUF BESAR, value = angka besar hijau, unit = satuan di samping angka, note = satu baris pembanding.
 */
const KPI_LIBRARY = {
  produksi_total: d => {
    const s = seriesStats(d.produksi);
    const nm = !d.produksiActual ? 'Estimasi produksi' : DECK_CONFIG.TONASE_BASIS === 'terjual' ? 'TBS terjual' : 'Total produksi';
    return s && { name: nm, value: fmt(s.sum, 0), unit: 'ton', note: `Total ${s.n} bulan, ${d.dataPeriod || ''}`.trim() };
  },
  yield_rata2: d => {
    const s = seriesStats(d.yield);
    return s && { name: 'Rata-rata yield', value: fmt(s.avg, 2), unit: 'ton/ha/bln', note: `Tertinggi ${fmt(s.max.value, 2)} pada ${monthShort(s.max.p)}` };
  },
  bjr_rata2: d => {
    if (DECK_CONFIG.TONASE_BASIS === 'terjual' && d.bjrSoldCum) {
      return { name: 'BJR', value: fmt(d.bjrSoldCum, 1), unit: 'kg/janjang', note: 'Ton terjual ÷ janjang terjual' };
    }
    const src = d.bjr.some(x => x.value !== null) ? d.bjr : d.bjrImplied;
    const s = seriesStats(src);
    return s && { name: 'BJR', value: fmt(s.avg, 1), unit: 'kg/janjang', note: `Rata-rata ${s.n} bulan` };
  },
  pendapatan_bulan_terakhir: d => {
    const s = seriesStats(d.revenueTotal);
    if (!s) return null;
    const r = rpParts(s.last.value);
    return { name: `Penjualan ${monthShort(s.last.p)}`, value: r.value, unit: r.unit, note: 'Estimasi: tonase terjual × harga jual' };
  },
  pendapatan_total: d => {
    const s = seriesStats(d.revenueTotal);
    if (!s) return null;
    const r = rpParts(s.sum);
    return { name: 'Penjualan TBS', value: r.value, unit: r.unit, note: `Estimasi total ${s.n} bulan` };
  },
  pencapaian_marihat: d => d.marihat && {
    name: 'Vs standar Marihat', value: fmtPct(d.marihat.achTon * 100, 0), unit: `kelas ${d.marihat.cls}`,
    note: `${fmt(d.marihat.realTonHa, 1)} vs ${fmt(d.marihat.pot.ton, 1)} ton/ha/tahun` },
  kebocoran_janjang: d => {
    const F = d.flow;
    if (!F) return null;
    if (F.overSold) return { name: 'Kebocoran janjang', value: '–', unit: 'tidak terukur', note: `Terjual ${fmt(F.overSoldPct, 0)}% lebih banyak dari dipanen; catatan panen kurang` };
    if (!F.lossJjg) return { name: 'Kebocoran janjang', value: '0%', unit: '', note: 'Janjang dipanen tercatat sampai terjual' };
    if (F.lossRp !== null) {
      const hi = rpParts(F.lossRp, 0);
      const lo = F.lossRpLow ? rpParts(F.lossRpLow, 0) : null;
      const value = lo && lo.unit === hi.unit && lo.value !== hi.value ? `${lo.value}–${hi.value}` : hi.value;
      return { name: 'Estimasi kerugian', value, unit: hi.unit, note: `${fmt(F.lossJjg, 0)} janjang (${fmt(F.lossPct, 0)}%) tidak sampai terjual` };
    }
    return { name: 'Kebocoran janjang', value: `${fmt(F.lossPct, 0)}%`, unit: '', note: `${fmt(F.lossJjg, 0)} janjang tidak sampai terjual` };
  },
  laba_bulan_terakhir: d => {
    const s = seriesStats(d.profit);
    if (!s) return null;
    const r = rpParts(s.last.value);
    return { name: `Laba kotor ${monthShort(s.last.p)}`, value: r.value, unit: r.unit, note: 'Pendapatan − biaya pekerja (sebelum material)' };
  },
  biaya_per_kg: d => {
    const s = seriesStats(d.upahKg);
    return s && { name: 'Biaya pekerja', value: fmt(s.avg, 0), unit: 'Rp/kg', note: `Rata-rata ${s.n} bulan; tertinggi ${monthShort(s.max.p)}` };
  },
  tanpa_berat: d => d.noWeight && {
    name: 'Terjual tanpa berat', value: `${fmt(d.noWeight.share, 0)}%`, unit: '',
    note: `${fmt(d.noWeight.nwSum, 0)} janjang, ±${fmtRpShort(d.noWeight.rpSum)} tidak tercatat` },
  margin_rata2: d => {
    const s = seriesStats(d.margin);
    if (!s) return null;
    const r = rpParts(s.avg);
    return { name: 'Rata-rata margin', value: r.value, unit: `${r.unit}/ha/bln`, note: `${s.n} bulan` };
  }
};

function computeKpis(data, count) {
  const n = Math.max(3, Math.min(6, count || (DECK_CONFIG.KPIS || []).length || 4));
  const kpis = (DECK_CONFIG.KPIS || []).map(k => (KPI_LIBRARY[k] ? KPI_LIBRARY[k](data) : null)).filter(Boolean);
  // Jika data suatu KPI tidak ada, isi dengan KPI cadangan yang datanya tersedia
  Object.keys(KPI_LIBRARY).forEach(k => {
    if (kpis.length < n && DECK_CONFIG.KPIS.indexOf(k) < 0) { const v = KPI_LIBRARY[k](data); if (v) kpis.push(v); }
  });
  while (kpis.length < n) kpis.push({ name: 'Data', value: '-', unit: '', note: 'Data belum tersedia' });
  return kpis.slice(0, n);
}

/** Ringkasan bulan terakhir vs bulan sebelumnya vs rata-rata. */
function buildScorecard(d) {
  const ys = seriesStats(d.yield);
  if (!ys) return null;
  const last = ys.last.p, prev = ys.prev ? ys.prev.p : null;
  const metrics = [
    ['Yield (ton/ha)', d.yield, v => fmt(v, 2)],
    ['JJG/ha', d.jjgHa, v => fmt(v, 2)],
    ['BJR (kg)', d.bjr, v => fmt(v, 2)],
    ['Umur blok dipanen (th)', d.ageMonthly, v => fmt(v, 1)],
    ['Luas panen (ha)', d.luasPanen, v => fmt(v, 2)],
    [!d.produksiActual ? 'Estimasi produksi (ton)' : DECK_CONFIG.TONASE_BASIS === 'terjual' ? 'TBS terjual (ton)' : 'Produksi (ton)', d.produksi, v => fmt(v, 0)],
    ['Harga jual/kg', d.hargaJual.length ? d.hargaJual : d.revKg, v => `Rp${fmt(v, 0)}`],
    ['Pendapatan/ha', d.revHa, fmtRp],
    ['Margin/ha', d.margin, fmtRp]
  ];
  const rows = [], facts = [];
  metrics.forEach(([name, s, f]) => {
    const st = seriesStats(s);
    if (!st) return;
    const a = valAt(s, last), b = valAt(s, prev);
    const diff = a !== null && st.avg ? ((a - st.avg) / Math.abs(st.avg)) * 100 : null;
    const dtxt = diff === null || d.snapshot ? '-' : `${diff >= 0 ? '▲ +' : '▼ '}${fmt(diff, 0)}%`;
    rows.push([name, a === null ? '-' : f(a), b === null ? '-' : f(b), f(st.avg), dtxt]);
    facts.push(`${name}: ${monthLong(last)} ${a === null ? 'kosong' : f(a)}; ${prev ? monthLong(prev) : '-'} ${b === null ? 'kosong' : f(b)}; rata-rata ${f(st.avg)}; vs rata-rata ${dtxt}`);
  });
  // Kolom: bulan terakhir | bulan sebelumnya (pembanding) | rata-rata periode | selisih vs rata-rata.
  // Kolom pembanding dibuang bila tidak ada bulan sebelumnya; rata-rata dibuang bila hanya 1 bulan data.
  // Header dua baris (baris kedua = keterangan kecil), tidak pernah terpotong di tengah kata/kurung
  let headers = ['Indikator', `${monthShort(last)}\nbulan laporan`, prev ? `${monthShort(prev)}\npembanding` : '-', `Rata-rata\n${ys.n} bulan`, 'Selisih\nvs rata-rata'];
  let keep = [0, 1, 2, 3, 4];
  if (!prev || !DECK_CONFIG.SCORECARD_SHOW_PREV) keep = keep.filter(i => i !== 2);
  if (ys.n < 2) keep = keep.filter(i => i !== 3 && i !== 4);
  else if (d.snapshot) keep = keep.filter(i => i !== 4);   // data < MIN_MONTHS_FOR_TREND: selisih vs rata-rata belum bermakna
  headers = keep.map(i => headers[i]);
  rows.forEach((r, j) => { rows[j] = keep.map(i => r[i]); });
  return {
    headers, keep,
    rows,
    facts: `Ringkasan bulan terakhir (${monthLong(last)}):\n` + facts.join('\n'),
    lastLabel: monthLong(last)
  };
}

function mergeMandorTables(data) {
  const out = [];
  [['Panen', data.panen], ['Muat', data.muat]].forEach(([role, t]) => {
    if (!t) return;
    t.rows.forEach(r => out.push([r[0] || '-', role, r[1] || '-', r[2] || '-']));
  });
  return out;
}

/** Upkeep: [{name, value, pct}] terurut terbesar. */
function upkeepItems(data) {
  if (!data.upkeep) return [];
  const items = data.upkeep.rows.map(r => ({ name: r[0] || '-', value: parseNum(r[1]) })).filter(x => x.value !== null);
  const total = items.reduce((s, x) => s + x.value, 0);
  items.forEach(x => { x.pct = total ? (x.value / total) * 100 : 0; });
  return items.sort((a, b) => b.value - a.value);
}

function describeUpkeep(items, period) {
  if (!items.length) return 'Upkeep cost per kelompok aktivitas: ANOMALI: tabel kosong / data belum tersedia.';
  const total = items.reduce((s, x) => s + x.value, 0);
  return `Upkeep cost per kelompok aktivitas, periode ${period || DECK_CONFIG.UPKEEP_ACTIVITY_PERIOD} (total ${fmtRp(total)}):\n` +
    items.map(x => `- ${x.name}: ${fmtRp(x.value)} (${fmtPct(x.pct, 1)} dari total)`).join('\n') +
    '\n- Catatan: kolom % di sheet kosong; persentase dihitung otomatis dari total.';
}

/* ------------------------------------------------------------------------- */
/* Teks slide                                                                */
/* ------------------------------------------------------------------------- */

function findSlideByPlaceholder(presentation, placeholder) {
  const slides = presentation.getSlides();
  for (let i = 0; i < slides.length; i++) {
    const shapes = slides[i].getShapes();
    for (let j = 0; j < shapes.length; j++) {
      try {
        if (shapes[j].getText().asString().includes(placeholder)) return slides[i];
      } catch (e) { /* shape tanpa teks */ }
    }
  }
  return null;
}

function removeShapeWithText(slide, placeholder) {
  slide.getShapes().forEach(s => {
    try { if (s.getText().asString().includes(placeholder)) s.remove(); } catch (e) { /* abaikan */ }
  });
}

function setSlideSpeakerNotes(slide, notesText) {
  if (!slide || !notesText) return;
  try {
    slide.getNotesPage().getSpeakerNotesShape().getText().setText(String(notesText).replace(/[*#]/g, ''));
  } catch (e) {
    Logger.log(`Warning speaker notes: ${e.message}`);
  }
}

/* ------------------------------------------------------------------------- */
/* ALUR JANJANG (dulu file 9, kini digabung di sini)                          */
/* ------------------------------------------------------------------------- */
/**
 * Analisis aliran janjang: Dipanen -> Dimuat -> Masuk trip (delivery) -> Terjual.
 * Tujuan: menemukan di tahap mana janjang hilang/tertahan (bottleneck), pihak yang bertanggung jawab
 * di tahap itu, dan estimasi kerugiannya (janjang × BJR × harga jual).
 *
 * Catatan metodologi:
 *  - Dihitung KUMULATIF selama periode (bulan penuh), karena janjang yang dipanen akhir bulan bisa dimuat bulan berikutnya.
 *  - Selisih positif = janjang tidak sampai ke tahap berikutnya (restan/hilang/tidak tercatat).
 *  - Selisih negatif = tahap berikut lebih besar (mengejar restan periode lalu atau pencatatan tahap sebelumnya kurang).
 *  - Nilai kerugian memakai BJR berbasis janjang terjual (tonase ÷ janjang terjual) bila wajar, jika tidak memakai standar Marihat.
 *  - Ini INDIKASI untuk diverifikasi, bukan tuduhan kepada orang tertentu.
 */

const FLOW_STAGES = [
  { key: 'flowPanen', name: 'Dipanen', role: 'tim panen (mandor panen)' },
  { key: 'flowMuat', name: 'Dimuat', role: 'tim muat & penjagaan TPH (mandor muat)' },
  { key: 'flowTrip', name: 'Masuk trip', role: 'sopir & armada angkut' },
  { key: 'flowSold', name: 'Terjual', role: 'timbangan PKS / agen pembeli' }
];

function buildFlow(d) {
  if (!d.flowPanen.length || !d.flowMuat.length) return null;
  const T = DECK_CONFIG.THRESHOLDS;
  // bulan yang punya data di semua tahap yang tersedia
  // "Masuk trip" yang selalu sama dengan "Dimuat" berarti belum dicatat terpisah: tahap ini tidak ditampilkan
  const tripSame = d.flowTrip.length && d.flowTrip.every(x => x.value === null || x.value === valAt(d.flowMuat, x.p));
  const stages = FLOW_STAGES.filter(st => !(st.key === 'flowTrip' && tripSame) && d[st.key] && d[st.key].some(x => x.value !== null));
  const months = d.flowPanen.filter(x => x.value !== null).map(x => x.p)
    .filter(p => stages.every(st => valAt(d[st.key], p) !== null));
  if (!months.length) return null;
  const tot = stages.map(st => months.reduce((s, p) => s + valAt(d[st.key], p), 0));

  // BJR untuk valuasi: tonase ÷ janjang terjual (kumulatif) bila wajar, jika tidak standar Marihat / BJR rata-rata
  const soldKey = stages[stages.length - 1].key;
  const tonSum = months.reduce((s, p) => s + (valAt(d.produksi, p) || 0), 0);
  const soldSum = months.reduce((s, p) => s + (valAt(d[soldKey], p) || 0), 0);
  const panenSum = tot[0];
  // BJR terjual: pakai d.bjrSoldCum (tonase ÷ janjang terjual BERBERAT) bila ada; janjang tanpa berat tidak punya tonase
  const bjrSold = d.bjrSoldCum || (soldSum ? (tonSum * 1000) / soldSum : null);
  const bjrPanen = panenSum ? (tonSum * 1000) / panenSum : null;
  // BJR untuk menilai janjang hilang mengikuti asal tonase (DECK_CONFIG.TONASE_BASIS)
  const basisPanen = DECK_CONFIG.TONASE_BASIS !== 'terjual';
  const bjrBasis = basisPanen ? bjrPanen : bjrSold;
  let bjrUsed = null, bjrSource = '';
  const sheetBjr = seriesStats(d.bjr);
  const ok = v => v && v >= 3 && v <= 40;
  if (ok(bjrBasis)) { bjrUsed = bjrBasis; bjrSource = basisPanen ? 'tonase ÷ janjang dipanen' : 'tonase ÷ janjang terjual'; }
  else if (sheetBjr && ok(sheetBjr.avg)) { bjrUsed = sheetBjr.avg; bjrSource = `rata-rata BJR bulanan, karena tonase ÷ janjang = ${fmt(bjrBasis, 1)} kg tidak wajar`; }
  else if (d.marihat) { bjrUsed = d.marihat.pot.rbt; bjrSource = `standar Marihat ${d.marihat.cls}, karena BJR data tidak wajar`; }
  const ps = seriesStats(d.hargaJual.length ? d.hargaJual : d.revKg);
  const price = ps ? ps.avg : null;
  const rp = j => (bjrUsed && price ? j * bjrUsed * price : null);
  // Asal tonase sudah ditetapkan di config, jadi nilai kerugian berupa satu angka (bukan rentang)
  const bjrLow = null;
  const rpLow = () => null;

  const steps = [];
  for (let i = 1; i < stages.length; i++) {
    const gap = tot[i - 1] - tot[i];
    const pct = tot[i - 1] ? (gap / tot[i - 1]) * 100 : 0;
    steps.push({
      from: stages[i - 1].name, to: stages[i].name, role: stages[i].role, gap, pct,
      loss: pct > T.FLOW_LOSS_PCT, excess: -pct > T.FLOW_EXCESS_PCT,
      rp: gap > 0 ? rp(gap) : null, rpLow: gap > 0 ? rpLow(gap) : null
    });
  }
  const lossJjg = Math.max(0, tot[0] - tot[tot.length - 1]);
  // Bila janjang terjual (kumulatif) MELEBIHI janjang dipanen, pencatatan panen tidak lengkap:
  // kebocoran tidak bisa diukur (BUKAN 0%). Dicatat sebagai temuan data.
  const overSold = tot[tot.length - 1] > tot[0] * (1 + T.FLOW_EXCESS_PCT / 100);
  const overSoldPct = tot[0] ? ((tot[tot.length - 1] - tot[0]) / tot[0]) * 100 : 0;
  // Bulan dengan panen > terjual (indikasi bulanan; bisa karena selisih waktu jual)
  const lastKey = stages[stages.length - 1].key;
  const shortMonths = months.map(p => ({ p, gap: valAt(d[stages[0].key], p) - valAt(d[lastKey], p) })).filter(x => x.gap > 0)
    .sort((a, b) => b.gap - a.gap);
  const worst = steps.filter(s => s.gap > 0 && s.pct >= 1).sort((a, b) => b.gap - a.gap)[0] || null;

  // Selisih panen - muat per bulan (bulan penuh) dan kumulatifnya
  let cum = 0;
  const monthlyGap = d.flowPanen.filter(x => x.value !== null && valAt(d.flowMuat, x.p) !== null).map(x => {
    const g = x.value - valAt(d.flowMuat, x.p); cum += g;
    return { p: x.p, label: x.label, value: g, cum };
  });

  // Konsistensi dengan tabel utama & tabel mandor
  const panenVsTotal = meanRelDiff(d.flowPanen, d.totalJjg);
  const mandor = [];
  [['panen', d.mandorPanen, d.flowPanen], ['muat', d.mandorMuat, d.flowMuat]].forEach(([role, m, ser]) => {
    if (!m) return;
    m.periods.forEach((per, i) => {
      if (per.partial || !per.p) return;
      const tm = m.rows.reduce((s, r) => s + ((r.vals[i] && r.vals[i].total) || 0), 0);
      const tf = valAt(ser, per.p);
      if (tm && tf) mandor.push({ role, label: per.label, mandorTotal: tm, flowTotal: tf, names: m.rows.filter(r => r.vals[i]).map(r => r.name) });
    });
  });

  // Konsistensi janjang terjual: tabel alur (berberat + tanpa berat) vs tabel utama (total_sale_jjg + tanpa berat)
  const soldVsMain = (d.saleJjg || []).some(x => x.value) ? months.map(p => {
    const main = (valAt(d.saleJjg, p) || 0) + (valAt(d.noWeightJjg || [], p) || 0), fl = valAt(d.flowSold, p);
    return { p, main, flow: fl, nwMain: valAt(d.noWeightJjg || [], p) || 0, nwFlow: valAt(d.flowSoldNoWeight || [], p) || 0 };
  }).filter(x => x.flow !== null && Math.abs(x.flow - x.main) > Math.max(10, x.main * 0.02)) : [];
  const nwTot = d.flowSoldNoWeight && d.flowSoldNoWeight.length ? months.reduce((s, p) => s + (valAt(d.flowSoldNoWeight, p) || 0), 0) : 0;

  // Kebocoran PER BULAN: bulan laporan (terakhir) dibandingkan bulan sebelumnya. Dinilai dengan BJR & harga bulan itu.
  // Saldo restan berjalan: janjang dipanen yang belum terjual dibawa ke bulan berikutnya (sering baru terjual awal bulan depan).
  //  - pendingJjg = dari panen BULAN INI yang belum terjual -> "belum terjual", BUKAN kerugian (dipantau bulan depan)
  //  - lossJjg    = dari panen BULAN SEBELUMNYA yang sampai akhir bulan ini masih belum terjual -> tertahan > 1 bulan,
  //                 indikasi janjang hilang/busuk (dasar estimasi kerugian)
  // Terjual melebihi dipanen mengurangi saldo (restan bulan lalu terjual); saldo tidak pernah negatif.
  const priceSer = d.hargaJual.length ? d.hargaJual : d.revKg;
  const snapshot = (p, carryIn, carryKnown) => {
    const vals = stages.map(st => valAt(d[st.key], p));
    const bjrM = valAt(d.bjrSoldMonthly || [], p), hM = valAt(priceSer, p);
    const bjrV = ok(bjrM) ? bjrM : bjrUsed, priceV = hM || price;
    const rpM = j => (bjrV && priceV ? j * bjrV * priceV : null);
    const stepsM = [];
    for (let i = 1; i < stages.length; i++) {
      const gap = vals[i - 1] - vals[i], pct = vals[i - 1] ? (gap / vals[i - 1]) * 100 : 0;
      stepsM.push({ from: stages[i - 1].name, to: stages[i].name, role: stages[i].role, gap, pct,
        loss: pct > T.FLOW_LOSS_PCT, excess: -pct > T.FLOW_EXCESS_PCT, rp: gap > 0 ? rpM(gap) : null, rpLow: null });
    }
    const panen = vals[0], sold = vals[vals.length - 1];
    const balance = Math.max(0, carryIn + panen - sold);
    const pending = Math.min(Math.max(0, panen - sold), balance);
    const loss = balance - pending;                       // tertahan > 1 bulan
    const avail = carryIn + panen;
    const nw = valAt(d.flowSoldNoWeight || [], p) || 0;
    return {
      p, label: monthShort(p), months: 1, bjrUsed: bjrV, price: priceV, carryIn, carryKnown, balance,
      carrySold: sold > panen ? Math.min(carryIn, sold - panen) : 0,
      pendingJjg: pending, pendingPct: panen ? (pending / panen) * 100 : 0, pendingRp: pending ? rpM(pending) : null,
      stages: stages.map((st, i) => ({ name: st.name, role: st.role, total: vals[i],
        note: st.key === 'flowSold' && nw ? `${fmt(nw, 0)} tanpa berat` : '' })),
      steps: stepsM, lossJjg: loss, lossPct: avail ? (loss / avail) * 100 : 0, lossRp: loss ? rpM(loss) : null, lossRpLow: null,
      // terjual melebihi dipanen + sisa bulan lalu = catatan panen kurang (tidak bisa diukur)
      overSold: sold > avail * (1 + T.FLOW_EXCESS_PCT / 100),
      overSoldPct: avail ? ((sold - avail) / avail) * 100 : 0,
      soldNoWeight: nw, worst: stepsM.filter(s => s.gap > 0 && s.pct >= 1).sort((a, b) => b.gap - a.gap)[0] || null
    };
  };
  const monthly = [];
  months.forEach((p, i) => { const prevS = monthly[i - 1]; monthly.push(snapshot(p, prevS ? prevS.balance : 0, i > 0)); });
  const cur = monthly[monthly.length - 1] || null, prevM = monthly.length > 1 ? monthly[monthly.length - 2] : null;
  // Sisa yang tertahan di akhir bulan laporan tetapi sudah terjual di bulan berjalan (terjual > dipanen) bukan kerugian
  const PF = d.partialFlow;
  if (cur && PF && PF.sold > PF.panen && cur.balance > 0) {
    const extra = PF.sold - PF.panen;
    cur.soldLater = Math.min(cur.balance, extra); cur.soldLaterP = PF.p;
    const fromAged = Math.min(cur.lossJjg, cur.soldLater);
    cur.lossJjg -= fromAged; cur.pendingJjg -= Math.min(cur.pendingJjg, cur.soldLater - fromAged);
    const avail = cur.carryIn + cur.stages[0].total;
    cur.lossPct = avail ? (cur.lossJjg / avail) * 100 : 0;
    cur.lossRp = cur.lossJjg && cur.bjrUsed && cur.price ? cur.lossJjg * cur.bjrUsed * cur.price : null;
    cur.pendingPct = cur.stages[0].total ? (cur.pendingJjg / cur.stages[0].total) * 100 : 0;
    cur.pendingRp = cur.pendingJjg && cur.bjrUsed && cur.price ? cur.pendingJjg * cur.bjrUsed * cur.price : null;
  }

  return {
    monthly, cur, prev: prevM,
    soldNoWeight: nwTot, overSold, overSoldPct, shortMonths, tripMerged: !!tripSame,
    stages: stages.map((st, i) => ({ name: st.name, role: st.role, total: tot[i],
      note: st.key === 'flowSold' && nwTot ? `${fmt(nwTot, 0)} tanpa berat` : '' })),
    months: months.length, firstP: months[0], lastP: months[months.length - 1],
    steps, worst, lossJjg, lossPct: tot[0] ? (lossJjg / tot[0]) * 100 : 0, lossRp: lossJjg ? rp(lossJjg) : null,
    lossRpLow: lossJjg ? rpLow(lossJjg) : null, bjrLow,
    bjrUsed, bjrSource, bjrSold, bjrPanen, price, monthlyGap, panenVsTotal, mandor, soldVsMain
  };
}

function describeFlow(d) {
  const F = d.flow;
  if (!F) return 'Alur janjang: tabel panen-muat-trip-terjual belum tersedia.';
  const L = [];
  // Bulan laporan vs bulan sebelumnya: angka utama untuk owner (judul, KPI, slide ringkasan)
  const head = s => `${monthLong(s.p)}: dipanen ${fmt(s.stages[0].total, 0)}${s.carryIn ? ` + sisa belum terjual bulan lalu ${fmt(s.carryIn, 0)}` : ''}, terjual ${fmt(s.stages[s.stages.length - 1].total, 0)} janjang`;
  const mline = s => s.overSold
    ? `${head(s)} (terjual ${fmt(s.overSoldPct, 0)}% lebih banyak dari dipanen${s.carryIn ? ' ditambah sisa bulan lalu' : ''}; kebocoran bulan ini TIDAK BISA DIUKUR, kemungkinan catatan panen kurang${s.carryKnown ? '' : ' atau restan sebelum periode data ikut terjual'})`
    : `${head(s)}${s.carrySold ? ` (termasuk ${fmt(s.carrySold, 0)} sisa bulan lalu yang baru terjual)` : ''}; ` +
      `belum terjual dari panen bulan ini ${fmt(s.pendingJjg, 0)} janjang (${fmt(s.pendingPct, 0)}%${s.pendingRp ? `, nilai ${fmtRp(s.pendingRp)}` : ''}; bisa terjual bulan depan, BUKAN kerugian); ` +
      `tertahan lebih dari 1 bulan ${fmt(s.lossJjg, 0)} janjang (${fmt(s.lossPct, 1)}%)` +
      (s.lossRp ? ` ≈ ${fmtRp(s.lossRp)} (BJR ${fmt(s.bjrUsed, 1)} kg × harga Rp${fmt(s.price, 0)}/kg bulan itu)` : '') +
      (s.soldLater ? `; ${fmt(s.soldLater, 0)} janjang sisa sudah terjual di ${monthLong(s.soldLaterP)} (bulan berjalan: terjual melebihi dipanen), jadi tidak dihitung` : '') +
      (s.worst ? `; selisih terbesar di ${s.worst.from} → ${s.worst.to}` : '');
  if (F.cur) {
    L.push('Definisi: KERUGIAN janjang = janjang yang dipanen bulan-bulan sebelumnya dan sampai akhir bulan laporan masih belum terjual (tertahan > 1 bulan). ' +
      'Selisih panen − terjual BULAN INI ditulis "belum terjual" (sering baru terjual awal bulan berikutnya), bukan kerugian.');
    L.push(`KEBOCORAN BULAN LAPORAN (pakai angka ini untuk judul, KPI, dan ringkasan): ${mline(F.cur)}.`);
    if (F.prev) {
      L.push(`- Pembanding bulan sebelumnya: ${mline(F.prev)}.`);
      if (!F.cur.overSold && !F.prev.overSold && F.prev.lossRp && F.cur.lossRp !== null) {
        const ch = ((F.cur.lossRp - F.prev.lossRp) / Math.abs(F.prev.lossRp)) * 100;
        L.push(`- Estimasi kerugian (tertahan > 1 bulan) ${monthShort(F.cur.p)} ${ch >= 0 ? 'naik' : 'turun'} ${fmt(Math.abs(ch), 0)}% dibanding ${monthShort(F.prev.p)} (${fmtRp(F.cur.lossRp)} vs ${fmtRp(F.prev.lossRp)}).`);
      }
    }
    L.push(`- Per bulan (belum terjual bulan itu | tertahan > 1 bulan): ${F.monthly.map(s => `${s.label} ${s.overSold ? 'tidak terukur' : `${fmt(s.pendingJjg, 0)} | ${s.lossRp ? fmtRp(s.lossRp) : fmt(s.lossJjg, 0) + ' jjg'}`}`).join('; ')}.`);
  }
  L.push(`ALUR JANJANG KUMULATIF (konteks saja, ${F.months} bulan, ${monthLong(F.firstP)}–${monthLong(F.lastP)}): ` +
    F.stages.map(s => `${s.name} ${fmt(s.total, 0)}${s.note ? ` (${s.note})` : ''}`).join(' → ') + '.');
  if (F.tripMerged) L.push('- Tahap masuk trip belum dicatat terpisah (sama dengan dimuat), jadi tidak ditampilkan di corong.');
  if (F.soldNoWeight) L.push(`- Tahap Terjual = janjang terjual dengan berat + tanpa berat; ${fmt(F.soldNoWeight, 0)} janjang (${fmtPct((F.soldNoWeight / F.stages[F.stages.length - 1].total) * 100, 0)}) terjual tanpa catatan berat.`);
  F.steps.forEach(s => {
    if (s.gap > 0) L.push(`- ${s.from} → ${s.to}: berkurang ${fmt(s.gap, 0)} janjang (${fmt(s.pct, 1)}%)` +
      (s.rp ? ` ≈ ${s.rpLow ? `${fmtRp(s.rpLow)}–` : ''}${fmtRp(s.rp)}` : '') + `; tahap ini dipegang ${s.role}.` + (s.loss ? ' KEBOCORAN di atas ambang.' : ''));
    else if (s.gap < 0) L.push(`- ${s.from} → ${s.to}: tahap berikut LEBIH BESAR ${fmt(-s.gap, 0)} janjang (${fmt(-s.pct, 1)}%)` +
      (s.excess ? '; kemungkinan pencatatan tahap sebelumnya kurang atau restan dari periode sebelumnya.' : '; masih dalam batas wajar (selisih waktu).'));
    else L.push(`- ${s.from} → ${s.to}: seimbang.`);
  });
  if (F.lossJjg) L.push(`- Total janjang dipanen yang tidak sampai terjual: ${fmt(F.lossJjg, 0)} (${fmt(F.lossPct, 1)}%)` +
    (F.lossRp ? ` ≈ estimasi kerugian ${F.lossRpLow ? `${fmtRp(F.lossRpLow)} sampai ` : ''}${fmtRp(F.lossRp)}` +
      ` (janjang hilang × BJR × harga rata-rata Rp${fmt(F.price, 0)}/kg; BJR ${F.bjrLow ? `${fmt(F.bjrLow, 1)} kg [tonase ÷ janjang dipanen] sampai ` : ''}${fmt(F.bjrUsed, 1)} kg [${F.bjrSource}]).` : '.'));
  L.push(`- Tonase di sheet berasal dari janjang ${DECK_CONFIG.TONASE_BASIS === 'terjual' ? 'terjual' : 'dipanen'}; BJR dan nilai kerugian dihitung atas dasar itu.`);
  if (F.overSold) {
    L.push(`PERLU DICEK: janjang terjual ${fmt(F.overSoldPct, 1)}% LEBIH BANYAK dari janjang dipanen selama periode (${fmt(F.stages[F.stages.length - 1].total, 0)} vs ${fmt(F.stages[0].total, 0)}); pencatatan panen belum lengkap sehingga kebocoran janjang TIDAK BISA DIUKUR (bukan berarti 0%).`);
    if (F.shortMonths.length) L.push(`- Bulan dengan janjang dipanen lebih banyak dari yang terjual: ${F.shortMonths.slice(0, 5).map(x => `${monthLong(x.p)} ${fmt(x.gap, 0)} jjg`).join(', ')} (sebagian bisa terjual bulan berikutnya).`);
  }
  if (F.worst) L.push(`- Bottleneck terbesar: ${F.worst.from} → ${F.worst.to} (${F.worst.role}).`);
  // Tidak ditulis bila banyak janjang terjual tanpa berat: selisihnya terutama karena tonase janjang itu tidak tercatat
  const nwShare = d.noWeight ? d.noWeight.share : 0;
  if (DECK_CONFIG.TONASE_BASIS === 'terjual' && F.bjrSold && F.bjrPanen && F.bjrSold > F.bjrPanen * 1.15 && nwShare <= DECK_CONFIG.THRESHOLDS.NOWEIGHT_PCT && !F.overSold) {
    L.push(`- BJR berbasis janjang terjual ${fmt(F.bjrSold, 1)} kg vs berbasis janjang dipanen ${fmt(F.bjrPanen, 1)} kg: BJR rendah kemungkinan sebagian karena janjang yang dipanen tidak semuanya sampai terjual (tonase hanya dari janjang terjual).`);
  }
  const gaps = F.monthlyGap.filter(g => g.value > 0).sort((a, b) => b.value - a.value).slice(0, 3);
  if (gaps.length) L.push(`- Bulan dengan selisih panen-muat terbesar: ${gaps.map(g => `${monthLong(g.p)} ${fmt(g.value, 0)} jjg`).join(', ')}; selisih kumulatif akhir ${fmt(F.monthlyGap[F.monthlyGap.length - 1].cum, 0)} jjg.`);
  if (F.panenVsTotal !== null && F.panenVsTotal > 2) L.push(`TIDAK KONSISTEN (${fmt(F.panenVsTotal, 0)}%): jjg dipanen di tabel alur berbeda dengan total janjang dipanen di tabel produksi.`);
  F.mandor.forEach(m => {
    const diff = Math.abs(m.mandorTotal / m.flowTotal - 1) * 100;
    L.push(`- ${m.label} mandor ${m.role} (${m.names.join(', ')}): total ${fmt(m.mandorTotal, 0)} jjg vs tabel alur ${fmt(m.flowTotal, 0)} jjg${diff > 10 ? ' (berbeda >10%, perlu dicocokkan)' : ' (cocok)'}.`);
  });
  // Temuan kebocoran memakai bulan laporan (bukan kumulatif), agar sama dengan KPI dan judul
  const lossSrc = F.cur && !F.cur.overSold ? F.cur : null;
  (lossSrc ? lossSrc.steps : F.steps).filter(s => s.loss).forEach(s => L.push(`PERLU DICEK: kebocoran janjang ${lossSrc ? monthLong(lossSrc.p) : 'kumulatif'} ${s.from} → ${s.to} ${fmt(s.gap, 0)} jjg (${fmt(s.pct, 0)}%)${s.rp ? ` ≈ ${fmtRp(s.rp)}` : ''}; konfirmasi ke ${s.role}.`));
  if (F.soldVsMain && F.soldVsMain.length) L.push(`TIDAK KONSISTEN: janjang terjual di tabel alur berbeda dengan tabel utama (terjual berberat + tanpa berat) pada ${F.soldVsMain.length} bulan, ` +
    `mis. ${F.soldVsMain.slice(0, 3).map(x => `${monthShort(x.p)} alur ${fmt(x.flow, 0)} vs utama ${fmt(x.main, 0)} (tanpa berat ${fmt(x.nwFlow, 0)} vs ${fmt(x.nwMain, 0)})`).join('; ')}; ` +
    'angka tanpa berat di slide Tanpa Berat memakai tabel utama, corong memakai tabel alur. Samakan pencatatan kedua tabel.');
  F.steps.filter(s => s.excess).forEach(s => L.push(`PERLU DICEK: janjang ${s.to.toLowerCase()} melebihi ${s.from.toLowerCase()} ${fmt(-s.gap, 0)} jjg; cek pencatatan panen dan restan awal periode.`));
  return L.join('\n');
}
