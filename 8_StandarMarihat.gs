/**
 * File 8: StandarMarihat.gs
 * Standar potensi produksi kelapa sawit PPKS Marihat per umur tanaman dan kelas kesesuaian lahan.
 *
 * Sumber: Lampiran Permentan No. 131/Permentan/OT.140/12/2013 (Pedoman Budidaya Kelapa Sawit yang Baik),
 *         Tabel 3 "Potensi Produksi Kelapa Sawit Umur 3-25 Tahun pada Setiap Kelas Kesesuaian Lahan",
 *         sumber data PPKS (2009).
 *   ton = produktivitas TBS (ton/ha/tahun)
 *   rjt = rerata jumlah tandan (tandan/pohon/tahun)
 *   rbt = rerata berat tandan / BJR (kg/tandan)
 *   jjgHa = janjang/ha/tahun = ton × 1000 ÷ rbt (diturunkan dari tabel; tidak butuh jumlah pokok kebun).
 *   Tabel ini sendiri setara ±132 pokok produktif/ha (ton ÷ (rjt × rbt) = 132 di semua umur dan kelas),
 *   lebih rendah dari kerapatan tanam 143 pokok/ha (jarak 9 m segitiga), karena tidak semua pokok produktif.
 *   Karena jumlah pokok kebun jarang tercatat, perbandingan jumlah tandan memakai janjang/ha, bukan janjang/pokok.
 * Potensi ini berlaku untuk bahan tanam unggul D×P. Pedoman yang sama menyebut bahan tanam tidak unggul
 * hanya mencapai produksi TBS maksimum sekitar 50%.
 */

const MARIHAT = {
  //      S1: [ton, rjt, rbt]     S2                   S3
  3:  { S1: [6.0, 10.8, 4.2],  S2: [5.0, 9.4, 4.0],   S3: [4.0, 8.0, 3.8] },
  4:  { S1: [16.0, 18.1, 6.7], S2: [14.0, 16.8, 6.3], S3: [12.0, 15.1, 6.0] },
  5:  { S1: [19.0, 18.5, 7.8], S2: [17.0, 17.2, 7.5], S3: [15.0, 16.0, 7.1] },
  6:  { S1: [23.0, 17.1, 10.2], S2: [21.0, 16.1, 9.9], S3: [19.0, 15.5, 9.3] },
  7:  { S1: [28.0, 16.1, 13.2], S2: [26.0, 15.4, 12.8], S3: [23.0, 15.1, 11.5] },
  8:  { S1: [32.0, 15.3, 15.8], S2: [28.0, 14.8, 14.3], S3: [26.0, 14.3, 13.8] },
  9:  { S1: [34.0, 14.1, 18.2], S2: [30.0, 13.0, 17.5], S3: [27.0, 12.4, 16.5] },
  10: { S1: [35.0, 13.0, 20.4], S2: [31.0, 12.5, 18.8], S3: [28.0, 12.2, 17.4] },
  11: { S1: [35.0, 12.2, 21.8], S2: [32.0, 11.5, 21.1], S3: [29.0, 10.8, 20.4] },
  12: { S1: [35.0, 11.4, 23.2], S2: [32.0, 10.9, 22.2], S3: [30.0, 10.6, 21.4] },
  13: { S1: [34.0, 10.8, 23.9], S2: [32.0, 10.6, 22.9], S3: [30.0, 10.2, 22.3] },
  14: { S1: [33.0, 10.2, 24.5], S2: [31.0, 9.9, 23.7],  S3: [29.5, 9.6, 23.3] },
  15: { S1: [32.0, 9.1, 26.6],  S2: [30.0, 8.9, 25.5],  S3: [28.5, 8.7, 24.8] },
  16: { S1: [30.5, 8.2, 28.2],  S2: [28.5, 7.9, 27.3],  S3: [27.0, 7.7, 26.6] },
  17: { S1: [29.0, 7.6, 28.9],  S2: [27.5, 7.4, 28.2],  S3: [26.0, 7.2, 27.4] },
  18: { S1: [28.0, 7.1, 30.0],  S2: [27.0, 6.9, 29.6],  S3: [25.0, 6.7, 28.3] },
  19: { S1: [27.0, 6.7, 30.5],  S2: [26.0, 6.5, 30.3],  S3: [24.0, 6.1, 29.8] },
  20: { S1: [26.0, 6.2, 31.8],  S2: [25.0, 6.0, 31.6],  S3: [23.0, 5.6, 31.1] },
  21: { S1: [25.5, 5.9, 32.8],  S2: [24.0, 5.7, 31.9],  S3: [22.0, 5.3, 31.5] },
  22: { S1: [25.0, 5.7, 33.2],  S2: [23.0, 5.4, 32.3],  S3: [21.0, 5.0, 31.8] },
  23: { S1: [24.0, 5.4, 33.6],  S2: [22.0, 5.1, 32.7],  S3: [20.0, 4.7, 32.2] },
  24: { S1: [23.0, 5.0, 34.8],  S2: [21.5, 4.8, 33.9],  S3: [19.5, 4.4, 33.5] },
  25: { S1: [22.5, 4.8, 35.6],  S2: [21.0, 4.5, 35.4],  S3: [19.5, 4.2, 35.1] }
};

