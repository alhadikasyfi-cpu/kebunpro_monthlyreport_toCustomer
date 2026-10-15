/**
 * File 9: TanahPupuk.gs
 * Jenis tanah per blok (bagian ke-4 isian blok: "nama, luas ha, tahun tanam, jenis tanah") dan
 * kebutuhan pupuk INDIKATIF per pokok per tahun menurut umur tanaman dan jenis tanah.
 *
 * Tujuan:
 *  - Menajamkan analisis penyebab hasil (kendala hara tiap jenis tanah, blok tanpa penjualan per jenis tanah).
 *  - Dasar rekomendasi produk SawitPRO: Uji Tanah & Uji Daun (Dokter Sawit) dan penyediaan Pupuk SawitPRO.
 *
 * PENTING: dosis di ACUAN_PUPUK adalah acuan umum yang lazim dipakai di perkebunan (rentang kg/pokok/tahun),
 * BUKAN rekomendasi pemupukan kebun ini. Dosis pasti harus dari uji tanah + uji daun. Tim agronomi SawitPRO
 * dapat mengganti angka di sini tanpa menyentuh kode lain.
 */

/**
 * Jenis tanah yang dikenali (dicocokkan dari teks di sheet, tidak membedakan huruf besar/kecil).
 * adj = pengali dosis terhadap acuan tanah mineral; extra = tambahan khusus; kendala & fokus = bahan narasi.
 */
const SOIL_TYPES = [
  { key: 'gambut', name: 'Gambut', match: /gambut|peat|histosol|organosol/i,
    adj: { urea: 0.9, rp: 1.0, mop: 1.25, kies: 1.0, borat: 1.25 }, npk: [0.75, 1.0],
    extra: 'tambahan CuSO4 0,10–0,15 kg dan ZnSO4 0,05–0,10 kg per pokok per tahun',
    kendala: 'pH rendah, miskin Cu, Zn, dan B, pokok mudah condong; muka air perlu dijaga 50–75 cm',
    fokus: 'K, Cu, Zn, B; dolomit untuk pH' },
  { key: 'pmk', name: 'Podsolik Merah Kuning', match: /podsolik|pmk|ultisol|merah kuning/i,
    adj: { urea: 1.0, rp: 1.25, mop: 1.0, kies: 1.25, borat: 1.0 }, npk: [1.0, 1.15],
    extra: 'dolomit sebagai pengapuran bila pH < 4,5',
    kendala: 'masam, P mudah terikat Al/Fe, Mg rendah, rawan erosi',
    fokus: 'P (fosfat alam) dan Mg' },
  { key: 'latosol', name: 'Latosol/Oksisol', match: /latosol|oksisol|oxisol|laterit/i,
    adj: { urea: 1.0, rp: 1.25, mop: 1.1, kies: 1.0, borat: 1.0 }, npk: [1.0, 1.1],
    extra: '',
    kendala: 'pelapukan lanjut, daya simpan hara (KTK) rendah, P terikat',
    fokus: 'P dan K' },
  { key: 'aluvial', name: 'Aluvial', match: /aluvial|alluvial|inceptisol|entisol/i,
    adj: { urea: 1.0, rp: 1.0, mop: 1.0, kies: 1.0, borat: 1.0 }, npk: [1.0, 1.0],
    extra: '',
    kendala: 'relatif subur; perhatikan drainase di lahan rendah',
    fokus: 'dosis standar, jaga drainase' },
  { key: 'pasir', name: 'Berpasir', match: /pasir|sand|spodosol|psamment|podzol/i,
    adj: { urea: 1.1, rp: 1.0, mop: 1.25, kies: 1.25, borat: 1.0 }, npk: [1.0, 1.2],
    extra: 'aplikasi dibagi 3–4 kali per tahun agar tidak tercuci',
    kendala: 'hara mudah tercuci, daya simpan air rendah',
    fokus: 'K dan Mg, aplikasi bertahap' },
  { key: 'sulfat', name: 'Sulfat Masam', match: /sulfat|sulphat|pirit|acid sulfate/i,
    adj: { urea: 1.0, rp: 1.25, mop: 1.0, kies: 1.25, borat: 1.0 }, npk: [1.0, 1.15],
    extra: 'kapur/dolomit dan pengendalian muka air agar pirit tidak teroksidasi',
    kendala: 'pH sangat rendah bila pirit teroksidasi',
    fokus: 'pengapuran dan tata air' },
  { key: 'andosol', name: 'Andosol (vulkanik)', match: /andosol|andisol|vulkan/i,
    adj: { urea: 1.0, rp: 1.25, mop: 1.0, kies: 1.0, borat: 1.0 }, npk: [1.0, 1.1],
    extra: '',
    kendala: 'P terikat kuat oleh alofan',
    fokus: 'P' },
  { key: 'mineral', name: 'Mineral', match: /mineral|liat|clay|lempung|podsol/i,
    adj: { urea: 1.0, rp: 1.0, mop: 1.0, kies: 1.0, borat: 1.0 }, npk: [1.0, 1.0],
    extra: '', kendala: 'tanah mineral umum', fokus: 'dosis standar' }
];

