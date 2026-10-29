/**
 * File 5: MainController.gs
 * Alur:
 *  1. Baca sheet (batas tabel = baris kosong pertama) + metrik turunan.
 *  2. Salin template, buat satu slide per topik dari slide master {{slide_title}}.
 *  3. Jawaban Claude dibaca dari sel D1, D2, ... sheet customer (ditempel pengguna; lihat file 4). Tanpa API.
 *  4. Gambar grafik/tabel/kartu dengan Google Slides API (batch per slide).
 *  5. Isi insight, speaker notes, KPI, daftar isi, nomor halaman.
 *
 * DECK UTAMA (7 slide, cara owner membaca laporan bulanan):
 *  Cover → Agenda & Tujuan Pertemuan → Kinerja Bulan Ini (empat pilar KPI: panen, penjualan & pendapatan, perawatan,
 *  produktivitas) → Temuan → Actionable Item → Struktur Biaya → Terima Kasih.
 * DATA PENDUKUNG: pembatas Lampiran, Daftar Data Pendukung, lalu per bagian (Kinerja, Alur Panen ke Muat Tidak Tercatat,
 *  Penyebab Naik-Turun Hasil, Keuangan, Tim Kerja): slide ringkasan bagian (GRAFIK KESIMPULAN, MAIN_SUMMARY) + lampiran A1–An.
 * Slide yang datanya kosong otomatis dilewati.
 */

function generateCustomerDeck() {
  RUN_WARNINGS = [];
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) return showErrorAlert('Error: Tidak ada Google Sheets aktif yang terbuka!');
  if (typeof Slides === 'undefined') {
    return showErrorAlert('Aktifkan layanan "Google Slides API": editor Apps Script > Services (+) > Google Slides API > Add.');
  }
  const sheet = ss.getActiveSheet();
  const data = loadSheetData(sheet);   // data kebun + target owner; sel jawaban Claude (D1, D2, ...) disembunyikan
  const missing = checkDataCompleteness(data);
  if (missing.length) RUN_WARNINGS.push(`Data belum ada di sheet (slide terkait dilewati atau ditandai): ${missing.join(', ')}.`);
  if (!data.yield.length) return showErrorAlert(`Header 'ton/ha' tidak ditemukan di sheet '${sheet.getName()}'.`);

  // 1. Rencana deck + jawaban Claude dari sel D1, D2, ... (dibaca SEBELUM template disalin, agar bisa dibatalkan tanpa file sisa)
  const plan = planDeck(data);
  const loaded = loadClaudeAnswer(sheet, data, plan);
  if (loaded.abort) return;
  const ai = loaded.ai;   // null = teks cadangan dari data

  // 2. Salin template
  const templateFile = getTemplateFile();
  // Folder tujuan: OUTPUT_FOLDER_ID -> folder template -> My Drive user yang menjalankan (jika tidak punya akses edit)
  let folder = null;
  try {
    if (DECK_CONFIG.OUTPUT_FOLDER_ID) folder = DriveApp.getFolderById(DECK_CONFIG.OUTPUT_FOLDER_ID);
    else { const parents = templateFile.getParents(); folder = parents.hasNext() ? parents.next() : null; }
  } catch (e) { folder = null; }
  // Nama file memakai nama sheet (unik), karena beberapa customer bisa punya Title yang sama
  const deckName = `${data.sheetName} - Monthly Report KebunPRO`;
  let newFile;
  try {
    newFile = templateFile.makeCopy(deckName, folder || DriveApp.getRootFolder());
  } catch (e) {
    newFile = templateFile.makeCopy(deckName, DriveApp.getRootFolder());
    RUN_WARNINGS.push(`Tidak punya akses edit ke folder tujuan; deck disimpan di My Drive ${Session.getActiveUser().getEmail() || 'Anda'}.`);
  }
  shareDeckWithSheetUsers(newFile, ss);
  const presId = newFile.getId();
  let pres = SlidesApp.openById(presId);

  const coverTitle = data.title || data.sheetName;
  ['{{TITLE}}', '{{title}}'].forEach(p => pres.replaceAllText(p, coverTitle));
  fitCoverTitle(pres, coverTitle);
  const coverPeriod = (DECK_CONFIG.COVER_PERIOD_SOURCE === 'data' && data.dataPeriod) ? data.dataPeriod : (data.period || data.dataPeriod || '');
  ['{{PERIOD}}', '{{period}}'].forEach(p => pres.replaceAllText(p, coverPeriod || '-'));
  if (data.location) pres.replaceAllText('{{location}}', data.location);
  else pres.replaceAllText('Lokasi: {{location}}', ' ');   // baris lokasi dihilangkan bila tidak dicatat
  const master = findSlideByPlaceholder(pres, '{{slide_title}}');
  if (!master) return showErrorAlert('Slide master {{slide_title}} tidak ditemukan. Jalankan menu "Siapkan Template SawitPRO" terlebih dahulu.');
  const sectionMaster = findSlideByPlaceholder(pres, '{{section_title}}');   // template CBR: slide pembatas bagian

  // Topik detail (lampiran), slide ringkasan owner (deck utama), dan urutannya sudah ditetapkan di planDeck()
  const topics = plan.topics, anomTopic = plan.anomTopic, conclTopic = plan.conclTopic, costMain = plan.costMain;
  const mains = plan.mains, leads = plan.leads, appendix = plan.appendix;

  // Slide template
  const coverSlide = pres.getSlides()[0];
  const tocSlide = findSlideByPlaceholder(pres, 'Daftar Isi') || findSlideByPlaceholder(pres, 'Table of Contents');
  if (tocSlide) removeShapeWithText(tocSlide, '{{toc}}');
  const introSlide = findSlideByPlaceholder(pres, '{{ai_description}}');
  const closingSlide = findSlideByPlaceholder(pres, 'Terima Kasih') || findSlideByPlaceholder(pres, 'Thank You');
  const legacyKpiCards = !!findSlideByPlaceholder(pres, '{{kpi1_value}}');   // template lama: 4 kartu tetap

  // Buat semua slide dari master, lalu susun ulang urutannya
  const dup = item => { item.slide = master.duplicate(); item.pageId = item.slide.getObjectId(); };
  mains.forEach(dup);
  mains.forEach(m => { if (m.lead) m.lead.pageId = m.pageId; });   // topik lead tampil di slide utama
  [anomTopic, conclTopic, costMain].filter(Boolean).forEach(dup);
  appendix.forEach(dup);
  // Slide 3 = Kinerja Bulan Ini (empat pilar KPI); template lama menamainya Ringkasan Eksekutif
  if (introSlide) introSlide.replaceAllText('Ringkasan Eksekutif', `Kinerja Bulan Ini${data.reportP ? ` · ${monthLong(data.reportP)}` : ''}`);
  // Slide Agenda & Tujuan Pertemuan (slide 2): dari master konten, tanpa kartu INSIGHT
  const agendaSlide = master.duplicate();
  removeInsightCard(agendaSlide);
  agendaSlide.replaceAllText('{{slide_title}}', 'Agenda & Tujuan Pertemuan');
  let lampDivider = null;
  if (sectionMaster) {
    lampDivider = { slide: sectionMaster.duplicate() };
    lampDivider.pageId = lampDivider.slide.getObjectId();
    lampDivider.slide.replaceAllText('{{section_label}}', 'Lampiran');
    lampDivider.slide.replaceAllText('{{section_title}}', 'Data Pendukung');
    lampDivider.slide.replaceAllText('{{section_desc}}', `Ringkasan tiap bagian dan detail A1–A${appendix.length} di balik setiap angka`);
    fitSectionLabel(lampDivider.slide, 'Lampiran');
  }
  // Judul slide ({{slide_title}}) diisi setelah AI menjawab: judul berupa jawaban, bukan nama topik.
  [anomTopic, conclTopic].filter(Boolean).forEach(t => removeInsightCard(t.slide));   // slide lebar penuh: tanpa kartu INSIGHT
  if (tocSlide) tocSlide.replaceAllText('Daftar Isi', 'Daftar Data Pendukung');

  // Deck utama: Kinerja Bulan Ini → Temuan → Actionable Item → Struktur Biaya → Terima Kasih; lalu data pendukung
  const finalOrder = [coverSlide, agendaSlide, introSlide]
    .concat([anomTopic, conclTopic, costMain].filter(Boolean).map(t => t.slide))
    .concat([closingSlide, lampDivider && lampDivider.slide, tocSlide]).concat(plan.support.map(t => t.slide)).filter(Boolean);
  finalOrder.forEach((sl, i) => sl.move(i));
  master.remove();
  if (sectionMaster) sectionMaster.remove();

  const introPageId = introSlide ? introSlide.getObjectId() : null;
  const agendaPageId = agendaSlide.getObjectId();
  const tocPageId = tocSlide ? tocSlide.getObjectId() : null;
  const order = pres.getSlides().map(x => x.getObjectId());
  const pageOfId = id => order.indexOf(id) + 1;
  const allPaged = appendix.concat(mains).concat(leads).concat([anomTopic, conclTopic, costMain].filter(Boolean));
  allPaged.forEach(t => { t.page = pageOfId(t.pageId); });
  // Nomor slide di jawaban Claude mengikuti rencana paket; bila template berbeda dari rencana, beri tahu pengguna
  if (allPaged.some(t => t.plannedPage !== t.page)) {
    RUN_WARNINGS.push('Susunan slide template berbeda dari rencana paket, sehingga nomor slide pada jawaban Claude (temuan, rekomendasi, kalimat penghubung) bisa bergeser. Jalankan "Siapkan Template SawitPRO", lalu buat paket baru.');
  }
  const pageOf = id => { const t = topics.find(x => x.id === id); return t ? t.page : null; };
  // Tautan ke slide bukti: nomor halaman -> {pageId, label}
  const linkOf = pg => { const t = appendix.find(x => x.page === pg) || mains.find(x => x.page === pg);
    return t ? { pageId: t.pageId, label: t.appx ? `→ Lampiran ${t.appx}` : `→ hlm ${t.page}` } : null; };
  pres.saveAndClose();

  // 3. Rekomendasi & temuan: jawaban Claude bila ada, selain itu cadangan dari data
  const detected = detectAnomalies(topics, data);
  const candidates = detectRecommendations(data, topics, detected);
  const actions = (ai && ai.conclusion && ai.conclusion.actions.length >= 2) ? ai.conclusion.actions
    : (candidates.length ? fallbackActionsFromCatalog(candidates) : fallbackActions(data, pageOf));
  attachProducts(actions);   // rekomendasi cadangan: produk SawitPRO dicocokkan dari kode rekomendasi
  const anomalyRows = (ai && ai.anomalies && ai.anomalies.length) ? ai.anomalies : fallbackAnomalies(detectAnomalies(topics, data));
  // Agenda mengikuti susunan deck (tetap); dari Claude hanya hasil yang dituju dan catatan presenter
  const agenda = fallbackAgenda(plan);
  if (ai && ai.agenda && ai.agenda.outcomes.length) { agenda.outcomes = ai.agenda.outcomes; agenda.notes = ai.agenda.notes; }
  // Nomor slide -> pageId (untuk judul agenda yang dapat diklik)
  const fixedIds = [introPageId, closingSlide && closingSlide.getObjectId(), lampDivider && lampDivider.pageId].filter(Boolean);
  const pageIdOf = pg => { const f = fixedIds.find(id => pageOfId(id) === pg); if (f) return f;
    const t = mains.concat([anomTopic, conclTopic, costMain].filter(Boolean)).concat(appendix).find(x => x.page === pg); return t ? t.pageId : null; };
  const mainText = m => {
    const r = ai && ai.summaries && ai.summaries[m.id];
    const h = r && r.headline;
    return {
      headline: (h && titleFits(h) ? h : '') || dataHeadline(m.id, data) || m.title,
      insight: (r && r.insight) || (m.structure ? fallbackCostInsight(m.structure) : fallbackMainInsight(m)),
      notes: (r && r.speaker_notes) || (m.structure ? `${m.structure.facts}` : fallbackMainNotes(m))
    };
  };

  // 4. Gambar grafik / tabel / kartu / tombol
  const safeDraw = (label, pageId, prefix, fn) => {
    try { const b = new SlideBatch(pageId, prefix); fn(b); b.flush(presId); }
    catch (e) { Logger.log(`Gambar '${label}' gagal: ${e.stack || e.message}`); RUN_WARNINGS.push(`Visual "${label}" gagal dibuat: ${e.message}`); }
  };
  mains.concat(costMain ? [costMain] : []).forEach(m => safeDraw(m.title, m.pageId, m.id, b => {
    // Slide ringkasan = grafik KESIMPULAN (bulan laporan vs pembanding), bukan salinan grafik lampiran
    if (m.structure) drawCostStructure(b, m.structure);
    else if (m.summary) drawCompareRows(b, m.summary);
    else m.chartTopic.draw(b, ai);
    const mt = mainText(m);
    const ins = stripBold(mt.insight).trim(), I = DECK_CONFIG.LAYOUT.INSIGHT;
    drawDetailButtons(b, m.members.map(t => ({ pageId: t.pageId, label: `Lampiran ${t.appx} · ${shortTitle(t)} →`, short: `${t.appx} ${shortTitle(t)}` })),
      ins ? I.top + insightCardHeight(ins) + DECK_CONFIG.LAYOUT.CARD_GAP : I.top);   // tanpa insight: tombol mulai di atas
  }));
  safeDraw('Agenda', agendaPageId, 'agenda', b => drawAgenda(b,
    agenda.items.map(it => Object.assign({}, it, { pageId: pageIdOf((it.pages || [])[0]) })), agenda.outcomes));
  if (anomTopic) safeDraw(anomTopic.title, anomTopic.pageId, 'anomali', b => drawAnomalyTable(b, anomalyRows, linkOf));
  if (conclTopic) safeDraw(conclTopic.title, conclTopic.pageId, 'kesimpulan', b => drawConclusionCards(b, actions, linkOf));
  appendix.forEach(t => safeDraw(t.title, t.pageId, t.id, b => {
    t.draw(b, ai);
    drawBackButtons(b, t.mainOf ? { label: `← ${t.mainOf.title}`, pageId: t.mainOf.pageId, primary: true } : null,
      tocPageId ? { label: 'Daftar lampiran', pageId: tocPageId } : null);
  }));
  if (tocPageId) safeDraw('Daftar Lampiran', tocPageId, 'toc', b => drawAppendixIndex(b, mains.map(m => ({
    title: `${m.title} · hlm ${m.page}`, pageId: m.pageId, items: m.members.filter(t => t.mainOf === m).map(t => ({ code: t.appx, title: shortTitle(t, true), page: t.page, pageId: t.pageId })) }))
    .concat([{ title: 'Lainnya', items: appendix.filter(t => !t.mainOf).map(t => ({ code: t.appx, title: t.title, page: t.page, pageId: t.pageId })) }])));

  const leadText = (ai && ai.executive_summary) || fallbackSummary(data);
  if (introPageId && !legacyKpiCards) {
    safeDraw('Kartu KPI', introPageId, 'kpi', b => {
      // empat pilar mulai space-section-gap di bawah paragraf pembuka (2–4 baris) dan mengisi sisa tinggi
      const L = DECK_CONFIG.LAYOUT, T = DECK_CONFIG.TYPE;
      const leadLines = Math.min(4, Math.max(2, estLines(stripBold(leadText), T.LEAD, L.RIGHT - L.MARGIN)));
      drawPillarCards(b, computePillars(data), L.BODY_TOP + leadLines * T.LEAD * 1.55 + L.SECTION_GAP);
    });
  } else if (legacyKpiCards) {
    RUN_WARNINGS.push('Template masih versi lama (4 kartu KPI tetap). Jalankan "Siapkan Template SawitPRO" agar jumlah kartu mengikuti DECK_CONFIG.KPIS.');
  }

  // 5. Teks
  pres = SlidesApp.openById(presId);
  mains.concat(costMain ? [costMain] : []).forEach(m => {
    const slide = pres.getSlideById(m.pageId);
    if (!slide) return;
    const mt = mainText(m);
    slide.replaceAllText('{{slide_title}}', mt.headline);
    writeInsight(slide, mt.insight);
    setSlideSpeakerNotes(slide, `${mt.notes}` + (m.members.length ? `\n\nDetail di lampiran: ${m.members.map(t => `${t.appx} ${t.title} (hlm ${t.page})`).join('; ')}.` : ''));
  });
  [anomTopic, conclTopic].filter(Boolean).forEach(t => {
    const slide = pres.getSlideById(t.pageId);
    if (!slide) return;
    slide.replaceAllText('{{slide_title}}', t.kind === 'anomali' ? anomalyHeadline(anomalyRows, t.title) : conclusionHeadline(actions, t.title));
    if (t.kind === 'anomali') setSlideSpeakerNotes(slide, (ai && ai.anomaly_notes) ||
      anomalyRows.map((a, i) => `${i + 1}. ${a.finding}: ${a.evidence} ${a.argument} Tindak lanjut: ${a.follow_up}`).join('\n'));
    else setSlideSpeakerNotes(slide, ((ai && ai.conclusion.speaker_notes) ||
      `Rekomendasi untuk owner: ${actions.map((a, i) => `${i + 1}. ${a.title}. ${a.detail}`).join(' ')}`) +
      `\n\nRingkasan rekomendasi:\n${actions.map((a, i) => `${i + 1}. [${a.code || '-'}] ${a.title} | dampak: ${a.impact || '-'} | waktu: ${a.timeline || '-'}${a.evidence ? ` | bukti: ${a.evidence}` : ''}`).join('\n')}`);
  });
  appendix.forEach(t => {
    const slide = pres.getSlideById(t.pageId);
    if (!slide) return;
    const r = ai && ai.byId[t.id];
    const useAi = r && r.insight && !r.mismatch;   // AI ditolak bila tren yang dipilih bertentangan dengan sinyal data
    // Judul lampiran = jawaban (AI) -> judul otomatis dari data -> nama topik. Daftar Lampiran tetap memakai nama topik.
    slide.replaceAllText('{{slide_title}}', (useAi && r.headline) || dataHeadline(t.id, data) || t.title);
    const insightText = useAi ? r.insight : t.fallback;
    writeInsight(slide, insightText);
    slide.replaceAllText('Materi Milik SawitPRO', `Lampiran ${t.appx} · Materi Milik SawitPRO`);
    const g = t.signal;
    const head = [r && r.status ? `Status: ${r.status}` : null, g ? `Tren: ${g.trend}` : null, g && g.position !== 'data kurang' ? `Bulan terakhir: ${g.position}` : null]
      .filter(Boolean).join(' · ');
    setSlideSpeakerNotes(slide, `Lampiran ${t.appx}${t.mainOf ? ` (detail dari slide ${t.mainOf.page} "${t.mainOf.title}")` : ''}\n${head ? head + '\n' : ''}` +
      `Penghubung: ${(r && r.bridge) || fallbackBridge(t)}\n\n${(useAi && r.speaker_notes) || fallbackNotes(t)}`);
  });
  if (lampDivider) {
    const sl = pres.getSlideById(lampDivider.pageId);
    if (sl) setSlideSpeakerNotes(sl, `Lampiran berisi ${appendix.length} slide detail sebagai bukti setiap ringkasan. Buka lewat tombol "Lampiran …" di slide ringkasan, atau lewat Daftar Lampiran.`);
  }
  const tocS = tocPageId ? pres.getSlideById(tocPageId) : null;
  if (tocS) setSlideSpeakerNotes(tocS, `Daftar Lampiran: klik kode atau judul untuk membuka slide detail; setiap slide lampiran punya tombol untuk kembali ke ringkasannya.\n` +
    mains.filter(m => m.members.length).map(m => `${m.title} (slide ${m.page}): ${m.members.map(t => `${t.appx} ${t.title}`).join(', ')}`).join('\n'));
  const agendaS = pres.getSlideById(agendaPageId);
  if (agendaS) setSlideSpeakerNotes(agendaS, agenda.notes ||
    `Pertemuan ini membahas ${agenda.items.map(it => it.title.toLowerCase()).join(', ')}. Hasil yang dituju: ${agenda.outcomes.map((o, i) => `${i + 1}) ${o}`).join(' ')}`);
  const intro = introPageId ? pres.getSlideById(introPageId) : null;
  if (intro) setSlideSpeakerNotes(intro, (ai && ai.intro_notes) || fallbackIntroNotes(data, mains));
  // paragraf pembuka: angka kunci ditebalkan (**...**), tinggi kotak mengikuti 2–4 baris
  if (intro) writeWithBold(intro, '{{ai_description}}', leadText);
  if (legacyKpiCards) computeKpis(data, 4).forEach((k, i) => {
    pres.replaceAllText(`{{kpi${i + 1}_value}}`, k.value);
    pres.replaceAllText(`{{kpi${i + 1}_unit}}`, k.unit || ' ');
    pres.replaceAllText(`{{kpi${i + 1}_label}}`, k.note || k.name || ' ');
  });
  pres.getSlides().forEach((s, i) => s.replaceAllText('{{page}}', String(i + 1)));

  pres.saveAndClose();
  showSuccessModal(newFile.getUrl(), data.title || data.sheetName, !!ai);
}