/** Nilai standar untuk umur & kelas. Umur < 3 = TBM (null); umur > 25 memakai nilai umur 25 (lewat umur ekonomis). */
function marihatAt(age, cls) {
  if (age === null || age === undefined || age < 3) return null;
  const row = MARIHAT[Math.min(25, Math.round(age))];
  const v = row && row[cls || 'S3'];
  return v ? { ton: v[0], rjt: v[1], rbt: v[2], jjgHa: (v[0] * 1000) / v[2] } : null;
}

/**
 * Perbandingan kebun dengan standar Marihat.
 * - Luas = total blok unik yang tercatat dipanen (dari kolom blok).
 * - Realisasi produktivitas = tonase bulan penuh, disetahunkan, dibagi luas.
 * - Potensi = rata-rata standar per blok, ditimbang luas (blok dengan tahun tanam & umur ≥ 3 tahun).
 */
function buildMarihat(d) {
  const B = d.blocks;
  if (!B || !B.blocks.length) return null;
  const cls = d.landClass;
  // Blok yang janjangnya tercatat 0 di semua bulan (tidak pernah menghasilkan) tidak dipakai sebagai pembagi maupun potensi
  const zero = {}; (B.zeroJjg || []).forEach(b => { zero[`${b.name}|${b.ha}|${b.year}`] = true; });
  const counted = B.blocks.filter(b => !zero[`${b.name}|${b.ha}|${b.year}`]);
  const known = counted.filter(b => b.age !== null && b.age >= 3);
  const areaKnown = known.reduce((s, b) => s + b.ha, 0);
  if (!areaKnown) return null;
  const wavg = (c, k) => known.reduce((s, b) => s + b.ha * marihatAt(b.age, c)[k], 0) / areaKnown;
  const pot = { ton: wavg(cls, 'ton'), rjt: wavg(cls, 'rjt'), rbt: wavg(cls, 'rbt'), jjgHa: wavg(cls, 'jjgHa') };
  const potS1 = wavg('S1', 'ton');

  // Realisasi (bulan penuh saja; bulan awal yang belum penuh dikecualikan)
  const full = s => s.filter(x => x.value !== null && mkey(x.p) !== d.rampMonth);
  // Tonase = janjang terjual -> realisasi produksi memakai estimasi produksi panen (janjang dipanen × BJR terjual)
  const usePanen = d.produksiPanen && d.produksiPanen.some(x => x.value !== null);
  const ton = full(usePanen ? d.produksiPanen : d.produksi);
  const jjg = full(usePanen ? d.flowPanen : d.totalJjg);
  const nMonths = ton.length;
  if (!nMonths) return null;
  const tonSum = ton.reduce((s, x) => s + x.value, 0);
  const jjgSum = jjg.reduce((s, x) => s + x.value, 0);
  // Luas: total blok unik. Jika jauh lebih kecil dari luas panen bulanan (daftar blok tidak lengkap), pakai median luas panen.
  const lp = d.luasPanen.filter(x => x.value !== null).map(x => x.value).sort((a, b) => a - b);
  const lpMed = lp.length ? lp[Math.floor(lp.length / 2)] : 0;
  const blockHa = counted.reduce((s, b) => s + b.ha, 0);
  const areaFromBlocks = blockHa >= lpMed * 0.8 || !lpMed;
  const area = areaFromBlocks ? blockHa : lpMed;
  const realTonYear = (tonSum / nMonths) * 12;
  const realTonHa = realTonYear / area;
  const realBjr = usePanen ? d.bjrSoldCum : (jjgSum ? (tonSum * 1000) / jjgSum : null);
  const soldTonYear = (() => { const t = full(d.produksi); return t.length ? (t.reduce((a, x) => a + x.value, 0) / t.length) * 12 : null; })();
  // Jumlah tandan dibandingkan per hektare (pasti dari data); per pokok hanya bila jumlah pokok/ha dicatat di sheet.
  const realJjgHa = jjgSum ? ((jjgSum / jjg.length) * 12) / area : null;
  const realRjt = realJjgHa && d.sph && !d.sphAssumed ? realJjgHa / d.sph : null;
  const potTonYear = pot.ton * area;
  const priceS = seriesStats(d.hargaJual.length ? d.hargaJual : d.revKg);
  const avgPrice = priceS ? priceS.avg : null;
  const gapTon = Math.max(0, potTonYear - realTonYear);

  // Rincian per kelas umur
  const byClass = DECK_CONFIG.AGE_CLASSES.map(c => {
    const arr = known.filter(b => b.age >= c.min && b.age <= c.max);
    const ha = arr.reduce((s, b) => s + b.ha, 0);
    return ha ? { name: c.name, ha, ton: arr.reduce((s, b) => s + b.ha * marihatAt(b.age, cls).ton, 0) / ha,
                  rbt: arr.reduce((s, b) => s + b.ha * marihatAt(b.age, cls).rbt, 0) / ha } : null;
  }).filter(Boolean);

  return {
    cls, area, areaKnown, areaFromBlocks, zeroHa: B.zeroJjgHa || 0, reliable: nMonths >= DECK_CONFIG.THRESHOLDS.MIN_MONTHS_ANNUAL, nMonths, annualized: nMonths < 12, usePanen, soldTonYear,
    pot, potS1, realTonHa, realTonYear, potTonYear, realBjr, realRjt, realJjgHa,
    achTon: realTonHa / pot.ton, achBjr: realBjr ? realBjr / pot.rbt : null, achJjg: realJjgHa ? realJjgHa / pot.jjgHa : null, achRjt: realRjt ? realRjt / pot.rjt : null,
    gapTon, gapRp: avgPrice ? gapTon * 1000 * avgPrice : null, avgPrice, byClass
  };
}

