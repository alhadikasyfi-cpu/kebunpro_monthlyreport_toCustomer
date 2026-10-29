/**
 * File 9: TanahPupuk.gs
 * Jenis tanah per blok (bagian ke-4 isian blok: "nama, luas ha, tahun tanam, jenis tanah") dan
 * REKOMENDASI PUPUK PREDIKSI per kelompok blok (umur tanaman × jenis tanah).
 *
 * Metode prediksi (data customer: nama blok, luas, tahun tanam, jenis tanah bila ada, produksi kebun):
 *  1. Dosis dasar per kelas umur untuk tanah mineral: Permentan No. 131/2013 (Pedoman Budidaya Kelapa Sawit yang Baik),
 *     sebagaimana dikutip BRMP/BSIP Babel: Urea, SP-36, MOP, Kieserit kg/pohon/tahun (ACUAN_DOSIS).
 *  2. Penyesuaian jenis tanah: gambut ±10% lebih tinggi + unsur mikro Cu dan Zn (ringkasan rekomendasi PPKS untuk gambut).
 *  3. Pengecekan neraca hara: kebutuhan SERAPAN tanaman = hara untuk pertumbuhan vegetatif per umur (tabel sheet "pupuk",
 *     g/pohon/tahun) + hara terangkut panen per ton TBS (Ng & Thamboo 1967; Ng 1977) × produksi kebun.
 *     Pupuk tidak 100% terserap (sebagian tercuci/terikat), dan tanah serta pelepah yang dikembalikan juga memasok hara.
 *     Besarnya pasokan tanah inilah yang tidak diketahui tanpa UJI TANAH; status hara tanaman hanya pasti lewat UJI DAUN.
 *
 * Semua angka bersifat PREDIKSI (acuan umum), bukan rekomendasi final kebun. Tim agronomi SawitPRO dapat mengganti
 * angka di tabel-tabel di bawah tanpa menyentuh kode lain. Tabel vegetatif juga dibaca langsung dari sheet "pupuk"
 * di spreadsheet ini bila ada (lihat readHaraVegetatif).
 */

/**
 * Jenis tanah yang dikenali (dicocokkan dari teks di sheet, tidak membedakan huruf besar/kecil).
 * faktor = pengali dosis terhadap acuan tanah mineral; mikro = tambahan unsur mikro; kendala & fokus = bahan narasi.
 * Hanya gambut yang punya pengali bersumber (PPKS); jenis tanah lain memakai dosis mineral + catatan fokus hara.
 */
const SOIL_TYPES = [
  { key: 'gambut', name: 'Gambut', match: /gambut|peat|histosol|organosol/i, faktor: 1.10,
    mikro: 'CuSO4 dan ZnSO4 (umumnya 0,10–0,15 kg dan 0,05–0,10 kg/pohon/tahun; pastikan lewat uji daun)',
    kendala: 'pH rendah, miskin Cu, Zn, dan B, pokok mudah condong; muka air perlu dijaga 50–75 cm',
    fokus: 'K, Cu, Zn, B; dolomit untuk pH' },
  { key: 'pmk', name: 'Podsolik Merah Kuning', match: /podsolik|pmk|ultisol|merah kuning/i, faktor: 1.0, mikro: '',
    kendala: 'masam, P mudah terikat Al/Fe, Mg rendah, rawan erosi', fokus: 'P dan Mg; dolomit bila pH < 4,5' },
  { key: 'latosol', name: 'Latosol/Oksisol', match: /latosol|oksisol|oxisol|laterit/i, faktor: 1.0, mikro: '',
    kendala: 'pelapukan lanjut, daya simpan hara (KTK) rendah, P terikat', fokus: 'P dan K' },
  { key: 'aluvial', name: 'Aluvial', match: /aluvial|alluvial|inceptisol|entisol/i, faktor: 1.0, mikro: '',
    kendala: 'relatif subur; perhatikan drainase di lahan rendah', fokus: 'dosis standar, jaga drainase' },
  { key: 'pasir', name: 'Berpasir', match: /pasir|sand|spodosol|psamment|podzol/i, faktor: 1.0, mikro: '',
    kendala: 'hara mudah tercuci, daya simpan air rendah', fokus: 'K dan Mg; aplikasi dibagi 3–4 kali per tahun' },
  { key: 'sulfat', name: 'Sulfat Masam', match: /sulfat|sulphat|pirit|acid sulfate/i, faktor: 1.0, mikro: '',
    kendala: 'pH sangat rendah bila pirit teroksidasi', fokus: 'pengapuran dan tata air' },
  { key: 'andosol', name: 'Andosol (vulkanik)', match: /andosol|andisol|vulkan/i, faktor: 1.0, mikro: '',
    kendala: 'P terikat kuat oleh alofan', fokus: 'P' },
  { key: 'mineral', name: 'Mineral', match: /mineral|liat|clay|lempung|podsol/i, faktor: 1.0, mikro: '',
    kendala: 'tanah mineral umum', fokus: 'dosis standar' }
];

const SOIL_UNKNOWN = 'Belum tercatat';

/** Teks jenis tanah di sheet -> jenis tanah yang dikenali (atau jenis lain apa adanya). null = belum tercatat. */
function soilTypeOf(raw) {
  const s = String(raw || '').trim();
  if (!s || /^[-–—]+$/.test(s)) return null;
  return SOIL_TYPES.find(t => t.match.test(s)) ||
    { key: 'lain:' + s.toLowerCase(), name: s, faktor: 1.0, mikro: '', kendala: 'belum ada di daftar jenis tanah script', fokus: 'perlu uji tanah' };
}

/* ------------------------------------------------------------------------- */
/* Tabel acuan pupuk & hara                                                  */
/* ------------------------------------------------------------------------- */