/* ------------------------------------------------------------------------- */
/* Data + target owner, KPI berpembanding, agenda cadangan, produk SawitPRO   */
/* ------------------------------------------------------------------------- */

/**
 * Baca data kebun (sel jawaban Claude disembunyikan) + TARGET OWNER opsional
 * (label di satu sel, nilai tepat di kanannya; lihat DECK_CONFIG.HEADERS.TARGET_*).
 */
function loadSheetData(sheet) {
  const view = maskedSheetView(sheet);
  const d = getSheetData(view);
  // Nilai ASLI sel (bukan tampilan): pada locale Indonesia angka 1200 tampil "1.200" dan akan terbaca 1,2.
  const H = DECK_CONFIG.HEADERS, values = view.getDataRange().getValues();
  const num = aliases => {
    const c = aliases ? findCell(values, aliases) : null;
    if (!c) return null;
    const v = values[c.r][c.c + 1];
    const n = typeof v === 'number' ? v : parseNum(v);
    return n && n > 0 ? n : null;
  };
  d.targets = { tbs: num(H.TARGET_TBS), yield: num(H.TARGET_YIELD), bjr: num(H.TARGET_BJR), revenue: num(H.TARGET_REVENUE) };
  // Pemupukan (opsional): dosis NPK aktual & harga NPK -> rekomendasi NPK dinilai ulang (kurang/sesuai/berlebih)
  d.npkActual = num(H.NPK_ACTUAL); d.npkPrice = num(H.NPK_PRICE);
  // Tabel hara vegetatif per umur dari sheet "pupuk" di spreadsheet yang sama (bila ada), lalu hitung ulang rencana pupuk
  try { d.haraSheetRows = readHaraVegetatif(sheet.getParent ? sheet.getParent() : null); } catch (e) { d.haraSheetRows = 0; }
  d.fertilizer = buildFertilizerNeed(d);
  d.npk = d.fertilizer;
  d.fertStatus = buildFertilizerStatus(d);
  return d;
}

function kpiDelta(cur, ref) { return cur !== null && cur !== undefined && ref ? ((cur - ref) / Math.abs(ref)) * 100 : null; }
function arrowPct(p) { return p === null ? '' : p > 400 ? `▲ ${fmt(p / 100 + 1, 0)}×` : `${p >= 0 ? '▲' : '▼'} ${fmt(Math.abs(p), 0)}%`; }   // naik > 5 kali: "▲ 20×"
/** 'good' | 'bad' | 'neutral' dari selisih (%) dan arah yang baik (naik baik = true). */
function toneOf(p, goodUp) { if (p === null || Math.abs(p) < 1) return 'neutral'; return (p > 0) === goodUp ? 'good' : 'bad'; }
/** Realisasi vs target: catatan & warna. */
function vsTarget(value, target, unitTxt, f) {
  const ach = (value / target) * 100;
  return { note: `Target ${f(target)}${unitTxt} · tercapai ${fmt(ach, 0)}%`, tone: ach >= 100 ? 'good' : ach >= 90 ? 'neutral' : 'bad' };
}

/**
 * Kartu KPI Ringkasan Eksekutif: realisasi + PEMBANDING di bawahnya. Pembanding = target owner bila diisi di sheet;
 * bila kosong = bulan sebelumnya (TBS, pendapatan, laba) atau rata-rata periode (yield, BJR). Mengembalikan {name, value, unit, note, tone} atau null bila datanya tidak ada.
 */
/** Bulan awal yang belum penuh (ramp) tidak ikut rata-rata pembanding KPI. */
function kpiSeries(d, s) { return (s || []).filter(x => !d.rampMonth || mkey(x.p) !== d.rampMonth); }
/** Porsi janjang yang data penjualannya (berat) belum diinput bulan p (%) dan estimasi tonase bila semua diinput. */
function noWeightAt(d, p) {
  const x = d.noWeight && d.noWeight.monthly.find(m => mkey(m.p) === mkey(p));
  return x && x.share !== null ? { share: x.share, extraTon: x.ton } : null;
}

const OWNER_KPIS = {
  produksi_total: d => {
    const s = seriesStats(d.produksi);
    if (!s) return null;
    const f = x => fmt(x, x < 100 ? 1 : 0), v = s.last.value;
    const k = { name: `${d.produksiActual ? 'TBS terjual' : 'Estimasi produksi'} ${monthShort(s.last.p)}`, value: f(v), unit: 'ton' };
    // Data penjualan sebagian besar janjang belum diinput: tonase tercatat terlalu kecil -> jangan dibandingkan naik/turun
    const nw = d.produksiActual ? noWeightAt(d, s.last.p) : null;
    if (nw && nw.share > DECK_CONFIG.THRESHOLDS.KPI_NOWEIGHT_PCT) return Object.assign(k, { tone: 'neutral',
      note: `Penjualan ${fmt(nw.share, 0)}% janjang belum diinput${nw.extraTon ? ` (±${f(v + nw.extraTon)} ton bila lengkap)` : ''}` });
    if (d.targets && d.targets.tbs) return Object.assign(k, vsTarget(v, d.targets.tbs, ' ton', f));
    if (s.prev) { const p = kpiDelta(v, s.prev.value); return Object.assign(k, { note: `${arrowPct(p)} vs ${monthShort(s.prev.p)} (${f(s.prev.value)} ton)`, tone: toneOf(p, true) }); }
    return Object.assign(k, { note: 'Belum ada bulan pembanding', tone: 'neutral' });
  },
  yield_rata2: d => {
    const s = seriesStats(kpiSeries(d, d.yield));
    if (!s) return null;
    const f = x => fmt(x, 2), v = s.last.value;
    const k = { name: `Yield ${monthShort(s.last.p)}`, value: f(v), unit: 'ton/ha' };
    const nw = noWeightAt(d, s.last.p);
    if (nw && nw.share > DECK_CONFIG.THRESHOLDS.KPI_NOWEIGHT_PCT) return Object.assign(k, { tone: 'neutral',
      note: `Dari penjualan yang sudah diinput; ${fmt(nw.share, 0)}% janjang belum diinput` });
    if (d.targets && d.targets.yield) return Object.assign(k, vsTarget(v, d.targets.yield, ' ton/ha', f));
    if (s.n > 1) { const p = kpiDelta(v, s.avg); return Object.assign(k, { note: `${arrowPct(p)} vs rata-rata ${s.n} bulan (${f(s.avg)})`, tone: toneOf(p, true) }); }
    return Object.assign(k, { note: 'Belum ada bulan pembanding', tone: 'neutral' });
  },
  bjr_rata2: d => {
    const src = d.bjr && d.bjr.some(x => x.value !== null) ? d.bjr : (d.bjrSoldMonthly || []);
    const s = seriesStats(kpiSeries(d, src));
    if (!s) return null;
    const f = x => fmt(x, 1), v = s.last.value;
    const k = { name: `BJR ${monthShort(s.last.p)}`, value: f(v), unit: 'kg/janjang' };
    if (d.targets && d.targets.bjr) return Object.assign(k, vsTarget(v, d.targets.bjr, ' kg', f));
    if (s.n > 1) { const p = kpiDelta(v, s.avg); return Object.assign(k, { note: `${arrowPct(p)} vs rata-rata ${s.n} bulan (${f(s.avg)} kg)`, tone: toneOf(p, true) }); }
    return Object.assign(k, { note: 'Belum ada bulan pembanding', tone: 'neutral' });
  },
  pendapatan_bulan_terakhir: d => {
    const s = seriesStats(d.revenueTotal);
    if (!s) return null;
    const r = rpParts(s.last.value), k = { name: `Pendapatan ${monthShort(s.last.p)}`, value: r.value, unit: r.unit };
    if (d.targets && d.targets.revenue) return Object.assign(k, vsTarget(s.last.value, d.targets.revenue, '', x => fmtRpShort(x)));
    if (s.prev) { const p = kpiDelta(s.last.value, s.prev.value); return Object.assign(k, { note: `${arrowPct(p)} vs ${monthShort(s.prev.p)} (${fmtRpShort(s.prev.value)})`, tone: toneOf(p, true) }); }
    return Object.assign(k, { note: 'Belum ada bulan pembanding', tone: 'neutral' });
  },
  pencapaian_marihat: d => {
    const M = d.marihat;
    if (!M) return null;
    return { name: `Vs standar Marihat ${M.cls}`, value: fmtPct(M.achTon * 100, 0), unit: '',
             note: `${fmt(M.realTonHa, 1)} vs potensi ${fmt(M.pot.ton, 1)} ton/ha/tahun${M.reliable === false ? ` · data ${M.nMonths} bln, indikatif` : ''}`,
             tone: M.reliable === false ? 'neutral' : M.achTon >= 0.9 ? 'good' : 'bad' };
  },
  // Alur panen -> muat/jual yang tidak tercatat, BULAN LAPORAN (bukan kumulatif), dibandingkan bulan sebelumnya.
  // Umumnya karena data belum diinput, jadi disebut "belum tercatat", bukan kerugian.
  kebocoran_janjang: d => {
    const F = d.flow, lim = DECK_CONFIG.THRESHOLDS.FLOW_LOSS_PCT;
    if (!F) return null;
    const c = F.cur || F, p = F.cur ? F.prev : null;
    const mon = c.p ? ` ${monthShort(c.p)}` : '';
    if (c.overSold) return { name: `Alur panen tak tercatat${mon}`, value: '–', unit: 'belum terukur', note: 'Terjual melebihi dipanen; input panen belum lengkap', tone: 'bad' };
    const pend = c.pendingJjg ? ` · ${fmt(c.pendingJjg, 0)} jjg panen${mon} belum tercatat terjual` : '';
    if (!c.lossJjg) return c.pendingJjg && c.pendingPct > lim
      ? { name: `Belum tercatat terjual${mon}`, value: fmt(c.pendingJjg, 0), unit: 'jjg', note: `${fmt(c.pendingPct, 0)}% dari dipanen · pastikan muat & jual diinput`, tone: 'neutral' }
      : { name: `Belum tercatat >1 bln${mon}`, value: '0', unit: 'jjg', note: `Panen lama sudah tercatat terjual${pend}`, tone: 'good' };
    const bad = c.lossPct > lim;
    const prevOk = p && !p.overSold && p.lossRp !== null && p.lossRp !== undefined;
    if (c.lossRp) {
      const r = rpParts(c.lossRp, 1);
      if (prevOk && p.lossRp) {
        const ch = kpiDelta(c.lossRp, p.lossRp);
        return { name: `Nilai belum tercatat${mon}`, value: r.value, unit: r.unit,
                 note: `${fmt(c.lossJjg, 0)} jjg belum tercatat >1 bln · ${arrowPct(ch)} vs ${monthShort(p.p)} (${fmtRpShort(p.lossRp)})`, tone: bad || toneOf(ch, false) === 'bad' ? 'bad' : 'good' };
      }
      return { name: `Nilai belum tercatat${mon}`, value: r.value, unit: r.unit, note: `${fmt(c.lossJjg, 0)} jjg belum tercatat >1 bln${pend}`, tone: bad ? 'bad' : 'good' };
    }
    return { name: `Belum tercatat >1 bln${mon}`, value: fmt(c.lossJjg, 0), unit: 'jjg', note: `${fmt(c.lossPct, 0)}% · batas wajar ≤ ${lim}%`, tone: bad ? 'bad' : 'good' };
  },
  laba_bulan_terakhir: d => {
    const s = seriesStats(d.profit);
    if (!s) return null;
    const r = rpParts(s.last.value), k = { name: `Laba kotor ${monthShort(s.last.p)}`, value: r.value, unit: r.unit };
    if (s.prev) { const p = kpiDelta(s.last.value, s.prev.value); return Object.assign(k, { note: `${arrowPct(p)} vs ${monthShort(s.prev.p)} (${fmtRpShort(s.prev.value)})`, tone: toneOf(p, true) }); }
    return Object.assign(k, { note: 'Pendapatan − biaya pekerja', tone: 'neutral' });
  },
  tanpa_berat: d => {
    const N = d.noWeight, lim = DECK_CONFIG.THRESHOLDS.NOWEIGHT_PCT;
    if (!N) return null;
    return { name: 'Penjualan belum diinput', value: `${fmt(N.share, 0)}%`, unit: '',
             note: `Batas wajar ≤ ${lim}%${N.rpSum ? ` · ±${fmtRpShort(N.rpSum)}` : ''}`, tone: N.share > lim ? 'bad' : 'good' };
  },
  biaya_per_kg: d => {
    const s = seriesStats(d.upahKg), h = seriesStats(d.hargaJual && d.hargaJual.length ? d.hargaJual : d.revKg);
    if (!s) return null;
    const share = h && h.last.value ? (s.last.value / h.last.value) * 100 : null;
    return { name: `Biaya pekerja ${monthShort(s.last.p)}`, value: fmt(s.last.value, 0), unit: 'Rp/kg',
             note: share !== null ? `${fmt(share, 0)}% dari harga jual Rp${fmt(h.last.value, 0)}/kg` : 'Harga jual belum tersedia', tone: 'neutral' };
  }
};

/** Kartu KPI sesuai DECK_CONFIG.KPIS; KPI tanpa data diganti KPI lain yang datanya ada. */
function computeOwnerKpis(data) {
  const keys = DECK_CONFIG.KPIS || [];
  const n = Math.max(3, Math.min(6, keys.length || 4));
  const lib = (typeof KPI_LIBRARY !== 'undefined') ? KPI_LIBRARY : {};
  const get = k => { try { return (OWNER_KPIS[k] ? OWNER_KPIS[k](data) : (lib[k] ? lib[k](data) : null)) || null; } catch (e) { return null; } };
  const kpis = keys.map(get).filter(Boolean);
  Object.keys(OWNER_KPIS).concat(Object.keys(lib)).forEach(k => {
    if (kpis.length < n && keys.indexOf(k) < 0) { const v = get(k); if (v && !kpis.some(x => x.name === v.name)) kpis.push(v); }
  });
  while (kpis.length < n) kpis.push({ name: 'Data', value: '-', unit: '', note: 'Data belum tersedia', tone: 'neutral' });
  // Kartu yang angkanya dari bulan sebelum bulan laporan (bulan laporan belum tercatat) diberi keterangan jelas
  const rep = data.reportP ? monthShort(data.reportP) : null;
  kpis.forEach(k => {
    const m = String(k.name || '').match(/([A-Z][a-z]{2} \d{2})$/);
    if (rep && m && m[1] !== rep) k.note = `${rep} belum tercatat · ${k.note || ''}`.replace(/ · $/, '');
  });
  return kpis.slice(0, n);
}

/**
 * KINERJA BULAN INI (slide 3): empat pilar yang ditanyakan owner setiap bulan, masing-masing satu angka utama dan
 * satu angka pendukung, selalu dengan pembanding:
 *   PANEN (berapa ton TBS, seberapa berat tandannya) · PENJUALAN & PENDAPATAN (berapa uang masuk, di harga berapa)
 *   PERAWATAN (berapa biaya perawatan, untuk pekerjaan apa) · PRODUKTIVITAS (hasil per ha, dibanding standar umurnya)
 * slots: tiap slot = daftar KPI alternatif; dipakai yang pertama datanya ada.
 */
const PILLARS = [
  { key: 'panen', title: 'Panen', slots: [['produksi_total'], ['bjr_rata2']] },
  { key: 'jual', title: 'Penjualan & Pendapatan', slots: [['pendapatan_bulan_terakhir'], ['harga_jual']] },
  { key: 'rawat', title: 'Perawatan', slots: [['biaya_perawatan'], ['perawatan_terbesar']] },
  { key: 'produktivitas', title: 'Produktivitas', slots: [['yield_rata2'], ['pencapaian_marihat']] }
];

/** KPI tambahan untuk pilar (KPI lain memakai OWNER_KPIS). */
const PILLAR_KPIS = {
  harga_jual: d => {
    const s = seriesStats(d.hargaJual && d.hargaJual.length ? d.hargaJual : d.revKg);
    if (!s) return null;
    const k = { name: `Harga jual ${monthShort(s.last.p)}`, value: fmt(s.last.value, 0), unit: 'Rp/kg' };
    if (s.n > 1) { const p = kpiDelta(s.last.value, s.avg); return Object.assign(k, { note: `${arrowPct(p)} vs rata-rata ${s.n} bulan (Rp${fmt(s.avg, 0)})`, tone: toneOf(p, true) }); }
    return Object.assign(k, { note: 'Belum ada bulan pembanding', tone: 'neutral' });
  },
  // Upkeep per bulan (file 11): bulan laporan vs "biasanya" (median bulan sebelumnya, tidak terseret lonjakan)
  biaya_perawatan: d => {
    const U = d.upkeepAnalysis;
    if (U && U.cur && U.curAbsurd) return { name: `Biaya perawatan ${monthShort(U.cur.p)}`, value: '–', unit: '',
      note: `Tercatat ${fmtRpShort(U.cur.total)}, tidak wajar; cek input`, tone: 'bad' };
    if (U && U.cur) {
      const r = rpParts(U.cur.total), k = { name: `Biaya perawatan ${monthShort(U.cur.p)}`, value: r.value, unit: r.unit };
      if (U.avgPrev) { const p = kpiDelta(U.cur.total, U.avgPrev); return Object.assign(k, { note: `${arrowPct(p)} vs biasanya (${fmtRpShort(U.avgPrev)}/bulan)`, tone: toneOf(p, false) }); }
      return Object.assign(k, { note: 'Belum ada bulan pembanding', tone: 'neutral' });
    }
    const s = seriesStats(kpiSeries(d, (d.costUpkeep || []).filter(x => x.value > 0)));   // 0 = belum dicatat, bukan biaya nol
    if (!s) return null;
    const r = rpParts(s.last.value), k = { name: `Biaya perawatan ${monthShort(s.last.p)}`, value: r.value, unit: r.unit };
    if (s.prev) { const p = kpiDelta(s.last.value, s.prev.value); return Object.assign(k, { note: `${arrowPct(p)} vs ${monthShort(s.prev.p)} (${fmtRpShort(s.prev.value)})`, tone: toneOf(p, false) }); }
    return Object.assign(k, { note: 'Belum ada bulan pembanding', tone: 'neutral' });
  },
  perawatan_terbesar: d => {
    const U = d.upkeepAnalysis, t = U && U.cur && !U.curAbsurd && U.top && U.top[0];
    if (!t || !t.cost) return null;
    const r = rpParts(t.cost);
    return { name: `Terbesar ${monthShort(U.cur.p)}`, value: r.value, unit: r.unit, tone: t.spike ? 'bad' : 'neutral',
             note: `${t.name}, ${fmt(t.share, 0)}% biaya perawatan${t.spike && t.avg ? `; ${fmt(t.cost / t.avg, 0)}× biasanya, perlu dicek` : ''}` };
  }
};

/** Label kartu pilar: singkat, tanpa bulan (bulan laporan sudah di judul slide). */
const PILLAR_LABELS = [[/^TBS terjual|^Estimasi produksi/, 'TBS terjual'], [/^Yield/, 'Yield'], [/^BJR/, 'BJR'], [/^Pendapatan/, 'Pendapatan'],
  [/^Harga jual/, 'Harga jual'], [/^Biaya perawatan/, 'Biaya perawatan'], [/^Terbesar/, 'Pekerjaan terbesar'], [/^Vs standar Marihat/, 'Capaian standar Marihat']];

/**
 * Kartu KPI -> bentuk kartu pilar: label singkat tanpa bulan; rupiah ditulis "Rp590,1" + "juta"; catatan pembanding
 * tanpa angka dalam kurung; angka dari bulan sebelum bulan laporan diberi keterangan "Data Sep 26 (Okt 26 belum tercatat)".
 */
function pillarCard(k, data) {
  const rep = data.reportP ? monthShort(data.reportP) : null;
  const m = String(k.name || '').match(/([A-Z][a-z]{2} \d{2})$/);
  const lab = PILLAR_LABELS.find(([re]) => re.test(k.name));
  let value = String(k.value), unit = k.unit || '';
  if (/(^| )Rp$/.test(unit) && value !== '–' && value !== '-') { value = `Rp${value}`; unit = unit.replace(/\s*Rp$/, ''); }
  if (unit === 'kg/janjang') unit = 'kg/jjg';
  let note = String(k.note || '').replace(/( vs [^(·]*?) \([^)]*\)/g, '$1').replace(/^.*belum tercatat · /, '')
    .replace(/^Penjualan (\d+)% janjang belum diinput \((±[^)]*) bila lengkap\)/, '$1% penjualan belum diinput; $2 bila lengkap')
    .replace(/^Dari penjualan yang sudah diinput; (\d+)% janjang belum diinput/, '$1% penjualan belum diinput')
    .replace(/Penjualan (\d+)% janjang belum diinput/, '$1% penjualan belum diinput')
    .replace(/^[▲▼] 0% vs /, 'Setara ');
  const stale = !!(rep && m && m[1] !== rep);   // angka bulan sebelumnya: catatan netral, bukan hijau/merah
  if (stale) note = `Data ${m[1]}; ${rep.split(' ')[0]} belum tercatat${note && !/Belum ada bulan pembanding/.test(note) ? ` · ${note}` : ''}`;
  return { name: lab ? lab[1] : String(k.name).replace(/ [A-Z][a-z]{2} \d{2}$/, ''), value, unit, note, tone: stale ? 'neutral' : k.tone || 'neutral' };
}