function describeMarihat(d) {
  const M = d.marihat;
  if (!M) return 'Standar Marihat: tidak dapat dihitung (daftar blok/tahun tanam belum tersedia).';
  const L = [
    `STANDAR MARIHAT (PPKS, Permentan 131/2013 Tabel 3), kelas lahan ${M.cls}${d.landClassAssumed ? ' (ASUMSI, kelas lahan tidak dicatat di sheet)' : ''}:`,
    M.areaFromBlocks ? `- Luas blok unik yang dipanen: ${fmt(M.area, 1)} ha (${fmt(M.areaKnown, 1)} ha dengan tahun tanam ≥ 3 tahun dipakai untuk potensi)${M.zeroHa ? `; ${fmt(M.zeroHa, 1)} ha blok yang janjangnya 0 di semua bulan tidak dihitung` : ''}.`
      : `- PERLU DICEK: total luas di daftar blok lebih kecil dari luas panen bulanan; perhitungan memakai median luas panen ${fmt(M.area, 1)} ha. Lengkapi daftar blok.`,
    M.usePanen ? `- Dasar realisasi: estimasi produksi panen = janjang dipanen × BJR berbasis janjang terjual (${fmt(M.realBjr, 1)} kg), karena tonase di sheet adalah ton TERJUAL. TBS terjual setahun ${fmt(M.soldTonYear, 0)} ton.` : '',
    `- Realisasi produktivitas: ${fmt(M.realTonHa, 1)} ton TBS/ha/tahun (${M.annualized ? `disetahunkan dari ${M.nMonths} bulan` : `${M.nMonths} bulan`}) vs potensi ${fmt(M.pot.ton, 1)} ton/ha/tahun → pencapaian ${fmtPct(M.achTon * 100, 0)} (potensi kelas S1: ${fmt(M.potS1, 1)}).`,
    `- BJR realisasi (${M.usePanen ? 'tonase terjual ÷ janjang terjual' : 'tonase ÷ janjang'}): ${fmt(M.realBjr, 1)} kg vs standar ${fmt(M.pot.rbt, 1)} kg → ${M.achBjr ? fmtPct(M.achBjr * 100, 0) : '-'}.`,
    M.realJjgHa ? `- Janjang per hektare per tahun: ${fmt(M.realJjgHa, 0)} vs standar ${fmt(M.pot.jjgHa, 0)} → ${fmtPct(M.achJjg * 100, 0)} (produktivitas = jumlah janjang/ha × BJR, jadi kekurangan hasil bisa dipilah: tandan sedikit atau tandan ringan).` : '',
    M.realRjt ? `- Janjang per pokok per tahun: ${fmt(M.realRjt, 1)} vs standar ${fmt(M.pot.rjt, 1)} → ${fmtPct(M.achRjt * 100, 0)} (${d.sph} pokok/ha tercatat di sheet).` : '',
    `- Produksi setahun: realisasi ${fmt(M.realTonYear, 0)} ton vs potensi ${fmt(M.potTonYear, 0)} ton; selisih ${fmt(M.gapTon, 0)} ton${M.gapRp ? ` ≈ ${fmtRp(M.gapRp)} per tahun pada harga rata-rata Rp${fmt(M.avgPrice, 0)}/kg` : ''}.`,
    `- Potensi per kelas umur: ${M.byClass.map(c => `${c.name} ${fmt(c.ha, 1)} ha → ${fmt(c.ton, 1)} t/ha/th, BJR ${fmt(c.rbt, 1)} kg`).join('; ')}.`,
    '- Catatan: potensi Marihat berlaku untuk bibit unggul D×P dengan pemeliharaan standar; bibit tidak unggul menurut pedoman yang sama hanya mencapai sekitar 50% potensi. Yield bulanan di sheet memakai luas panen sebagai pembagi, sedangkan perbandingan ini memakai luas blok.'
  ].filter(Boolean);
  if (M.nMonths < DECK_CONFIG.THRESHOLDS.MIN_MONTHS_ANNUAL) L.push(`CATATAN: realisasi baru ${M.nMonths} bulan penuh; angka per tahun disetahunkan dan dipengaruhi musim panen, jadi masih INDIKATIF. Jangan menyimpulkan pencapaian dari angka ini saja.`);
  if (M.achTon > 1.2) L.push(`PERLU DICEK: produktivitas ${fmtPct(M.achTon * 100, 0)} dari standar Marihat (di atas potensi); periksa luas blok, tahun tanam, atau kelas lahan yang dipakai.`);
  if (M.achTon < 0.5) L.push(`PERLU DICEK: produktivitas baru ${fmtPct(M.achTon * 100, 0)} dari standar Marihat untuk umur tanamannya (${fmt(M.realTonHa, 1)} vs ${fmt(M.pot.ton, 1)} t/ha/th); potensi tambahan sekitar ${fmt(M.gapTon, 0)} ton per tahun.`);
  return L.join('\n');
}