const SOIL_UNKNOWN = 'Belum tercatat';

/**
 * Acuan umum dosis pupuk (kg/pokok/tahun, rentang [rendah, tinggi]) untuk tanah mineral, per kelas umur.
 *   npk  = pupuk majemuk NPK (mis. 12-12-17-2 atau 15-15-15), dipakai untuk REKOMENDASI per umur × jenis tanah;
 *          rentang ini disesuaikan dengan pengali `npk` di SOIL_TYPES.
 *   urea/rp/mop/kies/borat = padanan pupuk tunggal (rincian untuk tim agronomi).
 * BUKAN tabel Standar Marihat (tabel Marihat hanya memuat potensi produksi, jumlah tandan, dan BJR).
 * Lihat catatan PENTING di atas; tim agronomi SawitPRO sebaiknya memvalidasi angka ini.
 */
const ACUAN_PUPUK = [
  { min: 0, max: 3,   name: 'TBM (<4 th)', short: 'TBM <4 th', npk: [0.5, 1.5], urea: [0.5, 1.0],   rp: [0.5, 1.0],   mop: [0.5, 1.0],   kies: [0.25, 0.5],  borat: [0.02, 0.05] },
  { min: 4, max: 8,   name: 'TM muda (4–8 th)', short: 'TM 4–8 th', npk: [1.5, 2.5], urea: [1.5, 2.0],   rp: [1.0, 1.5],   mop: [1.5, 2.0],   kies: [0.75, 1.0],  borat: [0.05, 0.075] },
  { min: 9, max: 18,  name: 'TM puncak (9–18 th)', short: 'TM 9–18 th', npk: [2.0, 3.0], urea: [2.0, 2.75],  rp: [1.5, 2.0],   mop: [2.0, 2.75],  kies: [1.0, 1.5],   borat: [0.075, 0.1] },
  { min: 19, max: 25, name: 'TM tua (19–25 th)', short: 'TM 19–25 th', npk: [1.5, 2.5], urea: [1.75, 2.5],  rp: [1.25, 1.75], mop: [1.75, 2.5],  kies: [1.0, 1.25],  borat: [0.05, 0.1] },
  { min: 26, max: 200, name: 'Lewat umur ekonomis (>25 th)', short: '>25 th', npk: [1.0, 2.0], urea: [1.5, 2.0], rp: [1.0, 1.0], mop: [1.5, 2.0], kies: [0.75, 1.0], borat: [0.05, 0.05] }
];
const PUPUK_LIST = [
  { key: 'urea', name: 'Urea (N)' }, { key: 'rp', name: 'Fosfat alam/RP (P)' }, { key: 'mop', name: 'MOP/KCl (K)' },
  { key: 'kies', name: 'Kieserit (Mg)' }, { key: 'borat', name: 'Borat (B)' }
];

/** Teks jenis tanah di sheet -> jenis tanah yang dikenali (atau jenis lain apa adanya). null = belum tercatat. */
function soilTypeOf(raw) {
  const s = String(raw || '').trim();
  if (!s || /^[-–—]+$/.test(s)) return null;
  return SOIL_TYPES.find(t => t.match.test(s)) ||
    { key: 'lain:' + s.toLowerCase(), name: s, adj: { urea: 1, rp: 1, mop: 1, kies: 1, borat: 1 }, npk: [1.0, 1.0], extra: '', kendala: 'belum ada di daftar jenis tanah script', fokus: 'perlu uji tanah' };
}