/** Empat pilar Kinerja Bulan Ini -> [{key, title, main, sub}] (main/sub = kartu {name, value, unit, note, tone} atau null). */
function computePillars(data) {
  const get = id => { try { const f = PILLAR_KPIS[id] || OWNER_KPIS[id]; return f ? f(data) || null : null; } catch (e) { return null; } };
  return PILLARS.map(pl => {
    const picks = pl.slots.map(slot => { for (let i = 0; i < slot.length; i++) { const k = get(slot[i]); if (k) return pillarCard(k, data); } return null; });
    return { key: pl.key, title: pl.title, main: picks[0] || { name: 'Belum ada data', value: '-', unit: '', note: 'Data belum tersedia di sheet', tone: 'neutral' }, sub: picks[1] };
  });
}

/**
 * STRUKTUR BIAYA (deck utama): ke mana biaya pekerja bulan laporan, dibanding rata-rata bulan sebelumnya.
 * Komponen panen / muat / perawatan (+ lainnya bila total lebih besar), porsi, Rp per kg TBS, lalu pendapatan dan
 * laba kotor; rincian perawatan per kelompok pekerjaan dari tabel upkeep per bulan.
 * -> {p, refN, rows:[{name, cur, ref, share, perKg, color, kind}], total, revenue, profit, cats, perKgOk, caption, facts} | null
 */
function buildCostStructure(d) {
  const C = DECK_CONFIG.COLOR;
  const hasVal = (s, p) => { const v = valAt(s || [], p); return v !== null && v !== undefined; };
  const months = (d.costTotal || []).filter(x => x.value !== null && x.value !== undefined && x.value > 0).map(x => x.p);
  if (!months.length) return null;
  const p = d.reportP && months.some(m => mkey(m) === mkey(d.reportP)) ? d.reportP : months[months.length - 1];
  const before = months.filter(m => (m.y * 12 + m.m) < (p.y * 12 + p.m));
  const at = s => { const v = valAt(s || [], p); return v === null || v === undefined ? null : v; };
  const avgOf = s => { const v = before.map(m => valAt(s || [], m)).filter(x => x !== null && x !== undefined); return v.length ? v.reduce((a, x) => a + x, 0) / v.length : null; };
  const total = at(d.costTotal);
  const parts = [['Panen', d.costHarvest, C.GREEN], ['Muat', d.costLoad, C.MUTED], ['Perawatan', d.costUpkeep, C.YELLOW]]
    .filter(([, s]) => (s || []).some(x => x.value));
  // Komponen yang RUTIN tercatat (≥ separuh bulan sebelumnya, ≥ 5% biaya rata-rata) tetapi 0/kosong bulan ini
  // = BELUM DIINPUT (bukan biaya nol). Catatan sesekali yang kecil tidak dianggap rutin.
  const avgTotal = avgOf(d.costTotal);
  const routine = s => before.filter(m => valAt(s || [], m) > 0).length >= Math.max(2, before.length / 2);
  const rows = parts.map(([name, s, color]) => { const cur = at(s) || 0, ref = avgOf(s);
    const miss = !cur && ref > 0 && routine(s) && (!avgTotal || ref >= avgTotal * 0.05);
    return { name, cur: miss ? null : cur, ref, color, kind: 'part', missing: miss }; })
    .filter(r => r.missing || r.cur > 0);   // komponen tanpa biaya bulan ini (dan tidak rutin) tidak ditampilkan
  const missing = rows.filter(r => r.missing);
  const sum = rows.reduce((a, r) => a + (r.cur || 0), 0);
  if (total && total - sum > total * 0.02) rows.push({ name: 'Lainnya', cur: total - sum, ref: null, color: C.NEUTRAL, kind: 'part' });
  const ton = at(d.produksi);
  const nw = noWeightAt(d, p);
  const perKgOk = !!(ton && !(nw && nw.share > DECK_CONFIG.THRESHOLDS.KPI_NOWEIGHT_PCT));
  rows.forEach(r => { r.share = total && r.cur !== null ? (r.cur / total) * 100 : null; r.perKg = perKgOk && r.cur !== null ? r.cur / (ton * 1000) : null; });
  const revenue = at(d.revenueIdr && d.revenueIdr.length ? d.revenueIdr : d.revenueTotal);
  const profit = hasVal(d.profit, p) ? at(d.profit) : (revenue !== null && total !== null ? revenue - total : null);
  rows.push({ name: 'Total biaya pekerja', cur: total, ref: avgOf(d.costTotal), share: 100, perKg: perKgOk ? total / (ton * 1000) : null, kind: 'total' });
  if (revenue !== null) rows.push({ name: 'Pendapatan', cur: revenue, ref: avgOf(d.revenueIdr && d.revenueIdr.length ? d.revenueIdr : d.revenueTotal), share: null, perKg: perKgOk ? revenue / (ton * 1000) : null, kind: 'revenue' });
  if (profit !== null) rows.push({ name: 'Laba kotor', cur: profit, ref: avgOf(d.profit), share: null, perKg: perKgOk ? profit / (ton * 1000) : null, kind: 'profit' });
  // Rincian perawatan bulan itu per kelompok pekerjaan (pemupukan, gulma, ...), dari tabel upkeep per bulan
  const U = d.upkeepAnalysis;
  const cats = U && !U.curAbsurd ? (U.catSeries || []).map(c => ({ name: c.name, value: valAt(c.series, p) || 0 })).filter(c => c.value > 0)
    .sort((a, b) => b.value - a.value) : [];
  const catTot = cats.reduce((a, c) => a + c.value, 0);
  cats.forEach(c => { c.share = catTot ? (c.value / catTot) * 100 : 0; });
  const ratio = revenue ? (total / revenue) * 100 : null;
  const co = (d.costOutliers || []).find(x => mkey(x.p) === mkey(p));
  const lst = a => (a.length > 1 ? `${a.slice(0, -1).join(', ')} dan ${a[a.length - 1]}` : a[0] || '');
  // Keterangan di bawah diagram (angka utama sudah tampil di batang dan legenda)
  const caption = [
    d.reportP && mkey(d.reportP) !== mkey(p) ? `Biaya pekerja ${monthLong(d.reportP)} belum tercatat atau tidak wajar; slide ini memakai ${monthLong(p)}.` : '',
    missing.length ? `Biaya ${lst(missing.map(r => r.name.toLowerCase()))} belum diinput, jadi total biaya belum lengkap.` : '',
    co ? `Biaya ${monthLong(co.p)} tidak wajar dan perlu dicek.` : '',
    'Biaya pekerja = upah panen, muat, dan perawatan; belum termasuk pupuk dan bahan.'
  ].filter(Boolean).join(' ');
  const rp = v => (v === null || v === undefined ? '-' : fmtRp(v));
  const facts = `STRUKTUR BIAYA ${monthLong(p)} (biaya pekerja = upah panen + muat + perawatan, belum termasuk material; pembanding = rata-rata ${before.length} bulan sebelumnya):\n` +
    rows.map(r => `- ${r.name}: ${r.missing ? 'BELUM DIINPUT bulan ini' : rp(r.cur)}${r.share !== null && r.kind === 'part' ? ` (${fmt(r.share, 0)}% biaya)` : ''}${r.perKg !== null && r.perKg !== undefined ? `; Rp${fmt(r.perKg, 0)}/kg TBS` : ''}${r.ref !== null && r.ref !== undefined ? `; rata-rata ${rp(r.ref)}` : ''}`).join('\n') +
    (ratio !== null ? `\n- Porsi biaya pekerja terhadap pendapatan: ${fmt(ratio, 0)}%.` : '') +
    (cats.length ? `\n- Rincian perawatan per kelompok: ${cats.map(c => `${c.name} ${fmtRp(c.value)} (${fmt(c.share, 0)}%)`).join('; ')}.` : '') +
    (!perKgOk && ton ? '\n- Rp/kg tidak dihitung: tonase bulan ini belum lengkap karena data penjualan sebagian besar janjang belum diinput.' : '');
  return { p, refN: before.length, rows, total, revenue, profit, ratio, cats, perKgOk, missing, caption, facts };
}

/** Teks insight cadangan slide Struktur Biaya. */
function fallbackCostInsight(cs) {
  const parts = cs.rows.filter(r => r.kind === 'part' && r.cur !== null).sort((a, b) => b.cur - a.cur);
  const big = parts[0];
  if (cs.missing.length) return `Biaya ${cs.missing.map(r => r.name.toLowerCase()).join(' dan ')} ${monthLong(cs.p)} belum diinput, sehingga biaya pekerja yang tercatat baru **${fmtRpShort(cs.total)}**. Lengkapi input agar struktur biaya dan laba kotor bulan ini dapat dibaca.`;
  return `Biaya pekerja ${monthLong(cs.p)} **${fmtRpShort(cs.total)}**, terbesar untuk ${big.name.toLowerCase()} (${fmt(big.share, 0)}%).` +
    (cs.ratio !== null ? ` Biaya ini ${fmt(cs.ratio, 0)}% dari pendapatan, sehingga laba kotor ${fmtRpShort(cs.profit)}.` : ' Pendapatan bulan ini belum tercatat.');
}

/**
 * AGENDA (slide 2) tetap mengikuti susunan deck utama: Kinerja Bulan Ini → Temuan → Actionable Item → Struktur Biaya →
 * Terima Kasih, lalu Data Pendukung (lampiran). Claude hanya menulis hasil yang dituju dan catatan presenter.
 */
function fallbackAgenda(plan) {
  const n = plan.appendix.length;
  const items = [
    { title: 'Kinerja Bulan Ini', desc: 'Panen, penjualan dan pendapatan, perawatan, produktivitas', minutes: 15, pages: [plan.introPage] },
    plan.anomTopic ? { title: 'Temuan (Findings)', desc: 'Hal penting bulan ini, termasuk data yang belum diinput', minutes: 15, pages: [plan.anomTopic.page] } : null,
    plan.conclTopic ? { title: 'Actionable Item', desc: 'Tindakan prioritas beserta PIC dan tenggatnya', minutes: 20, pages: [plan.conclTopic.page] } : null,
    plan.costMain ? { title: 'Struktur Biaya', desc: 'Ke mana biaya pekerja dan perawatan bulan ini', minutes: 10, pages: [plan.costMain.page] } : null,
    { title: 'Data Pendukung', desc: n ? `Lampiran A1–A${n}: rincian di balik setiap angka` : 'Rincian di balik setiap angka', minutes: 0, pages: [plan.dividerPage] }
  ].filter(Boolean);
  // Sudut pandang penyedia layanan (SawitPRO/KebunPRO) kepada owner pelanggan: apa yang owner dapatkan dan sepakati bersama
  return {
    items,
    outcomes: ['Pemahaman bersama atas kinerja kebun dan temuan terpenting bulan ini',
               'Kesepakatan prioritas perbaikan yang akan didampingi tim SawitPRO',
               'Jadwal tindak lanjut dan tinjauan bulan berikutnya'],
    notes: ''
  };
}

/** Produk SawitPRO berdasarkan nama (persis, tanpa beda huruf besar/kecil). */
function productByName(name) {
  const n = String(name || '').trim().toLowerCase();
  return n ? (DECK_CONFIG.SAWITPRO_PRODUCTS || []).find(p => p.name.toLowerCase() === n) || null : null;
}

/**
 * Field product dari Claude: string ("Dokter Sawit"), daftar (["Uji Tanah Dokter Sawit","Pupuk SawitPRO"]), atau "".
 * -> {list:[produk dikenal, maks. 2], unknown:[nama tidak dikenal]}
 */
function productsFrom(value) {
  const names = (Array.isArray(value) ? value : [value]).map(x => String(x || '').trim()).filter(Boolean);
  const list = [], unknown = [];
  names.forEach(n => { const p = productByName(n); if (p) { if (list.indexOf(p) < 0) list.push(p); } else unknown.push(n); });
  return { list: list.slice(0, 2), unknown };
}

/**
 * Rekomendasi tanpa field product (cadangan dari data): pasangkan produk SawitPRO yang cocok dengan kode rekomendasinya
 * (maks. 2 produk per kartu), dan maksimal 2 kartu agar tidak berkesan promosi. Rekomendasi dari Claude tidak diubah.
 */
function attachProducts(actions) {
  let used = actions.filter(a => a.product && (!Array.isArray(a.product) || a.product.length)).length;
  actions.forEach(a => {
    if (a.product !== undefined) return;
    const ps = used < 2 ? (DECK_CONFIG.SAWITPRO_PRODUCTS || []).filter(x => (x.codes || []).indexOf(a.code) >= 0).slice(0, 2) : [];
    a.product = ps.length ? ps : null;
    if (ps.length) used++;
  });
  return actions;
}

/**
 * Rencana deck untuk satu kebun: topik, slide ringkasan owner (mains), lampiran (A1..An), penghubung antar-slide,
 * dan NOMOR HALAMAN RENCANA. Dipakai bersama oleh paket data (menu 1) dan generate (menu 2), sehingga nomor slide
 * pada jawaban Claude sama dengan nomor di deck.
 * Urutan deck (cara owner membaca laporan bulanan):
 *   DECK UTAMA: cover (1), Agenda & Tujuan Pertemuan (2), Kinerja Bulan Ini (3: empat pilar KPI), Temuan, Actionable Item,
 *               Struktur Biaya, Terima Kasih
 *   DATA PENDUKUNG: pembatas Lampiran, Daftar Lampiran, lalu tiap bagian = slide ringkasan bagian + slide lampirannya.
 */
function planDeck(data) {
  // Topik detail (menjadi LAMPIRAN) & slide ringkasan untuk owner (DECK UTAMA, maks. 10 slide)
  const topics = buildTopics(data);
  const detail = topics.filter(t => t.kind !== 'anomali' && t.kind !== 'conclusion');
  const anomTopic = topics.find(t => t.kind === 'anomali');
  const conclTopic = topics.find(t => t.kind === 'conclusion');
  if (anomTopic) anomTopic.title = 'Temuan Bulan Ini';
  if (conclTopic) conclTopic.title = 'Actionable Item';

  // Kelompok ringkasan: tiap kelompok = 1 slide utama berisi 1 visual kunci + insight + tombol ke lampiran.
  // lead = topik yang TAMPIL di slide utama dan tidak diulang di lampiran (mis. tabel Kinerja Bulan Ini).
  const mains = [];
  MAIN_GROUPS.forEach(g => {
    const lead = g.lead ? detail.find(t => t.id === g.lead) || null : null;
    const members = g.members.map(id => detail.find(t => t.id === id)).filter(Boolean);
    if (!members.length && !lead) return;
    const chartTopic = lead || g.chart.map(id => members.find(t => t.id === id)).find(Boolean) || members[0];
    // Grafik kesimpulan slide utama (bulan laporan vs pembanding); null -> grafik topik utama sebagai cadangan
    let summary = null;
    try { summary = MAIN_SUMMARY[g.id] ? MAIN_SUMMARY[g.id](data) : null; } catch (e) { summary = null; }
    if (summary && !(summary.rows || []).some(r => r.cur !== null && r.cur !== undefined)) summary = null;
    mains.push({ id: g.id, kind: 'main', title: g.title, group: g, members, chartTopic, lead, summary });
  });
  const leads = mains.map(m => m.lead).filter(Boolean);
  // Struktur Biaya (deck utama): grafik komposisi biaya + tombol ke lampiran keuangan
  let costStructure = null;
  try { costStructure = buildCostStructure(data); } catch (e) { costStructure = null; }
  const keu = mains.find(m => m.id === 'm_keuangan');
  const costMain = costStructure ? { id: 'm_biaya', kind: 'main', title: 'Struktur Biaya', structure: costStructure, members: keu ? keu.members : [],
    group: { question: 'Ke mana biaya pekerja bulan ini: berapa untuk panen, muat, dan perawatan, berapa per kg TBS, dan berapa laba kotor yang tersisa?' } } : null;
  // Lampiran: urut sesuai deck utama, lalu topik lain yang belum masuk kelompok
  const appendix = [];
  mains.forEach(m => m.members.forEach(t => { if (appendix.indexOf(t) < 0) { appendix.push(t); t.mainOf = m; } }));
  detail.filter(t => appendix.indexOf(t) < 0 && leads.indexOf(t) < 0).forEach(t => appendix.push(t));
  appendix.forEach((t, i) => { t.appx = `A${i + 1}`; });
  // Penghubung antar-slide mengikuti urutan yang benar-benar dilihat owner
  const ordered = leads.concat(appendix);
  ordered.forEach((t, i) => { t.prev = i ? ordered[i - 1] : null; });

  // Nomor halaman rencana (sama dengan urutan di generateCustomerDeck): cover 1, agenda 2, Kinerja Bulan Ini 3
  let pg = 3;
  const introPage = 3;
  if (anomTopic) anomTopic.page = ++pg;
  if (conclTopic) conclTopic.page = ++pg;
  if (costMain) costMain.page = ++pg;
  const closingPage = ++pg, dividerPage = ++pg, tocPage = ++pg;
  // Data pendukung: ringkasan tiap bagian langsung diikuti slide lampirannya
  const support = supportOrder(mains, appendix);
  support.forEach(t => { t.page = ++pg; if (t.lead) t.lead.page = t.page; });
  appendix.concat(mains).concat(leads).concat([anomTopic, conclTopic, costMain].filter(Boolean)).forEach(t => { t.plannedPage = t.page; });
  return { topics, anomTopic, conclTopic, costMain, mains, leads, appendix, support, introPage, closingPage, dividerPage, tocPage };
}

/** Urutan DATA PENDUKUNG: ringkasan bagian, lalu lampirannya; lampiran tanpa bagian di akhir. */
function supportOrder(mains, appendix) {
  const out = [];
  mains.forEach(m => { out.push(m); m.members.forEach(t => { if (out.indexOf(t) < 0 && t.mainOf === m) out.push(t); }); });
  appendix.forEach(t => { if (out.indexOf(t) < 0) out.push(t); });
  return out;
}

/**
 * Tabel "Kinerja Bulan Ini" untuk owner (tampil di deck utama setelah Ringkasan Eksekutif).
 * Berisi pertanyaan owner berurutan: berapa hasil, berapa uang masuk, berapa biaya, berapa sisa, lalu mutu & pencatatan.
 * Kolom: bulan laporan | bulan sebelumnya | rata-rata periode | selisih vs rata-rata.
 * Warna selisih mengikuti arti BAIK/BURUK (biaya atau penjualan belum diinput yang naik = merah), bukan sekadar arah.
 */
function buildOwnerScorecard(d) {
  const base = seriesStats(d.produksi) || seriesStats(d.yield);
  if (!base) return null;
  const last = base.last.p, prev = base.prev ? base.prev.p : null;
  const bjrMain = d.bjr.some(x => x.value !== null) ? d.bjr : (d.bjrSoldMonthly || []);
  const price = d.hargaJual.length ? d.hargaJual : d.revKg;
  const jt = v => fmt(v / 1e6, 1);
  const tbsName = !d.produksiActual ? 'Estimasi produksi (ton)' : DECK_CONFIG.TONASE_BASIS === 'terjual' ? 'TBS terjual (ton)' : 'Produksi TBS (ton)';
  // [nama, seri, format, arah baik: 1 = naik baik, -1 = turun baik, 0 = netral]
  const metrics = [
    [tbsName, d.produksi, v => fmt(v, Math.abs(v) < 100 ? 1 : 0), 1],
    ['Pendapatan (Rp juta)', d.revenueTotal, jt, 1],
    ['Biaya pekerja (Rp juta)', d.costTotal, jt, -1],
    ['Laba kotor (Rp juta)', d.profit, jt, 1],
    ['Harga jual (Rp/kg)', price, v => fmt(v, 0), 1],
    ['Yield (ton/ha)', d.yield, v => fmt(v, 2), 1],
    ['BJR (kg/janjang)', bjrMain, v => fmt(v, 1), 1],
    ['Luas panen (ha)', d.luasPanen, v => fmt(v, 0), 0],
    ['Penjualan belum diinput', d.noWeight ? d.noWeight.series : [], v => `${fmt(v, 0)}%`, -1]
  ];
  const rows = [], good = [], facts = [];
  metrics.forEach(([name, s, f, dir]) => {
    const st = seriesStats(s);
    if (!st) return;
    const a = valAt(s, last), b = valAt(s, prev);
    const diff = a !== null && st.avg ? ((a - st.avg) / Math.abs(st.avg)) * 100 : null;
    // spasi tipis di depan panah: warna ditentukan cellColor (arti baik/buruk), bukan warna panah bawaan tabel
    const dtxt = diff === null || d.snapshot ? '-' : ` ${diff >= 0 ? '▲ +' : '▼ '}${fmt(diff, 0)}%`;
    rows.push([name, a === null ? '-' : f(a), b === null ? '-' : f(b), f(st.avg), dtxt]);
    good.push(dir);
    facts.push(`${name}: ${monthLong(last)} ${a === null ? 'kosong' : f(a)}; ${prev ? monthLong(prev) : '-'} ${b === null ? 'kosong' : f(b)}; rata-rata ${f(st.avg)}; vs rata-rata ${dtxt.trim()}` +
      (dir === -1 ? ' (makin kecil makin baik)' : ''));
  });
  if (!rows.length) return null;
  let headers = ['Indikator', `${monthShort(last)}\nbulan laporan`, prev ? `${monthShort(prev)}\npembanding` : '-', `Rata-rata\n${base.n} bulan`, 'Selisih\nvs rata-rata'];
  let keep = [0, 1, 2, 3, 4];
  if (!prev || !DECK_CONFIG.SCORECARD_SHOW_PREV) keep = keep.filter(i => i !== 2);
  if (base.n < 2) keep = keep.filter(i => i !== 3 && i !== 4);
  else if (d.snapshot) keep = keep.filter(i => i !== 4);   // data < MIN_MONTHS_FOR_TREND: selisih vs rata-rata belum bermakna
  headers = keep.map(i => headers[i]);
  const finalRows = rows.map(r => keep.map(i => r[i]));
  const deltaCol = keep.indexOf(4);
  const C = DECK_CONFIG.COLOR;
  const cellColor = (r, c, txt) => {
    if (c !== deltaCol || deltaCol < 0) return null;
    const dir = good[r - 1];
    if (!dir || !/[▲▼]/.test(txt)) return null;
    return (txt.indexOf('▲') >= 0) === (dir > 0) ? C.GREEN : C.DANGER;
  };
  return {
    headers, keep, rows: finalRows, cellColor,
    colWidths: [3.4, 1.65, 1.65, 1.65, 1.65].filter((_, i) => keep.indexOf(i) >= 0),
    facts: `Kinerja bulan terakhir (${monthLong(last)}); laba kotor = pendapatan − biaya pekerja, sebelum biaya material:\n` + facts.join('\n'),
    lastLabel: monthLong(last)
  };
}