/**
 * Dosis pupuk tunggal tanah mineral (kg/pohon/tahun) per kelas umur tanaman menghasilkan.
 * Sumber umur 3–20 th: Permentan 131/2013 (dikutip BRMP Babel). Umur > 20 th: 80% dari kelas 14–20 th, mengikuti
 * ringkasan PPKS bahwa total dosis setelah umur 20 th turun ±20% (8,83 vs 11,10 kg/pohon) — INTERPOLASI.
 * Umur < 3 th (TBM) tidak dihitung: jadwal pupuk TBM per bulan setelah tanam, ikuti rekomendasi TBM PPKS.
 */
const ACUAN_DOSIS = [
  { min: 3, max: 8,   name: 'TM 3–8 th',   urea: 2.0, sp36: 1.5,  mop: 1.5,  kies: 1.0, sumber: 'Permentan 131/2013' },
  { min: 9, max: 13,  name: 'TM 9–13 th',  urea: 2.5, sp36: 2.25, mop: 2.25, kies: 1.5, sumber: 'Permentan 131/2013' },
  { min: 14, max: 20, name: 'TM 14–20 th', urea: 2.5, sp36: 2.0,  mop: 2.0,  kies: 1.5, sumber: 'Permentan 131/2013' },
  { min: 21, max: 200, name: 'TM >20 th',  urea: 2.0, sp36: 1.6,  mop: 1.6,  kies: 1.2, sumber: 'interpolasi (80% kelas 14–20 th)' }
];

/** Pupuk tunggal: kadar hara (fraksi) untuk konversi ke unsur hara dan ke NPK majemuk. */
const PUPUK_LIST = [
  { key: 'urea', name: 'Urea', hara: 'N', kadar: 0.46 },
  { key: 'sp36', name: 'SP-36', hara: 'P2O5', kadar: 0.36 },
  { key: 'mop', name: 'MOP/KCl', hara: 'K2O', kadar: 0.60 },
  { key: 'kies', name: 'Kieserit', hara: 'MgO', kadar: 0.27 }
];

/**
 * Formula NPK majemuk untuk konversi "kg NPK/pohon/tahun" (persen N-P2O5-K2O-MgO). Default 13-6-27-4, formula sawit
 * yang umum di pasaran. Dosis NPK dihitung agar K2O terpenuhi; kekurangan N, P2O5, MgO ditutup pupuk tunggal.
 */
const NPK_FORMULA = { name: 'NPK 13-6-27-4', N: 0.13, P2O5: 0.06, K2O: 0.27, MgO: 0.04 };
/** Rentang toleransi dosis NPK aktual terhadap prediksi (±15%) untuk status kurang / sesuai / berlebih. */
const NPK_TOLERANSI = 0.15;

/**
 * Hara untuk PERTUMBUHAN VEGETATIF per umur (g/pohon/tahun; N, P2O5, K2O, MgO). Salinan sheet "pupuk"
 * ("Keperluan Hara untuk Vegetative Growth Berdasarkan Umur Tanaman"); satuan tidak tertulis di sheet, ditafsirkan
 * g/pohon/tahun (sebagai kg/ha nilainya tidak masuk akal, mis. K2O 1.664 kg/ha pada umur 4). Umur ≥ 15 th di sheet
 * bernilai tetap. Bila sheet "pupuk" ada, nilainya dibaca langsung (readHaraVegetatif) dan menggantikan tabel ini.
 */
const HARA_VEGETATIF_DEFAULT = {
  4: [543, 134.9, 1664, 242], 5: [446, 116, 1308, 185], 6: [293, 68, 779, 115], 7: [277, 53, 623, 94], 8: [219, 40, 515, 82],
  9: [206, 37, 479, 88], 10: [198, 38, 438, 92], 11: [189, 37, 398, 105], 12: [195, 42, 392, 121], 13: [196, 35, 451, 119],
  14: [225, 43, 446, 127], 15: [223, 44, 472, 141]
};
var HARA_VEGETATIF = HARA_VEGETATIF_DEFAULT;

/** Hara terangkut per ton TBS (kg): N 2,94; P 0,44 (= 1,01 P2O5); K 3,71 (= 4,47 K2O); Mg 0,77 (= 1,28 MgO). Ng & Thamboo 1967; Ng 1977. */
const HARA_PER_TON_TBS = { N: 2.94, P2O5: 1.01, K2O: 4.47, MgO: 1.28 };
const HARA_KEYS = ['N', 'P2O5', 'K2O', 'MgO'];

/** Akibat dosis di luar prediksi (bahan narasi; tanpa janji angka). */
const RISIKO_DOSIS = {
  kurang: 'hara tidak mencukupi: jumlah janjang dan BJR cenderung turun 6–24 bulan kemudian (efek pupuk tertunda), sehingga produksi dan pendapatan tertahan',
  lebih: 'biaya pupuk terbuang, hara tercuci atau tidak seimbang (mis. K berlebih menekan serapan Mg), tanpa tambahan hasil yang sebanding'
};

function acuanDosisAt(age) {
  return age === null || age === undefined ? null : ACUAN_DOSIS.find(a => age >= a.min && age <= a.max) || null;
}

/** Hara vegetatif g/pohon/tahun untuk umur tertentu {N, P2O5, K2O, MgO}; umur < 4 memakai umur 4, di atas tabel memakai baris terakhir. */
function haraVegetatifAt(age) {
  const ages = Object.keys(HARA_VEGETATIF).map(Number).sort((a, b) => a - b);
  if (!ages.length || age === null || age === undefined) return null;
  const a = age < ages[0] ? ages[0] : age > ages[ages.length - 1] ? ages[ages.length - 1] : Math.round(age);
  const v = HARA_VEGETATIF[a] || HARA_VEGETATIF[ages.filter(x => x <= a).pop()];
  return v ? { N: v[0], P2O5: v[1], K2O: v[2], MgO: v[3] } : null;
}