function acuanPupukAt(age) {
  return age === null || age === undefined ? null : ACUAN_PUPUK.find(a => age >= a.min && age <= a.max) || null;
}

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
  groups.forEach(g => {
    g.pct = B.totalHa ? (g.ha / B.totalHa) * 100 : 0;
    g.unsaleRate = g.blockMonths ? (g.unsaleMonths / g.blockMonths) * 100 : null;
    const ages = g.blocks.filter(b => b.age !== null);
    g.avgAge = ages.length ? ages.reduce((a, b) => a + b.age * b.ha, 0) / ages.reduce((a, b) => a + b.ha, 0) : null;
  });
  const unk = map.unknown;
  const unknownHa = unk ? unk.ha : 0;
  const known = groups.filter(g => g.key !== 'unknown');
  return { groups, totalHa: B.totalHa, unknownHa, unknownCount: unk ? unk.count : 0,
           unknownPct: B.totalHa ? (unknownHa / B.totalHa) * 100 : 0, knownPct: B.totalHa ? 100 - (unknownHa / B.totalHa) * 100 : 0,
           dominant: known.length ? known[0] : null };
}

/**
 * Kebutuhan pupuk INDIKATIF setahun untuk blok unik dengan tahun tanam tercatat:
 * dosis acuan per umur × pengali jenis tanah × SPH × luas. Blok tanpa data tanah memakai acuan tanah mineral.
 * -> {total:{urea,...} (ton/tahun), perPokok:{urea,...} (kg rata-rata tertimbang), ha, haNoAge, haUnknownSoil, sph, rows}
 */
