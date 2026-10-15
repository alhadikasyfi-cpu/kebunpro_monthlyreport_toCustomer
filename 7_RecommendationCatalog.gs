/**
 * File 7: RecommendationCatalog.gs
 * Katalog rekomendasi standar perkebunan kelapa sawit (sama untuk semua kebun).
 *
 * Cara kerja:
 *  1. Script membaca data kebun dan menandai kode rekomendasi yang TERINDIKASI (fungsi `when`), lengkap dengan buktinya.
 *  2. Gemini menerima seluruh katalog + indikasi itu, menganalisis data lebih lanjut, lalu MEMILIH 3–4 kode
 *     yang paling berdampak untuk kebun ini dan menulis detail spesifiknya (blok, bulan, angka, target waktu).
 *  3. Judul kartu diambil dari katalog (bahasanya seragam untuk semua customer); detail dari Gemini.
 *  4. Jika Gemini gagal, kode yang terindikasi dipakai langsung sebagai rekomendasi.
 *
 * Tim agronomi bisa menambah/mengubah item di sini tanpa menyentuh kode lain.
 * Field: code, title (judul kartu), action (inti tindakan standar), signals (kapan relevan, untuk Gemini),
 *        topics (id slide terkait), when(d, ctx) -> null | {evidence, priority}
 */

