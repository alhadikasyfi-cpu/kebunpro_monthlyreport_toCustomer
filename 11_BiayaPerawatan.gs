/**
 * File 11: BiayaPerawatan.gs
 * Analisis BIAYA PERAWATAN (upkeep) PER BULAN dari tabel "Upkeep Cost":
 *   month | activity_group (name; cost) | total_cost
 *   2025-10-01 | PRUNING; 19110000, SPRAYING; 180000, FERTILIZING; 3166000 | 22456000
 *
 *  - Kode pekerjaan (PRUNING, SLASHING, ...) diterjemahkan ke nama Indonesia dan dikelompokkan per kategori
 *    (pemupukan, pengendalian gulma, perawatan tanaman, panen & brondolan, jalan & infrastruktur, kendaraan & operator).
 *  - Bulan laporan dibandingkan bulan lalu dan rata-rata bulan sebelumnya; biaya per ha dan per ton TBS.
 *  - Lonjakan biaya per pekerjaan / per bulan dan selisih antar-tabel ditandai PERLU DICEK (sering salah input).
 *  - Pemupukan tercatat (berapa bulan, kapan terakhir, Rp/ha) menjadi bukti status pemupukan (file 9).
 * Format lama (activity_group | total_upkeep_cost tanpa bulan) tetap dibaca sebagai satu periode.
 */

/** Kategori pekerjaan perawatan (urutan = urutan di grafik). */
const UPKEEP_CATEGORIES = [
  { key: 'pupuk', name: 'Pemupukan', color: '#007200' },
  { key: 'gulma', name: 'Pengendalian gulma', color: '#7fb77e' },
  { key: 'tanaman', name: 'Perawatan tanaman', color: '#f2c400' },
  { key: 'panen', name: 'Panen & brondolan', color: '#c98a00' },
  { key: 'infra', name: 'Jalan & infrastruktur', color: '#6b6b6b' },
  { key: 'alat', name: 'Kendaraan & operator', color: '#a9a9a9' },
  { key: 'lain', name: 'Lainnya', color: '#d9d9d9' }
];

