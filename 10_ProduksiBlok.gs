/**
 * File 10: ProduksiBlok.gs
 * Analisis PER BLOK dari janjang dipanen per blok per bulan (bagian ke-5 isian blok:
 * "nama, luas ha, tahun tanam, jenis tanah, janjang dipanen").
 *
 *  - Produktivitas blok: janjang/ha/tahun dibanding standar Marihat (PPKS) untuk umur & kelas lahan blok itu.
 *  - Potensi yang belum tercapai per blok (janjang & Rp per tahun) -> blok prioritas.
 *  - Keteraturan panen: bulan tanpa panen per blok (rotasi), konsentrasi produksi (blok penyumbang 80% janjang).
 *  - Kaitan pupuk: blok yang RUTIN dipanen tetapi janjang/ha jauh di bawah standar = indikasi kurang hara ->
 *    blok prioritas Uji Daun & Uji Tanah Dokter Sawit. Blok rendah karena panen tidak teratur atau lewat umur ekonomis
 *    dipisahkan (penyebabnya rotasi panen / peremajaan, bukan pupuk).
 *
 * Catatan: dibandingkan per hektare (standar janjang/ha = ton ÷ BJR tabel Marihat), jadi tidak bergantung pada asumsi
 * jumlah pokok/ha. Janjang/pokok hanya ditampilkan bila jumlah pokok/ha dicatat di sheet. Tonase per blok tidak ada di data,
 * jadi nilai Rp memakai BJR rata-rata kebun (estimasi).
 */

/** Catatan singkat untuk kolom tabel slide (satu–dua baris). */
const BLOK_CATATAN_SINGKAT = {
  hara: 'Prioritas uji daun & tanah', rotasi: 'Cek rotasi panen', tua: 'Kandidat peremajaan',
  baik: 'Sesuai standar', pantau: 'Pantau (data pendek)', cek: 'Cek luas/nama blok'
};

const BLOK_CATATAN = {
  hara: 'rutin dipanen, janjang rendah: prioritas uji daun & tanah',
  rotasi: 'panen tidak teratur: cek rotasi panen',
  tua: 'lewat umur ekonomis: kandidat peremajaan',
  baik: 'sesuai atau di atas standar',
  pantau: 'di bawah standar; data belum cukup untuk menyimpulkan penyebab',
  cek: 'jauh di atas standar: cek luas atau nama blok'
};

/** Catatan blok; blok "baik" yang belum 100% disebut apa adanya. */
function blockNote(r) {
  if (r.cat === 'baik' && r.ach < 1) return `di bawah standar, masih di atas ambang ${fmt(DECK_CONFIG.THRESHOLDS.BLOCK_LOW_ACH * 100, 0)}%`;
  const note = BLOK_CATATAN[r.cat] || '-';
  return r.ach !== null && r.ach < DECK_CONFIG.THRESHOLDS.BLOCK_VERY_LOW_ACH && r.cat !== 'cek' ? `${note}; angka sangat rendah, cek juga luas blok` : note;
}

/**
 * -> {rows:[{name, ha, year, age, soil, jjgSum, harvestMonths, regular, jjgHa, rjt, std, ach, tonHa, gapJjg, gapRp, trend, cat}],
 *     nMonths, sph, bjr, price, lowHa, lowPct, fertRows, fertHa, fertPct, rotasiRows, tuaRows, pareto, byAge, bySoil,
 *     priority, mismatchMonths, missingEntries}
 */
