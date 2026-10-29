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
    action: 'Jaga rotasi panen 7–10 hari per ancak agar janjang matang tidak tertinggal di pokok; jadwalkan ancak lewat RKH agar rotasinya bisa dipantau.',
    signals: 'JJG/ha turun atau fluktuatif; produksi naik-turun tajam antar-bulan.',
    topics: ['jjg', 'produksi'],
    when: d => { const P = d.blockProd;
      if (P && P.rotasiRows.length >= 3) return { evidence: `${P.rotasiRows.length} blok berproduktivitas rendah karena jarang dipanen, mis. ${P.rotasiRows.slice(0, 3).map(r => `${r.name} ${r.harvestMonths}/${P.nMonths} bln`).join(', ')}`, priority: 'tinggi' };
      const g = signals(d.jjgHa); return ['turun', 'fluktuatif'].indexOf(g.trend) >= 0
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
    when: d => { const y = signals(d.yield); const fert = upkeepItems(d).find(x => /fert|pupuk|pemupukan/i.test(x.name));
      const M = d.marihat, UF = d.upkeepAnalysis && d.upkeepAnalysis.fert;
      // Catatan upkeep per bulan: tidak ada / sudah lama tidak ada pemupukan
      if (UF && UF.of >= 6 && (UF.months === 0 || UF.monthsSince >= 6)) return { evidence: UF.months === 0
        ? `tidak ada biaya pemupukan dalam ${UF.of} bulan catatan upkeep` : `pemupukan terakhir ${monthLong(UF.last)}, ${UF.monthsSince} bulan sebelum bulan laporan (acuan 2–3 kali/tahun)`,
        priority: M && M.reliable && M.achTon < 0.7 ? 'tinggi' : 'sedang' };
      if (M && M.reliable && M.achTon < 0.7) return { evidence: `produktivitas ${fmt(M.realTonHa, 1)} t/ha/th, baru ${fmtPct(M.achTon * 100, 0)} dari standar Marihat ${M.cls} (${fmt(M.pot.ton, 1)})${fert ? `; biaya pupuk ${fmtPct(fert.pct, 0)} upkeep` : ''}`, priority: M.achTon < 0.5 ? 'tinggi' : 'sedang' };
      return ['turun', 'fluktuatif'].indexOf(y.trend) >= 0
        ? { evidence: `yield ${y.trend}${fert ? `; biaya pupuk ${fmtRp(fert.value)} (${fmtPct(fert.pct, 0)} upkeep)` : ''}`, priority: 'sedang' } : null; } },

  { code: 'R05', title: 'Rawat piringan, pasar pikul, dan gawangan',
    action: 'Kendalikan gulma di piringan dan pasar pikul agar panen dan pengutipan brondolan lancar.',
    signals: 'Biaya pemeliharaan (slashing/weeding) kecil atau tidak tercatat; produktivitas pemanen rendah.',
    topics: ['upkeep', 'mandorpanen'],
    when: d => { const U = d.upkeepAnalysis; if (!U || U.months.length < 6) return null;
      const tot = U.totalSeries.reduce((a, x) => a + (x.value || 0), 0), g = U.catSeries.find(c => c.key === 'gulma');   // tanpa bulan tidak wajar
      const gs = g ? g.series.reduce((a, x) => a + (x.value || 0), 0) : 0;
      return tot && gs / tot < 0.05 ? { evidence: `pengendalian gulma hanya ${fmt(gs / tot * 100, 0)}% biaya perawatan ${U.months.length} bulan (${fmtRp(gs)})`, priority: 'sedang' } : null; } },

  { code: 'R06', title: 'Perkuat pengendalian hama dan penyakit',
    action: 'Lakukan sensus hama (ulat api, tikus) dan deteksi dini Ganoderma; tindak sesuai ambang ekonomi.',
    signals: 'Biaya pestisida menjadi porsi terbesar atau meningkat; yield turun di blok tertentu.',
    topics: ['upkeep'],
    when: d => { const top = upkeepItems(d)[0]; return top && /pest|hama|insek|fungi|tikus|rodent|ulat|ganoderma/i.test(top.name)
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
      // hanya bila ada janjang yang tertahan > 1 bulan (selisih satu bulan saja bisa karena waktu muat/jual)
      const F = d.flow, held = F && F.cur && !F.cur.overSold && F.cur.lossJjg > 0;
      const st = held && F.steps.find(x => x.from === 'Dipanen' && x.loss);
      if (st) return { evidence: `${fmt(st.gap, 0)} jjg (${fmt(st.pct, 0)}%) dipanen belum tercatat dimuat${st.rp ? ` ≈ ${fmtRp(st.rp)}` : ''}; bila data muat sudah lengkap, berarti kapasitas muat kurang`, priority: 'sedang' };
      // hanya temuan restan bertanda tertahan (muat < panen), bukan "dimuat melebihi dipanen"
      const a = (ctx.detected || []).find(x => /restan/.test(x.text) && !/melebihi|tidak tercatat menjual/.test(x.text)); return a ? { evidence: a.text.replace(/^PERLU DICEK:\s*/, ''), priority: 'sedang' } : null; } },

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
      if (!m) return null;
      // Bulan rugi yang ruginya hilang bila lonjakan biaya (kemungkinan salah input) disisihkan -> bukan rugi nyata (lihat R25)
      const neg = m.negatives.filter(x => !lossFromUpkeepSpike(d, x.p));
      return neg.length || g.trend === 'turun'
        ? { evidence: neg.length ? `margin negatif pada ${neg.map(x => monthLong(x.p)).join(', ')}` : 'margin per ha menurun', priority: neg.length ? 'tinggi' : 'sedang' } : null; } },

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
    // hanya bila bulan laporan memang di atas bulan lalu / biasanya (tren naik tetapi bulan laporan turun = kontradiktif)
    when: d => { const g = signals(d.upahRatio), s = seriesStats(d.upahRatio);
      if (g.trend !== 'naik' || !s || (s.prev && s.last.value < s.prev.value) || s.last.value < s.avg) return null;
      return { evidence: `porsi upah terhadap harga jual ${monthShort(s.last.p)} ${fmt(s.last.value, 0)}% (rata-rata ${fmt(s.avg, 0)}%), cenderung naik`, priority: 'sedang' }; } },

  { code: 'R14', title: 'Lengkapi dan rapikan pencatatan data',
    action: 'Lengkapi data yang kosong dan samakan sumber angka antar-tabel; tetapkan admin yang menginput data setiap hari, bukan menumpuk di akhir bulan.',
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

  { code: 'R18', title: 'Input panen, muat, dan jual setiap hari',
    action: 'Input janjang panen, muat, dan penjualan di KebunPRO setiap hari (paling lambat H+1) oleh mandor dan admin; cocokkan jumlahnya tiap akhir minggu. Bila setelah input lengkap masih ada selisih, baru telusuri janjang yang tertinggal di TPH.',
    signals: 'Janjang dipanen belum tercatat dimuat/terjual di atas ambang; selisih menumpuk tiap bulan (umumnya karena data belum diinput).',
    topics: ['alurjjg', 'restan', 'mandormuat'],
    when: d => { const F = d.flow; if (!F) return null;
      // bulan laporan dulu (dibanding bulan sebelumnya); kumulatif hanya bila bulan laporan tidak terukur
      const c = F.cur && !F.cur.overSold ? F.cur : null, p = F.prev && !F.prev.overSold ? F.prev : null;
      if (c && c.lossJjg && c.lossPct > DECK_CONFIG.THRESHOLDS.FLOW_LOSS_PCT) return { evidence: `${monthShort(c.p)}: ${fmt(c.lossJjg, 0)} jjg (${fmt(c.lossPct, 0)}%) panen bulan sebelumnya belum tercatat terjual${c.lossRp ? ` ≈ ${fmtRp(c.lossRp)}` : ''}` +
        (p && p.lossRp && c.lossRp ? ` vs ${monthShort(p.p)} ${fmtRp(p.lossRp)}` : '') + (c.worst ? `; selisih terbesar di ${c.worst.from} → ${c.worst.to}` : ''), priority: 'tinggi' };
      if (c || !F.worst || !F.steps.some(x => x.loss)) return null;
      return { evidence: `kumulatif ${fmt(F.lossJjg, 0)} jjg (${fmt(F.lossPct, 0)}%) belum tercatat sampai terjual${F.lossRp ? ` ≈ ${fmtRp(F.lossRp)}` : ''}; terbesar di ${F.worst.from} → ${F.worst.to}`, priority: 'tinggi' }; } },

  { code: 'R19', title: 'Samakan pencatatan panen dan muat',
    action: 'Pastikan setiap janjang dicatat saat panen di TPH; janjang dimuat yang melebihi panen menandakan pencatatan panen kurang atau restan yang tidak tercatat.',
    signals: 'Janjang dimuat/terjual lebih besar dari janjang dipanen; jjg dipanen berbeda dengan total janjang di tabel produksi.',
    topics: ['alurjjg', 'anomali'],
    when: d => { const F = d.flow; if (!F) return null;
      if (F.overSold) return { evidence: `janjang terjual ${fmt(F.overSoldPct, 1)}% lebih banyak dari janjang dipanen; input panen belum lengkap`, priority: 'tinggi' };
      const ex = F.steps.find(x => x.excess);
      if (ex) return { evidence: `janjang ${ex.to.toLowerCase()} melebihi ${ex.from.toLowerCase()} ${fmt(-ex.gap, 0)} jjg (${fmt(-ex.pct, 1)}%)`, priority: 'sedang' };
      return F.panenVsTotal > 2 ? { evidence: `jjg dipanen berbeda ${fmt(F.panenVsTotal, 0)}% dari total janjang tabel produksi`, priority: 'sedang' } : null; } },

  { code: 'R20', title: 'Input data penjualan setiap trip',
    action: 'Input berat dari tiket timbang PKS/agen untuk setiap trip di hari yang sama; admin mengecek tiap minggu trip yang belum ada data penjualannya.',
    signals: 'Ada janjang yang sudah keluar kebun tetapi data penjualannya (berat) belum diinput dalam porsi berarti.',
    topics: ['tanpaberat', 'bjr'],
    when: d => { const N = d.noWeight; return N && N.share > DECK_CONFIG.THRESHOLDS.NOWEIGHT_PCT
      ? { evidence: `data penjualan ${fmt(N.share, 0)}% janjang belum diinput (${fmt(N.nwSum, 0)} jjg${N.rpSum ? ` ≈ ${fmtRp(N.rpSum)}` : ''})`, priority: N.share > 20 ? 'tinggi' : 'sedang' } : null; } },

  { code: 'R21', title: 'Telusuri blok yang tidak tercatat menjual',
    action: 'Cek per blok apakah janjang dipanen, tertinggal di TPH, atau dijual tanpa dicatat blok asalnya; tetapkan pengawasan blok tersebut.',
    signals: 'Blok yang sama berulang kali dipanen tetapi tidak tercatat menjual.',
    topics: ['blokunsale', 'alurjjg'],
    when: d => { const U = d.unsale; return U && U.chronic.length
      ? { evidence: `${U.chronic.length} blok${U.chronic.some(b => b.ha) ? ` (${fmt(U.chronic.reduce((a, b) => a + b.ha, 0), 1)} ha)` : ''} tanpa penjualan ≥ ${DECK_CONFIG.THRESHOLDS.UNSALE_MONTHS} bulan, mis. ${U.chronic.slice(0, 3).map(b => b.name).join(', ')}`, priority: 'tinggi' } : null; } },

  { code: 'R22', title: 'Lakukan uji tanah per jenis tanah',
    action: 'Ambil contoh tanah per blok atau kelompok blok sejenis, analisis pH, C-organik, N, P, K, Mg, dan KTK, lalu catat jenis tanah di data blok KebunPRO.',
    signals: 'Jenis tanah blok belum tercatat; dosis pupuk belum disesuaikan dengan tanah; produktivitas di bawah standar Marihat.',
    topics: ['tanah', 'pupuk', 'marihat'],
    when: d => { const S = d.soil; if (!S || !S.unknownHa) return null;
      return { evidence: `jenis tanah belum tercatat untuk ${S.unknownCount} blok (${fmt(S.unknownHa, 1)} ha, ${fmt(S.unknownPct, 0)}% luas)`,
               priority: S.unknownPct >= 50 || (d.marihat && d.marihat.reliable && d.marihat.achTon < 0.7) ? 'tinggi' : 'sedang' }; } },

  { code: 'R23', title: 'Pastikan status pupuk lewat uji daun dan tanah',
    action: 'Pohon terindikasi kurang atau kelebihan pupuk; ambil contoh daun (pelepah ke-17) dan tanah per kelompok blok sejenis untuk memastikan hara yang kurang atau berlebih sebelum mengubah dosis pupuk.',
    signals: 'STATUS PEMUPUKAN di paket = indikasi kurang pupuk atau indikasi kelebihan pupuk (hasil jauh di bawah standar Marihat, BJR rendah, dosis aktual menyimpang, atau pemupukan tidak tercatat).',
    topics: ['pupuk', 'marihat', 'bjr'],
    when: d => { const F = d.fertStatus; if (!F) return null;
      const blk = F.priorityBlocks && F.priorityBlocks.length ? `; mulai dari blok ${F.priorityBlocks.slice(0, 3).join(', ')}` : '';
      if (F.verdict === 'kurang' || F.verdict === 'berlebih') return { evidence: `${F.label.toLowerCase()}: ${F.reason}${blk}`, priority: 'tinggi' };
      if (F.verdict === 'belum') return { evidence: 'status pupuk belum dapat dinilai dari data kebun', priority: 'sedang' };
      return null; } },

  { code: 'R24', title: 'Sesuaikan pupuk dengan tanah dan umur',
    action: 'Terapkan dosis NPK per kelompok blok sesuai umur tanaman dan jenis tanah (rekomendasi umum di lampiran), konfirmasi dengan uji tanah/daun, lalu siapkan pengadaan pupuk sesuai kebutuhan setahun.',
    signals: 'Dosis NPK aktual di bawah atau di atas acuan; atau jenis tanah sudah tercatat dan rekomendasi NPK per kelompok blok sudah dihitung script.',
    topics: ['pupuk', 'tanah'],
    when: d => { const S = d.soil, N = d.npk; if (!N) return null;
      if (N.kurangHa) return { evidence: `dosis NPK ${fmt(N.actual, 1)} kg/pohon/tahun di bawah acuan untuk ${fmt(N.kurangHa, 1)} ha; risiko produksi turun`, priority: 'tinggi' };
      if (N.lebihHa) return { evidence: `dosis NPK ${fmt(N.actual, 1)} kg/pohon/tahun di atas acuan untuk ${fmt(N.lebihHa, 1)} ha${N.lebihRp ? ` (≈ ${fmtRp(N.lebihRp)}/tahun terbuang)` : ''}`, priority: 'tinggi' };
      return null; } },   // tanpa dosis aktual yang menyimpang, cukup R23 (uji daun & tanah) agar pesan tidak bertumpuk

  { code: 'R25', title: 'Cocokkan biaya perawatan yang melonjak',
    action: 'Cocokkan pekerjaan perawatan yang biayanya melonjak dengan bukti kerja (hari kerja, luas, bahan) dan perbaiki bila salah input sebelum dibayar atau dilaporkan.',
    signals: 'Biaya satu pekerjaan atau total upkeep satu bulan berlipat dari biasanya; total upkeep berbeda antar-tabel.',
    topics: ['upkeepakt', 'upkeep'],
    when: d => { const U = d.upkeepAnalysis; if (!U) return null;
      const s = U.spikes[0], ms = U.monthSpikes[0], x = U.crossMismatch[0];
      const inRep = s && U.cur && mkey(s.p) === mkey(U.cur.p);
      if (s) return { evidence: `${s.name} ${monthLong(s.p)} ${fmtRp(s.cost)}, ${s.ratio > 100 ? 'lebih dari 100×' : `${fmt(s.ratio, 0)}×`} median bulan lain (${fmtRp(s.median)})${U.spikes.length > 1 ? `; ${U.spikes.length - 1} lonjakan lain` : ''}`, priority: inRep || s.cost > 1e8 ? 'tinggi' : 'sedang' };
      if (ms) return { evidence: `total upkeep ${monthLong(ms.p)} ${fmtRp(ms.total)}${ms.perHa ? ` (${fmtRp(ms.perHa)}/ha)` : ''}`, priority: 'tinggi' };
      if (x) return { evidence: `total upkeep ${monthShort(x.p)} ${fmtRp(x.upkeep)} vs biaya perawatan di tabel biaya ${fmtRp(x.biaya)}`, priority: 'sedang' };
      return null; } },

  { code: 'R26', title: 'Gunakan RKH untuk memantau rotasi panen',
    action: 'Isi Rencana Kerja Harian (RKH) di KebunPRO setiap hari: ancak/blok yang akan dipanen dan dirawat. Bandingkan dengan panen aktual agar rotasi 7–10 hari per ancak terpantau dan blok yang terlewat terlihat.',
    signals: 'RKH belum diisi atau jarang diisi, sehingga rencana kerja belum bisa dibandingkan dengan rotasi panen di lapangan; produksi atau janjang per blok naik-turun.',
    topics: ['blokprod', 'jjg', 'produksi'],
    when: d => { const R = d.rkh, T = DECK_CONFIG.THRESHOLDS;
      const rot = d.blockProd && d.blockProd.rotasiRows && d.blockProd.rotasiRows.length ? `; ${d.blockProd.rotasiRows.length} blok jarang dipanen` : '';
      if (!R || !R.filled) return { evidence: `RKH belum diisi, rencana kerja belum bisa dibandingkan dengan rotasi panen aktual${rot}`, priority: 'tinggi' };
      if (R.coverage < T.RKH_MIN_COVERAGE || !R.cur) return { evidence: `RKH baru diisi ${R.filledMonths.length} dari ${R.months} bulan data${R.cur ? '' : ', bulan laporan belum diisi'}${rot}`, priority: 'tinggi' };
      if (R.cur.done !== null && R.cur.done < T.RKH_MIN_DONE) return { evidence: `RKH ${monthShort(R.cur.p)} selesai ${fmt(R.cur.completed, 0)} dari ${fmt(R.cur.created, 0)} (${fmt(R.cur.done * 100, 0)}%)${rot}`, priority: 'sedang' };
      return null; } },

  { code: 'R17', title: 'Pertahankan praktik yang sudah baik',
    action: 'Dokumentasikan praktik panen dan perawatan yang membuat kinerja naik agar tetap dijalankan.',
    signals: 'Yield atau produksi naik dan stabil; margin positif.',
    topics: ['yield', 'produksi', 'margin'],
    // tidak dipakai bila hasil masih jauh di bawah standar (kontradiktif dengan temuan lain)
    when: d => { const g = signals(d.yield); if (d.marihat && d.marihat.achTon < 0.7) return null; return g.trend === 'naik' ? { evidence: `yield ${g.trend} (bulan terakhir ${g.position})`, priority: 'sedang' } : null; } }
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