/**
 * Baca tabel hara vegetatif dari sheet "pupuk" (kolom Age | N | P2O5 | K2O | MgO). Mengembalikan jumlah baris terbaca
 * (0 bila sheet tidak ada atau formatnya berbeda; tabel bawaan tetap dipakai).
 */
function readHaraVegetatif(ss) {
  try {
    const sh = ss && ss.getSheetByName ? ss.getSheetByName('pupuk') : null;
    if (!sh) return 0;
    const v = sh.getDataRange().getValues();
    const h = findCell(v, ['Age', 'Umur']);
    if (!h) return 0;
    const col = name => v[h.r].findIndex(x => norm(x) === norm(name));
    const cN = col('N'), cP = col('P2O5'), cK = col('K2O'), cM = col('MgO');
    if ([cN, cP, cK, cM].some(c => c < 0)) return 0;
    const out = {};
    for (let r = h.r + 1; r < v.length; r++) {
      const age = parseNum(v[r][h.c]);
      const vals = [cN, cP, cK, cM].map(c => parseNum(v[r][c]));
      if (age && vals.every(x => x !== null)) out[Math.round(age)] = vals;
    }
    if (Object.keys(out).length >= 3) { HARA_VEGETATIF = out; return Object.keys(out).length; }
  } catch (e) { Logger.log(`Sheet pupuk tidak terbaca: ${e.message}`); }
  return 0;
}

/* ------------------------------------------------------------------------- */
/* Jenis tanah                                                               */
/* ------------------------------------------------------------------------- */

/**
 * Komposisi jenis tanah blok unik + seberapa sering blok tiap jenis tanah tidak tercatat menjual.
 * -> {groups:[{key,name,ha,pct,count,blocks,unsaleRate,type}], totalHa, unknownHa, unknownPct, knownPct, dominant}
 */
function buildSoilAnalytics(d) {
  const B = d.blocks;
  if (!B || !B.blocks.length) return null;
  const U = d.unsale;
  const unsaleOf = b => { if (!U) return null; const x = U.blocks.find(u => u.name === b.name && u.ha === b.ha && u.year === b.year); return x ? x.months : 0; };
  const nMonths = B.monthly.length;
  const map = {};
  B.blocks.forEach(b => {
    const t = soilTypeOf(b.soil);
    const key = t ? t.key : 'unknown';
    if (!map[key]) map[key] = { key, name: t ? t.name : SOIL_UNKNOWN, type: t, ha: 0, count: 0, blocks: [], unsaleMonths: 0, blockMonths: 0 };
    const g = map[key];
    g.ha += b.ha; g.count++; g.blocks.push(b);
    const um = unsaleOf(b);
    if (um !== null) { g.unsaleMonths += um; g.blockMonths += nMonths; }
  });
  const groups = Object.keys(map).map(k => map[k]).sort((a, b) => (a.key === 'unknown') - (b.key === 'unknown') || b.ha - a.ha);
  // Luas blok 0 di semua isian (luas belum dicatat): porsi dihitung dari jumlah blok
  const byCount = !B.totalHa, nBlocks = B.blocks.length;
  groups.forEach(g => {
    g.pct = byCount ? (g.count / nBlocks) * 100 : (g.ha / B.totalHa) * 100;
    g.unsaleRate = g.blockMonths ? (g.unsaleMonths / g.blockMonths) * 100 : null;
    const ages = g.blocks.filter(b => b.age !== null);
    g.avgAge = ages.length ? ages.reduce((a, b) => a + b.age * b.ha, 0) / ages.reduce((a, b) => a + b.ha, 0) : null;
  });
  const unk = map.unknown;
  const unknownHa = unk ? unk.ha : 0;
  const known = groups.filter(g => g.key !== 'unknown');
  return { groups, totalHa: B.totalHa, unknownHa, unknownCount: unk ? unk.count : 0,
           unknownPct: unk ? unk.pct : 0, knownPct: 100 - (unk ? unk.pct : 0), byCount,
           dominant: known.length ? known[0] : null };
}

/**
 * Kebutuhan pupuk INDIKATIF setahun untuk blok unik dengan tahun tanam tercatat:
 * dosis acuan per umur × pengali jenis tanah × SPH × luas. Blok tanpa data tanah memakai acuan tanah mineral.
 * -> {total:{urea,...} (ton/tahun), perPokok:{urea,...} (kg rata-rata tertimbang), ha, haNoAge, haUnknownSoil, sph, rows}
 */
/* ------------------------------------------------------------------------- */
/* Rekomendasi pupuk PREDIKSI per kelompok blok (umur × jenis tanah)          */
/* ------------------------------------------------------------------------- */

/** Produksi kebun (ton TBS/ha/tahun) untuk neraca hara: realisasi (estimasi panen bila ada), selain itu tonase disetahunkan. */
function yieldTonHaYear(d) {
  if (d.marihat && d.marihat.realTonHa) return d.marihat.realTonHa;
  const s = seriesStats(d.produksi);
  const ha = d.blocks ? d.blocks.totalHa : null;
  return s && ha ? ((s.sum / s.n) * 12) / ha : null;
}

/**
 * Rencana pupuk per kelompok blok. Setiap baris:
 *  dose  = pupuk tunggal kg/pohon/tahun (Permentan × faktor tanah); hara = unsur hara dari dosis itu (g/pohon);
 *  npk   = kg NPK majemuk/pohon/tahun (memenuhi K2O) + topUp pupuk tunggal; serapan = kebutuhan serapan tanaman (g/pohon)
 *          = vegetatif(umur) + produksi (realisasi dan potensi Marihat);
 *  lo/hi = rentang NPK (±NPK_TOLERANSI) untuk menilai dosis aktual; status = kurang | sesuai | berlebih | null.
 */