/** Kode pekerjaan -> [nama Indonesia, kategori]. Kode lain dikenali dari kata kuncinya (UPKEEP_RULES). */
const UPKEEP_ACTIVITIES = {
  FERTILIZING: ['Pemupukan', 'pupuk'], FERTILIZER_UNLOADING: ['Bongkar pupuk', 'pupuk'], FERTILIZER_TRANSPORT: ['Angkut pupuk', 'pupuk'],
  SPOTTER_DRIVER_FERTILIZER: ['Sopir angkut pupuk', 'pupuk'],
  SLASHING: ['Pembabatan', 'gulma'], INTERROW_SLASHING: ['Babat gawangan', 'gulma'], HARVEST_PATH_SLASHING: ['Babat pasar pikul', 'gulma'],
  SPRAYING: ['Penyemprotan herbisida', 'gulma'], SPRAYING_TOTAL: ['Penyemprotan herbisida', 'gulma'], VINE_REMOVAL: ['Pembersihan gulma merambat', 'gulma'],
  GRASS_EVACUATION: ['Pembuangan rumput', 'gulma'],
  PRUNING: ['Penunasan', 'tanaman'], PRUNINIG: ['Penunasan', 'tanaman'], FROND_PRUNING: ['Penunasan pelepah', 'tanaman'],
  SUCKER_PRUNING: ['Pembuangan tunas', 'tanaman'], ABLATION: ['Ablasi', 'tanaman'], PALM_PLANTING: ['Penanaman / sisip', 'tanaman'],
  IMMATURE_CONSOLIDATION: ['Konsolidasi TBM', 'tanaman'], PALM_CHIPING: ['Pencacahan batang', 'tanaman'], UPKEEPING: ['Perawatan umum', 'tanaman'],
  FFB_COLLECTION: ['Pengumpulan TBS', 'panen'], GLEANING: ['Pengutipan brondolan', 'panen'], LOOSE_FRUIT_LOADING: ['Muat brondolan', 'panen'],
  OVERGROWN_HARVESTING: ['Panen pokok tinggi', 'panen'], HARVEST_ATTENDANCE_INCENTIVE: ['Insentif kehadiran panen', 'panen'],
  ROAD_MAINTENANCE: ['Perawatan jalan', 'infra'], LOADING_RAMP_CLEANING: ['Pembersihan TPH', 'infra'], CONTRACT_STONE_TRANSPORT: ['Angkut batu (borongan)', 'infra'],
  DRIVER: ['Sopir', 'alat'], FARM_VEHICLE_DRIVER: ['Sopir kendaraan kebun', 'alat'], SPOTTER_DRIVER: ['Sopir spotter', 'alat'],
  MINI_EXCAVATOR_OPERATOR: ['Operator mini ekskavator', 'alat'], HITACHI_PC_OPERATOR_INCENTIVE: ['Insentif operator ekskavator', 'alat'],
  CRANE_WATCHMAN: ['Penjaga crane', 'alat'], WORKSHOP_ASSISTANT: ['Pembantu bengkel', 'alat'],
  CIRCLE_WEEDING: ['Pembersihan piringan', 'gulma'], WEEDING: ['Penyiangan', 'gulma'], WEED_SPRAYING: ['Penyemprotan gulma', 'gulma'],
  POISON_WEEDS: ['Penyemprotan gulma', 'gulma'], SLASHING_MACHINE: ['Pembabatan mesin', 'gulma'], VINE_CUTTING: ['Pemotongan gulma merambat', 'gulma'],
  WOODY_WEEDS_UPROOTING: ['Pencabutan gulma berkayu', 'gulma'], WOODY_WEED_CLEARING: ['Pembersihan gulma berkayu', 'gulma'],
  LATE_ROTATION_SHRUB_PRUNING: ['Penunasan rotasi terlambat', 'tanaman'], CONTRACT_PRUNING: ['Penunasan (borongan)', 'tanaman'],
  COVER_CROP_PLANTING: ['Penanaman kacangan penutup tanah', 'tanaman'], MUCUNA_PLANTING: ['Penanaman Mucuna', 'tanaman'],
  POLYBAG_TIDY_UP: ['Perapian polybag bibit', 'tanaman'], PALM_OIL_INFUSION: ['Infus batang', 'tanaman'],
  SPREADING_EFB: ['Aplikasi janjang kosong', 'pupuk'], BOILER_ASH_SPREADING: ['Aplikasi abu boiler', 'pupuk'],
  FFB_COLLECTION_PASSING: ['Pengumpulan TBS', 'panen'], FFB_HAULING_ASSISTANT: ['Pembantu angkut TBS', 'panen'], FFB_TRANSPORT: ['Angkut TBS', 'panen'],
  FFB_YARD_TRANSFER_OVERTIME: ['Lembur pindah TBS', 'panen'], RECOVERY_HARVESTING: ['Panen pemulihan', 'panen'], THRESHING: ['Pembrondolan', 'panen'],
  LOAD: ['Muat', 'panen'], LOAD_BUNCH: ['Muat janjang', 'panen'], LOADING_ASSISTANCE: ['Bantu muat', 'panen'], OVERTIME_LOADING: ['Lembur muat', 'panen'],
  ROAD_MAINTENNANCE: ['Perawatan jalan', 'infra'], ROAD_FILLING: ['Penimbunan jalan', 'infra'], BRIDGE_SERVICE: ['Perawatan jembatan', 'infra'],
  DRAIN_CONSTRUCTION: ['Pembuatan parit', 'infra'], TPH_CONSTRUCTION: ['Pembuatan TPH', 'infra'], CONTRACT_GRAVEL_TRANSPORT: ['Angkut kerikil (borongan)', 'infra'],
  CONTRACT_SAND_TRANSPORT: ['Angkut pasir (borongan)', 'infra'], SAND_TRANSPORT: ['Angkut pasir', 'infra'], UNLOAD_SIRTU: ['Bongkar sirtu', 'infra'],
  BUILDING_CONCRETE_WORK: ['Pengecoran bangunan', 'infra'], GATE_REPAIR: ['Perbaikan gerbang', 'infra'], CONTRACT_BLOCK_DEMOLITION: ['Pembongkaran blok (borongan)', 'infra'],
  OPERATOR: ['Operator alat', 'alat'], DRIVING: ['Mengemudi', 'alat'], TPH_SPOTTER_DRIVER: ['Sopir spotter TPH', 'alat'], VEHICLE_RENTAL: ['Sewa kendaraan', 'alat'],
  MINI_PC_OPERATOR_INCENTIVE: ['Insentif operator ekskavator mini', 'alat'], SCHOOL_BUS_DRIVER: ['Sopir bus sekolah', 'alat'],
  CONTRACT_RAM_VEHICLE_SERVICE: ['Servis kendaraan (borongan)', 'alat'], EQUIPMENT_MAINTENANCE: ['Perawatan alat', 'alat'],
  MECHANIC_ASSISTANT: ['Pembantu mekanik', 'alat'], MECHANIC_HELPER: ['Pembantu mekanik', 'alat'], CONTRACT_DIESEL_INCENTIVE: ['Insentif solar (borongan)', 'alat'],
  DIESEL_ALLOWANCE: ['Tunjangan solar', 'alat'], TIMBER_TRANSPORT: ['Angkut kayu', 'alat'],
  CONTRACT_TOTAL_MAINTENANCE: ['Perawatan menyeluruh (borongan)', 'lain'], CONTRACT_SPJP: ['Borongan SPJP', 'lain'], CONTRACT_FIRST_AID: ['P3K (borongan)', 'lain'],
  CONTRACT_MOSQUE_CARETAKER: ['Penjaga masjid (borongan)', 'lain'], FOREMAN_TRAINING: ['Pelatihan mandor', 'lain'], DORMITORY_CLEANING: ['Kebersihan mess', 'lain'],
  MESS_CLEANING_OVERTIME: ['Lembur kebersihan mess', 'lain'], SPRAY_MESS_AREA: ['Penyemprotan area mess', 'lain'], SPRAY_WATER_SUPPLY: ['Penyemprotan sumber air', 'lain'],
  CLEANING: ['Kebersihan', 'lain'], COOKING: ['Masak', 'lain'], MEAL: ['Makan pekerja', 'lain'], HELPER: ['Pembantu umum', 'lain'],
  CARPENTER_ASSISTANT: ['Pembantu tukang kayu', 'lain'], GARDEN_MAINTENANCE: ['Perawatan taman', 'lain'], GATE_SECURITY_DUTY: ['Jaga gerbang', 'lain'],
  TARGET_ACHIEVEMENT_INCENTIVE: ['Insentif capaian target', 'lain'], WASP_NEST_BURNING: ['Pembakaran sarang tawon', 'lain'],
  OTHERS: ['Lainnya', 'lain']
};
const UPKEEP_RULES = [
  [/FERTILI|PUPUK|MANUR/, 'pupuk'], [/SLASH|SPRAY|WEED|HERBI|VINE|GRASS|BABAT|SEMPROT|GULMA/, 'gulma'],
  [/PRUN|ABLAT|PLANT|SUCKER|TUNAS|SISIP|CONSOLID/, 'tanaman'], [/FFB|GLEAN|LOOSE_FRUIT|HARVEST|BRONDOL|PANEN/, 'panen'],
  [/ROAD|BRIDGE|DRAIN|RAMP|JALAN|PARIT|STONE|CULVERT|TPH|GRAVEL|SAND/, 'infra'], [/DRIVER|OPERATOR|VEHICLE|EXCAVATOR|CRANE|WORKSHOP|TRACTOR/, 'alat']
];