/** Definisi slide konten. visual = deskripsi isi visual untuk peta slide untuk AI. */
function buildTopics(d) {
  const C = DECK_CONFIG.COLOR;
  const f2 = v => fmt(v, 2), f1 = v => fmt(v, 1), f0 = v => fmt(v, 0);
  const rp = v => `Rp${fmt(v, 0)}`;
  const T = [];
  const has = s => s && s.some(x => x.value !== null);

  const sc = buildOwnerScorecard(d);
  if (sc) T.push({
    id: 'scorecard', section: 'Kinerja Bulan Ini', title: `Tabel Kinerja ${sc.lastLabel}`,
    visual: `tabel kinerja bulan terakhir (hasil, pendapatan, biaya pekerja, laba kotor, harga, yield, BJR, luas panen, porsi janjang yang penjualannya belum diinput)${sc.keep.indexOf(2) >= 0 ? ' vs bulan sebelumnya' : ''}${sc.keep.indexOf(3) >= 0 ? ' vs rata-rata periode' : ''}`,
    facts: sc.facts,
    fallback: `Kinerja ${sc.lastLabel}: ${sc.rows.slice(0, 4).map(r => `${r[0]} ${r[1]}`).join(', ')}.`,
    draw: b => drawTable(b, sc.headers, sc.rows, { colWidths: sc.colWidths,
      fontSize: DECK_CONFIG.TYPE.TABLE_CELL, headerSize: DECK_CONFIG.TYPE.TABLE_HEADER, rowHeight: 25, headerHeight: 36,
      numCols: sc.headers.map((_, i) => i).filter(i => i > 0), cellColor: sc.cellColor })
  });

  if (has(d.yield)) T.push({
    id: 'yield', section: 'Produktivitas Kebun', title: 'Produktivitas Kebun: Yield',
    visual: 'bar yield ton/ha per bulan, bulan tertinggi disorot',
    facts: describeSeries('Yield', 'ton/ha', d.yield, f2),
    fallback: fallbackInsight('Yield', 'ton/ha', d.yield, f2),
    draw: b => drawBarChart(b, d.yield, { labelFmt: f2, axisFmt: f1 })
  });

  const M = d.marihat;
  if (M) T.push({
    id: 'marihat', title: 'Pencapaian vs Standar Marihat',
    visual: `tabel realisasi vs potensi standar Marihat (PPKS) kelas ${M.cls}: produktivitas ton/ha/tahun, BJR, janjang per ha, produksi setahun`,
    facts: describeMarihat(d),
    fallback: `Produktivitas kebun ${fmt(M.realTonHa, 1)} ton TBS/ha/tahun, ${fmtPct(M.achTon * 100, 0)} dari potensi standar Marihat ${M.cls} sebesar ${fmt(M.pot.ton, 1)} ton untuk umur tanamannya. Selisihnya sekitar ${fmt(M.gapTon, 0)} ton per tahun${M.gapRp ? ` atau ${fmtRp(M.gapRp)}` : ''}.`,
    draw: b => drawTable(b, ['Indikator', 'Realisasi', `Standar Marihat\nkelas ${M.cls}`, 'Pencapaian'], [
      ['Produktivitas (ton TBS/ha/tahun)', fmt(M.realTonHa, 1), fmt(M.pot.ton, 1), fmtPct(M.achTon * 100, 0)],
      ['BJR (kg/janjang)', fmt(M.realBjr, 1), fmt(M.pot.rbt, 1), M.achBjr ? fmtPct(M.achBjr * 100, 0) : '-'],
      ['Janjang per ha per tahun', M.realJjgHa ? fmt(M.realJjgHa, 0) : '-', fmt(M.pot.jjgHa, 0), M.achJjg ? fmtPct(M.achJjg * 100, 0) : '-'],
      ...(M.realRjt ? [['Janjang per pokok per tahun', fmt(M.realRjt, 1), fmt(M.pot.rjt, 1), fmtPct(M.achRjt * 100, 0)]] : []),
      [M.usePanen ? 'Produksi panen setahun (ton, estimasi)' : 'Produksi setahun (ton TBS)', fmt(M.realTonYear, 0), fmt(M.potTonYear, 0), fmtPct((M.realTonYear / M.potTonYear) * 100, 0)],
      ...(M.usePanen ? [['TBS terjual setahun (ton)', fmt(M.soldTonYear, 0), '-', fmtPct((M.soldTonYear / M.potTonYear) * 100, 0)]] : []),
      ['Potensi tambahan per tahun', '-', `${fmt(M.gapTon, 0)} ton`, M.gapRp ? fmtRpShort(M.gapRp) : '-'],
      [`Dasar: ${fmt(M.area, 1)} ha blok${M.annualized ? `, disetahunkan dari ${M.nMonths} bln` : ''}`, '', d.landClassAssumed ? 'kelas lahan diasumsikan' : '', '']
    ], { colWidths: [3.2, 1.6, 2.0, 1.6], fontSize: DECK_CONFIG.TYPE.TABLE_CELL, headerSize: DECK_CONFIG.TYPE.TABLE_HEADER, rowHeight: 25, headerHeight: 36, numCols: [1, 2, 3] })
  });

  if (has(d.jjgHa)) T.push({
    id: 'jjg', section: 'Produktivitas Kebun', title: 'Produktivitas Kebun: Kerapatan Panen (JJG/ha)',
    visual: 'bar JJG per hektar per bulan (jumlah janjang yang dipanen per ha)',
    facts: describeSeries('JJG/ha', 'JJG/ha', d.jjgHa, f2),
    fallback: fallbackInsight('JJG/ha', '', d.jjgHa, f2),
    draw: b => drawBarChart(b, d.jjgHa, { labelFmt: f1, axisFmt: f0 })
  });

  // BJR hanya SATU angka: tonase terjual ÷ janjang terjual berberat (sama dengan kolom BJR di sheet format terbaru).
  // Bila sheet tidak punya kolom BJR, dipakai hitungan dari tonase & janjang terjual.
  const bjrMain = has(d.bjr) ? d.bjr : (d.bjrSoldMonthly || []);
  if (has(bjrMain)) T.push({
    id: 'bjr', title: 'Berat Janjang Rata-rata (BJR)',
    visual: 'garis BJR per bulan (kg per janjang) dengan garis putus-putus standar Marihat sesuai umur tanaman',
    facts: describeSeries('BJR (tonase terjual ÷ janjang terjual yang ada beratnya)', 'kg', bjrMain, f2) +
      (d.bjrSoldCum ? `\n- BJR rata-rata tertimbang seluruh periode: ${fmt(d.bjrSoldCum, 2)} kg` : ''),
    fallback: fallbackInsight('BJR', 'kg', bjrMain, f2),
    draw: b => {
      const std = (d.bjrAcuan || []).map(a => ({ p: a.p, label: a.label, value: a.min }));
      const stdAligned = bjrMain.map(x => { const m = std.find(z => mkey(z.p) === mkey(x.p)); return { p: x.p, label: x.label, value: m ? m.value : null }; });
      const hasStd = stdAligned.some(x => x.value !== null);
      drawLineChart(b, [{ series: bjrMain, color: C.GREEN, labels: true }]
        .concat(hasStd ? [{ series: stdAligned, color: C.CHART_LIGHT, dashed: true, labels: false }] : []),
        { labelFmt: f1, axisFmt: f0,
          legend: [{ name: 'BJR (kg)', color: C.GREEN }]
            .concat(hasStd ? [{ name: `Standar Marihat ${d.landClass} sesuai umur`, color: C.CHART_LIGHT, dashed: true }] : []) });
    }
  });

  if (has(d.luasPanen)) T.push({
    id: 'panen', section: 'Produktivitas Kebun', title: 'Produktivitas Kebun: Luas Panen',
    visual: 'bar luas panen (ha) per bulan',
    facts: describeSeries('Luas panen', 'ha', d.luasPanen, f2),
    fallback: fallbackInsight('Luas panen', 'ha', d.luasPanen, f2),
    draw: b => drawBarChart(b, d.luasPanen, { labelFmt: f0, axisFmt: f0 })
  });

  if (has(d.produksi)) T.push({
    id: 'produksi', section: 'Produktivitas Kebun',
    title: d.produksiActual && DECK_CONFIG.TONASE_BASIS === 'terjual' ? 'TBS Terjual per Bulan' : 'Produksi TBS',
    visual: d.produksiActual ? 'bar tonase hasil panen aktual (ton) per bulan' : 'bar estimasi produksi TBS (ton) per bulan = yield × luas panen',
    facts: describeSeries(!d.produksiActual ? 'Estimasi produksi TBS (yield × luas panen)' : DECK_CONFIG.TONASE_BASIS === 'terjual' ? 'TBS terjual (tonase hasil jual)' : 'Produksi TBS aktual', 'ton', d.produksi, f2) +
      (d.produksiPanen ? `\n- estimasi produksi panen (janjang dipanen × BJR berbasis janjang terjual ${fmt(d.bjrSoldCum, 1)} kg): total ${fmt(seriesStats(d.produksiPanen).sum, 0)} ton` : '') +
      `\n- total ${fmt(seriesStats(d.produksi).sum, 2)} ton selama ${d.produksi.length} bulan` +
      (has(d.revenueTotal) ? `\n- estimasi penjualan TBS (${d.revenueBasis}): total ${fmtRp(seriesStats(d.revenueTotal).sum)}, tertinggi ${fmtRp(seriesStats(d.revenueTotal).max.value)} pada ${monthLong(seriesStats(d.revenueTotal).max.p)}` : ''),
    fallback: fallbackInsight(d.produksiActual ? 'Produksi TBS' : 'Estimasi produksi TBS', 'ton', d.produksi, f0),
    draw: b => drawBarChart(b, d.produksi, { labelFmt: f0, axisFmt: f0 })
  });


  const B = d.blocks;
  if (B && B.classes.length) T.push({
    id: 'umur', section: 'Umur Tanaman & Blok', title: 'Struktur Umur Tanaman Blok Dipanen',
    visual: 'bar horizontal luas (ha) blok unik per kelas umur tanaman, dengan % luas',
    facts: describeBlocks(d),
    fallback: `${fmt(B.classes.reduce((m, c) => (c.value > m.value ? c : m)).pct, 0)}% luas blok dipanen berada di kelas ${B.classes.reduce((m, c) => (c.value > m.value ? c : m)).name}; ${B.replant.length} blok (${fmt(B.replant.reduce((s, b) => s + b.ha, 0), 1)} ha) sudah lewat umur ekonomis.`,
    draw: b => drawHBarChart(b, B.classes, { labelFmt: v => `${fmt(v, 0)} ha` })
  });

  if (has(d.ageMonthly) && !d.snapshot) T.push({
    id: 'umuryield', section: 'Umur Tanaman & Blok', title: 'Umur Rata-rata Blok yang Dipanen',
    visual: 'bar umur rata-rata blok dipanen per bulan (tahun, tertimbang luas)',
    facts: describeSeries('Umur rata-rata blok dipanen (tertimbang luas)', 'tahun', d.ageMonthly, f1) +
      `\n- korelasi dengan yield: r = ${fmt(pearson(d.yield, d.ageMonthly), 2)}`,
    fallback: fallbackInsight('Umur rata-rata blok dipanen', 'tahun', d.ageMonthly, f1),
    draw: b => drawBarChart(b, d.ageMonthly, { labelFmt: f1, axisFmt: f0 })
  });

  if (B && B.replant.length) T.push({
    id: 'replanting', section: 'Umur Tanaman & Blok', title: 'Kandidat Peremajaan (Replanting)',
    visual: 'tabel blok berumur >25 tahun terluas: blok, luas, tahun tanam, umur, frekuensi panen',
    facts: `Blok >25 tahun: ${B.replant.length} blok, ${fmt(B.replant.reduce((s, b) => s + b.ha, 0), 1)} ha dari ${fmt(B.totalHa, 1)} ha blok unik.\n` +
      B.replant.slice(0, 10).map(b => `- ${b.name}: ${fmt(b.ha, 2)} ha, tanam ${b.year}, umur ${b.age} th, dipanen ${b.months} dari ${B.monthly.length} bulan`).join('\n'),
    fallback: `${B.replant.length} blok seluas ${fmt(B.replant.reduce((s, b) => s + b.ha, 0), 1)} ha sudah berumur lebih dari 25 tahun; blok terluas ${B.replant[0].name} (${fmt(B.replant[0].ha, 2)} ha, tanam ${B.replant[0].year}).`,
    draw: b => drawTable(b, ['Blok', 'Luas\nha', 'Tahun\ntanam', 'Umur\ntahun', 'Dipanen\nbulan'],
      B.replant.slice(0, 9).map(x => [x.name, x.ha ? fmt(x.ha, 2) : '–', String(x.year), String(x.age), `${x.months}/${B.monthly.length}`]),
      { colWidths: [2.6, 1.5, 1.6, 1.4, 1.6], fontSize: DECK_CONFIG.TYPE.TABLE_CELL, headerSize: DECK_CONFIG.TYPE.TABLE_HEADER, rowHeight: 25, headerHeight: 36, numCols: [1, 2, 3, 4] })
  });

  // --- Produktivitas per blok (file 10): janjang/ha/tahun vs standar Marihat umur blok ---
  const BR = blockProdTableRows(d);
  if (BR) T.push({
    id: 'blokprod', title: 'Produktivitas per Blok',
    visual: 'tabel blok prioritas (selisih janjang terbesar dari standar): blok, umur, luas, janjang/ha/tahun kebun, standar Marihat, capaian %, tindak lanjut (uji daun & tanah / rotasi panen / peremajaan)',
    facts: describeBlockProduction(d),
    fallback: (() => { const P = d.blockProd;
      return `${fmt(P.lowPct, 0)}% luas blok menghasilkan janjang di bawah ${fmt(DECK_CONFIG.THRESHOLDS.BLOCK_LOW_ACH * 100, 0)}% standar umurnya; ` +
        `${P.fertRows.length} blok rutin dipanen tetapi tetap rendah${P.fertRows.length ? ` (mis. ${P.fertRows.slice(0, 2).map(r => r.name).join(', ')})` : ''}, sehingga perlu uji daun dan uji tanah.` +
        (P.gapRpTotal ? ` Potensi yang belum tercapai sekitar ${fmtRp(P.gapRpTotal)} per tahun.` : ''); })(),
    draw: b => drawTable(b, ['Blok', 'Umur\ntahun', 'Luas\nha', 'Kebun\njjg/ha/th', 'Standar\njjg/ha/th', 'Capaian', 'Tindak lanjut'], BR,
      { colWidths: [1.3, 1.0, 1.0, 1.25, 1.35, 1.25, 2.7], fontSize: DECK_CONFIG.TYPE.TABLE_CELL, headerSize: DECK_CONFIG.TYPE.TABLE_HEADER, rowHeight: 24, headerHeight: 36, numCols: [1, 2, 3, 4, 5],
        cellColor: (r, c, txt) => (c === 5 ? (parseNum(txt) < DECK_CONFIG.THRESHOLDS.BLOCK_LOW_ACH * 100 ? DECK_CONFIG.COLOR.DANGER : null) : null) })
  });

  // --- Jenis tanah & kebutuhan pupuk indikatif (file 9) ---
  const SR = soilTableRows(d);
  if (SR && SR.length) T.push({
    id: 'tanah', title: 'Jenis Tanah Blok',
    visual: 'tabel jenis tanah: luas ha, porsi luas, jumlah blok, fokus hara; baris Belum tercatat bila data tanah kosong',
    facts: describeSoil(d),
    fallback: d.soil.unknownCount || !d.soil.dominant
      ? `Jenis tanah belum tercatat untuk ${d.soil.unknownCount} blok (${d.soil.byCount ? `${fmt(d.soil.unknownPct, 0)}% blok` : `${fmt(d.soil.unknownHa, 1)} ha, ${fmt(d.soil.unknownPct, 0)}% luas`}), sehingga dosis pupuk belum dapat disesuaikan dengan kondisi tanah. Uji tanah per kelompok blok menjadi langkah pertama.`
      : `Tanah dominan ${d.soil.dominant.name.toLowerCase()} (${fmt(d.soil.dominant.pct, 0)}% luas) dengan fokus hara ${d.soil.dominant.type.fokus}.`,
    draw: b => drawTable(b, ['Jenis tanah', 'Luas\nha', 'Porsi\nluas', 'Blok', 'Fokus hara'], SR,
      { colWidths: [2.3, 1.1, 1.1, 0.9, 3.2], fontSize: DECK_CONFIG.TYPE.TABLE_CELL, headerSize: DECK_CONFIG.TYPE.TABLE_HEADER, rowHeight: 25, headerHeight: 36, numCols: [1, 2, 3] })
  });
  // Rekomendasi pupuk PREDIKSI per kelompok blok (umur × jenis tanah; Permentan 131/2013); dosis presisi lewat uji tanah/daun Dokter Sawit
  // STATUS PEMUPUKAN: pesan utama = indikasi kurang / kelebihan pupuk -> pastikan dengan Uji Daun & Uji Tanah Dokter Sawit.
  // Marihat, dosis prediksi (Permentan 131/2013), catatan pemupukan, dan jenis tanah hanya bukti pendukung.
  const FS = d.fertStatus, FSR = fertStatusTableRows(d);
  if (FS && FSR && FS.evidence.length) T.push({
    id: 'pupuk', title: 'Status Pemupukan Kebun',
    visual: 'tabel bukti status pemupukan: indikator, angka kebun, acuan, arti (merah = mendukung indikasi kurang/berlebih), ditutup baris kesimpulan dan saran uji daun & uji tanah Dokter Sawit',
    facts: describeFertStatus(d) + '\n' + describeNpk(d) + '\n' + describeFertilizer(d),
    fallback: `${FS.label}: ${FS.reason}. ${STATUS_PUPUK_SARAN} agar dosis pupuk tiap blok tepat.`,
    draw: b => drawTable(b, ['Indikator', 'Kebun', 'Acuan', 'Artinya'], FSR,
      { colWidths: [1.8, 2.0, 1.7, 3.5], fontSize: DECK_CONFIG.TYPE.TABLE_CELL, headerSize: DECK_CONFIG.TYPE.TABLE_HEADER, rowHeight: 24, headerHeight: 25, keepLast: true,
        cellColor: (r, c) => { const e = FS.evidence[r - 1];
          if (!e) return c === 3 ? DECK_CONFIG.COLOR.GREEN : null;                       // baris kesimpulan: saran hijau
          return c === 3 && e.arah !== 'netral' ? DECK_CONFIG.COLOR.DANGER : null; } })
  });

  // Biaya perawatan per bulan (file 11): grafik per kategori + tabel pekerjaan bulan laporan
  const UK = d.upkeepAnalysis;
  if (UK && UK.months.length) {
    const sp = UK.spikes[0], c = UK.cur;
    T.push({
      id: 'upkeep', section: 'Analisis Pengeluaran', title: 'Biaya Perawatan per Bulan',
      visual: `bar bertumpuk biaya perawatan per bulan (Rp juta) per kategori: ${UK.catSeries.map(x => x.name.toLowerCase()).join(', ')}`,
      facts: describeUpkeepMonthly(d),
      fallback: sp ? `Biaya ${sp.name.toLowerCase()} ${monthLong(sp.p)} tercatat ${fmtRp(sp.cost)}, ${fmt(sp.ratio, 0)} kali median bulan lain (${fmtRp(sp.median)}), sehingga perlu dicek apakah ada salah input.`
        : c ? `Biaya perawatan ${monthLong(c.p)} ${fmtRp(c.total)}${UK.avgPrev ? `, ${c.total >= UK.avgPrev ? 'di atas' : 'di bawah'} biasanya (median bulan sebelumnya ${fmtRp(UK.avgPrev)})` : ''}; terbesar untuk ${c.items.length ? c.items[0].name.toLowerCase() : '-'}.`
        : fallbackInsight('Biaya perawatan', '', UK.totalSeries, fmtRp),
      draw: b => drawStackedBarChart(b, UK.catSeries.map(x => ({ name: x.name, series: x.series, color: x.color })), { scale: 1e6, labelFmt: f1, axisFmt: jtAxis })
    });
    const UR = upkeepTableRows(d);
    if (UR) T.push({
      id: 'upkeepakt', section: 'Analisis Pengeluaran', title: 'Pekerjaan Perawatan Bulan Laporan',
      visual: `tabel pekerjaan perawatan ${monthLong(c.p)}: biaya bulan ini, bulan lalu, biasanya (median bulan sebelumnya, Rp juta), catatan lonjakan`,
      facts: describeUpkeepMonthly(d),
      fallback: `${c.items[0].name} menjadi biaya perawatan terbesar ${monthLong(c.p)}, ${fmtRp(c.items[0].cost)} (${fmt(c.total ? c.items[0].cost / c.total * 100 : 0, 0)}% dari ${fmtRp(c.total)}).`,
      draw: b => drawTable(b, ['Pekerjaan', 'Kategori', `${monthShort(c.p)}\nRp jt`, `${UK.prev ? monthShort(UK.prev.p) : 'Bulan lalu'}\nRp jt`, 'Biasanya\n(median)', 'Catatan'], UR,
        { colWidths: [2.4, 1.9, 1.1, 1.1, 1.2, 1.9], fontSize: DECK_CONFIG.TYPE.TABLE_CELL, headerSize: DECK_CONFIG.TYPE.TABLE_HEADER, rowHeight: 25, headerHeight: 36, numCols: [2, 3, 4],
          cellColor: (r, col, txt) => (col === 5 && /lonjakan|naik/.test(txt) ? DECK_CONFIG.COLOR.DANGER : null) })
    });
  }

  const up = UK ? [] : upkeepItems(d);
  if (up.length >= 2) T.push({
    id: 'upkeep', section: 'Analisis Pengeluaran', title: 'Analisis Pengeluaran: Komposisi Upkeep Cost',
    visual: `bar horizontal biaya perawatan per kelompok aktivitas (Rp jt dan % dari total), periode ${d.upkeepPeriod || DECK_CONFIG.UPKEEP_ACTIVITY_PERIOD}`,
    facts: describeUpkeep(up, d.upkeepPeriod),
    fallback: `${up[0].name} menyerap porsi upkeep terbesar, ${fmtRp(up[0].value)} (${fmtPct(up[0].pct, 0)} dari total upkeep cost).`,
    draw: b => drawHBarChart(b, up, { scale: 1e6, labelFmt: v => `${fmt(v, 2)} jt` })
  });

  // Laba kotor per bulan: uang yang tersisa setelah biaya pekerja (pertanyaan utama owner di bagian keuangan)
  if (has(d.profit)) T.push({
    id: 'laba', title: 'Laba Kotor per Bulan',
    visual: 'satu batang per bulan setinggi pendapatan (Rp juta), terbagi biaya pekerja (abu) dan laba kotor (hijau, angka di atas batang); bulan rugi berwarna merah di bawah nol',
    facts: [describeSeries('Laba kotor sebelum biaya material (pendapatan − biaya pekerja)', '', d.profit, fmtRp),
            describeSeries('Pendapatan tercatat', '', d.revenueIdr, fmtRp),
            describeSeries('Total biaya pekerja', '', d.costTotal, fmtRp)].join('\n'),
    fallback: fallbackInsight('Laba kotor sebelum biaya material', '', d.profit, fmtRp),
    draw: b => drawProfitChart(b, d.revenueIdr, d.costTotal)
  });

  if (has(d.revKg)) T.push({
    id: 'biayakg', section: 'Analisis Pengeluaran', title: 'Analisis Pengeluaran: Biaya per Kg TBS',
    visual: 'garis pendapatan per kg (hijau) dan biaya pekerja per kg (merah putus-putus), Rp ribu',
    facts: [describeSeries('Pendapatan / harga jual per kg TBS', '', d.revKg, rp), describeSeries('Biaya pekerja per kg TBS (panen + muat + perawatan)', '', d.upahKg, rp)].join('\n'),
    fallback: fallbackInsight('Pendapatan per kg', '', d.revKg, rp),
    draw: b => drawLineChart(b, [{ series: d.revKg, color: C.GREEN, labels: true }]
      .concat(has(d.upahKg) ? [{ series: d.upahKg, color: C.DANGER, dashed: true, labels: false }] : []),
      { scale: 1000, labelFmt: f1, axisFmt: v => `${fmt(v, 1)} rb`,
        legend: [{ name: 'Pendapatan/kg (Rp rb)', color: C.GREEN }].concat(has(d.upahKg) ? [{ name: 'Biaya pekerja/kg', color: C.DANGER, dashed: true }] : []) })
  });

  if (has(d.upahRatio)) T.push({
    id: 'efisiensi', section: 'Analisis Pengeluaran', title: 'Analisis Pengeluaran: Efisiensi Upah per Kg',
    visual: 'garis porsi biaya pekerja terhadap harga jual per kg (%) per bulan',
    facts: describeSeries('Porsi biaya pekerja terhadap harga jual per kg', '%', d.upahRatio, f1),
    fallback: fallbackInsight('Porsi biaya pekerja terhadap harga jual', '%', d.upahRatio, f1),
    draw: b => drawLineChart(b, [{ series: d.upahRatio, color: C.GREEN, labels: true }], { labelFmt: v => `${fmt(v, 1)}%`, axisFmt: v => `${fmt(v, 0)}%` })
  });

  if (has(d.revHa)) T.push({
    id: 'biayaha', section: 'Analisis Pengeluaran', title: 'Analisis Pengeluaran: Pendapatan vs Biaya per Ha',
    visual: 'bar pendapatan per ha (Rp jt) dengan garis biaya per ha (merah putus-putus)',
    facts: [describeSeries('Pendapatan per ha', '', d.revHa, fmtRp), describeSeries('Biaya per ha', '', d.costHa, fmtRp),
            describeSeries('Porsi biaya terhadap pendapatan per ha', '%', d.costRatio, f1),
            up.length ? describeUpkeep(up, d.upkeepPeriod) : ''].join('\n'),
    fallback: fallbackInsight('Pendapatan per hektar', '', d.revHa, fmtRp),
    draw: b => drawBarChart(b, d.revHa, {
      scale: 1e6, labelFmt: f2, axisFmt: jtAxis,
      extraLines: has(d.costHa) ? [{ series: d.costHa, color: C.DANGER, dashed: true }] : [],
      legend: [{ name: 'Pendapatan/ha (Rp jt)', type: 'bar', color: C.GREEN }].concat(has(d.costHa) ? [{ name: 'Biaya/ha', color: C.DANGER, dashed: true }] : []) })
  });

  if (has(d.margin)) T.push({
    id: 'margin', section: 'Analisis Pengeluaran', title: 'Analisis Pengeluaran: Margin per Ha',
    visual: 'bar margin per ha (pendapatan - biaya, Rp jt); bulan negatif berwarna merah',
    facts: describeSeries('Margin per ha (pendapatan - biaya)', '', d.margin, fmtRp),
    fallback: fallbackInsight('Margin per hektar', '', d.margin, fmtRp),
    draw: b => drawBarChart(b, d.margin, { scale: 1e6, labelFmt: f2, axisFmt: jtAxis })
  });

  const rawatEmpty = !d.rawat || !d.rawat.rows.length;
  [['panen', d.mandorPanen], ['muat', d.mandorMuat]].forEach(([role, m]) => {
    if (!m) return;
    T.push({
      id: `mandor${role}`, section: 'Produktivitas Pekerja', title: `Produktivitas Mandor ${role === 'panen' ? 'Panen' : 'Muat'}`,
      visual: `bar berkelompok JJG/hari per mandor ${role} untuk ${m.periods.map(p => p.label).join(', ')}, dengan jumlah hari kerja di bawah bar`,
      facts: describeMandor(role, m, d) + (role === 'panen' && rawatEmpty ? '\nTop mandor rawat: ANOMALI: data belum tersedia.' : ''),
      fallback: mandorFallbackText(role, m) + (role === 'panen' && rawatEmpty ? ' Data mandor rawat belum tersedia.' : ''),
      draw: b => drawMandorChart(b, m)
    });
  });

  const F = d.flow;
  if (F) {
    T.push({
      id: 'alurjjg', title: 'Alur Janjang: Panen sampai Terjual',
      visual: `corong janjang bulan laporan ${F.stages.map(x => x.name).join(' → ')} dengan selisih tiap tahap dan estimasi nilainya`,
      facts: describeFlow(d),
      fallback: (() => {
        const c = F.cur || F, p = F.cur ? F.prev : null, when = c.p ? ` pada ${monthLong(c.p)}` : '';
        if (c.overSold) return `Janjang terjual${when} ${fmt(c.overSoldPct, 1)}% lebih banyak dari janjang dipanen, artinya input panen belum lengkap atau restan bulan lalu ikut terjual. Alur bulan ini belum bisa dinilai.`;
        if (c.lossJjg === undefined || c.pendingJjg === undefined) {   // cadangan kumulatif (tanpa data per bulan)
          if (!c.worst) return 'Janjang dipanen, dimuat, dan terjual tercatat seimbang.';
          return `Dari ${fmt(c.stages[0].total, 0)} janjang dipanen, ${fmt(c.lossJjg, 0)} (${fmt(c.lossPct, 0)}%) belum tercatat sampai terjual. Selisih terbesar pada tahap ${c.worst.from} → ${c.worst.to}.`;
        }
        const vs = p && !p.overSold && p.lossRp && c.lossRp ? ` dibanding ${fmtRp(p.lossRp)} pada ${monthLong(p.p)}` : '';
        const pend = c.pendingJjg ? `${fmt(c.pendingJjg, 0)} janjang (${fmt(c.pendingPct, 0)}%) panen${when} belum tercatat terjual; pastikan muat dan penjualannya diinput` : `Panen${when} sudah tercatat terjual`;
        const aged = c.lossJjg ? ` Sebanyak ${fmt(c.lossJjg, 0)} janjang panen bulan sebelumnya belum tercatat dimuat atau terjual lebih dari sebulan${c.lossRp ? ` (nilai ±${fmtRp(c.lossRp)}${vs})` : ''}; kemungkinan besar datanya belum diinput.` : ' Panen bulan sebelumnya sudah tercatat terjual.';
        return `${pend}.${aged}${c.worst && c.lossJjg ? ` Selisih terbesar pada tahap ${c.worst.from} → ${c.worst.to}, yang dicatat ${c.worst.role}.` : ''}`;
      })(),
      draw: b => drawFlowFunnel(b, F.cur || F)   // corong BULAN LAPORAN; kumulatif hanya di catatan fakta
    });
    if (F.monthlyGap.length >= 2) T.push({
      id: 'restan', title: 'Selisih Panen vs Muat per Bulan',
      visual: 'bar selisih janjang dipanen dikurangi janjang dimuat per bulan (positif = belum tercatat dimuat, negatif = muat melebihi panen)',
      facts: [`Selisih janjang dipanen − dimuat per bulan (positif = belum tercatat dimuat, umumnya data muat belum diinput atau restan; negatif = muat melebihi panen, biasanya mengejar restan bulan sebelumnya):`,
        `- per bulan: ${F.monthlyGap.map(g => `${g.label} ${fmt(g.value, 0)}`).join(', ')}`,
        `- kumulatif: ${F.monthlyGap.map(g => `${g.label} ${fmt(g.cum, 0)}`).join(', ')}`,
        describeSignal(F.monthlyGap)].join('\n'),
      fallback: (() => { const g = F.monthlyGap.slice().sort((a, b) => b.value - a.value)[0];
        return `Selisih panen dan muat terbesar terjadi pada ${monthLong(g.p)} sebanyak ${fmt(g.value, 0)} janjang; selisih kumulatif akhir periode ${fmt(F.monthlyGap[F.monthlyGap.length - 1].cum, 0)} janjang.`; })(),
      draw: b => drawBarChart(b, F.monthlyGap, { labelFmt: f0, axisFmt: f0 })
    });
  }

  const RW = rawatTableRows(d);
  if (RW) T.push({
    id: 'rawat', title: 'Mandor Rawat',
    visual: 'tabel mandor rawat: hari kerja bulan terakhir & pembanding, dan aktivitas utama beserta produktivitas per hari',
    facts: describeRawat(d),
    fallback: (() => { const top = RW.rows.slice().sort((a, b2) => (parseNum(b2[1]) || 0) - (parseNum(a[1]) || 0))[0];
      return `${top[0]} paling aktif dengan ${top[1]} hari kerja rawat; aktivitas utamanya ${top[top.length - 1]}.`; })(),
    draw: b => drawTable(b, RW.headers, RW.rows, { colWidths: RW.headers.length === 4 ? [1.8, 1.1, 1.1, 3.4] : [1.8, 1.1, 3.4],
      fontSize: DECK_CONFIG.TYPE.TABLE_CELL, headerSize: DECK_CONFIG.TYPE.TABLE_HEADER, rowHeight: 25, headerHeight: 36, numCols: RW.numCols })
  });
  else if (!rawatEmpty) T.push({
    id: 'rawat', title: 'Mandor Rawat',
    visual: 'tabel mandor rawat dan jumlah hari rawat',
    facts: describeTable('Top mandor rawat (jumlah hari rawat)', d.rawat),
    fallback: `${d.rawat.rows[0][0]} mencatat ${d.rawat.rows[0][1]} hari rawat pada periode ini.`,
    draw: b => drawTable(b, d.rawat.headers, d.rawat.rows)
  });

  // --- Janjang yang data penjualannya belum diinput & blok tanpa penjualan (kolom baru) ---
  const NW = d.noWeight;
  if (NW && NW.nwSum > 0) T.push({
    id: 'tanpaberat', title: 'Data Penjualan Belum Diinput',
    visual: 'bar bertumpuk per bulan: janjang yang data penjualannya sudah diinput (hijau) dan belum diinput (oranye)',
    facts: describeNoWeight(d),
    fallback: `Data penjualan ${fmt(NW.nwSum, 0)} janjang (${fmt(NW.share, 0)}%) belum diinput, setara ±${fmtRpShort(NW.rpSum)} pendapatan yang belum tercatat. Tertinggi ${monthLong(NW.worst.p)} (${fmt(NW.worst.share, 0)}%).`,
    draw: b => drawStackedBarChart(b, [
      { name: 'Penjualan sudah diinput', series: d.saleJjg, color: C.GREEN },
      { name: 'Penjualan belum diinput', series: d.noWeightJjg, color: C.WARNING }], { labelFmt: f0, axisFmt: f0 })
  });
  const U = d.unsale;
  if (U && U.blocks.length) T.push({
    id: 'blokunsale', title: 'Blok Tanpa Penjualan',
    visual: U.jjgTotal ? 'tabel blok dengan janjang dipanen terbanyak saat blok itu tidak tercatat menjual: blok, luas, tahun tanam, bulan tanpa penjualan, janjang dipanen'
      : 'tabel blok yang paling sering tidak tercatat menjual janjang: blok, luas, tahun tanam, jumlah bulan tanpa penjualan, bulan terakhir',
    facts: describeUnsale(d),
    fallback: U.jjgTotal
      ? `${fmt(U.jjgTotal, 0)} janjang dipanen di blok yang tidak tercatat menjual selama periode; terbanyak ${U.blocks[0].name}${U.blocks[0].ha ? ` (${fmt(U.blocks[0].ha, 2)} ha)` : ''} ${fmt(U.blocks[0].jjg, 0)} janjang dalam ${U.blocks[0].months} bulan.`
      : `${U.chronic.length || U.blocks.length} blok tidak tercatat menjual janjang selama beberapa bulan; terbanyak ${U.blocks[0].name}${U.blocks[0].ha ? ` (${fmt(U.blocks[0].ha, 2)} ha)` : ''} ${U.blocks[0].months} dari ${U.months} bulan.`,
    // janjang per blok tersedia: kolom terakhir = janjang dipanen tanpa penjualan tercatat (bukan bulan terakhir)
    draw: b => drawTable(b, ['Blok', 'Luas\nha', 'Tahun\ntanam', 'Tanpa penjualan\nbulan', U.jjgTotal ? 'Janjang\ndipanen' : 'Terakhir\nbulan'],
      U.blocks.slice(0, 9).map(x => [x.name, x.ha ? fmt(x.ha, 2) : '–', x.year ? String(x.year) : '-', `${x.months}/${U.months}`, U.jjgTotal ? fmt(x.jjg, 0) : (x.last ? monthShort(x.last) : '-')]),
      { colWidths: [2.4, 1.3, 1.3, 1.8, 1.4], fontSize: DECK_CONFIG.TYPE.TABLE_CELL, headerSize: DECK_CONFIG.TYPE.TABLE_HEADER, rowHeight: 25, headerHeight: 36, numCols: U.jjgTotal ? [1, 2, 3, 4] : [1, 2, 3] })
  });

  // --- Komposisi biaya pekerja per bulan (panen / perawatan / muat) ---
  // Tiga warna yang jelas berbeda: hijau (panen), kuning (perawatan), abu tua (muat).
  // Komponen yang belum dicatat (kosong di semua bulan) tidak digambar dan tidak masuk legenda.
  const costParts = [
    { name: 'Panen', series: d.costHarvest, color: C.GREEN },
    { name: 'Perawatan', series: d.costUpkeep, color: C.YELLOW },
    { name: 'Muat', series: d.costLoad, color: C.MUTED }
  ].filter(p => has(p.series));
  if (costParts.length) T.push({
    id: 'biayakomposisi', title: 'Komposisi Biaya Pekerja per Bulan',
    visual: `bar bertumpuk biaya per bulan (Rp juta): ${costParts.map(p => p.name.toLowerCase()).join(', ')}`,
    facts: [describeSeries('Total biaya pekerja', '', d.costTotal, fmtRp), describeSeries('Biaya panen', '', d.costHarvest, fmtRp),
            describeSeries('Biaya perawatan (upkeep)', '', d.costUpkeep, fmtRp), describeSeries('Biaya muat', '', d.costLoad, fmtRp),
            has(d.profit) ? describeSeries('Laba kotor sebelum biaya material (pendapatan − biaya pekerja)', '', d.profit, fmtRp) : '',
            (d.featureNotes || []).length ? 'CATATAN FITUR: ' + d.featureNotes.join('; ') : ''].join('\n'),
    fallback: fallbackInsight('Total biaya pekerja', '', d.costTotal, fmtRp),
    draw: b => drawStackedBarChart(b, costParts, { scale: 1e6, labelFmt: f1, axisFmt: jtAxis })
  });

  T.push({ id: 'anomali', kind: 'anomali', title: 'Anomali yang Perlu Ditindaklanjuti',
    visual: 'tabel lebar: temuan | data/bukti | mengapa penting | tindak lanjut', facts: '', fallback: '' });
  T.push({ id: 'kesimpulan', kind: 'conclusion', section: 'Rekomendasi', title: 'Kesimpulan & Rekomendasi', visual: 'kartu aksi untuk owner', facts: '', fallback: '' });
  // Hanya 1 bulan data: grafik bulanan tidak bermakna -> cukup tabel kinerja; slide tren dilewati
  if (d.months < 2) {
    const trendOnly = ['produksi', 'panen', 'yield', 'jjg', 'laba', 'biayakg', 'efisiensi', 'biayaha', 'margin', 'biayakomposisi'];
    for (let i = T.length - 1; i >= 0; i--) if (trendOnly.indexOf(T[i].id) >= 0) T.splice(i, 1);
  }
  // Seri utama tiap slide -> sinyal otomatis (tren/posisi/volatilitas) sebagai pilihan jawaban tetap
  const PRIMARY = { tanpaberat: d.noWeight ? d.noWeight.series : [], biayakomposisi: d.costTotal || [], laba: d.profit || [],
                    restan: d.flow ? d.flow.monthlyGap : [], produksi: d.produksi, panen: d.luasPanen, yield: d.yield, jjg: d.jjgHa, bjr: d.bjr, umuryield: d.ageMonthly,
                    biayakg: d.revKg, efisiensi: d.upahRatio, biayaha: d.revHa, margin: d.margin };
  T.forEach(t => { if (PRIMARY[t.id] && PRIMARY[t.id].length) t.signal = signals(PRIMARY[t.id]); });
  // marihat & tabel kinerja tidak memakai sinyal tren
  return applyStory(T);
}