function buildFertilizerPlan(d) {
  const B = d.blocks;
  if (!B || !B.blocks.length) return null;
  const sph = d.sph || DECK_CONFIG.SPH_DEFAULT;
  const cls = d.landClass || DECK_CONFIG.DEFAULT_LAND_CLASS;
  const yReal = yieldTonHaYear(d);
  const actual = d.npkActual || null, price = d.npkPrice || null;
  const map = {};
  let haTbm = 0, haNoAge = 0;
  B.blocks.forEach(b => {
    if (!b.ha) return;   // luas blok belum dicatat (0 ha): kebutuhan pupuk tidak dapat dihitung
    if (b.age === null || b.age === undefined) { haNoAge += b.ha; return; }
    const ac = acuanDosisAt(b.age);
    if (!ac) { haTbm += b.ha; return; }
    const t = soilTypeOf(b.soil);
    const key = `${ac.name}|${t ? t.name : SOIL_UNKNOWN}`;
    if (!map[key]) map[key] = { ac, type: t, age: ac.name, ageShort: ac.name, soil: t ? t.name : SOIL_UNKNOWN, soilKnown: !!t,
                                ha: 0, blocks: [], ageHa: 0 };
    const g = map[key];
    g.ha += b.ha; g.blocks.push(b.name); g.ageHa += b.age * b.ha;
  });
  const rows = Object.keys(map).map(k => map[k]).sort((a, b) => b.ha - a.ha);
  if (!rows.length) return { rows: [], haTbm, haNoAge, sph, empty: true };
  rows.forEach(r => {
    const f = r.type ? r.type.faktor : 1.0;
    r.avgAge = r.ageHa / r.ha;
    r.pokok = r.ha * sph;
    r.dose = {}; r.hara = {};
    PUPUK_LIST.forEach(p => { r.dose[p.key] = r.ac[p.key] * f; r.hara[p.hara] = r.dose[p.key] * p.kadar * 1000; });
    // NPK majemuk: penuhi K2O, sisanya pupuk tunggal
    r.npk = r.hara.K2O / 1000 / NPK_FORMULA.K2O;
    r.topUp = {};
    PUPUK_LIST.filter(p => p.hara !== 'K2O').forEach(p => {
      const sisa = r.hara[p.hara] / 1000 - r.npk * NPK_FORMULA[p.hara];
      r.topUp[p.key] = sisa > 0.01 ? sisa / p.kadar : 0;
    });
    // Neraca hara: serapan tanaman (vegetatif + produksi) pada produksi realisasi dan potensi Marihat
    const veg = haraVegetatifAt(r.avgAge);
    const pot = marihatAt(r.avgAge, cls);
    const serapan = tPerHa => (veg ? HARA_KEYS.reduce((o, k) => { o[k] = veg[k] + (tPerHa ? (tPerHa * 1000 / sph) * HARA_PER_TON_TBS[k] : 0); return o; }, {}) : null);
    r.veg = veg;
    r.serapanReal = yReal ? serapan(yReal) : null;
    r.serapanPot = pot ? serapan(pot.ton) : null;
    r.potTon = pot ? pot.ton : null;
    r.lo = r.npk * (1 - NPK_TOLERANSI); r.hi = r.npk * (1 + NPK_TOLERANSI);
    r.tonLo = (r.lo * r.pokok) / 1000; r.tonHi = (r.hi * r.pokok) / 1000;
    r.status = actual === null ? null : actual < r.lo ? 'kurang' : actual > r.hi ? 'berlebih' : 'sesuai';
    r.gapKg = r.status === 'kurang' ? (r.lo - actual) * r.pokok : r.status === 'berlebih' ? (actual - r.hi) * r.pokok : 0;
    r.gapRp = price && r.gapKg ? r.gapKg * price : null;
  });
  const sum = k => rows.reduce((a, r) => a + r[k], 0);
  const total = {};
  PUPUK_LIST.forEach(p => { total[p.key] = rows.reduce((a, r) => a + r.dose[p.key] * r.pokok, 0) / 1000; });   // ton/tahun
  return { rows, haTbm, haNoAge, sph, sphAssumed: !!d.sphAssumed, yReal, cls, actual, price, total,
           totalTon: PUPUK_LIST.reduce((a, p) => a + total[p.key], 0),
           npkTon: rows.reduce((a, r) => a + r.npk * r.pokok, 0) / 1000,
           tonLo: sum('tonLo'), tonHi: sum('tonHi'), ha: sum('ha'), pokok: sum('pokok'),
           unknownSoilHa: rows.filter(r => !r.soilKnown).reduce((a, r) => a + r.ha, 0),
           kurangHa: rows.filter(r => r.status === 'kurang').reduce((a, r) => a + r.ha, 0),
           lebihHa: rows.filter(r => r.status === 'berlebih').reduce((a, r) => a + r.ha, 0),
           lebihRp: rows.filter(r => r.status === 'berlebih').reduce((a, r) => a + (r.gapRp || 0), 0),
           kurangKg: rows.filter(r => r.status === 'kurang').reduce((a, r) => a + r.gapKg, 0) };
}

/** Nama lama (dipakai file 3 & 5): d.fertilizer dan d.npk berisi rencana yang sama. */
function buildFertilizerNeed(d) { const P = buildFertilizerPlan(d); return P && !P.empty ? P : null; }
function buildNpkRecommendation(d) { return buildFertilizerNeed(d); }

function npkRange(r) { return `${fmt(r.lo, 1)}–${fmt(r.hi, 1)}`; }