const RECO_CATALOG = [
  { code: 'R01', title: 'Perketat rotasi panen',
    action: 'Jaga rotasi panen 7–10 hari per ancak agar janjang matang tidak tertinggal di pokok.',
    signals: 'JJG/ha turun atau fluktuatif; produksi naik-turun tajam antar-bulan.',
    topics: ['jjg', 'produksi'],
    when: d => { const g = signals(d.jjgHa); return ['turun', 'fluktuatif'].indexOf(g.trend) >= 0
      ? { evidence: `JJG/ha ${g.trend} (CV ${fmt(g.cv, 0)}%, bulan terakhir ${g.position})`, priority: 'tinggi' } : null; } },

  { code: 'R02', title: 'Tegakkan kriteria matang panen',
    action: 'Panen hanya janjang matang (brondolan lepas sesuai standar) dan periksa mutu buah di TPH.',
    signals: 'BJR di bawah acuan umur tanaman, turun, fluktuatif, atau di bawah rata-rata.',
    topics: ['bjr', 'yield'],
    when: (d, ctx) => {
      const below = (ctx.detected || []).find(x => /acuan umur/.test(x.text));
      if (below) {
        // ringkas: jumlah bulan di bawah standar + bulan terburuk (tanpa memotong kalimat di tengah)
        const m = [...below.text.matchAll(/([A-Z][a-z]+ \d{4}) \(([\d.,]+) kg vs standar Marihat ([\d.,]+) kg\)/g)];
        const worst = m.sort((a, b2) => parseNum(a[2]) / parseNum(a[3]) - parseNum(b2[2]) / parseNum(b2[3]))[0];
        return { evidence: m.length
          ? `BJR di bawah standar Marihat pada ${m.length} bulan; terendah ${worst[1]}: ${worst[2]} kg vs ${worst[3]} kg`
          : 'BJR di bawah standar Marihat untuk umur tanamannya', priority: 'tinggi' };
      }
      const g = signals(d.bjr.length ? d.bjr : d.bjrImplied); return ['turun', 'fluktuatif'].indexOf(g.trend) >= 0 || g.position === 'di bawah rata-rata'
      ? { evidence: `BJR ${g.trend}, bulan terakhir ${g.position} (${g.vsAvg >= 0 ? '+' : ''}${fmt(g.vsAvg, 0)}%)`, priority: 'tinggi' } : null; } },

  { code: 'R03', title: 'Kutip brondolan sampai bersih',
    action: 'Wajibkan pengutipan brondolan di piringan dan TPH; brondolan tertinggal langsung mengurangi tonase.',
    signals: 'Yield turun sementara JJG/ha relatif stabil; BJR rendah.',
    topics: ['yield', 'bjr'],
    when: d => { const y = signals(d.yield), j = signals(d.jjgHa); return y.trend === 'turun' && ['stabil', 'naik'].indexOf(j.trend) >= 0
      ? { evidence: `yield ${y.trend} padahal JJG/ha ${j.trend}`, priority: 'sedang' } : null; } },

  { code: 'R04', title: 'Evaluasi program pemupukan',
    action: 'Tinjau dosis, jenis, dan waktu aplikasi pupuk per blok; aplikasikan saat tanah lembap dan sesuai rekomendasi analisis daun/tanah.',
    signals: 'Produktivitas jauh di bawah standar Marihat untuk umurnya; yield turun/fluktuatif; porsi biaya pupuk besar tanpa kenaikan yield.',
    topics: ['yield', 'upkeep', 'umur'],
    when: d => { const y = signals(d.yield); const fert = upkeepItems(d).find(x => /fert|pupuk/i.test(x.name));
      const M = d.marihat;
      if (M && M.achTon < 0.7) return { evidence: `produktivitas ${fmt(M.realTonHa, 1)} t/ha/th, baru ${fmtPct(M.achTon * 100, 0)} dari standar Marihat ${M.cls} (${fmt(M.pot.ton, 1)})${fert ? `; biaya pupuk ${fmtPct(fert.pct, 0)} upkeep` : ''}`, priority: M.achTon < 0.5 ? 'tinggi' : 'sedang' };
      return ['turun', 'fluktuatif'].indexOf(y.trend) >= 0
        ? { evidence: `yield ${y.trend}${fert ? `; biaya pupuk ${fmtRp(fert.value)} (${fmtPct(fert.pct, 0)} upkeep)` : ''}`, priority: 'sedang' } : null; } },

  { code: 'R05', title: 'Rawat piringan, pasar pikul, dan gawangan',
    action: 'Kendalikan gulma di piringan dan pasar pikul agar panen dan pengutipan brondolan lancar.',
    signals: 'Biaya pemeliharaan (slashing/weeding) kecil atau tidak tercatat; produktivitas pemanen rendah.',
    topics: ['upkeep', 'mandorpanen'],
    when: () => null },

  { code: 'R06', title: 'Perkuat pengendalian hama dan penyakit',
    action: 'Lakukan sensus hama (ulat api, tikus) dan deteksi dini Ganoderma; tindak sesuai ambang ekonomi.',
    signals: 'Biaya pestisida menjadi porsi terbesar atau meningkat; yield turun di blok tertentu.',
    topics: ['upkeep'],
    when: d => { const top = upkeepItems(d)[0]; return top && /pest|hama|insek|fungi|herbi/i.test(top.name)
      ? { evidence: `${top.name} porsi upkeep terbesar (${fmtPct(top.pct, 0)})`, priority: 'sedang' } : null; } },

  { code: 'R07', title: 'Rencanakan peremajaan (replanting) bertahap',
    action: 'Susun jadwal replanting blok lewat umur ekonomis secara bertahap agar produksi kebun tidak turun drastis.',
    signals: 'Ada blok berumur > ambang REPLANT_AGE; porsi luas blok tua besar.',
    topics: ['umur', 'replanting', 'umuryield'],
    when: d => { const B = d.blocks; return B && B.replant.length
      ? { evidence: `${B.replant.length} blok (${fmt(B.replant.reduce((s, b) => s + b.ha, 0), 1)} ha) berumur > ${DECK_CONFIG.THRESHOLDS.REPLANT_AGE} th`, priority: 'tinggi' } : null; } },

  { code: 'R08', title: 'Sisip pokok mati dan kosong',
    action: 'Sensus pokok per blok dan lakukan penyisipan pada titik kosong untuk menjaga kerapatan tanam.',
    signals: 'JJG/ha rendah di blok yang belum tua; data jumlah pokok tersedia.',
    topics: ['jjg'],
    when: () => null },

  { code: 'R09', title: 'Seimbangkan kapasitas muat dengan panen',
    action: 'Pastikan armada dan tenaga muat cukup agar TBS terangkut di hari yang sama dan tidak restan.',
    signals: 'JJG dimuat jauh lebih kecil dari JJG dipanen; hari kerja muat sedikit.',
    topics: ['mandormuat', 'mandorpanen'],
    when: (d, ctx) => {
      const st = d.flow && d.flow.steps.find(x => x.from === 'Dipanen' && x.loss);
      if (st) return { evidence: `${fmt(st.gap, 0)} jjg (${fmt(st.pct, 0)}%) dipanen tidak tercatat dimuat${st.rp ? ` ≈ ${fmtRp(st.rp)}` : ''}`, priority: 'tinggi' };
      const a = (ctx.detected || []).find(x => /restan/.test(x.text)); return a ? { evidence: a.text.replace(/^PERLU DICEK:\s*/, ''), priority: 'tinggi' } : null; } },

  { code: 'R10', title: 'Samakan produktivitas antar-pemanen',
    action: 'Tetapkan target JJG/hari berbasis capaian terbaik, tinjau pembagian ancak, dan beri insentif premi.',
    signals: 'Selisih JJG/hari antar-mandor panen besar; produktivitas mandor turun.',
    topics: ['mandorpanen'],
    when: d => { const m = d.mandorPanen; if (!m || m.rows.length < 2) return null;
      const li = m.periods.map((p, i) => (p.partial ? null : i)).filter(i => i !== null).pop() || 0;
      const r = m.rows.map(x => x.vals[li] && x.vals[li].rate).filter(Boolean);
      return r.length > 1 && Math.max(...r) > Math.min(...r) * 1.3
        ? { evidence: `selisih JJG/hari ${m.periods[li].label}: ${fmt(Math.max(...r), 0)} vs ${fmt(Math.min(...r), 0)} (${fmt(Math.max(...r) / Math.min(...r), 1)}×)`, priority: 'sedang' } : null; } },

  { code: 'R11', title: 'Kendalikan dan jadwalkan pengeluaran',
    action: 'Setujui pengeluaran besar lebih dulu dan tempatkan di bulan dengan pendapatan tinggi.',
    signals: 'Margin per ha negatif atau menurun; biaya per ha melonjak di bulan tertentu.',
    topics: ['margin', 'biayaha'],
    when: d => { const m = seriesStats(d.margin), g = signals(d.margin);
      return m && (m.negatives.length || g.trend === 'turun')
        ? { evidence: m.negatives.length ? `margin negatif pada ${m.negatives.map(x => monthLong(x.p)).join(', ')}` : 'margin per ha menurun', priority: 'tinggi' } : null; } },

  { code: 'R12', title: 'Optimalkan harga jual TBS',
    action: 'Bandingkan harga dengan penetapan dinas/PKS lain, jaga mutu TBS agar potongan grading kecil, pertimbangkan kontrak.',
    signals: 'Harga jual bulan terakhir di bawah rata-rata atau fluktuatif; pendapatan per kg tertinggal.',
    topics: ['biayakg'],
    when: d => { const g = signals(d.hargaJual.length ? d.hargaJual : d.revKg); return g.position === 'di bawah rata-rata'
      ? { evidence: `harga jual bulan terakhir ${g.position} (${fmt(g.vsAvg, 0)}%)`, priority: 'sedang' } : null; } },

  { code: 'R13', title: 'Kendalikan biaya pekerja per kg',
    action: 'Tinjau tarif, output per hari kerja, dan komposisi biaya panen/muat/perawatan agar biaya pekerja tetap sebanding dengan harga jual.',
    signals: 'Porsi biaya pekerja terhadap harga jual naik; biaya per kg melonjak di bulan tertentu.',
    topics: ['efisiensi', 'biayakg'],
    when: d => { const g = signals(d.upahRatio); return g.trend === 'naik'
      ? { evidence: `porsi upah terhadap harga jual ${g.trend}`, priority: 'sedang' } : null; } },

  { code: 'R14', title: 'Lengkapi dan rapikan pencatatan data',
    action: 'Lengkapi data yang kosong dan samakan sumber angka antar-tabel sebelum laporan berikutnya.',
    signals: 'Ada data kosong, tabel tidak konsisten, atau anomali yang belum terjelaskan.',
    topics: ['anomali'],
    when: d => { const miss = checkDataCompleteness(d);
      const inc = describeRelations(d).split('\n').filter(l => /ANOMALI DATA|TIDAK KONSISTEN/.test(l)).length;
      return miss.length || inc ? { evidence: [miss.length ? `data kosong: ${miss.slice(0, 4).join(', ')}` : '', inc ? `${inc} ketidaksesuaian antar-tabel` : ''].filter(Boolean).join('; '), priority: 'sedang' } : null; } },

  { code: 'R15', title: 'Perbaiki jalan dan jembatan panen',
    action: 'Prioritaskan perbaikan akses di blok dengan angkutan terhambat untuk mencegah restan.',
    signals: 'Restan/muat tertinggal; produktivitas muat turun.',
    topics: ['mandormuat'],
    when: () => null },

  { code: 'R16', title: 'Lakukan penunasan sesuai standar',
    action: 'Tunas pelepah sesuai umur tanaman agar janjang mudah dipanen dan brondolan tidak tersangkut.',
    signals: 'BJR/yield fluktuatif; banyak blok tua dengan pokok tinggi.',
    topics: ['bjr', 'umur'],
    when: () => null },

  { code: 'R18', title: 'Telusuri kebocoran janjang per tahap',
    action: 'Rekonsiliasi harian jumlah janjang di TPH, saat muat, di surat jalan, dan di tiket timbang; lakukan cek mendadak dan beri penanda/segel pada janjang di TPH.',
    signals: 'Janjang dipanen tidak sampai dimuat/terjual di atas ambang; selisih menumpuk tiap bulan.',
    topics: ['alurjjg', 'restan', 'mandormuat'],
    when: d => { const F = d.flow; if (!F) return null;
      // bulan laporan dulu (dibanding bulan sebelumnya); kumulatif hanya bila bulan laporan tidak terukur
      const c = F.cur && !F.cur.overSold ? F.cur : null, p = F.prev && !F.prev.overSold ? F.prev : null;
      if (c && c.worst && c.steps.some(x => x.loss)) return { evidence: `${monthShort(c.p)}: ${fmt(c.lossJjg, 0)} jjg (${fmt(c.lossPct, 0)}%) tidak sampai terjual${c.lossRp ? ` ≈ ${fmtRp(c.lossRp)}` : ''}` +
        (p && p.lossRp && c.lossRp ? ` vs ${monthShort(p.p)} ${fmtRp(p.lossRp)}` : '') + `; terbesar di ${c.worst.from} → ${c.worst.to}`, priority: 'tinggi' };
      if (c || !F.worst || !F.steps.some(x => x.loss)) return null;
      return { evidence: `kumulatif ${fmt(F.lossJjg, 0)} jjg (${fmt(F.lossPct, 0)}%) tidak sampai terjual${F.lossRp ? ` ≈ ${fmtRp(F.lossRp)}` : ''}; terbesar di ${F.worst.from} → ${F.worst.to}`, priority: 'tinggi' }; } },

  { code: 'R19', title: 'Samakan pencatatan panen dan muat',
    action: 'Pastikan setiap janjang dicatat saat panen di TPH; janjang dimuat yang melebihi panen menandakan pencatatan panen kurang atau restan yang tidak tercatat.',
    signals: 'Janjang dimuat/terjual lebih besar dari janjang dipanen; jjg dipanen berbeda dengan total janjang di tabel produksi.',
    topics: ['alurjjg', 'anomali'],
    when: d => { const F = d.flow; if (!F) return null;
      if (F.overSold) return { evidence: `janjang terjual ${fmt(F.overSoldPct, 1)}% lebih banyak dari janjang dipanen; kebocoran tidak terukur`, priority: 'tinggi' };
      const ex = F.steps.find(x => x.excess);
      if (ex) return { evidence: `janjang ${ex.to.toLowerCase()} melebihi ${ex.from.toLowerCase()} ${fmt(-ex.gap, 0)} jjg (${fmt(-ex.pct, 1)}%)`, priority: 'sedang' };
      return F.panenVsTotal > 2 ? { evidence: `jjg dipanen berbeda ${fmt(F.panenVsTotal, 0)}% dari total janjang tabel produksi`, priority: 'sedang' } : null; } },

  { code: 'R20', title: 'Wajibkan timbang setiap janjang terjual',
    action: 'Setiap penjualan dicatat jumlah janjang DAN beratnya (tiket timbang); penjualan tanpa berat tidak diterima di pembukuan.',
    signals: 'Ada janjang terjual tanpa catatan berat dalam porsi berarti.',
    topics: ['tanpaberat', 'bjr'],
    when: d => { const N = d.noWeight; return N && N.share > DECK_CONFIG.THRESHOLDS.NOWEIGHT_PCT
      ? { evidence: `${fmt(N.share, 0)}% janjang terjual tanpa berat (${fmt(N.nwSum, 0)} jjg ≈ ${fmtRp(N.rpSum)})`, priority: N.share > 20 ? 'tinggi' : 'sedang' } : null; } },

  { code: 'R21', title: 'Telusuri blok yang tidak tercatat menjual',
    action: 'Cek per blok apakah janjang dipanen, tertinggal di TPH, atau dijual tanpa dicatat blok asalnya; tetapkan pengawasan blok tersebut.',
    signals: 'Blok yang sama berulang kali dipanen tetapi tidak tercatat menjual.',
    topics: ['blokunsale', 'alurjjg'],
    when: d => { const U = d.unsale; return U && U.chronic.length
      ? { evidence: `${U.chronic.length} blok (${fmt(U.chronic.reduce((a, b) => a + b.ha, 0), 1)} ha) tanpa penjualan ≥ ${DECK_CONFIG.THRESHOLDS.UNSALE_MONTHS} bulan, mis. ${U.chronic.slice(0, 3).map(b => b.name).join(', ')}`, priority: 'tinggi' } : null; } },

  { code: 'R22', title: 'Lakukan uji tanah per jenis tanah',
    action: 'Ambil contoh tanah per blok atau kelompok blok sejenis, analisis pH, C-organik, N, P, K, Mg, dan KTK, lalu catat jenis tanah di data blok KebunPRO.',
    signals: 'Jenis tanah blok belum tercatat; dosis pupuk belum disesuaikan dengan tanah; produktivitas di bawah standar Marihat.',
    topics: ['tanah', 'pupuk', 'marihat'],
    when: d => { const S = d.soil; if (!S || !S.unknownHa) return null;
      return { evidence: `jenis tanah belum tercatat untuk ${S.unknownCount} blok (${fmt(S.unknownHa, 1)} ha, ${fmt(S.unknownPct, 0)}% luas)`,
               priority: S.unknownPct >= 50 || (d.marihat && d.marihat.achTon < 0.7) ? 'tinggi' : 'sedang' }; } },

  { code: 'R23', title: 'Lakukan uji daun untuk status hara',
    action: 'Ambil contoh daun pelepah ke-17 per blok sejenis untuk melihat kekurangan hara yang sebenarnya sebelum menetapkan dosis pupuk.',
    signals: 'BJR atau produktivitas jauh di bawah standar Marihat untuk umurnya; yield turun tanpa sebab pencatatan.',
    topics: ['bjr', 'marihat', 'pupuk'],
    when: d => { const M = d.marihat; if (!M) return null;
      const low = (M.achBjr && M.achBjr < 0.8) || M.achTon < 0.7;
      return low ? { evidence: `produktivitas ${fmtPct(M.achTon * 100, 0)}${M.achBjr ? `, BJR ${fmtPct(M.achBjr * 100, 0)}` : ''} dari standar Marihat ${M.cls}`, priority: M.achTon < 0.5 ? 'tinggi' : 'sedang' } : null; } },

  { code: 'R24', title: 'Sesuaikan pupuk dengan tanah dan umur',
    action: 'Terapkan dosis NPK per kelompok blok sesuai umur tanaman dan jenis tanah (rekomendasi umum di lampiran), konfirmasi dengan uji tanah/daun, lalu siapkan pengadaan pupuk sesuai kebutuhan setahun.',
    signals: 'Dosis NPK aktual di bawah atau di atas acuan; atau jenis tanah sudah tercatat dan rekomendasi NPK per kelompok blok sudah dihitung script.',
    topics: ['pupuk', 'tanah'],
    when: d => { const S = d.soil, N = d.npk; if (!N) return null;
      if (N.kurangHa) return { evidence: `dosis NPK ${fmt(N.actual, 1)} kg/pohon/tahun di bawah acuan untuk ${fmt(N.kurangHa, 1)} ha; risiko produksi turun`, priority: 'tinggi' };
      if (N.lebihHa) return { evidence: `dosis NPK ${fmt(N.actual, 1)} kg/pohon/tahun di atas acuan untuk ${fmt(N.lebihHa, 1)} ha${N.lebihRp ? ` (≈ ${fmtRp(N.lebihRp)}/tahun terbuang)` : ''}`, priority: 'tinggi' };
      if (!S || S.knownPct <= 0) return null;
      const r = N.rows.find(x => x.soilKnown) || N.rows[0];
      return { evidence: `${fmt(S.knownPct, 0)}% luas tercatat jenis tanahnya; contoh ${r.age.toLowerCase()} tanah ${r.soil.toLowerCase()}: NPK ${npkRange(r)} kg/pohon/tahun; total ${fmt(N.tonLo, 0)}–${fmt(N.tonHi, 0)} ton/tahun`, priority: 'sedang' }; } },

  { code: 'R17', title: 'Pertahankan praktik yang sudah baik',
    action: 'Dokumentasikan praktik panen dan perawatan yang membuat kinerja naik agar tetap dijalankan.',
    signals: 'Yield atau produksi naik dan stabil; margin positif.',
    topics: ['yield', 'produksi', 'margin'],
    when: d => { const g = signals(d.yield); return g.trend === 'naik' ? { evidence: `yield ${g.trend} (bulan terakhir ${g.position})`, priority: 'sedang' } : null; } }
];