function buildBlockProduction(d) {
  const B = d.blocks;
  if (!B || !B.blocks.some(b => b.jjgSum > 0)) return null;
  const T = DECK_CONFIG.THRESHOLDS;
  // Bulan awal yang belum penuh (ramp) tidak dihitung; tiap blok disetahunkan dari bulan pertama ia muncul
  const months = B.monthly.map(m => mkey(m.p)).filter(k => k !== d.rampMonth);
  const nMonths = months.length;
  if (!nMonths) return null;
  const shortData = nMonths < T.MIN_MONTHS_ANNUAL;     // terlalu sedikit bulan: penyebab (hara/rotasi) belum disimpulkan
  const sph = d.sph || DECK_CONFIG.SPH_DEFAULT, sphKnown = !d.sphAssumed && !!d.sph, cls = d.landClass || DECK_CONFIG.DEFAULT_LAND_CLASS;
  const bjrS = seriesStats(d.bjr);
  const bjr = d.bjrSoldCum || (bjrS ? bjrS.avg : null);
  const priceS = seriesStats(d.hargaJual && d.hargaJual.length ? d.hargaJual : d.revKg);
  const price = priceS ? priceS.avg : null;
  const rows = B.blocks.filter(b => b.ha > 0 && b.jjgSum > 0).map(b => {
    const fi = b.firstP ? months.indexOf(mkey(b.firstP)) : 0;
    const bm = months.slice(Math.max(0, fi));                                        // bulan sejak blok pertama muncul
    const bSum = bm.reduce((a, k) => a + (b.jjgByMonth[k] || 0), 0);
    const bHarvest = bm.filter(k => (b.jjgByMonth[k] || 0) > 0).length;
    const jjgHa = bm.length ? ((bSum / bm.length) * 12) / b.ha : 0;                  // janjang/ha/tahun
    const rjt = sphKnown ? jjgHa / sph : null;
    const std = b.age !== null && b.age >= 3 ? marihatAt(b.age, cls) : null;
    const ach = std ? jjgHa / std.jjgHa : null;
    const regular = bHarvest >= bm.length * T.BLOCK_REGULAR;
    const blockShort = bm.length < Math.min(3, nMonths);   // blok baru muncul 1–2 bulan: penyebab belum disimpulkan
    const gapJjg = std ? Math.max(0, std.jjgHa - jjgHa) * b.ha : null;               // janjang/tahun
    const gapRp = gapJjg && bjr && price ? gapJjg * bjr * price : null;
    // tren: rata-rata 3 bulan terakhir vs 3 bulan sebelumnya
    const v = months.map(k => b.jjgByMonth[k] || 0);
    const last3 = v.slice(-3), prev3 = v.slice(-6, -3);
    const avg = a => a.reduce((x, y) => x + y, 0) / (a.length || 1);
    const trend = prev3.length === 3 && avg(prev3) ? ((avg(last3) - avg(prev3)) / avg(prev3)) * 100 : null;
    const low = ach !== null && ach < T.BLOCK_LOW_ACH;
    const cat = ach !== null && ach > T.BLOCK_SUSPECT_ACH ? 'cek' : !low ? (ach !== null ? 'baik' : null) : b.age > T.REPLANT_AGE ? 'tua' : shortData || blockShort ? 'pantau' : !regular ? 'rotasi' : 'hara';
    return { name: b.name, ha: b.ha, year: b.year, age: b.age, soil: b.soil, jjgSum: bSum, harvestMonths: bHarvest, monthsOf: bm.length, regular,
             jjgHa, rjt, std, ach, tonHa: bjr && bm.length ? ((bSum * bjr) / 1000 / bm.length) * 12 / b.ha : null, gapJjg, gapRp, trend, cat };
  });
  if (!rows.length) return null;
  const haOf = arr => arr.reduce((a, r) => a + r.ha, 0);
  const suspectRows = rows.filter(r => r.cat === 'cek');
  const rated = rows.filter(r => r.ach !== null && r.cat !== 'cek'), ratedHa = haOf(rated);
  const lowRows = rated.filter(r => r.cat && r.cat !== 'baik');
  const fertRows = rated.filter(r => r.cat === 'hara').sort((a, b) => (b.gapJjg || 0) - (a.gapJjg || 0));
  // Konsentrasi produksi: blok penyumbang 80% janjang
  const byJjg = rows.slice().sort((a, b) => b.jjgSum - a.jjgSum), totJjg = rows.reduce((a, r) => a + r.jjgSum, 0);
  let cum = 0, k80 = 0;
  for (const r of byJjg) { cum += r.jjgSum; k80++; if (cum >= totJjg * 0.8) break; }
  const pareto = { blocks: k80, of: rows.length, haPct: (haOf(byJjg.slice(0, k80)) / haOf(rows)) * 100 };
  // Capaian tertimbang per kelas umur & per jenis tanah
  const group = keyFn => {
    const map = {};
    rated.forEach(r => { const k = keyFn(r); if (!map[k]) map[k] = { name: k, ha: 0, real: 0, std: 0, n: 0 };
      map[k].ha += r.ha; map[k].real += r.jjgHa * r.ha; map[k].std += r.std.jjgHa * r.ha; map[k].n++; });
    return Object.keys(map).map(k => map[k]).map(g => Object.assign(g, { ach: g.std ? g.real / g.std : null, jjgHa: g.real / g.ha }))
      .sort((a, b) => b.ha - a.ha);
  };
  // Cek data: jumlah janjang per blok vs total janjang kebun per bulan
  const mismatchMonths = B.monthly.filter(m => {
    const sum = rows.reduce((a, r) => a + (B.blocks.find(b => b.name === r.name && b.ha === r.ha && b.year === r.year).jjgByMonth[mkey(m.p)] || 0), 0);
    const tot = valAt(d.totalJjg, m.p);
    return tot && Math.abs(sum / tot - 1) > 0.02;
  }).map(m => m.label);
  const missingEntries = (d.blocksRaw || []).reduce((a, row) => a + parseBlocks(row.value).filter(b => b.jjg === null).length, 0);
  return {
    rows, nMonths, shortData, sph, sphKnown, cls, bjr, price,
    ratedHa, lowHa: haOf(lowRows), lowPct: ratedHa ? (haOf(lowRows) / ratedHa) * 100 : 0,
    fertRows, fertHa: haOf(fertRows), fertPct: ratedHa ? (haOf(fertRows) / ratedHa) * 100 : 0,
    rotasiRows: rated.filter(r => r.cat === 'rotasi'), tuaRows: rated.filter(r => r.cat === 'tua'),
    pareto, byAge: group(r => ageClassOf(r.age)), bySoil: group(r => (soilTypeOf(r.soil) || { name: SOIL_UNKNOWN }).name),
    priority: rated.filter(r => r.gapJjg > 0).sort((a, b) => b.gapJjg - a.gapJjg).slice(0, 8),
    gapJjgTotal: rated.reduce((a, r) => a + (r.gapJjg || 0), 0), gapRpTotal: rated.reduce((a, r) => a + (r.gapRp || 0), 0),
    mismatchMonths, missingEntries, suspectRows,
    best: rated.slice().sort((a, b) => b.ach - a.ach)[0] || null
  };
}