function describeNpk(d) {
  const N = d.npk;
  if (!N) return 'REKOMENDASI PUPUK PREDIKSI: tidak dapat dihitung (tahun tanam blok belum tercatat atau semua blok TBM).';
  const L = [`REKOMENDASI PUPUK PREDIKSI per kelompok blok (dosis dasar Permentan 131/2013 untuk tanah mineral, gambut +10% dan unsur mikro sesuai PPKS; ` +
    `dikonversi ke ${NPK_FORMULA.name}). Ini PREDIKSI dari umur dan jenis tanah, bukan dosis final; dosis presisi lewat uji tanah dan uji daun Dokter Sawit. Dasar ${fmt(N.ha, 1)} ha, ${N.sph} pokok/ha${N.sphAssumed ? ' (asumsi)' : ''}:`];
  N.rows.forEach(r => L.push(`- ${r.age}, tanah ${r.soil.toLowerCase()}: ${fmt(r.ha, 1)} ha (${r.blocks.length} blok, mis. ${r.blocks.slice(0, 3).join(', ')}) → ` +
    `Urea ${fmt(r.dose.urea, 2)} + SP-36 ${fmt(r.dose.sp36, 2)} + MOP ${fmt(r.dose.mop, 2)} + Kieserit ${fmt(r.dose.kies, 2)} kg/pohon/tahun, ` +
    `atau ${NPK_FORMULA.name} ${fmt(r.npk, 1)} kg (rentang ${npkRange(r)} kg) + tambahan ${PUPUK_LIST.filter(p => r.topUp[p.key]).map(p => `${p.name} ${fmt(r.topUp[p.key], 1)} kg`).join(', ') || '-'}; ` +
    `kebutuhan NPK ${fmt(r.tonLo, 1)}–${fmt(r.tonHi, 1)} ton/tahun` +
    (r.type && r.type.mikro ? `; tambah ${r.type.mikro}` : '') + (!r.soilKnown ? '; jenis tanah belum tercatat, dihitung sebagai tanah mineral' : '') +
    (r.ac.sumber.indexOf('interpolasi') >= 0 ? '; dosis umur >20 th hasil interpolasi' : '') +
    (r.status ? `; dosis NPK aktual ${fmt(N.actual, 1)} kg = ${r.status.toUpperCase()}${r.gapRp ? ` (≈ ${fmtRp(r.gapRp)})` : ''}` : '') + '.'));
  L.push(`- Total pupuk tunggal setahun: ${PUPUK_LIST.map(p => `${p.name} ${fmt(N.total[p.key], 1)} ton`).join(', ')} (±${fmt(N.totalTon, 0)} ton); atau ${NPK_FORMULA.name} ±${fmt(N.npkTon, 0)} ton + tambahan pupuk tunggal` +
    (N.price ? `; nilai NPK ≈ ${fmtRp(N.npkTon * 1000 * N.price)} pada harga Rp${fmt(N.price, 0)}/kg` : '') + '.');
  if (N.haTbm) L.push(`- ${fmt(N.haTbm, 1)} ha TBM (umur < 3 th) tidak dihitung; ikuti jadwal pupuk TBM.`);
  if (N.haNoAge) L.push(`- ${fmt(N.haNoAge, 1)} ha tanpa tahun tanam tidak dihitung.`);
  L.push(`- Bila dosis di bawah prediksi: ${RISIKO_DOSIS.kurang}. Bila di atas: ${RISIKO_DOSIS.lebih}.`);
  if (N.actual === null) L.push('- Dosis NPK aktual kebun belum diisi di sheet (label "Dosis NPK Aktual"), jadi belum dapat dinilai kurang atau berlebih.');
  if (N.kurangHa) L.push(`PERLU DICEK: dosis NPK aktual ${fmt(N.actual, 1)} kg/pohon/tahun DI BAWAH prediksi untuk ${fmt(N.kurangHa, 1)} ha (kurang ±${fmt(N.kurangKg / 1000, 1)} ton NPK/tahun); risiko produksi turun pada bulan-bulan berikutnya.`);
  if (N.lebihHa) L.push(`PERLU DICEK: dosis NPK aktual ${fmt(N.actual, 1)} kg/pohon/tahun DI ATAS prediksi untuk ${fmt(N.lebihHa, 1)} ha${N.lebihRp ? ` (≈ ${fmtRp(N.lebihRp)} per tahun terbuang)` : ''}.`);
  return L.join('\n');
}

/**
 * Neraca hara kelompok terluas: serapan tanaman (vegetatif dari tabel "pupuk" + terangkut panen) vs hara dari pupuk prediksi.
 * Menjelaskan mengapa data umur + tanah hanya cukup untuk PREDIKSI.
 */
function describeFertilizer(d) {
  const N = d.npk;
  if (!N || !N.rows.length) return 'NERACA HARA: tidak dapat dihitung.';
  const r = N.rows[0];
  const L = [`NERACA HARA (kelompok terluas: ${r.age}, tanah ${r.soil.toLowerCase()}, umur rata-rata ${fmt(r.avgAge, 0)} th; g/pohon/tahun). ` +
    `Serapan = hara pertumbuhan vegetatif (tabel sheet "pupuk") + hara terangkut panen per ton TBS (N 2,94; P2O5 1,01; K2O 4,47; MgO 1,28 kg/ton; Ng & Thamboo 1967).`];
  const line = (label, o) => `${label}: ${HARA_KEYS.map(k => `${k} ${fmt(o[k], 0)}`).join(', ')}`;
  if (r.veg) L.push(`- ${line('Vegetatif', r.veg)}.`);
  if (r.serapanReal) L.push(`- ${line(`Serapan pada produksi realisasi ${fmt(N.yReal, 1)} ton/ha/th`, r.serapanReal)}.`);
  if (r.serapanPot) L.push(`- ${line(`Serapan pada potensi Marihat ${N.cls} ${fmt(r.potTon, 1)} ton/ha/th`, r.serapanPot)}.`);
  L.push(`- ${line('Hara dari pupuk prediksi', r.hara)}.`);
  L.push('- Pupuk tidak seluruhnya terserap (sebagian tercuci atau terikat tanah), sementara tanah dan pelepah yang dikembalikan juga memasok hara. ' +
    'Besar pasokan tanah hanya diketahui lewat UJI TANAH, dan kecukupan hara tanaman hanya pasti lewat UJI DAUN; karena itu angka di atas adalah prediksi.');
  return L.join('\n');
}