/** Kode berbeda untuk pekerjaan yang sama (salah ketik / varian) -> satu kode, agar tidak terpecah di tabel & lonjakan. */
const UPKEEP_ALIASES = { PRUNINIG: 'PRUNING', ROAD_MAINTENNANCE: 'ROAD_MAINTENANCE', SPRAYING_TOTAL: 'SPRAYING',
  FFB_COLLECTION_PASSING: 'FFB_COLLECTION', MECHANIC_HELPER: 'MECHANIC_ASSISTANT', POISON_WEEDS: 'WEED_SPRAYING' };
/** Pekerjaan aplikasi pupuk (bukti frekuensi pemupukan); bongkar/angkut pupuk tidak dihitung sebagai aplikasi. */
const UPKEEP_FERT_APPLY = /^(FERTILIZING|SPREADING_EFB|BOILER_ASH_SPREADING)$/;

function upkeepCategory(key) { return UPKEEP_CATEGORIES.find(c => c.key === key) || UPKEEP_CATEGORIES[UPKEEP_CATEGORIES.length - 1]; }

/** "PRUNINIG" -> {code: 'PRUNING', name: 'Penunasan', cat: 'tanaman'}; kode tak dikenal -> nama dari kode itu sendiri. */
function upkeepActivity(raw) {
  const raw0 = String(raw || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  const code = UPKEEP_ALIASES[raw0] || raw0;
  const known = UPKEEP_ACTIVITIES[code];
  if (known) return { code, name: known[0], cat: known[1] };
  const rule = UPKEEP_RULES.find(r => r[0].test(code));
  const name = code.toLowerCase().split('_').filter(Boolean).join(' ');
  return { code, name: name ? name.charAt(0).toUpperCase() + name.slice(1) : 'Tanpa nama', cat: rule ? rule[1] : 'lain' };
}

/** "PRUNING; 19110000, SPRAYING; 180000" -> [{code, name, cat, cost}] (kode sama dalam satu bulan dijumlahkan). */
function parseUpkeepItems(text) {
  const out = {};
  String(text || '').split(/,\s*(?=[A-Za-z_])/).forEach(part => {
    const m = part.match(/^\s*([^;]+);\s*(.+?)\s*$/);
    if (!m) return;
    const cost = parseNum(m[2]);
    if (cost === null) return;
    const a = upkeepActivity(m[1]);
    if (!out[a.code]) out[a.code] = Object.assign({ cost: 0 }, a);
    out[a.code].cost += cost;
  });
  return Object.keys(out).map(k => out[k]).sort((a, b) => b.cost - a.cost);
}

/**
 * Tabel upkeep format baru (per bulan) dari sheet. Mengembalikan null bila tabel tidak ada atau masih format lama.
 * -> [{p, label, items, total, itemSum}] urut bulan; bulan berjalan yang belum lengkap tidak diikutkan.
 */
function readUpkeepMonthly(values, display) {
  const H = DECK_CONFIG.HEADERS;
  const at = findCell(display, H.UPKEEP_HEADER);
  if (!at) return null;
  const c0 = at.c - 1;                        // kolom bulan tepat di kiri kolom activity_group
  if (c0 < 0 || !/month|bulan/.test(norm(display[at.r][c0]))) return null;
  const rows = [];
  for (let r = at.r + 1; r < values.length; r++) {
    const pv = values[r][c0], txt = display[r][at.c];
    const p = parseMonth(pv) || parseMonth(display[r][c0]);
    if (!p) { if (isBlank(display[r][c0]) && isBlank(txt)) break; continue; }
    const items = parseUpkeepItems(txt);
    const itemSum = items.reduce((a, x) => a + x.cost, 0);
    const total = parseNum(values[r][at.c + 1]);
    rows.push({ p, label: monthShort(p), items, itemSum, total: total !== null ? total : itemSum });
  }
  const full = rows.filter(x => !isPartialMonth(x.p)).sort((a, b) => (a.p.y - b.p.y) || (a.p.m - b.p.m));
  return full.length ? full : null;
}

function upkeepMedian(arr) {
  const v = arr.filter(x => x !== null && x !== undefined && !isNaN(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const k = Math.floor(v.length / 2);
  return v.length % 2 ? v[k] : (v[k - 1] + v[k]) / 2;
}

/**
 * Analisis biaya perawatan per bulan. Bulan laporan = bulan terakhir tabel utama (bukan tabel upkeep).
 * -> {months, cur, prev, avgPrev, catSeries, totalSeries, perHa, perTon, area, top, changes, spikes, monthSpikes,
 *     sumMismatch, crossMismatch, fert, beforeMain}
 */
function buildUpkeepAnalysis(d) {
  const M = d.upkeepMonthly;
  if (!M || !M.length) return null;
  const T = DECK_CONFIG.THRESHOLDS;
  const lastMain = [d.totalJjg, d.flowPanen, d.yield, d.produksi].map(s => (s || []).filter(x => x.value !== null).pop()).find(Boolean);
  const repP = lastMain ? lastMain.p : M[M.length - 1].p;
  const months = M.filter(x => (x.p.y * 12 + x.p.m) <= (repP.y * 12 + repP.m));
  if (!months.length) return null;
  const key = mkey;
  const cur = months.find(x => key(x.p) === key(repP)) || null;
  const prevCal = { y: repP.m === 0 ? repP.y - 1 : repP.y, m: (repP.m + 11) % 12 };
  const prev = months.find(x => key(x.p) === key(prevCal)) || null;
  // Luas pembagi: luas blok (Marihat) -> luas blok unik -> median luas panen
  const lp = (d.luasPanen || []).map(x => x.value).filter(v => v);
  const area = (d.marihat && d.marihat.area) || (d.blocks && d.blocks.totalHa) || upkeepMedian(lp) || null;
  // Bulan dengan upkeep per ha tidak masuk akal (mis. Rp434 juta/ha sebulan) = hampir pasti salah input:
  // tetap dilaporkan, tetapi tidak dipakai sebagai pembanding, rata-rata, atau grafik
  // Tanpa luas: pakai biaya per janjang dipanen (upkeep > Rp100 ribu per janjang sebulan = lebih mahal dari nilai janjangnya)
  const jjgOf = m => valAt(d.flowPanen || [], m.p) || valAt(d.totalJjg || [], m.p);
  const absurd = months.filter(m => area ? m.total / area > T.UPKEEP_MAX_RP_HA_MONTH
    : (jjgOf(m) ? m.total / jjgOf(m) > T.UPKEEP_MAX_RP_JJG : false));
  const isAbsurd = m => absurd.indexOf(m) >= 0;

  // Lonjakan per pekerjaan: biaya bulan itu > SPIKE_X × median bulan lain (minimal 3 bulan pembanding) dan > Rp5 juta
  const spikes = [];
  const codes = {};
  months.forEach(m => m.items.forEach(it => { (codes[it.code] = codes[it.code] || []).push({ p: m.p, cost: it.cost, name: it.name }); }));
  Object.keys(codes).forEach(c => {
    const arr = codes[c];
    arr.forEach(x => {
      const others = arr.filter(y => y !== x).map(y => y.cost);
      const med = others.length >= 2 ? upkeepMedian(others) : null;
      if (med && x.cost > med * T.UPKEEP_SPIKE_X && x.cost - med > T.UPKEEP_SPIKE_MIN_RP) spikes.push({ p: x.p, code: c, name: x.name, cost: x.cost, median: med, ratio: x.cost / med });
    });
  });
  spikes.sort((a, b) => (b.cost - b.median) - (a.cost - a.median));
  // Bulan yang sebagian besar biayanya berasal dari lonjakan (kemungkinan salah input) tidak dipakai sebagai "biasanya"
  const spikeRp = m => spikes.filter(s => key(s.p) === key(m.p)).reduce((a, s) => a + (s.cost - s.median), 0);
  const tainted = m => isAbsurd(m) || (m.total && spikeRp(m) / m.total > 0.5);
  const before = months.filter(x => (!cur || key(x.p) !== key(cur.p)) && !tainted(x));
  // Biaya kurang dari Rp1.000 untuk satu pekerjaan sebulan hampir pasti jumlah/satuan, bukan rupiah
  const tinyItems = [];
  months.forEach(m => m.items.forEach(it => { if (it.cost > 0 && it.cost < 1000) tinyItems.push({ p: m.p, name: it.name, cost: it.cost }); }));
  // Lonjakan total bulanan & biaya per ha per bulan yang tidak masuk akal
  const totals = months.map(m => m.total);
  const monthSpikes = months.filter(m => {
    const others = months.filter(o => o !== m).map(o => o.total);
    const med = others.length >= 2 ? upkeepMedian(others) : null;
    const perHa = area ? m.total / area : null;
    return (med && m.total > med * T.UPKEEP_SPIKE_X && m.total - med > T.UPKEEP_SPIKE_MIN_RP) || (perHa && perHa > T.UPKEEP_MAX_RP_HA_MONTH);
  }).map(m => ({ p: m.p, total: m.total, perHa: area ? m.total / area : null,
                 median: upkeepMedian(months.filter(o => o !== m).map(o => o.total)) }));
  // Konsistensi: jumlah rincian vs total_cost; total upkeep vs kolom upkeep_cost_idr tabel biaya pekerja
  const near = (a, b) => Math.abs(a - b) <= Math.max(1000, Math.abs(b) * 0.01);
  const sumMismatch = months.filter(m => m.items.length && !near(m.itemSum, m.total));
  // Pakai angka mentah tabel biaya (sebelum bulan tidak wajar disisihkan); urut dari selisih terbesar
  const crossMismatch = months.map(m => ({ p: m.p, upkeep: m.total, biaya: valAt(d.costUpkeepRaw || d.costUpkeep || [], m.p) }))
    .filter(x => x.biaya !== null && x.biaya !== undefined && !near(x.upkeep, x.biaya))
    .sort((a, b) => Math.abs(b.upkeep - b.biaya) - Math.abs(a.upkeep - a.biaya));

  // Seri per kategori (untuk grafik bertumpuk) dan total
  const catSeries = UPKEEP_CATEGORIES.map(c => ({ key: c.key, name: c.name, color: c.color,
    series: months.map(m => ({ p: m.p, label: m.label, value: isAbsurd(m) ? null : m.items.filter(it => it.cat === c.key).reduce((a, it) => a + it.cost, 0) })) }))
    .filter(c => c.series.some(x => x.value > 0));
  const totalSeries = months.map(m => ({ p: m.p, label: m.label, value: isAbsurd(m) ? null : m.total }));
  const perHa = area ? months.map(m => ({ p: m.p, label: m.label, value: isAbsurd(m) ? null : m.total / area })) : [];
  const perTon = months.map(m => { const t = valAt(d.produksi || [], m.p); return { p: m.p, label: m.label, value: t && !isAbsurd(m) ? m.total / (t * 1000) : null }; });

  // Pekerjaan bulan laporan vs bulan lalu & rata-rata (median) bulan sebelumnya
  const histOf = code => before.map(m => { const it = m.items.find(x => x.code === code); return it ? it.cost : 0; });
  const top = cur ? cur.items.slice(0, 8).map(it => {
    const pv = prev ? (prev.items.find(x => x.code === it.code) || { cost: 0 }).cost : null;
    const hist = histOf(it.code);
    const avg = before.length ? upkeepMedian(hist) : null;   // "biasanya" = median (tidak terseret lonjakan)
    const isNew = !pv && !months.some(m => key(m.p) !== key(cur.p) && m.items.some(x => x.code === it.code && x.cost > 0));
    return Object.assign({}, it, { prev: pv, avg, isNew, share: cur.total ? (it.cost / cur.total) * 100 : 0,
      spike: spikes.some(s => key(s.p) === key(cur.p) && s.code === it.code) });
  }) : [];
  const avgPrev = before.length ? upkeepMedian(before.map(m => m.total)) : null;   // median bulan sebelumnya

  // Pemupukan tercatat: bulan dengan biaya pemupukan, terakhir kapan, Rp/ha setahun (dari bulan yang tercatat)
  // hanya pekerjaan aplikasi pupuk; biaya yang ditandai lonjakan memakai nilai biasanya (median) agar Rp/ha tidak menggelembung
  const fertMonths = months.filter(m => !isAbsurd(m) && m.items.some(it => UPKEEP_FERT_APPLY.test(it.code) && it.cost > 0));
  const fertCost = (m, it) => { const s = spikes.find(x => key(x.p) === key(m.p) && x.code === it.code); return s ? s.median : it.cost; };
  const fertRp = fertMonths.reduce((a, m) => a + m.items.filter(it => UPKEEP_FERT_APPLY.test(it.code)).reduce((x, it) => x + fertCost(m, it), 0), 0);
  const lastFert = fertMonths.length ? fertMonths[fertMonths.length - 1].p : null;
  const monthsSince = lastFert ? (repP.y * 12 + repP.m) - (lastFert.y * 12 + lastFert.m) : null;
  const fert = { months: fertMonths.length, of: months.length, rp: fertRp, last: lastFert, monthsSince,
    rpHaYear: area && months.length ? (fertRp / months.length) * 12 / area : null,
    perYear: months.length ? (fertMonths.length / months.length) * 12 : null };

  return { months, repP, cur, prev, avgPrev, before, area, absurd, curAbsurd: !!(cur && isAbsurd(cur)), prevAbsurd: !!(prev && isAbsurd(prev)), catSeries, totalSeries, perHa, perTon, top, spikes, monthSpikes,
           sumMismatch, crossMismatch, fert, tinyItems, spikeLoss: (p, loss) => { const m = months.find(x => key(x.p) === key(p)); return m && loss < 0 && spikeRp(m) >= -loss ? spikes.find(s => key(s.p) === key(p)) : null; }, beforeMain: M.filter(x => (x.p.y * 12 + x.p.m) < (months[0].p.y * 12 + months[0].p.m)).length,
           extraBeforeMain: lastMain ? months.filter(m => !valAt(d.totalJjg || [], m.p) && !valAt(d.flowPanen || [], m.p)).length : 0 };
}

/** Teks fakta untuk paket Claude. */
function describeUpkeepMonthly(d) {
  const U = d.upkeepAnalysis;
  if (!U) return 'BIAYA PERAWATAN PER BULAN: tabel upkeep per bulan belum tersedia.';
  const rp = v => fmtRp(v);
  // Perubahan: persen; bila lebih dari 5 kali lipat ditulis "N×" (persen ribuan sulit dibaca)
  const pct = (a, b) => (!b ? '-' : a / b > 5 ? `${fmt(a / b, 0)}×` : `${a >= b ? '+' : '−'}${fmt(Math.abs((a - b) / b) * 100, 0)}%`);
  const L = [`BIAYA PERAWATAN (UPKEEP) PER BULAN, ${U.months.length} bulan (${monthShort(U.months[0].p)}–${monthShort(U.months[U.months.length - 1].p)})` +
    `${U.area ? `; luas pembagi ${fmt(U.area, 1)} ha` : '; luas belum tercatat, biaya per ha tidak dihitung'}:`];
  if (U.cur && U.curAbsurd) {
    L.push(`- Bulan laporan ${monthLong(U.cur.p)}: tercatat ${rp(U.cur.total)} (${rp(U.cur.total / U.area)}/ha dalam sebulan) — TIDAK WAJAR, hampir pasti salah input; ` +
      `angka ini tidak dipakai sebagai pembanding. ${U.prev ? `${monthLong(U.prev.p)} ${rp(U.prev.total)}.` : ''}`);
  } else if (U.cur) {
    const prevOk = U.prev && !U.prevAbsurd;
    L.push(`- Bulan laporan ${monthLong(U.cur.p)}: ${rp(U.cur.total)}${U.area ? ` (${rp(U.cur.total / U.area)}/ha)` : ''}` +
      `${prevOk ? `; ${monthLong(U.prev.p)} ${rp(U.prev.total)} (${pct(U.cur.total, U.prev.total)})` : U.prev ? `; ${monthLong(U.prev.p)} tidak wajar (salah input), tidak dibandingkan` : '; bulan lalu tidak ada data'}` +
      `${U.avgPrev && U.before.length >= 2 ? `; biasanya (median ${U.before.length} bulan sebelumnya) ${rp(U.avgPrev)} (${pct(U.cur.total, U.avgPrev)})` : ''}.`);
    if (U.top.length) L.push(`- Pekerjaan terbesar ${monthShort(U.cur.p)}: ${U.top.slice(0, 5).map(t => `${t.name} ${rp(t.cost)} (${fmt(t.share, 0)}%` +
      `${t.avg !== null ? `, biasanya ${rp(t.avg)}` : ''})`).join('; ')}.`);
  } else L.push(`- Bulan laporan ${monthLong(U.repP)} belum ada di tabel upkeep.`);
  L.push(`- Per kategori (total periode${U.absurd.length ? `, tanpa bulan tidak wajar ${U.absurd.map(m => m.label).join(', ')}` : ''}): ${U.catSeries.map(c => `${c.name} ${rp(c.series.reduce((a, x) => a + (x.value || 0), 0))}`).join('; ')}.`);
  L.push(`- Per bulan: ${U.months.map(m => `${m.label} ${rp(m.total)}`).join('; ')}.`);
  const tons = U.perTon.filter(x => x.value);
  if (tons.length) L.push(`- Biaya perawatan per kg TBS terjual: ${tons.map(x => `${x.label} Rp${fmt(x.value, 0)}`).join('; ')}.`);
  const F = U.fert;
  L.push(`- Pemupukan (biaya kerja aplikasi; harga pupuk belum tentu termasuk) tercatat di ${F.months} dari ${F.of} bulan${F.last ? ` (terakhir ${monthLong(F.last)}${F.monthsSince ? `, ${F.monthsSince} bulan sebelum bulan laporan` : ', bulan laporan'})` : ''}` +
    `${F.rp ? `, total ${rp(F.rp)}${F.rpHaYear ? ` ≈ ${rp(F.rpHaYear)}/ha/tahun` : ''}` : ''}; acuan umum 2–3 kali aplikasi per tahun.`);
  U.spikes.slice(0, 4).forEach(s => L.push(`PERLU DICEK: biaya ${s.name} ${monthLong(s.p)} ${rp(s.cost)}, ${fmt(s.ratio, 0)}× median bulan lain (${rp(s.median)}); kemungkinan salah input jumlah atau satuan, atau pekerjaan besar sekali jalan.`));
  U.monthSpikes.filter(m => !U.spikes.some(s => mkey(s.p) === mkey(m.p)) || (m.perHa && m.perHa > DECK_CONFIG.THRESHOLDS.UPKEEP_MAX_RP_HA_MONTH)).slice(0, 2).forEach(m => L.push(`PERLU DICEK: total upkeep ${monthLong(m.p)} ${rp(m.total)}` +
    `${m.perHa ? ` (${rp(m.perHa)}/ha, tidak wajar untuk satu bulan)` : ''}${m.median ? `; median bulan lain ${rp(m.median)}` : ''}; kemungkinan salah input.`));
  if (U.tinyItems.length) L.push(`PERLU DICEK: biaya ${U.tinyItems.slice(0, 3).map(x => `${x.name} ${monthShort(x.p)} Rp${fmt(x.cost, 0)}`).join(', ')} terlalu kecil untuk satu pekerjaan sebulan; kemungkinan yang diisi jumlah/satuan, bukan rupiah.`);
  if (U.sumMismatch.length) L.push(`TIDAK KONSISTEN: jumlah rincian pekerjaan ≠ total_cost pada ${U.sumMismatch.map(m => `${m.label} (${rp(m.itemSum)} vs ${rp(m.total)})`).slice(0, 3).join(', ')}.`);
  if (U.crossMismatch.length) L.push(`TIDAK KONSISTEN: total upkeep berbeda dengan biaya perawatan di tabel biaya pekerja pada ${U.crossMismatch.map(x => `${monthShort(x.p)} (${rp(x.upkeep)} vs ${rp(x.biaya)})`).slice(0, 3).join(', ')}; samakan sumber pencatatan.`);
  return L.join('\n');
}

/** Lonjakan upkeep yang menjelaskan kerugian bulan p (rugi hilang bila kelebihan lonjakan disisihkan) -> spike | null. */
function lossFromUpkeepSpike(d, p) {
  const U = d.upkeepAnalysis, v = valAt(d.profit || [], p);
  return U && v !== null && v !== undefined ? U.spikeLoss(p, v) : null;
}

/** Baris tabel lampiran: pekerjaan bulan laporan vs bulan lalu & rata-rata. */
function upkeepTableRows(d) {
  const U = d.upkeepAnalysis;
  if (!U || !U.top.length) return null;
  const jt = v => (v === null || v === undefined ? '-' : fmt(v / 1e6, v && v < 1e6 ? 2 : 1));
  return U.top.map(t => [t.name, upkeepCategory(t.cat).name, jt(t.cost), U.prev ? jt(t.prev) : '-', jt(t.avg),
    t.spike ? 'lonjakan, cek input' : t.isNew ? 'baru bulan ini' : t.avg && t.cost > t.avg * 2 ? 'naik > 2× biasanya' : '']);
}

/** Item upkeep bulan laporan untuk kode lama (rekomendasi, status pupuk): [{name, value, pct}]. */
function upkeepItemsMonthly(d) {
  const U = d.upkeepAnalysis;
  const m = U && (U.cur || U.months[U.months.length - 1]);
  if (!m || !m.items) return [];
  return m.items.map(it => ({ name: it.name, code: it.code, cat: it.cat, value: it.cost, pct: m.total ? (it.cost / m.total) * 100 : 0 }));
}