/**
 * Kumpulkan anomali yang dideteksi script dari fakta tiap slide + cek konsistensi antar-tabel.
 * [{page, slide, text}]
 */
function detectAnomalies(topics, data) {
  const out = [];
  const push = (t, text) => { if (out.length < 80 && !out.some(o => o.text === text)) out.push({ page: t ? t.page : null, slide: t ? t.title : '-', text }); };
  topics.forEach(t => {
    String(t.facts || '').split('\n').forEach(l => {
      if (/ANOMALI|PERLU DICEK|TIDAK KONSISTEN|NEGATIF/.test(l)) push(t, l.replace(/^[-\s]+/, ''));
    });
  });
  const byId = id => topics.find(x => x.id === id);
  describeRelations(data).split('\n').forEach(line => {
    let l = line;
    if (!/ANOMALI|TIDAK KONSISTEN|PERLU DICEK/.test(l)) return;
    l = l.replace(/^[-\s]+/, '');
    const t = /TIDAK BISA DIUKUR|tidak ada janjang terjual tercatat/.test(l) && byId('alurjjg') ? byId('alurjjg')
      : /penjualannya belum diinput|penjualan \d+% janjang belum diinput/i.test(l) && byId('tanpaberat') ? byId('tanpaberat')
      : /tidak tercatat menjual/i.test(l) && byId('blokunsale') ? byId('blokunsale')
      : /alur panen tidak tercatat|tabel alur|melebihi dipanen|melebihi dimuat|melebihi masuk trip/i.test(l) && byId('alurjjg') ? byId('alurjjg') : /produktivitas baru/.test(l) ? byId('marihat') : /upah/.test(l) ? (byId('efisiensi') || byId('biayakg')) : /pendapatan/.test(l) ? byId('biayaha') : /BJR/.test(l) ? byId('bjr')
      : /luas panen/.test(l) ? byId('panen') : /harga/.test(l) ? byId('biayakg') : byId('yield');
    push(t, l);
  });
  // Panen vs muat per bulan (risiko restan)
  const mp = data.mandorPanen, mm = data.mandorMuat;
  if (mp && mm && !data.flow) {
    mp.periods.forEach((p, i) => {
      if (p.partial) return;
      const j = mm.periods.findIndex(q => q.label === p.label);
      if (j < 0) return;
      const tp = mp.rows.reduce((s, r) => s + ((r.vals[i] && r.vals[i].total) || 0), 0);
      const tm = mm.rows.reduce((s, r) => s + ((r.vals[j] && r.vals[j].total) || 0), 0);
      if (tp && tm < tp * DECK_CONFIG.THRESHOLDS.MUAT_VS_PANEN) push(byId('mandormuat'), `PERLU DICEK: ${p.label} janjang dipanen ${fmt(tp, 0)} JJG tetapi tercatat dimuat ${fmt(tm, 0)} JJG (${fmtPct((tm / tp) * 100, 0)}); risiko restan atau data muat belum lengkap.`);
    });
  }
  const missing = checkDataCompleteness(data);
  if (missing.length) push({ page: null, title: 'Kelengkapan data' }, `ANOMALI: data belum tersedia di sheet: ${missing.join(', ')}.`);
  describeRkh(data).split('\n').filter(l => /PERLU DICEK/.test(l))
    .forEach(l => push(byId('blokprod') || byId('jjg') || { page: null, title: 'Rencana Kerja Harian (RKH)' }, l));
  if (data.partialMonth) push(null, `${data.partialMonth} bulan berjalan, belum lengkap dan tidak dianalisis.`);
  // Prioritas bisnis: inkonsistensi > rugi > BJR/upah tidak wajar > restan > harga tetap > angka menyimpang > data kosong
  const rank = a => /ANOMALI DATA|TIDAK KONSISTEN/.test(a.text) ? 1 : /NEGATIF/.test(a.text) ? 2
    : /alur panen tidak tercatat|penjualan[^.]*belum diinput|RKH|TIDAK BISA DIUKUR|tidak ada janjang terjual tercatat/.test(a.text) ? 2 : /tidak tercatat menjual|kurang hara|jarang dipanen/.test(a.text) ? 3 : /acuan umur|melebihi harga|produktivitas baru/.test(a.text) ? 3 : /restan|melebihi dipanen/.test(a.text) ? 4 : /persis sama/.test(a.text) ? 5
    : /bulan berjalan/.test(a.text) ? 9 : /belum tersedia|belum dicatat|kosong pada|tercatat 0|NOL/.test(a.text) ? 7 : 6;
  return out.sort((a, b) => rank(a) - rank(b));
}

