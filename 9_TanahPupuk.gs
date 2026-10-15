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
    adj: { urea: 0.9, rp: 1.0, mop: 1.25, kies: 1.0, borat: 1.25 },
    extra: 'tambahan CuSO4 0,10–0,15 kg dan ZnSO4 0,05–0,10 kg per pokok per tahun',
    kendala: 'pH rendah, miskin Cu, Zn, dan B, pokok mudah condong; muka air perlu dijaga 50–75 cm',
    fokus: 'K, Cu, Zn, B; dolomit untuk pH' },
  { key: 'pmk', name: 'Podsolik Merah Kuning', match: /podsolik|pmk|ultisol|merah kuning/i,
    adj: { urea: 1.0, rp: 1.25, mop: 1.0, kies: 1.25, borat: 1.0 },
    extra: 'dolomit sebagai pengapuran bila pH < 4,5',
    kendala: 'masam, P mudah terikat Al/Fe, Mg rendah, rawan erosi',
    fokus: 'P (fosfat alam) dan Mg' },
  { key: 'latosol', name: 'Latosol/Oksisol', match: /latosol|oksisol|oxisol|laterit/i,
    adj: { urea: 1.0, rp: 1.25, mop: 1.1, kies: 1.0, borat: 1.0 },
    extra: '',
    kendala: 'pelapukan lanjut, daya simpan hara (KTK) rendah, P terikat',
    fokus: 'P dan K' },
  { key: 'aluvial', name: 'Aluvial', match: /aluvial|alluvial|inceptisol|entisol/i,
    adj: { urea: 1.0, rp: 1.0, mop: 1.0, kies: 1.0, borat: 1.0 },
    extra: '',
    kendala: 'relatif subur; perhatikan drainase di lahan rendah',
    fokus: 'dosis standar, jaga drainase' },
  { key: 'pasir', name: 'Berpasir', match: /pasir|sand|spodosol|psamment|podzol/i,
    adj: { urea: 1.1, rp: 1.0, mop: 1.25, kies: 1.25, borat: 1.0 },
    extra: 'aplikasi dibagi 3–4 kali per tahun agar tidak tercuci',
    kendala: 'hara mudah tercuci, daya simpan air rendah',
    fokus: 'K dan Mg, aplikasi bertahap' },
  { key: 'sulfat', name: 'Sulfat Masam', match: /sulfat|sulphat|pirit|acid sulfate/i,
    adj: { urea: 1.0, rp: 1.25, mop: 1.0, kies: 1.25, borat: 1.0 },
    extra: 'kapur/dolomit dan pengendalian muka air agar pirit tidak teroksidasi',
    kendala: 'pH sangat rendah bila pirit teroksidasi',
    fokus: 'pengapuran dan tata air' },
  { key: 'andosol', name: 'Andosol (vulkanik)', match: /andosol|andisol|vulkan/i,
    adj: { urea: 1.0, rp: 1.25, mop: 1.0, kies: 1.0, borat: 1.0 },
    extra: '',
    kendala: 'P terikat kuat oleh alofan',
    fokus: 'P' },
  { key: 'mineral', name: 'Mineral', match: /mineral|liat|clay|lempung|podsol/i,
    adj: { urea: 1.0, rp: 1.0, mop: 1.0, kies: 1.0, borat: 1.0 },
    extra: '', kendala: 'tanah mineral umum', fokus: 'dosis standar' }
];

const SOIL_UNKNOWN = 'Belum tercatat';

/**
 * Acuan umum dosis pupuk tunggal (kg/pokok/tahun, rentang [rendah, tinggi]) untuk tanah mineral, per kelas umur.
 * Urea (N), RP = fosfat alam (P), MOP = KCl (K), Kieserit (Mg), Borat (B). Lihat catatan PENTING di atas.
 */
const ACUAN_PUPUK = [
  { min: 0, max: 3,   name: 'TBM (<4 th)',         urea: [0.5, 1.0],   rp: [0.5, 1.0],   mop: [0.5, 1.0],   kies: [0.25, 0.5],  borat: [0.02, 0.05] },
  { min: 4, max: 8,   name: 'TM muda (4–8 th)',    urea: [1.5, 2.0],   rp: [1.0, 1.5],   mop: [1.5, 2.0],   kies: [0.75, 1.0],  borat: [0.05, 0.075] },
  { min: 9, max: 18,  name: 'TM puncak (9–18 th)', urea: [2.0, 2.75],  rp: [1.5, 2.0],   mop: [2.0, 2.75],  kies: [1.0, 1.5],   borat: [0.075, 0.1] },
  { min: 19, max: 25, name: 'TM tua (19–25 th)',   urea: [1.75, 2.5],  rp: [1.25, 1.75], mop: [1.75, 2.5],  kies: [1.0, 1.25],  borat: [0.05, 0.1] },
  { min: 26, max: 200, name: 'Lewat umur ekonomis (>25 th)', urea: [1.5, 2.0], rp: [1.0, 1.0], mop: [1.5, 2.0], kies: [0.75, 1.0], borat: [0.05, 0.05] }
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
    { key: 'lain:' + s.toLowerCase(), name: s, adj: { urea: 1, rp: 1, mop: 1, kies: 1, borat: 1 }, extra: '', kendala: 'belum ada di daftar jenis tanah script', fokus: 'perlu uji tanah' };
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