function describeSoil(d) {
  const S = d.soil;
  if (!S) return 'JENIS TANAH: daftar blok belum tersedia.';
  const L = [`JENIS TANAH BLOK (${fmt(S.totalHa, 1)} ha blok unik): ` +
    S.groups.map(g => `${g.name} ${fmt(g.ha, 1)} ha (${fmt(g.pct, 0)}%, ${g.count} blok${g.avgAge !== null ? `, umur rata-rata ${fmt(g.avgAge, 0)} th` : ''})`).join('; ') + '.'];
  S.groups.filter(g => g.type).forEach(g => L.push(`- ${g.name}: kendala ${g.type.kendala}; fokus hara ${g.type.fokus}${g.type.extra ? `; ${g.type.extra}` : ''}.`));
  const withRate = S.groups.filter(g => g.unsaleRate !== null);
  if (withRate.length > 1) L.push(`- Blok tanpa penjualan per jenis tanah (% bulan-blok tidak tercatat menjual): ${withRate.map(g => `${g.name} ${fmt(g.unsaleRate, 0)}%`).join('; ')}.`);
  if (S.unknownHa > 0) L.push(`PERLU DICEK: jenis tanah belum tercatat untuk ${S.unknownCount} blok (${fmt(S.unknownHa, 1)} ha, ${fmt(S.unknownPct, 0)}% luas); dosis pupuk belum bisa disesuaikan dengan tanah. Saran: uji tanah per blok/kelompok blok dan isi jenis tanah di data blok KebunPRO.`);
  else L.push('- Jenis tanah sudah tercatat untuk semua blok.');
  return L.join('\n');
}

/** Baris tabel jenis tanah untuk slide lampiran. */
function soilTableRows(d) {
  const S = d.soil;
  if (!S) return null;
  return S.groups.slice(0, 7).map(g => [g.name, fmt(g.ha, 1), `${fmt(g.pct, 0)}%`, String(g.count),
    g.type ? g.type.fokus : 'uji tanah dulu']);
}


/** Baris tabel rekomendasi pupuk prediksi untuk slide lampiran (maks. 7 kelompok, sisanya digabung). */
function npkTableRows(d) {
  const N = d.npk;
  if (!N || !N.rows.length) return null;
  const tunggal = r => `${fmt(r.dose.urea, 1)} / ${fmt(r.dose.sp36, 1)} / ${fmt(r.dose.mop, 1)} / ${fmt(r.dose.kies, 1)}`;
  const head = N.rows.slice(0, 7), rest = N.rows.slice(7);
  const rows = head.map(r => [r.ageShort, r.soil, fmt(r.ha, 1), tunggal(r), fmt(r.npk, 1)].concat(N.actual !== null ? [r.status] : []));
  if (rest.length) rows.push([`${rest.length} kelompok lain`, '-', fmt(rest.reduce((a, r) => a + r.ha, 0), 1), '-', '-'].concat(N.actual !== null ? ['-'] : []));
  rows.push([`Total ton/tahun`, '', fmt(N.ha, 1), PUPUK_LIST.map(p => fmt(N.total[p.key], 0)).join(' / '), fmt(N.npkTon, 0)].concat(N.actual !== null ? [''] : []));
  return rows;
}

/* ------------------------------------------------------------------------- */
/* STATUS PEMUPUKAN: pesan utama untuk owner                                  */
/* ------------------------------------------------------------------------- */

/**
 * Inti bagian pupuk: memberi tahu owner apakah pohonnya terindikasi KURANG atau KELEBIHAN pupuk, lalu mengajak
 * memastikan lewat Uji Daun dan Uji Tanah Dokter Sawit. Angka lain (Marihat, dosis prediksi, aktivitas pemupukan,
 * jenis tanah) hanya BUKTI PENDUKUNG.
 * -> {verdict: 'kurang'|'berlebih'|'sesuai'|'belum', label, reason, evidence:[{indikator, kebun, acuan, arti, arah}]}
 *    arah: 'kurang' | 'lebih' | 'netral' (menentukan warna baris di slide).
 */
const STATUS_PUPUK_LABEL = {
  kurang: 'Indikasi kurang pupuk', berlebih: 'Indikasi kelebihan pupuk',
  sesuai: 'Tidak ada indikasi kurang pupuk', belum: 'Status pupuk belum dapat dinilai'
};
const STATUS_PUPUK_SARAN = 'Pastikan dengan Uji Daun dan Uji Tanah Dokter Sawit';