/**
 * ALUR CERITA: pertanyaan dan relasi tiap slide diatur di sini (bukan oleh AI) agar selalu runut.
 * Urutan slide di deck mengikuti MAIN_GROUPS; penghubung (prev) dihitung ulang dari urutan itu saat generate.
 */
// Deskripsi bagian: satu baris di Daftar Isi (judul 21px, deskripsi 17px; ±30 karakter pada slide 720pt)
const SECTION_DESC = {
  'Introduction': 'Temuan utama dan angka kunci',
  'Ringkasan Eksekutif': 'Temuan utama dan angka kunci',
  'Kinerja Bulan Ini': 'Hasil, uang masuk, biaya, laba',
  'Hasil Produksi': 'Produksi, yield, vs Marihat',
  'Faktor Penentu Yield': 'Jumlah dan berat janjang',
  'Kondisi Tanaman': 'Umur blok dan peremajaan',
  'Tenaga Kerja': 'Produktivitas mandor',
  'Alur Panen ke Muat Tidak Tercatat': 'Panen, muat, dan jual yang belum diinput',
  'Keuangan Kebun': 'Harga, biaya, dan laba',
  'Anomali Data': 'Angka janggal yang perlu dicek',
  'Rekomendasi': 'Tindakan prioritas untuk owner'
};


/**
 * DECK UTAMA untuk estate owner (maks. 10 slide), urut sesuai pertanyaan owner:
 *   1. Bagaimana bulan ini? (hasil, uang masuk, biaya, laba)   -> Kinerja Bulan Ini
 *   2. Apakah semua panen tercatat sampai terjual?              -> Alur Panen ke Muat Tidak Tercatat
 *   3. Mengapa hasil naik/turun?                                -> Penyebab Naik-Turun Hasil
 *   4. Ke mana uang keluar dan berapa sisanya per bulan?        -> Keuangan Kebun
 *   5. Bagaimana kinerja orangnya?                              -> Tim Kerja
 *   lead    = topik yang tampil di slide utama dan TIDAK diulang di lampiran.
 *   members = slide detail (lampiran) yang dirangkum; chart = urutan pilihan grafik bila tidak ada lead.
 */
const MAIN_GROUPS = [
  { id: 'm_kinerja', title: 'Rincian Kinerja Bulan Ini', members: ['scorecard', 'produksi', 'panen', 'yield', 'marihat'], chart: ['produksi', 'yield', 'panen'],
    question: 'Bagaimana hasil dan uang kebun bulan ini: berapa ton terjual, berapa uang masuk, dan berapa yang tersisa?' },
  { id: 'm_kebocoran', title: 'Alur Panen ke Muat Tidak Tercatat', members: ['alurjjg', 'tanpaberat', 'blokunsale', 'restan'], chart: ['alurjjg', 'tanpaberat', 'restan'],
    question: 'Berapa janjang panen bulan ini yang belum tercatat dimuat atau terjual (umumnya karena data belum diinput), dibanding bulan lalu, dan di tahap mana?' },
  { id: 'm_penyebab', title: 'Penyebab Naik-Turun Hasil', members: ['jjg', 'blokprod', 'bjr', 'umur', 'tanah', 'pupuk', 'umuryield', 'replanting'], chart: ['bjr', 'jjg', 'umur'],
    question: 'Apa penyebab utama hasil per hektar rendah atau naik-turun: jumlah janjang, berat janjang (BJR), umur tanaman, atau kondisi tanah dan pemupukan?' },
  { id: 'm_keuangan', title: 'Keuangan Kebun', members: ['laba', 'biayakomposisi', 'upkeep', 'upkeepakt', 'biayakg', 'efisiensi', 'biayaha', 'margin'], chart: ['laba', 'biayaha', 'biayakomposisi', 'margin', 'biayakg'],
    question: 'Berapa uang yang tersisa setiap bulan setelah biaya pekerja, dan apa yang membuatnya turun atau rugi?' },
  { id: 'm_tim', title: 'Tim Kerja', members: ['mandorpanen', 'mandormuat', 'rawat'], chart: ['mandorpanen', 'mandormuat', 'rawat'],
    question: 'Apakah tim panen, muat, dan rawat bekerja cukup produktif dan merata?' }
];

/** Label sumbu Rp juta: desimal secukupnya agar nilai kecil (mis. 0,35 jt) tidak semua terbaca "0 jt". */
function jtAxis(v) {
  const a = Math.abs(v);
  return `${fmt(v, !a || Number.isInteger(Math.round(v * 100) / 100) ? 0 : a < 1 ? 2 : a < 10 ? 1 : 0)} jt`;
}

/** Nama kebun panjang di cover diperkecil agar tetap satu baris (tidak menimpa label dan baris periode). */
function fitCoverTitle(pres, title) {
  const cover = pres.getSlides()[0];
  if (!cover) return;
  const T = DECK_CONFIG.TYPE;
  cover.getShapes().forEach(sh => {
    let txt = '';
    try { txt = sh.getText().asString().trim(); } catch (e) { return; }
    if (txt !== String(title).trim()) return;
    const need = estWidth(title, T.COVER_NAME, true), room = sh.getWidth() - 8;
    if (need > room) sh.getText().getTextStyle().setFontSize(Math.max(T.COVER_NAME_MIN, Math.floor(T.COVER_NAME * room / need)));
  });
}

/**
 * GRAFIK KESIMPULAN slide utama (dibaca owner dalam ±30 detik): 3–4 indikator kunci, bulan laporan berdampingan dengan
 * pembandingnya (bulan sebelumnya, atau standar Marihat untuk slide penyebab). Detail tren tetap di lampiran.
 * Setiap fungsi -> {curLabel, refLabel, rows:[{label, unit, cur, ref, f, goodUp}], caption, desc} atau null.
 */
/** Label pembanding: "(bulan lalu)" hanya bila memang bulan kalender sebelumnya; bila bulan itu kosong, sebut terus terang. */
function refMonthLabel(p, q) {
  if (!q) return 'belum ada pembanding';
  const prevCal = { y: p.m === 0 ? p.y - 1 : p.y, m: p.m === 0 ? 11 : p.m - 1 };
  return mkey(q) === mkey(prevCal) ? `${monthShort(q)} (bulan lalu)` : `${monthShort(q)} (pembanding terakhir; ${monthShort(prevCal)} kosong)`;
}

const MAIN_SUMMARY = {
  m_kinerja: d => {
    const base = seriesStats(d.produksi) || seriesStats(d.yield);
    if (!base) return null;
    const p = base.last.p, q = base.prev ? base.prev.p : null;
    const at = (s, m) => (m ? valAt(s || [], m) : null);
    const jt = s => m => { const v = at(s, m); return v === null || v === undefined ? null : v / 1e6; };
    const row = (label, unit, get, f, goodUp) => ({ label, unit, cur: get(p), ref: q ? get(q) : null, f, goodUp });
    const f1 = v => fmt(v, 1);
    // Bulan laporan belum ada penjualan/tonase: grafik memakai bulan terakhir yang tercatat dan menyebutnya terus terang
    const R = d.reportP, stale = R && mkey(R) !== mkey(p);
    const pn = stale ? valAt(d.flowPanen || [], R) || valAt(d.totalJjg || [], R) : null;
    return {
      curLabel: `${monthShort(p)} (${stale ? 'data terakhir' : 'bulan laporan'})`, refLabel: refMonthLabel(p, q),
      caption: stale ? `${monthLong(R)} belum ada penjualan/tonase tercatat${pn ? ` (dipanen ${fmt(pn, 0)} janjang)` : ''}; grafik memakai ${monthLong(p)}.`
        : [valAt(d.revenueTotal || [], p) === null ? `Pendapatan ${monthLong(p)} belum tercatat, sehingga laba bulan ini belum dapat dihitung.` : '',
           (d.costOutliers || []).some(x => mkey(x.p) === mkey(p)) ? `Biaya pekerja ${monthLong(p)} tidak wajar (kemungkinan salah input) dan tidak dipakai.` : ''].filter(Boolean).join(' '),
      rows: [
        row(d.produksiActual === false ? 'Estimasi produksi' : 'TBS terjual', 'ton', m => at(d.produksi, m), v => fmt(v, Math.abs(v) < 100 ? 1 : 0), true),
        row('Pendapatan', 'Rp juta', jt(d.revenueTotal), f1, true),
        row('Biaya pekerja', 'Rp juta (makin kecil makin baik)', jt(d.costTotal), f1, false),
        row('Laba kotor', 'Rp juta, sebelum biaya material', jt(d.profit), f1, true)
      ],
      desc: 'hasil, pendapatan, biaya pekerja, dan laba kotor bulan laporan vs bulan lalu'
    };
  },
  m_kebocoran: d => {
    const F = d.flow, N = d.noWeight;
    const c = F && F.cur, p = F && F.prev;
    const nwAt = m => { if (!N || !m) return null; const x = N.monthly.find(z => mkey(z.p) === mkey(m)); return x ? x.share : null; };
    const lossV = (s, k) => (s && !s.overSold ? s[k] : null);
    const ref = p || null, cm = c ? c.p : (N ? N.monthly[N.monthly.length - 1].p : null);
    const pm = ref ? ref.p : (N && N.monthly.length > 1 ? N.monthly[N.monthly.length - 2].p : null);
    if (!cm) return null;
    const rows = [
      { label: 'Belum tercatat terjual', unit: 'janjang panen bulan itu', cur: lossV(c, 'pendingJjg'), ref: lossV(ref, 'pendingJjg'), f: v => fmt(v, 0), goodUp: false },
      { label: 'Belum tercatat > 1 bln', unit: 'janjang panen bulan sebelumnya', cur: lossV(c, 'lossJjg'), ref: lossV(ref, 'lossJjg'), f: v => fmt(v, 0), goodUp: false },
      { label: 'Nilai belum tercatat', unit: 'Rp juta (janjang > 1 bulan)', cur: lossV(c, 'lossRp') !== null ? lossV(c, 'lossRp') / 1e6 : null,
        ref: lossV(ref, 'lossRp') !== null ? lossV(ref, 'lossRp') / 1e6 : null, f: v => fmt(v, 1), goodUp: false },
      { label: 'Penjualan belum diinput', unit: `% janjang (wajar ≤ ${DECK_CONFIG.THRESHOLDS.NOWEIGHT_PCT}%)`, cur: nwAt(cm), ref: nwAt(pm), f: v => `${fmt(v, 0)}%`, goodUp: false }
    ];
    const caption = c && c.overSold ? `Alur ${monthLong(c.p)} belum terukur: janjang terjual melebihi janjang dipanen (input panen kurang atau restan bulan lalu ikut terjual).`
      : 'Selisih umumnya karena data muat atau penjualan belum diinput; input setiap hari agar angka ini mendekati nol.';
    return { curLabel: `${monthShort(cm)} (bulan laporan)`, refLabel: refMonthLabel(cm, pm),
             rows, caption, desc: 'janjang panen yang belum tercatat terjual, yang belum tercatat lebih dari sebulan beserta nilainya, dan porsi penjualan yang belum diinput, bulan laporan vs bulan lalu' };
  },
  m_penyebab: d => {
    const M = d.marihat, S = d.soil;
    if (M) return {
      curLabel: 'Realisasi kebun', refLabel: `Standar Marihat ${M.cls} (umur yang sama)`,
      rows: [
        { label: 'Produktivitas', unit: 'ton TBS/ha/tahun', cur: M.realTonHa, ref: M.pot.ton, f: v => fmt(v, 1), goodUp: true },
        { label: 'BJR', unit: 'kg per janjang', cur: M.realBjr, ref: M.pot.rbt, f: v => fmt(v, 1), goodUp: true },
        { label: 'Janjang per ha', unit: 'janjang/ha/tahun', cur: M.realJjgHa, ref: M.pot.jjgHa, f: v => fmt(v, 0), goodUp: true },
        // produksi per blok tersedia: porsi luas blok yang memenuhi standar janjang (lebih bermakna dari kelengkapan data tanah)
        d.blockProd ? { label: 'Luas blok sesuai standar', unit: `% luas, janjang ≥ ${fmt(DECK_CONFIG.THRESHOLDS.BLOCK_LOW_ACH * 100, 0)}% standar`, cur: 100 - d.blockProd.lowPct, ref: 100, f: v => `${fmt(v, 0)}%`, goodUp: true }
          : S ? { label: 'Data jenis tanah', unit: '% luas blok tercatat', cur: S.knownPct, ref: 100, f: v => `${fmt(v, 0)}%`, goodUp: true } : null
      ].filter(Boolean),
      // pesan pupuk didahulukan: indikasi kurang/kelebihan pupuk + ajakan uji daun & tanah
      caption: d.fertStatus && d.fertStatus.verdict !== 'sesuai' ? `${d.fertStatus.label}: ${d.fertStatus.reason}. ${STATUS_PUPUK_SARAN}.`
        : S && S.unknownHa ? `Jenis tanah ${fmt(S.unknownPct, 0)}% luas belum tercatat, sehingga dosis pupuk belum bisa disesuaikan dengan tanah.` : '',
      desc: 'produktivitas, BJR, janjang per ha, dan kelengkapan data tanah vs standar Marihat'
    };
    const y = seriesStats(d.yield), j = seriesStats(d.jjgHa), bj = seriesStats(d.bjr);
    if (!y) return null;
    return { curLabel: `${monthShort(y.last.p)} (bulan laporan)`, refLabel: `Rata-rata ${y.n} bulan`,
      rows: [
        { label: 'Yield', unit: 'ton/ha', cur: y.last.value, ref: y.avg, f: v => fmt(v, 2), goodUp: true },
        j ? { label: 'Janjang per ha', unit: 'janjang/ha', cur: j.last.value, ref: j.avg, f: v => fmt(v, 1), goodUp: true } : null,
        bj ? { label: 'BJR', unit: 'kg per janjang', cur: bj.last.value, ref: bj.avg, f: v => fmt(v, 1), goodUp: true } : null
      ].filter(Boolean), desc: 'yield, janjang per ha, dan BJR bulan laporan vs rata-rata' };
  },
  m_keuangan: d => {
    const base = seriesStats(d.revenueTotal) || seriesStats(d.costTotal);
    if (!base) return null;
    const p = base.last.p, q = base.prev ? base.prev.p : null;
    const at = (s, m) => (m ? valAt(s || [], m) : null);
    const ratio = m => { const r = at(d.revenueIdr && d.revenueIdr.length ? d.revenueIdr : d.revenueTotal, m), c = at(d.costTotal, m); return r && c !== null ? (c / r) * 100 : null; };
    const price = d.hargaJual && d.hargaJual.length ? d.hargaJual : d.revKg;
    const row = (label, unit, get, f, goodUp) => ({ label, unit, cur: get(p), ref: q ? get(q) : null, f, goodUp });
    // Upkeep per bulan (file 11): baris biaya perawatan menggantikan biaya per kg; lonjakan disebut di keterangan
    const UK = d.upkeepAnalysis;
    const upk = UK ? m => { const v = valAt(UK.totalSeries, m); return v === null || v === undefined ? null : v / 1e6; } : null;
    const R = d.reportP, stale = R && mkey(R) !== mkey(p);
    const sp = UK && UK.spikes.find(x => mkey(x.p) === mkey(p) || (q && mkey(x.p) === mkey(q)));
    const co = (d.costOutliers || []).find(x => mkey(x.p) === mkey(p));
    const caption = [stale ? `${monthLong(R)} belum ada pendapatan tercatat; grafik memakai ${monthLong(p)}.` : '',
      co ? `Biaya pekerja ${monthLong(co.p)} ${fmtRpShort(co.total)} tidak wajar (kemungkinan salah input), laba bulan ini tidak dihitung.` : '',
      sp ? `Biaya ${sp.name.toLowerCase()} ${monthLong(sp.p)} ${fmtRpShort(sp.cost)}, ${fmt(sp.ratio, 0)}× biasanya; perlu dicek.` : ''].filter(Boolean).join(' ');
    return {
      curLabel: `${monthShort(p)} (${stale ? 'data terakhir' : 'bulan laporan'})`, refLabel: refMonthLabel(p, q), caption,
      rows: [
        row('Laba kotor', 'Rp juta, sebelum biaya material', m => { const v = at(d.profit, m); return v === null ? null : v / 1e6; }, v => fmt(v, 1), true),
        row('Porsi biaya pekerja', '% dari pendapatan', ratio, v => `${fmt(v, 0)}%`, false),
        upk ? row('Biaya perawatan', 'Rp juta (makin kecil makin baik)', upk, v => fmt(v, 1), false)
            : row('Biaya pekerja per kg', 'Rp/kg TBS', m => at(d.upahKg, m), v => fmt(v, 0), false),
        row('Harga jual', 'Rp/kg TBS', m => at(price, m), v => fmt(v, 0), true)
      ],
      desc: `laba kotor, porsi biaya pekerja, ${upk ? 'biaya perawatan' : 'biaya per kg'}, dan harga jual bulan laporan vs bulan lalu`
    };
  },
  m_tim: d => {
    const m = d.mandorPanen;
    if (!m) return null;
    const full = m.periods.map((p, i) => ({ p, i })).filter(x => !x.p.partial);
    const last = full[full.length - 1], prev = full[full.length - 2];
    if (!last) return null;
    const rows = m.rows.filter(r => r.vals[last.i] && r.vals[last.i].rate)
      .sort((a, b) => b.vals[last.i].rate - a.vals[last.i].rate).slice(0, 4)
      .map(r => ({ label: String(r.name).length > 20 ? String(r.name).slice(0, 19) + '…' : String(r.name),
        unit: `jjg/hari · ${fmt(r.vals[last.i].days, 0)} hari kerja`, cur: r.vals[last.i].rate,
        ref: prev && r.vals[prev.i] ? r.vals[prev.i].rate : null, f: v => fmt(v, 0), goodUp: true }));
    return { curLabel: `${last.p.label} (bulan laporan)`, refLabel: prev ? `${prev.p.label} (bulan lalu)` : 'belum ada pembanding',
             rows, desc: 'produktivitas mandor panen (jjg/hari) bulan laporan vs bulan lalu' };
  }
};