function describeBlockProduction(d) {
  const P = d.blockProd;
  if (!P) return 'PRODUKSI PER BLOK: janjang per blok belum tersedia di data blok.';
  const pct = v => `${fmt(v * 100, 0)}%`;
  const L = [`PRODUKSI PER BLOK (janjang dipanen per blok, ${P.nMonths} bulan; dibanding standar Marihat ${P.cls} janjang/ha/tahun untuk umur blok itu = ton ÷ BJR standar; tidak memakai asumsi jumlah pokok):`];
  if (P.shortData) L.push(`CATATAN: data blok baru ${P.nMonths} bulan. Angka per tahun disetahunkan dari bulan itu dan dipengaruhi musim panen, jadi masih INDIKATIF; penyebab blok rendah (kurang hara atau rotasi panen) belum disimpulkan sampai minimal ${DECK_CONFIG.THRESHOLDS.MIN_MONTHS_ANNUAL} bulan data.`);
  L.push(`- ${fmt(P.lowPct, 0)}% luas blok yang dinilai (${fmt(P.lowHa, 1)} dari ${fmt(P.ratedHa, 1)} ha) di bawah ${pct(DECK_CONFIG.THRESHOLDS.BLOCK_LOW_ACH)} standar: ` +
    (P.shortData ? `${P.rows.filter(r => r.cat === 'pantau').length} blok belum disimpulkan penyebabnya, ${P.tuaRows.length} blok lewat umur ekonomis.`
      : `${P.fertRows.length} blok rutin dipanen (indikasi kurang hara), ${P.rotasiRows.length} blok panen tidak teratur, ${P.tuaRows.length} blok lewat umur ekonomis.`));
  L.push(`- Potensi janjang yang belum tercapai: ±${fmt(P.gapJjgTotal, 0)} janjang/tahun${P.gapRpTotal ? ` ≈ ${fmtRp(P.gapRpTotal)}/tahun (BJR kebun ${fmt(P.bjr, 1)} kg × harga rata-rata Rp${fmt(P.price, 0)}/kg; estimasi${P.shortData ? `, disetahunkan dari ${P.nMonths} bulan` : ''})` : ''}.`);
  L.push(`- Blok prioritas (selisih terbesar dari standar): ${P.priority.slice(0, 6).map(r => `${r.name} ${fmt(r.ha, 1)} ha, umur ${r.age} th, ${fmt(r.jjgHa, 0)} vs standar ${fmt(r.std.jjgHa, 0)} jjg/ha/th (${pct(r.ach)}), dipanen ${r.harvestMonths}/${r.monthsOf} bln → ${blockNote(r)}`).join('; ')}.`);
  if (P.best) L.push(`- Blok terbaik: ${P.best.name} (${fmt(P.best.jjgHa, 0)} jjg/ha/th, ${pct(P.best.ach)} standar) — praktik di blok ini bisa jadi acuan.`);
  L.push(`- Capaian per kelas umur: ${P.byAge.map(g => `${g.name} ${pct(g.ach)} (${fmt(g.ha, 0)} ha)`).join('; ')}.`);
  if (P.bySoil.length > 1 || (P.bySoil[0] && P.bySoil[0].name !== SOIL_UNKNOWN)) L.push(`- Capaian per jenis tanah: ${P.bySoil.map(g => `${g.name} ${pct(g.ach)} (${fmt(g.ha, 0)} ha)`).join('; ')}.`);
  L.push(`- Konsentrasi produksi: ${P.pareto.blocks} dari ${P.pareto.of} blok (${fmt(P.pareto.haPct, 0)}% luas) menghasilkan 80% janjang.`);
  const down = P.rows.filter(r => r.trend !== null && r.trend <= -30 && r.ha >= 2).sort((a, b) => a.trend - b.trend).slice(0, 4);
  if (down.length) L.push(`- Blok dengan janjang 3 bulan terakhir turun tajam (≥30% dari 3 bulan sebelumnya): ${down.map(r => `${r.name} ${fmt(r.trend, 0)}%`).join(', ')}.`);
  if (P.fertRows.length) L.push(`PERLU DICEK: ${P.fertRows.length} blok (${fmt(P.fertHa, 1)} ha) rutin dipanen tetapi janjang/ha di bawah ${pct(DECK_CONFIG.THRESHOLDS.BLOCK_LOW_ACH)} standar umurnya, mis. ${P.fertRows.slice(0, 4).map(r => r.name).join(', ')}; indikasi kurang hara, prioritaskan uji daun dan uji tanah di blok ini.`);
  if (P.rotasiRows.length) L.push(`PERLU DICEK: ${P.rotasiRows.length} blok berproduktivitas rendah karena jarang dipanen (mis. ${P.rotasiRows.slice(0, 4).map(r => `${r.name} ${r.harvestMonths}/${r.monthsOf} bln`).join(', ')}); cek rotasi panen dan akses blok.`);
  if (P.suspectRows.length) L.push(`PERLU DICEK DATA: ${P.suspectRows.length} blok mencatat janjang/ha lebih dari ${fmt(DECK_CONFIG.THRESHOLDS.BLOCK_SUSPECT_ACH * 100, 0)}% standar umurnya (mis. ${P.suspectRows.slice(0, 4).map(r => `${r.name} ${fmt(r.ha, 1)} ha, ${fmt(r.ach * 100, 0)}%`).join(', ')}); kemungkinan luas atau nama blok tidak sesuai, sehingga tidak dihitung dalam analisis blok.`);
  if (P.mismatchMonths.length) L.push(`TIDAK KONSISTEN: jumlah janjang per blok berbeda >2% dari total janjang kebun pada ${P.mismatchMonths.join(', ')}.`);
  if (P.missingEntries) L.push(`- ${P.missingEntries} isian blok-bulan belum mencantumkan jumlah janjang (dianggap belum tercatat, bukan nol).`);
  return L.join('\n');
}

/** Baris tabel blok prioritas untuk slide lampiran. */
function blockProdTableRows(d) {
  const P = d.blockProd;
  if (!P || !P.priority.length) return null;
  const T = DECK_CONFIG.THRESHOLDS;
  const note = r => (r.cat === 'baik' && r.ach < 1 ? 'Di bawah standar' : BLOK_CATATAN_SINGKAT[r.cat] || '-') +
    (r.ach !== null && r.ach < T.BLOCK_VERY_LOW_ACH && r.cat !== 'cek' ? '; cek luas' : '');
  return P.priority.slice(0, 8).map(r => [r.name, String(r.age), fmt(r.ha, 1), fmt(r.jjgHa, 0), fmt(r.std.jjgHa, 0), `${fmt(r.ach * 100, 0)}%`, note(r)]);
}