function buildFertilizerStatus(d) {
  const M = d.marihat, N = d.npk, S = d.soil, ev = [];
  const pct = v => `${fmt(v * 100, 0)}%`;
  // Produktivitas per tahun dari < MIN_MONTHS_ANNUAL bulan data dipengaruhi musim panen -> hanya pendukung, bukan dasar kesimpulan
  const shortM = !!(M && M.nMonths < DECK_CONFIG.THRESHOLDS.MIN_MONTHS_ANNUAL);
  // BJR hanya dari janjang yang ditimbang: bila data penjualan sebagian besar janjang belum diinput, sampelnya terlalu kecil
  const nwShare = d.noWeight ? d.noWeight.share : 0;
  const bjrOk = !!(M && M.achBjr) && !shortM && nwShare <= DECK_CONFIG.THRESHOLDS.BJR_MAX_NOWEIGHT_PCT;
  // 1. Hasil vs standar Marihat untuk umur yang sama (kurang hara adalah salah satu penyebab umum hasil rendah)
  if (M) {
    ev.push({ indikator: 'Produktivitas', kebun: `${fmt(M.realTonHa, 1)} ton/ha/th`, acuan: `${fmt(M.pot.ton, 1)} (Marihat ${M.cls})`,
      arti: (M.achTon < 0.8 ? `${pct(M.achTon)} dari potensi; kurang hara salah satu penyebab umum` : `${pct(M.achTon)} dari potensi`) +
        (shortM ? `; baru ${M.nMonths} bulan data, masih indikatif` : ''),
      arah: M.achTon < 0.8 && !shortM ? 'kurang' : 'netral' });
    if (M.achBjr) ev.push({ indikator: 'BJR', kebun: `${fmt(M.realBjr, 1)} kg`, acuan: `${fmt(M.pot.rbt, 1)} kg`,
      arti: (M.achBjr < 0.85 ? 'tandan ringan; sering terkait kurang K dan Mg' : 'berat tandan wajar') +
        (!bjrOk ? (shortM ? `; baru ${M.nMonths} bulan data` : `; hanya dari ${fmt(100 - nwShare, 0)}% janjang yang ditimbang`) + ', masih indikatif' : ''),
      arah: M.achBjr < 0.85 && bjrOk ? 'kurang' : 'netral' });
    if (M.achJjg) ev.push({ indikator: 'Janjang per ha', kebun: `${fmt(M.realJjgHa, 0)}/tahun`, acuan: `${fmt(M.pot.jjgHa, 0)}/tahun`,
      arti: (M.achJjg < 0.8 ? 'tandan sedikit; terkait N dan K (juga rotasi panen)' : 'jumlah tandan wajar') + (shortM ? '; masih indikatif' : ''),
      arah: M.achJjg < 0.8 && !shortM ? 'kurang' : 'netral' });
  }
  // 2. Dosis NPK aktual vs prediksi (bila diisi di sheet)
  let doseVerdict = null;
  if (N && N.actual !== null && N.rows.length) {
    const lo = Math.min.apply(null, N.rows.map(r => r.lo)), hi = Math.max.apply(null, N.rows.map(r => r.hi));
    const kShare = N.kurangHa / N.ha, lShare = N.lebihHa / N.ha;
    doseVerdict = kShare >= 0.3 && kShare >= lShare ? 'kurang' : lShare >= 0.3 ? 'berlebih' : 'sesuai';
    ev.push({ indikator: 'Dosis NPK aktual', kebun: `${fmt(N.actual, 1)} kg/pohon/th`, acuan: `prediksi ${fmt(lo, 1)}–${fmt(hi, 1)} kg`,
      arti: doseVerdict === 'sesuai' ? (N.kurangHa || N.lebihHa ? `sebagian blok ${N.kurangHa ? 'kurang' : 'berlebih'}` : 'sesuai prediksi')
        : `${doseVerdict} untuk ${fmt(doseVerdict === 'kurang' ? N.kurangHa : N.lebihHa, 0)} ha${doseVerdict === 'berlebih' && N.lebihRp ? ` (≈ ${fmtRpShort(N.lebihRp)}/th)` : ''}`,
      arah: doseVerdict === 'kurang' ? 'kurang' : doseVerdict === 'berlebih' ? 'lebih' : 'netral' });
  }
  // 3. Pemupukan yang tercatat di KebunPRO (biaya upkeep & aktivitas mandor rawat)
  const fertUpkeep = upkeepItems(d).filter(x => x.cat === 'pupuk' || /pupuk|fert|pemupukan/i.test(x.name));
  const R = d.rawatActivities;
  const fertDays = R ? R.rows.reduce((a, r) => a + r.vals.filter(v => v && v.acts.some(x => /pupuk|fert|pemupukan/i.test(x.name))).length, 0) : 0;
  const UF = d.upkeepAnalysis && d.upkeepAnalysis.months.length >= 3 ? d.upkeepAnalysis.fert : null;
  if (UF) {
    // Upkeep per bulan: frekuensi pemupukan setahun dan jarak dari pemupukan terakhir
    const jarang = UF.months === 0 || (UF.of >= 6 && UF.perYear < 2) || (UF.monthsSince !== null && UF.monthsSince >= 6);
    ev.push({ indikator: 'Pemupukan tercatat', kebun: UF.months ? `${UF.months} dari ${UF.of} bulan${UF.last ? `, terakhir ${monthShort(UF.last)}` : ''}${UF.rpHaYear ? `, upah ${fmtRpShort(UF.rpHaYear)}/ha/th` : ''}` : `tidak ada dalam ${UF.of} bulan`,
      acuan: '2–3 kali/tahun', arti: UF.months === 0 ? 'tidak ada biaya pemupukan di catatan upkeep'
        : jarang ? (UF.monthsSince >= 6 ? `${UF.monthsSince} bulan tanpa pemupukan` : 'pemupukan jarang') : 'pemupukan tercatat rutin', arah: jarang ? 'kurang' : 'netral' });
  } else if (d.upkeep || R || d.upkeepAnalysis) {
    const ada = fertUpkeep.length || fertDays;
    ev.push({ indikator: 'Pemupukan tercatat', kebun: ada ? [fertUpkeep.length ? fmtRpShort(fertUpkeep.reduce((a, x) => a + x.value, 0)) : '', fertDays ? `${fertDays} catatan mandor` : ''].filter(Boolean).join(', ') : 'tidak tercatat',
      // Catatan upkeep per bulan yang baru 1–2 bulan belum cukup untuk menyimpulkan "tidak ada pemupukan"
      acuan: '2–3 kali/tahun', arti: ada ? 'ada catatan pemupukan' : d.upkeepAnalysis ? `catatan upkeep baru ${d.upkeepAnalysis.months.length} bulan, belum cukup dinilai` : 'belum terlihat di catatan KebunPRO',
      arah: ada || d.upkeepAnalysis ? 'netral' : 'kurang' });
  }
  // 3b. Produksi per blok (file 10): blok yang RUTIN dipanen tetapi janjang/ha jauh di bawah standar umurnya
  const P = d.blockProd, T = DECK_CONFIG.THRESHOLDS;
  const blockLow = !!(P && P.fertPct / 100 >= T.BLOCK_LOW_AREA);
  if (P && P.ratedHa) ev.push({ indikator: 'Blok janjang rendah', kebun: `${P.fertRows.length} blok (${fmt(P.fertPct, 0)}% luas)`,
    acuan: `≥ ${pct(T.BLOCK_LOW_ACH)} standar`, arti: P.fertRows.length ? `rutin dipanen tetapi janjang/ha rendah, mis. ${P.fertRows.slice(0, 3).map(r => r.name).join(', ')}` : 'tidak ada blok rutin dipanen yang jauh di bawah standar',
    arah: blockLow ? 'kurang' : 'netral' });
  // 4. Jenis tanah (menentukan kebutuhan khusus; tanpa data tanah dosis belum bisa disesuaikan)
  if (S) {
    const gb = S.groups.find(g => g.key === 'gambut');
    if (gb) ev.push({ indikator: 'Jenis tanah', kebun: `Gambut ${fmt(gb.ha, 0)} ha`, acuan: '-', arti: 'butuh K lebih serta Cu dan Zn', arah: 'netral' });
    else if (S.unknownPct >= 50) ev.push({ indikator: 'Jenis tanah', kebun: `${fmt(S.unknownPct, 0)}% belum tercatat`, acuan: '-', arti: 'dosis belum bisa disesuaikan dengan tanah', arah: 'netral' });
  }
  const yieldLow = M && ((M.achTon < 0.8 && !shortM) || (bjrOk && M.achBjr < 0.85));
  const verdict = doseVerdict && doseVerdict !== 'sesuai' ? doseVerdict
    : yieldLow || blockLow ? 'kurang'
    : doseVerdict === 'sesuai' || (M && M.achTon >= 0.8 && !shortM) ? 'sesuai' : 'belum';
  const reason = verdict === 'kurang'
    ? (doseVerdict === 'kurang' ? `dosis NPK ${fmt(N.actual, 1)} kg/pohon/tahun di bawah prediksi untuk ${fmt(N.kurangHa, 0)} ha`
      : M && M.achTon < 0.8 && !shortM ? `hasil ${pct(M.achTon)} dari standar Marihat${bjrOk && M.achBjr < 0.85 ? ` dan BJR ${pct(M.achBjr)} dari standar` : ''}`
      : bjrOk && M.achBjr < 0.85 ? `BJR ${pct(M.achBjr)} dari standar Marihat untuk umurnya`
      : `${P.fertRows.length} blok (${fmt(P.fertPct, 0)}% luas) rutin dipanen tetapi janjangnya di bawah ${pct(T.BLOCK_LOW_ACH)} standar`)
    : verdict === 'berlebih' ? `dosis NPK ${fmt(N.actual, 1)} kg/pohon/tahun di atas prediksi untuk ${fmt(N.lebihHa, 0)} ha`
    : verdict === 'sesuai' ? (M ? `hasil ${pct(M.achTon)} dari standar Marihat` : 'dosis sesuai prediksi')
    : 'data hasil per umur tanaman dan dosis pupuk belum cukup';
  // Blok prioritas uji daun & tanah: blok rutin dipanen dengan selisih janjang terbesar dari standar
  const priorityBlocks = P ? P.fertRows.slice(0, 5).map(r => r.name) : [];
  return { verdict, label: STATUS_PUPUK_LABEL[verdict], reason, evidence: ev.slice(0, 6), doseVerdict, priorityBlocks, blockLow };
}