/**
 * Judul otomatis dari data (dipakai bila AI gagal atau judulnya terlalu panjang).
 * Setiap judul menjawab pertanyaan slide dengan angka; null = tidak ada jawaban yang pasti dari data.
 */
function dataHeadline(id, d) {
  const T = DECK_CONFIG.THRESHOLDS, M = d.marihat, F = d.flow, N = d.noWeight, B = d.blocks, U = d.unsale;
  const pct = v => `${fmt(v * 100, 0)}%`;
  // Alur panen -> muat/jual yang belum tercatat, bulan laporan (bukan kumulatif); umumnya data belum diinput
  const kebocoran = () => {
    const c = F && F.cur, p = F && F.prev;
    if (c && !c.overSold && c.lossJjg && c.lossPct >= T.FLOW_LOSS_PCT) {   // belum tercatat > 1 bulan
      const rp = c.lossRp ? `Rp${fmt(c.lossRp / 1e6, 1)} juta` : '';
      return [rp ? `Panen ${rp} belum tercatat terjual di ${BULAN_PENDEK[c.p.m]}` : '', rp ? `Panen ${rp} belum tercatat terjual` : '',
              `${fmt(c.lossJjg, 0)} janjang belum tercatat terjual`].filter(Boolean);
    }
    if (c && !c.overSold && c.pendingJjg && c.pendingPct >= T.FLOW_LOSS_PCT) return [`${fmt(c.pendingPct, 0)}% panen ${monthLong(c.p)} belum tercatat terjual`,
      `${fmt(c.pendingPct, 0)}% panen ${BULAN_PENDEK[c.p.m]} belum tercatat terjual`, `${fmt(c.pendingPct, 0)}% panen belum tercatat terjual`];
    if (N && N.share > T.NOWEIGHT_PCT) return [`Penjualan ${fmt(N.share, 0)}% janjang belum diinput`];
    if (c && c.overSold) return [`Input panen ${monthLong(c.p)} belum lengkap`, 'Input panen belum lengkap'];
    if (F && F.overSold) return ['Input panen belum lengkap', 'Alur panen belum dapat diukur'];
    if (F) return ['Janjang dipanen tercatat sampai terjual'];
    return null;
  };
  const S = d.soil, FZ = d.fertilizer;
  const penyebab = () => {
    if (M && M.reliable === false) return [`Hasil ${pct(M.achTon)} dari standar (data ${M.nMonths} bulan)`];
    if (M && M.achTon < 0.9) {
      if (M.achBjr && (!M.achJjg || M.achBjr <= M.achJjg)) return [`Hasil rendah: BJR ${fmt(M.realBjr, 1)} kg, ${pct(M.achBjr)} dari standar`, `Hasil rendah: BJR ${pct(M.achBjr)} dari standar`];
      if (M.achJjg) return [`Hasil rendah: janjang per ha ${pct(M.achJjg)} dari standar`, `Hasil rendah: janjang/ha ${pct(M.achJjg)} standar`];
    }
    if (M) return [`Hasil ${pct(M.achTon)} dari standar Marihat`];
    return null;
  };
  const laba = () => {
    const p = seriesStats(d.profit);
    if (!p) return null;
    const avg = fmtRpShort(Math.abs(p.avg));
    if (p.avg < 0) return [`Rata-rata rugi ${avg} per bulan`, 'Kebun merugi setelah biaya pekerja'];
    if (p.n === 1) return [`Laba kotor ${monthLong(p.last.p)} ${avg}`];
    const neg = p.negatives.filter(x => !lossFromUpkeepSpike(d, x.p));   // rugi karena lonjakan biaya (cek input) tidak disebut rugi
    if (neg.length) return [`Laba ${avg}/bulan, rugi ${monthShort(neg[0].p)}`, `Laba ${avg} per bulan, sempat rugi`];
    return [`Laba kotor rata-rata ${avg} per bulan`];
  };
  const H = {
    m_kinerja: () => {
      const s2 = seriesStats(d.produksi);
      if (!s2) return null;
      const ton = `${fmt(s2.last.value, s2.last.value < 100 ? 1 : 0)} ton`;
      const lp = seriesStats(d.profit) ? valAt(d.profit, s2.last.p) : null;
      const laba2 = lp !== null && lp !== undefined ? (lp < 0 ? `rugi ${fmtRpShort(-lp)}` : `laba ${fmtRpShort(lp)}`) : '';
      return laba2 ? [`${monthLong(s2.last.p)}: ${ton} terjual, ${laba2}`, `${ton} TBS terjual, ${laba2}`]
                   : [`${monthLong(s2.last.p)}: ${ton} TBS terjual`, `${ton} TBS terjual`];
    },
    m_kebocoran: kebocoran,
    alurjjg: () => (F ? kebocoran() : null),
    tanpaberat: () => (N && N.nwSum ? [`Penjualan ${fmt(N.share, 0)}% janjang belum diinput`] : null),
    // Struktur Biaya: porsi biaya pekerja terhadap pendapatan, atau komponen terbesar bila pendapatan belum tercatat
    m_biaya: () => { const cs = buildCostStructure(d); if (!cs) return null;
      const big = cs.rows.filter(r => r.kind === 'part' && r.cur !== null).sort((a, b2) => b2.cur - a.cur)[0], mon = BULAN_PENDEK[cs.p.m];
      const out = [];
      if (cs.missing.length) out.push(`Biaya ${cs.missing.map(r => r.name.toLowerCase()).join(' dan ')} ${mon} belum diinput`);
      if (cs.ratio !== null) out.push(`Biaya pekerja ${fmt(cs.ratio, 0)}% dari pendapatan ${mon}`, `Biaya pekerja ${fmt(cs.ratio, 0)}% dari pendapatan`);
      out.push(`${big.name} ${fmt(big.share, 0)}% dari biaya pekerja ${mon}`, `Biaya pekerja ${monthShort(cs.p)} ${fmtRpShort(cs.total)}`);
      return out; },
    blokunsale: () => (U && U.chronic.length ? [`${U.chronic.length} blok dipanen tanpa penjualan tercatat`] : null),
    m_penyebab: penyebab,
    marihat: () => (!M ? null : M.nMonths < T.MIN_MONTHS_ANNUAL ? [`Hasil ${pct(M.achTon)} dari standar (data ${M.nMonths} bulan)`]
      : [`Hasil baru ${pct(M.achTon)} dari standar Marihat`]),
    bjr: () => (M && M.achBjr ? [`BJR ${fmt(M.realBjr, 1)} kg, ${pct(M.achBjr)} dari standar umur`] : null),
    replanting: () => (B && B.replant.length ? [`${B.replant.length} blok (${fmt(B.replant.reduce((x, b) => x + b.ha, 0), 0)} ha) lewat umur ekonomis`] : null),
    blokprod: () => { const P = d.blockProd; if (!P) return null;
      if (P.fertRows.length) return [`${P.fertRows.length} blok rutin dipanen, janjang di bawah standar`, `${P.fertRows.length} blok janjang rendah, perlu uji daun`];
      if (P.lowPct >= 10) return [`${fmt(P.lowPct, 0)}% luas blok di bawah standar janjang`];
      return P.best ? [`Blok ${P.best.name} paling produktif, ${fmt(P.best.jjgHa, 0)} jjg/ha/th`] : null; },
    upkeep: () => { const UK = d.upkeepAnalysis; if (!UK) return null;
      const c = UK.cur, recent = m => c && (c.p.y * 12 + c.p.m) - (m.y * 12 + m.m) <= 1;
      const sp = UK.spikes.find(x => recent(x.p));   // judul hanya mengangkat lonjakan bulan laporan / bulan lalu
      if (UK.curAbsurd) return [`Upkeep ${monthShort(c.p)} ${fmtRpShort(c.total)}, perlu dicek`, 'Biaya perawatan bulan ini tidak wajar'];
      if (sp) return [`Biaya ${sp.name.toLowerCase()} ${monthShort(sp.p)} naik ${fmt(sp.ratio, 0)}×`, `Lonjakan biaya ${monthShort(sp.p)} perlu dicek`];
      if (c && UK.avgPrev && UK.before.length >= 2) { const ch = (c.total - UK.avgPrev) / UK.avgPrev * 100;
        return [`Biaya perawatan ${monthShort(c.p)} ${ch >= 0 ? 'naik' : 'turun'} ${fmt(Math.abs(ch), 0)}% dari biasanya`, `Biaya perawatan ${fmtRpShort(c.total)}`]; }
      return c ? [`Biaya perawatan ${monthShort(c.p)} ${fmtRpShort(c.total)}`] : null; },
    upkeepakt: () => { const UK = d.upkeepAnalysis, t = UK && UK.top[0]; if (!t) return null;
      return [`${t.name} ${fmt(t.share, 0)}% biaya perawatan ${monthShort(UK.cur.p)}`, `${t.name} biaya perawatan terbesar`, 'Pekerjaan perawatan terbesar bulan ini']; },
    tanah: () => (!S ? null : S.unknownPct >= 50 ? [`${fmt(S.unknownPct, 0)}% luas belum ada data jenis tanah`, 'Jenis tanah sebagian besar belum tercatat']
      : S.dominant ? [`Tanah dominan ${S.dominant.name.toLowerCase()}, ${fmt(S.dominant.pct, 0)}% luas`, `Tanah dominan ${S.dominant.name.toLowerCase()}`] : null),
    pupuk: () => { const F2 = d.fertStatus; if (!F2) return null;
      const M2 = d.marihat, pc = v => `${fmt(v * 100, 0)}%`;
      if (F2.verdict === 'kurang') return (F2.doseVerdict === 'kurang' ? [`Indikasi kurang pupuk di ${fmt(d.npk.kurangHa, 0)} ha`]
        : /^hasil/.test(F2.reason) ? [`Indikasi kurang pupuk: hasil ${pc(M2.achTon)} dari standar`]
        : /^BJR/.test(F2.reason) ? [`Indikasi kurang pupuk: BJR ${pc(M2.achBjr)} dari standar`]
        : [`Indikasi kurang pupuk di ${F2.priorityBlocks.length} blok rutin panen`]).concat(['Indikasi kurang pupuk, perlu uji daun']);
      if (F2.verdict === 'berlebih') return [`Indikasi kelebihan pupuk di ${fmt(d.npk.lebihHa, 0)} ha`, 'Indikasi kelebihan pupuk'];
      if (F2.verdict === 'sesuai') return ['Tidak ada indikasi kurang pupuk'];
      return ['Status pupuk perlu dicek lewat uji daun']; },
    m_keuangan: laba,
    laba: laba,
    m_tim: () => {
      const mp = d.mandorPanen;
      if (!mp || mp.rows.length < 2) return null;
      const li = mp.periods.map((p, i) => (p.partial ? null : i)).filter(i => i !== null).pop() || 0;
      const r = mp.rows.map(x => x.vals[li] && x.vals[li].rate).filter(Boolean);
      if (r.length < 2) return null;
      const ratio = Math.max.apply(null, r) / Math.min.apply(null, r);
      return ratio >= 1.3 ? [`Pemanen terbaik ${fmt(ratio, 1)}× lebih produktif`] : ['Produktivitas mandor panen relatif merata'];
    }
  };
  try {
    const list = H[id] ? H[id]() : null;
    // judul = satu baris dan ≤ 45 karakter (aturan gaya); kandidat lebih panjang dilewati
    return (list || []).find(h => h && h.length <= AI_LIMITS.HEADLINE_MAX_CHARS && titleFits(h)) || null;
  } catch (e) { return null; }
}

/** Judul slide temuan: jumlah temuan + temuan terbesar bila muat satu baris. */
function anomalyHeadline(rows, fallback) {
  if (!rows || !rows.length) return fallback;
  const top = String(rows[0].finding || '').replace(/\s*\(.*\)$/, '').trim();
  const h = top ? `${rows.length} temuan, terbesar: ${top.charAt(0).toLowerCase()}${top.slice(1)}` : '';
  return h && titleFits(h) ? h : `${rows.length} temuan data yang perlu dicek owner`;
}

/** Judul slide rekomendasi: jumlah tindakan + tindakan pertama bila muat satu baris. */
function conclusionHeadline(actions, fallback) {
  if (!actions || !actions.length) return fallback;
  const first = String(actions[0].title || '').trim();
  const h = first ? `Prioritas: ${first.charAt(0).toLowerCase()}${first.slice(1)}` : '';
  return h && titleFits(h) ? h : `${actions.length} tindakan prioritas untuk owner`;
}

/**
 * Grafik laba kotor yang menjelaskan dirinya sendiri: satu batang per bulan setinggi PENDAPATAN,
 * dibagi biaya pekerja (abu, bawah) dan laba kotor (hijau, atas; angkanya di atas batang).
 * Bulan rugi (biaya > pendapatan): batang abu setinggi pendapatan + batang merah di bawah nol sebesar ruginya.
 * Memakai primitif SlideBatch & kerangka chFrame dari file 6.
 */
function drawProfitChart(b, rev, cost) {
  const C = DECK_CONFIG.COLOR, A = DECK_CONFIG.LAYOUT.CONTENT, W = DECK_CONFIG.WEIGHT;
  const base = rev;
  const R = base.map(x => (x.value === null ? null : x.value / 1e6));
  const K = base.map(x => { const v = valAt(cost, x.p); return v === null || v === undefined ? null : v / 1e6; });
  const P = R.map((r, i) => (r === null || K[i] === null ? null : r - K[i]));
  const all = finite(R.concat(K).concat(P));
  if (!all.length) return;
  const scale = niceScale(Math.min.apply(null, all), Math.max.apply(null, all));
  const f = chFrame(b, base, scale, v => `${fmt(v, 0)} jt`);
  const bw = f.step * CH.BAR_RATIO, y0 = f.yOf(0), lw = Math.max(f.step + 8, 36);
  let anyLoss = false;
  base.forEach((x, i) => {
    const cx = f.x0 + f.step * (i + 0.5), r = R[i], k = K[i], p = P[i];
    if (p === null) { b.label('n/a', cx, y0 - 16, 40, { color: C.MUTED }); return; }
    const covered = Math.max(0, Math.min(k, r));                               // bagian pendapatan yang terpakai biaya
    if (covered > 0) b.rect(cx - bw / 2, f.yOf(covered), bw, y0 - f.yOf(covered), C.NEUTRAL);
    if (p >= 0) {
      const yTop = f.yOf(r), h = f.yOf(covered) - yTop;
      if (h > 0) b.rect(cx - bw / 2, yTop, bw, h, C.GREEN);
      b.label(fmt(p, 1), cx, yTop - 15, lw, { weight: W.HEAVY, color: C.GREEN });
    } else {
      anyLoss = true;
      const yBot = f.yOf(p);
      b.rect(cx - bw / 2, y0, bw, yBot - y0, C.DANGER);
      b.label(fmt(p, 1), cx, yBot + 1, lw, { weight: W.HEAVY, color: C.DANGER });
    }
  });
  // Legenda: warna selalu disertai kata; baris kedua menjelaskan arti tinggi batang
  const items = [{ name: 'Biaya pekerja', color: C.NEUTRAL }, { name: 'Laba kotor', color: C.GREEN }]
    .concat(anyLoss ? [{ name: 'Rugi', color: C.DANGER }] : []);
  let lx = A.left + CH.PAD_LEFT + 6;
  const ly = A.top + 4;
  items.forEach(it => {
    b.rect(lx, ly - 4, 10, 8, it.color);
    const w = it.name.length * 4.8 + 18;
    b.label(it.name, lx + 20, ly - 7, w, { align: 'START', color: C.MUTED });
    lx += 20 + w + 8;
  });
  b.label('Tinggi batang = pendapatan (Rp juta); angka = laba kotor', A.left + CH.PAD_LEFT + 6, ly + 8, 300, { align: 'START', color: C.MUTED });
}

/** Nama pendek slide lampiran untuk tombol (maks. ±18 karakter) dan Daftar Lampiran. */
const SHORT_TITLES = {
  scorecard: 'Tabel kinerja', blokprod: 'Produktivitas blok', tanah: 'Jenis tanah', pupuk: 'Status pupuk', produksi: 'Tren TBS terjual', panen: 'Luas panen', yield: 'Yield per ha', marihat: 'Std. Marihat',
  jjg: 'Janjang/ha', bjr: 'BJR', umur: 'Umur tanaman', umuryield: 'Umur vs yield', replanting: 'Replanting',
  alurjjg: 'Alur janjang', restan: 'Panen vs muat', tanpaberat: 'Penjualan belum diinput', blokunsale: 'Blok tanpa jual',
  laba: 'Laba kotor', biayakg: 'Biaya per kg', efisiensi: 'Porsi biaya', biayakomposisi: 'Komposisi biaya', biayaha: 'Biaya per ha',
  upkeep: 'Perawatan per bulan', upkeepakt: 'Pekerjaan perawatan', margin: 'Margin per ha', mandorpanen: 'Mandor panen', mandormuat: 'Mandor muat', rawat: 'Mandor rawat'
};
function shortTitle(t, long) { return long ? t.title : (SHORT_TITLES[t.id] || t.title); }

/** Tinggi kartu INSIGHT (rumus sama dengan fitInsightCard) untuk menempatkan tombol lampiran di bawahnya. */
function insightCardHeight(text) {
  const L = DECK_CONFIG.LAYOUT, T = DECK_CONFIG.TYPE, I = L.INSIGHT;
  const lines = estLines(text, T.BODY, I.width - 2 * I.padX);
  return Math.min(I.height, I.padTop + T.EYEBROW * 1.3 + 6.75 + lines * T.BODY * 1.6 + I.padBottom);
}

/** Insight cadangan slide ringkasan: kalimat pertama dari 2 topik terpenting (maks. 220 karakter). */
function fallbackMainInsight(m) {
  const first = t => String(t.fallback || '').split(/(?<=\.)\s/)[0];
  return trimToSentence([m.chartTopic].concat(m.members.filter(t => t !== m.chartTopic)).slice(0, 2).map(first).join(' '), AI_LIMITS.MAIN_INSIGHT_MAX_CHARS);
}
function fallbackMainNotes(m) {
  return `${m.title}: ${[m.lead].concat(m.members).filter(Boolean).map(t => String(t.fallback || '')).join(' ')}`.slice(0, AI_LIMITS.NOTES_MAX_CHARS);
}