function buildFertilizerNeed(d) {
  const B = d.blocks;
  if (!B || !B.blocks.length) return null;
  const sph = d.sph || DECK_CONFIG.SPH_DEFAULT;
  const total = {}, kgPokok = {};
  PUPUK_LIST.forEach(p => { total[p.key] = 0; kgPokok[p.key] = 0; });
  let ha = 0, haNoAge = 0, haUnknownSoil = 0;
  const extras = {};
  B.blocks.forEach(b => {
    const ac = acuanPupukAt(b.age);
    if (!ac) { haNoAge += b.ha; return; }
    const t = soilTypeOf(b.soil);
    if (!t) haUnknownSoil += b.ha;
    else if (t.extra) extras[t.name] = t.extra;
    const adj = t ? t.adj : SOIL_TYPES.find(x => x.key === 'mineral').adj;
    PUPUK_LIST.forEach(p => {
      const dose = ((ac[p.key][0] + ac[p.key][1]) / 2) * (adj[p.key] || 1);   // kg/pokok/tahun (titik tengah rentang)
      total[p.key] += (dose * sph * b.ha) / 1000;                              // ton/tahun
      kgPokok[p.key] += dose * b.ha;
    });
    ha += b.ha;
  });
  if (!ha) return null;
  PUPUK_LIST.forEach(p => { kgPokok[p.key] = kgPokok[p.key] / ha; });
  return { total, perPokok: kgPokok, ha, haNoAge, haUnknownSoil, sph, sphAssumed: !!d.sphAssumed, extras,
           totalTon: PUPUK_LIST.reduce((a, p) => a + total[p.key], 0) };
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

function describeFertilizer(d) {
  const F = d.fertilizer;
  if (!F) return 'KEBUTUHAN PUPUK: tidak dapat dihitung (tahun tanam blok belum tercatat).';
  const L = [`KEBUTUHAN PUPUK INDIKATIF SETAHUN (acuan umum per umur × penyesuaian jenis tanah; BUKAN rekomendasi final, wajib dikonfirmasi uji tanah dan uji daun): dasar ${fmt(F.ha, 1)} ha, ${F.sph} pokok/ha${F.sphAssumed ? ' (asumsi)' : ''}.`];
  L.push('- ' + PUPUK_LIST.map(p => `${p.name} rata-rata ${fmt(F.perPokok[p.key], 2)} kg/pokok → ${fmt(F.total[p.key], 1)} ton/tahun`).join('; ') + `; total ±${fmt(F.totalTon, 0)} ton/tahun.`);
  Object.keys(F.extras).forEach(k => L.push(`- ${k}: ${F.extras[k]}.`));
  if (F.haUnknownSoil) L.push(`- ${fmt(F.haUnknownSoil, 1)} ha tanpa data jenis tanah dihitung dengan acuan tanah mineral; angka bisa berubah setelah uji tanah.`);
  if (F.haNoAge) L.push(`- ${fmt(F.haNoAge, 1)} ha tanpa tahun tanam tidak dihitung.`);
  return L.join('\n');
}

/** Baris tabel jenis tanah untuk slide lampiran. */
function soilTableRows(d) {
  const S = d.soil;
  if (!S) return null;
  return S.groups.slice(0, 7).map(g => [g.name, fmt(g.ha, 1), `${fmt(g.pct, 0)}%`, String(g.count),
    g.type ? g.type.fokus : 'uji tanah dulu']);
}

/** Baris tabel kebutuhan pupuk untuk slide lampiran. */
function fertilizerTableRows(d) {
  const F = d.fertilizer;
  if (!F) return null;
  return PUPUK_LIST.map(p => [p.name, fmt(F.perPokok[p.key], 2), fmt(F.total[p.key], 1)])
    .concat([[`Total (${fmt(F.ha, 0)} ha, ${F.sph} pokok/ha)`, '', fmt(F.totalTon, 0)]]);
}

/* ------------------------------------------------------------------------- */
/* Rekomendasi NPK per kelompok blok (umur tanaman × jenis tanah)            */
/* ------------------------------------------------------------------------- */

/** Akibat dosis di luar acuan (bahan narasi; tanpa janji angka). */
const RISIKO_DOSIS = {
  kurang: 'hara tidak mencukupi: jumlah janjang dan BJR cenderung turun 6–24 bulan kemudian (efek pupuk tertunda), sehingga produksi dan pendapatan tertahan',
  lebih: 'biaya pupuk terbuang, hara tercuci atau tidak seimbang (mis. K berlebih menekan serapan Mg), tanpa tambahan hasil yang sebanding'
};

/**
 * Rekomendasi NPK UMUM per kelompok blok (kelas umur × jenis tanah) dari data blok:
 * rentang kg NPK/pohon/tahun = acuan umur × pengali jenis tanah; kebutuhan ton/tahun = rentang × jumlah pokok.
 * Bila sheet berisi "Dosis NPK Aktual" (kg/pohon/tahun), tiap kelompok dinilai kurang / sesuai / berlebih,
 * dan bila "Harga Pupuk NPK" (Rp/kg) diisi, selisihnya dirupiahkan.
 * -> {rows:[{age, soil, soilKnown, ha, pokok, blocks, lo, hi, tonLo, tonHi, status, gapRp}], tonLo, tonHi, ha, pokok, actual, price, sph}
 */
function buildNpkRecommendation(d) {
  const B = d.blocks;
  if (!B || !B.blocks.length) return null;
  const sph = d.sph || DECK_CONFIG.SPH_DEFAULT;
  const actual = d.npkActual || null, price = d.npkPrice || null;
  const map = {};
  B.blocks.forEach(b => {
    const ac = acuanPupukAt(b.age);
    if (!ac) return;
    const t = soilTypeOf(b.soil);
    const key = `${ac.name}|${t ? t.name : SOIL_UNKNOWN}`;
    if (!map[key]) {
      const mul = t ? t.npk : [1, 1];
      map[key] = { age: ac.name, ageShort: ac.short || ac.name, ageMin: ac.min, soil: t ? t.name : SOIL_UNKNOWN, soilKnown: !!t, type: t,
                   lo: ac.npk[0] * mul[0], hi: ac.npk[1] * mul[1], ha: 0, blocks: [] };
    }
    map[key].ha += b.ha; map[key].blocks.push(b.name);
  });
  const rows = Object.keys(map).map(k => map[k]).sort((a, b) => b.ha - a.ha);
  if (!rows.length) return null;
  rows.forEach(r => {
    r.pokok = r.ha * sph;
    r.tonLo = (r.lo * r.pokok) / 1000; r.tonHi = (r.hi * r.pokok) / 1000;
    r.status = actual === null ? null : actual < r.lo ? 'kurang' : actual > r.hi ? 'berlebih' : 'sesuai';
    // berlebih: pupuk terbuang di atas batas atas; kurang: pupuk yang perlu ditambah sampai batas bawah
    r.gapKg = r.status === 'kurang' ? (r.lo - actual) * r.pokok : r.status === 'berlebih' ? (actual - r.hi) * r.pokok : 0;
    r.gapRp = price && r.gapKg ? r.gapKg * price : null;
  });
  const sum = k => rows.reduce((a, r) => a + r[k], 0);
  return { rows, tonLo: sum('tonLo'), tonHi: sum('tonHi'), ha: sum('ha'), pokok: sum('pokok'), actual, price, sph,
           sphAssumed: !!d.sphAssumed, unknownSoilHa: rows.filter(r => !r.soilKnown).reduce((a, r) => a + r.ha, 0),
           kurangHa: rows.filter(r => r.status === 'kurang').reduce((a, r) => a + r.ha, 0),
           lebihHa: rows.filter(r => r.status === 'berlebih').reduce((a, r) => a + r.ha, 0),
           lebihRp: rows.filter(r => r.status === 'berlebih').reduce((a, r) => a + (r.gapRp || 0), 0),
           kurangKg: rows.filter(r => r.status === 'kurang').reduce((a, r) => a + r.gapKg, 0) };
}

function npkRange(r) { return `${fmt(r.lo, 1)}–${fmt(r.hi, 1)}`; }

function describeNpk(d) {
  const N = d.npk;
  if (!N) return 'REKOMENDASI NPK: tidak dapat dihitung (tahun tanam blok belum tercatat).';
  const L = [`REKOMENDASI NPK UMUM per kelompok blok (acuan umum per umur tanaman × penyesuaian jenis tanah; BUKAN tabel Standar Marihat; dosis pasti lewat uji tanah dan uji daun Dokter Sawit). Dasar ${fmt(N.ha, 1)} ha, ${N.sph} pokok/ha${N.sphAssumed ? ' (asumsi)' : ''}:`];
  N.rows.forEach(r => L.push(`- ${r.age}, tanah ${r.soil.toLowerCase()}: ${fmt(r.ha, 1)} ha (${r.blocks.length} blok, mis. ${r.blocks.slice(0, 3).join(', ')}) → NPK ${npkRange(r)} kg/pohon/tahun; kebutuhan ${fmt(r.tonLo, 1)}–${fmt(r.tonHi, 1)} ton/tahun` +
    (r.type && r.type.extra ? `; ${r.type.extra}` : '') + (!r.soilKnown ? '; jenis tanah belum tercatat, dihitung sebagai tanah mineral' : '') +
    (r.status ? `; dosis aktual ${fmt(N.actual, 1)} kg = ${r.status.toUpperCase()}${r.gapRp ? ` (≈ ${fmtRp(r.gapRp)})` : ''}` : '') + '.'));
  L.push(`- Total kebutuhan NPK indikatif: ${fmt(N.tonLo, 0)}–${fmt(N.tonHi, 0)} ton/tahun${N.price ? ` ≈ ${fmtRp(N.tonLo * 1000 * N.price)}–${fmtRp(N.tonHi * 1000 * N.price)} pada harga Rp${fmt(N.price, 0)}/kg` : ''}.`);
  L.push(`- Bila dosis di bawah acuan: ${RISIKO_DOSIS.kurang}. Bila di atas acuan: ${RISIKO_DOSIS.lebih}.`);
  if (N.actual === null) L.push('- Dosis NPK aktual kebun belum diisi di sheet (label "Dosis NPK Aktual"), jadi belum dapat dinilai kurang atau berlebih.');
  if (N.kurangHa) L.push(`PERLU DICEK: dosis NPK aktual ${fmt(N.actual, 1)} kg/pohon/tahun DI BAWAH acuan untuk ${fmt(N.kurangHa, 1)} ha (kurang ±${fmt(N.kurangKg / 1000, 1)} ton NPK/tahun); risiko produksi turun pada bulan-bulan berikutnya.`);
  if (N.lebihHa) L.push(`PERLU DICEK: dosis NPK aktual ${fmt(N.actual, 1)} kg/pohon/tahun DI ATAS acuan untuk ${fmt(N.lebihHa, 1)} ha${N.lebihRp ? ` (≈ ${fmtRp(N.lebihRp)} per tahun terbuang)` : ''}.`);
  return L.join('\n');
}

/** Baris tabel rekomendasi NPK untuk slide lampiran (maks. 8 kelompok, sisanya digabung). */
function npkTableRows(d) {
  const N = d.npk;
  if (!N) return null;
  const head = N.rows.slice(0, 7), rest = N.rows.slice(7);
  const rows = head.map(r => [r.ageShort, r.soil, fmt(r.ha, 1), npkRange(r), `${fmt(r.tonLo, 1)}–${fmt(r.tonHi, 1)}`]
    .concat(N.actual !== null ? [r.status] : []));
  if (rest.length) rows.push([`${rest.length} kelompok lain`, '-', fmt(rest.reduce((a, r) => a + r.ha, 0), 1), '-',
    `${fmt(rest.reduce((a, r) => a + r.tonLo, 0), 1)}–${fmt(rest.reduce((a, r) => a + r.tonHi, 0), 1)}`].concat(N.actual !== null ? ['-'] : []));
  rows.push(['Total', '', fmt(N.ha, 1), '', `${fmt(N.tonLo, 0)}–${fmt(N.tonHi, 0)}`].concat(N.actual !== null ? [''] : []));
  return rows;
}