function describeFertStatus(d) {
  const F = d.fertStatus;
  if (!F) return 'STATUS PEMUPUKAN: tidak dapat dinilai.';
  const L = [`STATUS PEMUPUKAN (PESAN UTAMA bagian pupuk): ${F.label} — ${F.reason}. ${STATUS_PUPUK_SARAN}. ` +
    'Angka di bawah hanya bukti pendukung; jangan menuliskannya sebagai dosis anjuran.'];
  F.evidence.forEach(e => L.push(`- ${e.indikator}: kebun ${e.kebun} | acuan ${e.acuan} | ${e.arti}${e.arah === 'kurang' ? ' (mendukung indikasi kurang)' : e.arah === 'lebih' ? ' (mendukung indikasi berlebih)' : ''}.`));
  if (F.verdict !== 'berlebih' && !F.doseVerdict) L.push('- Kelebihan pupuk hanya bisa dinilai bila dosis aktual kebun diisi di sheet (label "Dosis NPK Aktual").');
  if (F.priorityBlocks && F.priorityBlocks.length) L.push(`- Blok prioritas uji daun dan uji tanah (rutin dipanen, janjang paling jauh dari standar): ${F.priorityBlocks.join(', ')}.`);
  if (F.verdict === 'kurang' || F.verdict === 'berlebih') L.push(`PERLU DICEK: ${F.label.toLowerCase()} (${F.reason}); ${STATUS_PUPUK_SARAN.toLowerCase()}.`);
  return L.join('\n');
}

/** Baris tabel bukti status pemupukan untuk slide lampiran + baris kesimpulan. */
function fertStatusTableRows(d) {
  const F = d.fertStatus;
  if (!F) return null;
  return F.evidence.map(e => [e.indikator, e.kebun, e.acuan, e.arti])
    .concat([[`Kesimpulan: ${F.label}`, F.priorityBlocks && F.priorityBlocks.length ? `Blok prioritas: ${F.priorityBlocks.slice(0, 3).join(', ')}` : '', '', STATUS_PUPUK_SARAN]]);
}