const STORY = [
  { id: 'scorecard', section: 'Kinerja Bulan Ini', title: null,
    q: 'Bagaimana kebun bulan ini: berapa TBS terjual, berapa uang masuk, berapa biaya pekerja, dan berapa yang tersisa?',
    link: 'Rincian lengkap slide Kinerja Bulan Ini: semua angka penting bulan laporan dalam satu tabel, dibandingkan dengan bulan lalu dan rata-rata.' },
  { id: 'produksi', section: 'Hasil Produksi', title: null,
    q: 'Bagaimana tren ton TBS terjual dari bulan ke bulan?',
    link: 'Rincian baris TBS terjual pada tabel kinerja: trennya selama periode. Produksi = luas panen × yield, dua komponen ini dibahas berikutnya.' },
  { id: 'panen', section: 'Hasil Produksi', title: 'Luas Panen',
    q: 'Seberapa luas area yang dipanen, dan apakah itu yang menggerakkan naik-turun produksi?',
    link: 'Komponen pertama produksi pada slide sebelumnya.' },
  { id: 'yield', section: 'Hasil Produksi', title: 'Yield per Hektar',
    q: 'Berapa hasil per hektar, dan apakah produktivitasnya ikut naik saat luas panen naik?',
    link: 'Komponen kedua produksi: hasil per hektar dari luas panen pada slide sebelumnya.' },
  { id: 'marihat', section: 'Hasil Produksi', title: 'Pencapaian vs Standar Marihat',
    q: 'Seberapa jauh hasil kebun dari potensi standar Marihat (PPKS) untuk umur tanaman dan kelas lahannya?',
    link: 'Yield dibandingkan dengan potensi standar Marihat sesuai umur blok, sehingga terlihat besar peluang yang belum tergarap.' },
  { id: 'alurjjg', section: 'Alur Panen ke Muat Tidak Tercatat', title: 'Alur Janjang Bulan Laporan',
    q: 'Dari janjang yang dipanen pada bulan laporan, berapa yang sudah tercatat dimuat dan terjual dibanding bulan lalu, dan di tahap mana pencatatannya terputus?',
    link: 'Setelah melihat hasil bulan ini, ditelusuri apakah setiap janjang yang dipanen sudah tercatat sampai menjadi uang, dan di tahap mana pencatatannya terputus.' },
  { id: 'tanpaberat', section: 'Alur Panen ke Muat Tidak Tercatat', title: 'Data Penjualan Belum Diinput',
    q: 'Berapa janjang yang sudah keluar kebun tetapi data penjualannya (berat/tiket timbang) belum diinput, dan berapa nilainya?',
    link: 'Janjang yang sudah keluar kebun belum tentu diinput penjualannya; selama belum diinput, tonase dan pendapatan tampak lebih kecil.' },
  { id: 'blokunsale', section: 'Alur Panen ke Muat Tidak Tercatat', title: 'Blok Tanpa Penjualan',
    q: 'Blok mana yang berulang kali tidak tercatat menjual janjang?',
    link: 'Menelusuri pencatatan sampai ke tingkat blok: blok yang dipanen tetapi tidak tercatat menjual.' },
  { id: 'restan', section: 'Alur Panen ke Muat Tidak Tercatat', title: 'Selisih Panen vs Muat per Bulan',
    q: 'Bulan apa janjang panen paling banyak belum tercatat dimuat?',
    link: 'Rincian per bulan dari tahap panen ke muat pada corong alur janjang.' },
  { id: 'jjg', section: 'Faktor Penentu Yield', title: 'Janjang Terjual per Hektar',
    q: 'Berapa janjang terjual per hektar luas panen, dan apakah berubah?',
    link: 'Mengapa hasil naik-turun: yield = JJG/ha × BJR. Dilihat dulu jumlah tandan per hektar.' },
  { id: 'blokprod', section: 'Faktor Penentu Yield', title: 'Produktivitas per Blok',
    q: 'Blok mana yang janjangnya jauh di bawah standar untuk umurnya, apa kemungkinan penyebabnya (hara, rotasi panen, umur), dan berapa potensi yang belum tercapai?',
    link: 'JJG/ha kebun (slide sebelumnya) dirinci per blok dan dibandingkan dengan standar Marihat sesuai umur tiap blok.' },
  { id: 'bjr', section: 'Faktor Penentu Yield', title: 'Berat Janjang Rata-rata (BJR)',
    q: 'Apakah berat tiap tandan berubah?',
    link: 'Faktor kedua yield: berat tandan. Bersama JJG/ha pada slide sebelumnya, keduanya menjelaskan yield.' },
  { id: 'umur', section: 'Kondisi Tanaman', title: 'Struktur Umur Tanaman',
    q: 'Seberapa tua tanaman di blok-blok yang dipanen?',
    link: 'Mengapa JJG/ha dan BJR seperti itu: umur tanaman menentukan jumlah dan berat tandan.' },
  { id: 'tanah', section: 'Kondisi Tanaman', title: 'Jenis Tanah Blok',
    q: 'Di jenis tanah apa blok-blok kebun berada, apa kendala haranya, dan berapa luas yang belum tercatat jenis tanahnya?',
    link: 'Selain umur, jenis tanah menentukan hara yang kurang dan dosis pupuk yang tepat untuk setiap pokok.' },
  { id: 'pupuk', section: 'Kondisi Tanaman', title: 'Status Pemupukan Kebun',
    q: 'Apakah pohon di kebun ini terindikasi kurang atau kelebihan pupuk, apa buktinya, dan bagaimana memastikannya?',
    link: 'Dari hasil per umur tanaman, catatan pemupukan, dan jenis tanah (slide sebelumnya) dinilai indikasi kurang atau kelebihan pupuk; kepastiannya lewat uji daun dan uji tanah Dokter Sawit.' },
  { id: 'umuryield', section: 'Kondisi Tanaman', title: 'Umur Blok Dipanen per Bulan',
    q: 'Apakah bulan yang didominasi blok tua menghasilkan yield lebih rendah?',
    link: 'Menghubungkan struktur umur (slide sebelumnya) dengan yield bulanan.' },
  { id: 'replanting', section: 'Kondisi Tanaman', title: 'Kandidat Peremajaan (Replanting)',
    q: 'Blok mana yang sudah lewat umur ekonomis dan perlu direncanakan peremajaannya?',
    link: 'Tindak lanjut dari struktur umur: daftar blok berumur lebih dari 25 tahun.' },
  { id: 'laba', section: 'Keuangan Kebun', title: 'Laba Kotor per Bulan',
    q: 'Berapa uang yang tersisa setiap bulan setelah biaya pekerja, dan bulan mana yang paling rendah?',
    link: 'Dari hasil dan pencatatan alur panen ke uang: pendapatan dikurangi biaya pekerja setiap bulan (belum termasuk biaya material).' },
  { id: 'biayakomposisi', section: 'Keuangan Kebun', title: 'Komposisi Biaya Pekerja per Bulan',
    q: 'Biaya pekerja paling banyak untuk panen, perawatan, atau muat, dan bulan mana yang melonjak?',
    link: 'Rincian sisi biaya dari laba kotor pada slide sebelumnya: dari mana biaya pekerja berasal.' },
  { id: 'biayakg', section: 'Keuangan Kebun', title: 'Harga Jual dan Biaya Pekerja per Kg',
    q: 'Berapa harga jual setiap kg TBS dan berapa biaya pekerja per kg?',
    link: 'Biaya pekerja dibandingkan per kg dengan harga jual TBS.' },
  { id: 'efisiensi', section: 'Keuangan Kebun', title: 'Porsi Biaya Pekerja terhadap Harga Jual',
    q: 'Berapa persen harga jual yang terpakai untuk biaya pekerja?',
    link: 'Membandingkan dua garis pada slide sebelumnya dalam satu angka persentase.' },
  { id: 'biayaha', section: 'Keuangan Kebun', title: 'Pendapatan vs Biaya per Hektar',
    q: 'Berapa pendapatan dan biaya setiap hektar per bulan?',
    link: 'Pendapatan/ha = yield × harga jual; dibandingkan dengan biaya per hektar.' },
  { id: 'upkeep', section: 'Keuangan Kebun', title: 'Biaya Perawatan per Bulan',
    q: 'Berapa biaya perawatan setiap bulan dan untuk pekerjaan apa (pemupukan, gulma, tanaman, jalan)?',
    link: 'Rincian isi biaya perawatan per bulan dan kategori pekerjaan.' },
  { id: 'upkeepakt', section: 'Keuangan Kebun', title: 'Pekerjaan Perawatan Bulan Laporan',
    q: 'Pekerjaan perawatan apa yang paling besar bulan ini, dan mana yang melonjak dibanding biasanya?',
    link: 'Membandingkan tiap pekerjaan dengan bulan lalu dan rata-rata untuk menemukan lonjakan atau salah input.' },
  { id: 'margin', section: 'Keuangan Kebun', title: 'Margin per Hektar',
    q: 'Berapa sisa uang per hektar setelah biaya, dan bulan mana yang merugi?',
    link: 'Hasil akhir keuangan per hektar: pendapatan dikurangi biaya.' },
  { id: 'mandorpanen', section: 'Tenaga Kerja', title: 'Produktivitas Mandor Panen',
    q: 'Seberapa produktif tim panen dalam 3 bulan terakhir?',
    link: 'Selain kondisi tanaman dan biaya, jumlah janjang yang terambil juga ditentukan tim yang memanen.' },
  { id: 'mandormuat', section: 'Tenaga Kerja', title: 'Produktivitas Mandor Muat',
    q: 'Apakah kapasitas muat mengimbangi janjang yang dipanen?',
    link: 'Janjang yang dipanen (slide sebelumnya) harus segera dimuat agar tidak restan.' },
  { id: 'rawat', section: 'Tenaga Kerja', title: 'Mandor Rawat',
    q: 'Aktivitas perawatan apa yang dikerjakan, berapa hari, dan seberapa produktif?',
    link: 'Perawatan (pemupukan, pruning, semprot) menentukan jumlah dan berat janjang bulan-bulan berikutnya.' },
  { id: 'anomali', section: 'Anomali Data', title: 'Anomali yang Perlu Ditindaklanjuti',
    q: 'Angka mana yang janggal, mengapa penting, dan apa yang harus dicek owner?',
    link: 'Setelah seluruh rantai produksi sampai keuangan dibahas, dikumpulkan angka-angka yang tidak wajar atau tidak konsisten.' },
  { id: 'kesimpulan', section: 'Rekomendasi', title: 'Kesimpulan & Rekomendasi',
    q: 'Apa yang perlu dilakukan owner?', link: 'Merangkum seluruh rantai sebab-akibat menjadi tindakan.' }
];

function applyStory(topics) {
  const out = [];
  STORY.forEach(s => {
    const t = topics.find(x => x.id === s.id);
    if (!t) return;
    t.section = s.section;
    if (s.title) t.title = s.title;
    t.question = s.q;
    t.link = s.link;
    out.push(t);
  });
  topics.filter(t => out.indexOf(t) < 0).forEach(t => out.push(t));   // topik tambahan di akhir
  for (let i = 0; i < out.length; i++) out[i].prev = i > 0 ? out[i - 1] : null;
  return out;
}

/** Teks penghubung default (dipakai bila AI gagal). */
function fallbackBridge(t) {
  return t.prev ? `Dari slide ${t.prev.page} (${t.prev.title}): ${t.link}` : t.link;
}

function toRoman(n) {
  return ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'][n - 1] || String(n);
}

/** Sorotan kuning label "Bagian I" dipersempit mengikuti panjang teks (SectionLabel CBR, padding 6px). */
function fitSectionLabel(slide, label) {
  const S = DECK_CONFIG.LAYOUT.SECTION_TEXT;
  const w = estWidth(label, DECK_CONFIG.TYPE.SECTION_LABEL, true) + 6.75 + 2 * DECK_CONFIG.TEXT_INSET.X;
  slide.getShapes().forEach(sh => {
    try {
      // hanya kotak sorotan kuning (baris paling atas), bukan judul bagian
      if (Math.abs(sh.getTop() - S.top) < 2 && sh.getText().asString().trim() === label) sh.setWidth(w);
    } catch (e) { /* abaikan */ }
  });
}

function stripBold(t) { return String(t || '').replace(/\*\*/g, ''); }

/**
 * Ganti placeholder dengan teks; bagian **...** ditebalkan (ink, Bold) sesuai aturan CBR
 * ("bold satu atau dua angka kunci"). Gaya teks lain mengikuti placeholder.
 */
function writeWithBold(slide, placeholder, text) {
  const plain = stripBold(text);
  const ranges = [];
  let pos = 0;
  String(text || '').split('**').forEach((part, i) => { if (i % 2 === 1 && part) ranges.push([pos, pos + part.length]); pos += part.length; });
  const shape = slide.getShapes().find(sh => { try { return sh.getText().asString().indexOf(placeholder) >= 0; } catch (e) { return false; } });
  slide.replaceAllText(placeholder, plain);
  if (!shape) return;
  const tr = shape.getText();
  const base = tr.asString().indexOf(plain);
  if (base < 0) return;
  ranges.slice(0, 3).forEach(([a, b]) => {
    try { tr.getRange(base + a, base + b).getTextStyle().setFontFamilyAndWeight(DECK_CONFIG.FONT.BODY, DECK_CONFIG.WEIGHT.TITLE).setForegroundColor(DECK_CONFIG.COLOR.INK); }
    catch (e) { /* abaikan */ }
  });
}

/**
 * InsightCard mengikuti panjang teks dan menempel ke atas (tidak meregang setinggi tabel):
 * tinggi = padding atas 28px + label + 12px + teks + padding bawah 36px.
 * Kartu dikenali dari posisi kiri DAN atas serta isinya kosong, agar tombol lampiran
 * (juga ROUND_RECTANGLE di kolom yang sama) tidak ikut diubah tingginya.
 */
function fitInsightCard(slide, text) {
  const L = DECK_CONFIG.LAYOUT, T = DECK_CONFIG.TYPE, I = L.INSIGHT;
  const lines = estLines(text, T.BODY, I.width - 2 * I.padX);
  const textH = lines * T.BODY * 1.6;
  const need = I.padTop + T.EYEBROW * 1.3 + 6.75 + textH + I.padBottom;
  const cardH = Math.min(I.height, need);
  if (need > I.height) RUN_WARNINGS.push('Insight terlalu panjang untuk kartunya; persingkat menjadi 2–3 kalimat.');
  slide.getShapes().forEach(sh => {
    try {
      const txt = sh.getText().asString().trim();
      const isCard = sh.getShapeType() === SlidesApp.ShapeType.ROUND_RECTANGLE &&
        Math.abs(sh.getLeft() - I.left) < 2 && Math.abs(sh.getTop() - I.top) < 2 && txt === '';
      if (isCard) sh.setHeight(cardH);
      else if (txt === String(text).trim()) sh.setHeight(textH + 2 * DECK_CONFIG.TEXT_INSET.Y);   // kotak = area teks + jarak dalam
    } catch (e) { /* abaikan */ }
  });
}

/**
 * Isi kartu INSIGHT. Bila teksnya kosong, seluruh kartu (kotak, label INSIGHT, placeholder) dihapus
 * agar tidak ada kotak kosong di slide.
 */
function writeInsight(slide, text) {
  const plain = stripBold(text).trim();
  if (!plain) { removeInsightCard(slide); return; }
  writeWithBold(slide, '{{ai_insight}}', text);
  fitInsightCard(slide, plain);
}

/** Hapus kartu INSIGHT (kotak di posisi rancangan, label "INSIGHT", dan placeholder {{ai_insight}}). */
function removeInsightCard(slide) {
  const I = DECK_CONFIG.LAYOUT.INSIGHT;
  slide.getShapes().forEach(sh => {
    try {
      const txt = sh.getText().asString().trim();
      const isCard = sh.getShapeType() === SlidesApp.ShapeType.ROUND_RECTANGLE &&
        Math.abs(sh.getLeft() - I.left) < 2 && Math.abs(sh.getTop() - I.top) < 2 && txt === '';
      if (isCard || txt === 'INSIGHT' || txt.indexOf('{{ai_insight}}') >= 0) sh.remove();
    } catch (e) { /* abaikan */ }
  });
}

/** True bila judul muat satu baris slide-title (40px Bold) di lebar judul. */
function titleFits(text) {
  return estWidth(text, DECK_CONFIG.TYPE.SLIDE_TITLE, true) <= DECK_CONFIG.LAYOUT.TITLE.width;
}

/** Bagikan deck ke editor (sebagai editor) dan viewer (sebagai viewer) spreadsheet. Google dapat mengirim email notifikasi berbagi. */
function shareDeckWithSheetUsers(file, ss) {
  if (!DECK_CONFIG.SHARE_WITH_SHEET_USERS) return;
  const me = (Session.getActiveUser().getEmail() || '').toLowerCase();
  const emails = u => u.map(x => x.getEmail()).filter(e => e && e.toLowerCase() !== me);
  try {
    const ed = emails(ss.getEditors()), vw = emails(ss.getViewers()).filter(e => ed.indexOf(e) < 0);
    if (ed.length) file.addEditors(ed);
    if (vw.length) file.addViewers(vw);
  } catch (e) {
    RUN_WARNINGS.push(`Deck belum otomatis dibagikan: ${e.message}`);
  }
}

function findShapeInPresentation(pres, text) {
  for (const slide of pres.getSlides()) {
    for (const sh of slide.getShapes()) {
      try { if (sh.getText().asString().indexOf(text) >= 0) return sh; } catch (e) { /* tanpa teks */ }
    }
  }
  return null;
}

function escHtml(t) { return String(t === null || t === undefined ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

function showSuccessModal(slideUrl, rawName, aiOk) {
  const name = escHtml(rawName);
  slideUrl = /^https:\/\/docs\.google\.com\//.test(slideUrl) ? slideUrl : '#';
  Logger.log(`Deck dibuat: ${slideUrl}`);
  const warn = RUN_WARNINGS.length
    ? `<p style="color:#b45309"><b>Catatan:</b><br>${RUN_WARNINGS.map(escHtml).join('<br>')}</p>` : '';
  const note = (aiOk ? '' : '<p style="color:#b45309">Jawaban Claude tidak dipakai, teks diisi otomatis dari data. Lihat catatan di bawah untuk penyebabnya.</p>') + warn;
  try {
    const html = HtmlService.createHtmlOutput(`
      <div style="font-family:Arial,sans-serif;padding:12px;line-height:1.5">
        <p>Monthly Report KebunPRO untuk <b>${name}</b> berhasil dibuat.</p>
        ${note}
        <p><a href="${slideUrl}" target="_blank" style="color:#007200;font-weight:bold;text-decoration:none">Buka Google Slides</a></p>
      </div>`).setWidth(460).setHeight(RUN_WARNINGS.length || !aiOk ? 320 : 170);
    SpreadsheetApp.getUi().showModalDialog(html, 'Deck siap');
  } catch (e) { /* konteks non-UI */ }
}

function showErrorAlert(message) {
  Logger.log(`[ERROR] ${message}`);
  try { SpreadsheetApp.getUi().alert(message); } catch (e) { /* konteks non-UI */ }
}

function onOpen() {
  try {
    SpreadsheetApp.getUi().createMenu('🚀 Auto Presentation')
      .addItem('1. Salin Paket Data untuk Claude', 'showClaudePacket')
      .addItem('2. Generate Slide Customer Saat Ini', 'generateCustomerDeck')
      .addSeparator()
      .addItem('Validasi semua sheet customer', 'validateAllSheets')
      .addItem('Siapkan Template SawitPRO (khusus admin)', 'setupTemplate')
      .addToUi();
  } catch (e) { /* konteks non-UI */ }
}

/**
 * Memeriksa SEMUA sheet customer tanpa membuat deck. Juga menunjukkan apakah sel jawaban Claude (D1, D2, ...) sudah terisi.
 * Sheet tanpa header 'ton/ha' (mis. sheet catatan) otomatis dilewati.
 * Menampilkan per customer: bulan dianalisis, mode, data yang belum ada, slide yang akan muncul, dan peringatan.
 */
function validateAllSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const rows = [];
  ss.getSheets().forEach(sh => {
    RUN_WARNINGS = [];
    const view = maskedSheetView(sh);
    const values = view.getDataRange().getValues();
    if (!findCell(values, DECK_CONFIG.HEADERS.YIELD)) return;
    try {
      const d = loadSheetData(sh);
      const rb = readAnswerBlocks(sh);
      const topics = buildTopics(d);
      topics.forEach((t, i) => { t.page = i + 4; });
      const anomalies = detectAnomalies(topics, d).filter(a => !/bulan berjalan/.test(a.text));
      rows.push({
        sheet: sh.getName(), title: d.title, location: d.location || '(kosong)',
        months: `${d.months} bln (${d.dataPeriod || '-'})${d.partialMonth ? `, ${d.partialMonth} dikecualikan` : ''}`,
        mode: d.snapshot ? 'Ringkasan (tren tidak dianalisis)' : 'Lengkap',
        slides: topics.length, claude: rb.blocks.length ? `${rb.blocks.length} sel (${rb.blocks.map(b => b.a1).join(', ')})${rb.errors.length ? ', ada yang rusak' : ''}` : 'kosong',
        missing: checkDataCompleteness(d).join(', ') || '-',
        notes: anomalies.slice(0, 4).map(a => a.text.slice(0, 140)).join('<br>') || '-'
      });
    } catch (e) {
      rows.push({ sheet: sh.getName(), title: '-', location: '-', months: '-', mode: 'GAGAL DIBACA', slides: 0, claude: '-', missing: '-', notes: e.message });
    }
  });
  const esc = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/&lt;br>/g, '<br>');
  const html = `<div style="font-family:Arial,sans-serif;font-size:12px">
    <p>${rows.length} sheet customer terdeteksi.</p>
    <table style="border-collapse:collapse;width:100%">
      <tr style="background:#007200;color:#fff">${['Sheet', 'Title', 'Lokasi', 'Data', 'Mode', 'Slide', 'Jawaban Claude', 'Data belum ada', 'Catatan teratas'].map(h => `<th style="padding:6px;text-align:left">${h}</th>`).join('')}</tr>
      ${rows.map((r, i) => `<tr style="background:${i % 2 ? '#f4f9f6' : '#fff'};vertical-align:top">${[r.sheet, r.title, r.location, r.months, r.mode, r.slides, r.claude, r.missing, r.notes].map(c => `<td style="padding:6px;border-bottom:1px solid #e2e8f0">${esc(c)}</td>`).join('')}</tr>`).join('')}
    </table></div>`;
  if ((DECK_CONFIG.SECURITY || {}).LOG_AI_OUTPUT) Logger.log(JSON.stringify(rows, null, 1));
  try { SpreadsheetApp.getUi().showModalDialog(HtmlService.createHtmlOutput(html).setWidth(1100).setHeight(560), 'Validasi sheet customer'); } catch (e) { /* non-UI */ }
}