const RECO_CODES = RECO_CATALOG.map(r => r.code).concat(['LAINNYA']);

function recoByCode(code) { return RECO_CATALOG.find(r => r.code === code) || null; }

/** Kode yang terindikasi oleh data kebun ini: [{code, title, evidence, priority, pages}] */
function detectRecommendations(d, topics, detected) {
  const pageOf = id => { const t = topics.find(x => x.id === id); return t ? t.page : null; };
  const out = [];
  RECO_CATALOG.forEach(r => {
    let hit = null;
    try { hit = r.when(d, { detected }); } catch (e) { Logger.log(`Trigger ${r.code} gagal: ${e.message}`); }
    if (hit) out.push({ code: r.code, title: r.title, evidence: hit.evidence, priority: hit.priority, pages: r.topics.map(pageOf).filter(Boolean) });
  });
  const rank = p => (p === 'tinggi' ? 0 : 1);
  return out.sort((a, b) => rank(a.priority) - rank(b.priority));
}

/** Katalog sebagai teks untuk prompt. */
function catalogForPrompt() {
  return RECO_CATALOG.map(r => `${r.code} | ${r.title} | tindakan standar: ${r.action} | relevan bila: ${r.signals}`).join('\n') +
    '\nLAINNYA | (judul sendiri) | hanya bila tidak ada kode yang cocok dan didukung kuat oleh data';
}

/** Rekomendasi cadangan (tanpa Gemini) dari kode yang terindikasi. */
function fallbackActionsFromCatalog(candidates) {
  return candidates.slice(0, 4).map(c => {
    const r = recoByCode(c.code);
    return { code: c.code, title: r.title, detail: trimToSentence(`${r.action} Dasar data: ${String(c.evidence).replace(/[.;\s]+$/, "")}.`, AI_LIMITS.ACTION_DETAIL),
             priority: c.priority, timeline: c.priority === 'tinggi' ? '1–3 bulan' : '3–12 bulan', impact: '', basis_pages: c.pages };
  });
}
