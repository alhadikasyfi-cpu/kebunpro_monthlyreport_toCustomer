/**
 * File 2: TemplateBuilder.gs
 * Menyusun ulang "Deck Template" mengikuti design system SawitPRO CBR (Customer Business Report):
 *   1 Cover (latar cbr-cover.jpg)            {{TITLE}}, {{period}}, {{location}}
 *   2 Daftar Isi                              kartu agenda digambar script
 *   3 Ringkasan Eksekutif                     {{ai_description}} + kartu KPI digambar script
 *   4 MASTER pembatas bagian (cbr-section)    {{section_label}}, {{section_title}}, {{section_desc}}
 *   5 MASTER slide konten                     {{slide_title}}, kartu INSIGHT {{ai_insight}} (tinggi kartu disesuaikan isi saat generate)
 *   6 Penutup (latar cbr-closing.jpg)         "Terima Kasih" #TerusTumbuh
 * Logo SawitPRO HANYA di cover, pembatas bagian, dan penutup (sudah ada di gambar latar).
 * Slide isi tanpa logo: judul di margin kiri + garis border, {{page}} di kanan bawah.
 *
 * Jalankan setupTemplate() SEKALI (menu 🚀 Auto Presentation > Siapkan Template SawitPRO, khusus admin).
 * Sebelum mengubah, script membuat salinan cadangan template di folder yang sama. Link template tidak berubah.
 */

function setupTemplate() {
  if (!isAdminUser()) {
    const msg = 'Hanya admin (DECK_CONFIG.SECURITY.ADMIN_EMAILS) yang boleh menyiapkan ulang template.';
    try { SpreadsheetApp.getUi().alert(msg); } catch (e) { /* non-UI */ }
    throw new Error(msg);
  }
  const file = getTemplateFile();
  const parent = file.getParents().hasNext() ? file.getParents().next() : DriveApp.getRootFolder();
  const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HHmm');
  file.makeCopy(`${file.getName()} (backup ${stamp})`, parent);

  const pres = SlidesApp.openById(file.getId());
  const oldSlides = pres.getSlides();
  buildCoverSlide(pres);
  buildTocSlide(pres);
  buildIntroSlide(pres);
  buildSectionMasterSlide(pres);
  buildContentMasterSlide(pres);
  buildClosingSlide(pres);
  oldSlides.forEach(sl => sl.remove());
  pres.saveAndClose();

  const missing = ['COVER_BG', 'SECTION_BG', 'CLOSING_BG', 'LOGO'].filter(k => !getAssetBlob(k));
  const msg = `Template '${file.getName()}' sudah disusun ulang dengan design system SawitPRO CBR.` +
    (missing.length ? ` Gambar belum ditemukan: ${missing.map(k => DECK_CONFIG.ASSETS[k]).join(', ')} (upload ke folder aset lalu jalankan ulang).` : '');
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { /* konteks non-UI */ }
}

/** Template hanya diambil berdasarkan ID (tidak ada pencarian nama di seluruh Drive). */
function getTemplateFile() {
  if (!DECK_CONFIG.TEMPLATE_ID) throw new Error('TEMPLATE_ID belum diisi di DECK_CONFIG.');
  return DriveApp.getFileById(DECK_CONFIG.TEMPLATE_ID);
}

/** True bila user boleh menjalankan fungsi admin (ADMIN_EMAILS kosong = semua editor). */
function isAdminUser() {
  const admins = ((DECK_CONFIG.SECURITY || {}).ADMIN_EMAILS || []).map(e => String(e).trim().toLowerCase()).filter(Boolean);
  if (!admins.length) return true;
  const me = String(Session.getActiveUser().getEmail() || '').toLowerCase();
  return !!me && admins.indexOf(me) >= 0;
}

function newBlankSlide(pres, bg) {
  const slide = pres.appendSlide(SlidesApp.PredefinedLayout.BLANK);
  slide.getBackground().setSolidFill(bg || DECK_CONFIG.COLOR.SURFACE);
  return slide;
}

/** Latar foto penuh; bila gambar belum ada, gambar ulang unsur utamanya (logo, garis, pita hijau). */
function setPhotoBackground(slide, key, fallback) {
  const blob = getAssetBlob(key);
  if (blob) { slide.getBackground().setPictureFill(blob); return true; }
  if (fallback) fallback(slide);
  return false;
}

function drawHeaderFallback(slide) {
  const L = DECK_CONFIG.LAYOUT, C = DECK_CONFIG.COLOR;
  addAssetImage(slide, 'LOGO', L.MARGIN - 18, 8, 38, 38);
  const ln = slide.insertLine(SlidesApp.LineCategory.STRAIGHT, L.MARGIN, 50, L.RIGHT, 50);
  ln.getLineFill().setSolidFill(C.GREEN); ln.setWeight(0.75);
}

function drawFooterBandFallback(slide) {
  const L = DECK_CONFIG.LAYOUT, C = DECK_CONFIG.COLOR;
  addRect(slide, 8, 374, 704, 22, C.GREEN, { round: true });
  addText(slide, 'Materi Milik SawitPRO      SawitPRO.id      Dilarang mempergunakan dan menyebarkan isi materi tanpa izin dari SawitPRO',
    20, 374, 680, 22, { size: DECK_CONFIG.TYPE.FOOTER, color: C.ON_GREEN, valign: 'MIDDLE', weight: DECK_CONFIG.WEIGHT.STRONG });
}

/** Cover: eyebrow, nama pelanggan (ExtraBold ink), lalu Periode & Lokasi (label muted, nilai ExtraBold hijau). */
function buildCoverSlide(pres) {
  const C = DECK_CONFIG.COLOR, L = DECK_CONFIG.LAYOUT, T = DECK_CONFIG.TYPE, W = DECK_CONFIG.WEIGHT;
  const slide = newBlankSlide(pres);
  setPhotoBackground(slide, 'COVER_BG', sl => {
    drawHeaderFallback(sl);
    addRect(sl, 8, 247, 704, 170, C.GREEN, { round: true });
  });
  const x = L.COVER_TEXT.left, y = L.COVER_TEXT.top, w = L.COVER_TEXT.width;
  addText(slide, 'MONTHLY REPORT KEBUNPRO', x, y, w, 12, { size: T.EYEBROW, weight: W.HEAVY, color: C.GREEN });
  addText(slide, '{{TITLE}}', x, y + 16, w, 46, { size: T.COVER_NAME, weight: W.HEAVY, color: C.INK, valign: 'MIDDLE' });
  const meta = addText(slide, 'Periode: {{period}}\nLokasi: {{location}}', x, y + 70, w, 40,
    { size: T.META, color: C.MUTED, lineSpacing: 140 });
  const tr = meta.getText(), str = tr.asString();
  [['Periode: ', '{{period}}'], ['Lokasi: ', '{{location}}']].forEach(([label, ph]) => {
    const i = str.indexOf(ph);
    if (i >= 0) tr.getRange(i, i + ph.length).getTextStyle().setFontFamilyAndWeight(DECK_CONFIG.FONT.BODY, W.HEAVY).setForegroundColor(C.GREEN);
  });
  return slide;
}

/** Daftar Isi: judul saja; baris agenda digambar script sesuai bagian yang muncul. */
function buildTocSlide(pres) {
  const slide = newBlankSlide(pres);
  addSlideTitle(slide, 'Daftar Isi');
  addContentChrome(slide);
  return slide;
}

/** Ringkasan Eksekutif: paragraf pembuka (body-lg muted); kartu KPI digambar script di bawahnya. */
function buildIntroSlide(pres) {
  const T = DECK_CONFIG.TYPE, L = DECK_CONFIG.LAYOUT;
  const slide = newBlankSlide(pres);
  addSlideTitle(slide, 'Ringkasan Eksekutif');
  // sp-lead 20px: 2–4 baris; kartu KPI (digambar script) mengisi sisa tinggi sampai footer
  addText(slide, '{{ai_description}}', L.MARGIN, L.BODY_TOP, L.RIGHT - L.MARGIN, 4 * T.LEAD * 1.55,
    { size: T.LEAD, color: DECK_CONFIG.COLOR.MUTED, lineSpacing: 155 });
  addContentChrome(slide);
  return slide;
}

/** MASTER pembatas bagian: label "Bagian I" (hijau di sorotan kuning), judul bagian, satu baris penjelasan. */
function buildSectionMasterSlide(pres) {
  const C = DECK_CONFIG.COLOR, L = DECK_CONFIG.LAYOUT, T = DECK_CONFIG.TYPE, W = DECK_CONFIG.WEIGHT;
  const slide = newBlankSlide(pres);
  setPhotoBackground(slide, 'SECTION_BG', sl => {
    drawHeaderFallback(sl);
    addRect(sl, 422, 0, 290, 366, C.GREEN, { round: true });
    drawFooterBandFallback(sl);
  });
  const x = L.SECTION_TEXT.left, y = L.SECTION_TEXT.top, w = L.SECTION_TEXT.width;
  // SectionLabel: sorotan kuning sempit mengikuti teks (lebar disetel ulang saat generate)
  const lbl = slide.insertTextBox('{{section_label}}', x - 3.4, y, 80, 20);   // padding 6px; lebar disetel saat generate
  lbl.getFill().setSolidFill(C.YELLOW); lbl.getBorder().setTransparent();
  styleTextRange(lbl.getText(), { size: T.SECTION_LABEL, weight: W.HEAVY, color: C.GREEN, align: 'CENTER' });
  lbl.setContentAlignment(SlidesApp.ContentAlignment.MIDDLE);
  addText(slide, '{{section_title}}', x, y + 30, w, 92, { size: T.SECTION_TITLE, weight: W.HEAVY, color: C.INK, lineSpacing: 105 });
  addText(slide, '{{section_desc}}', x, y + 128, w, 36, { size: T.LEAD, color: C.MUTED, lineSpacing: 155 });
  return slide;
}

/** MASTER slide konten: judul, area grafik/tabel kiri (diisi script), kartu INSIGHT kanan. */
function buildContentMasterSlide(pres) {
  const C = DECK_CONFIG.COLOR, T = DECK_CONFIG.TYPE, L = DECK_CONFIG.LAYOUT, W = DECK_CONFIG.WEIGHT;
  const slide = newBlankSlide(pres);
  addSlideTitle(slide, '{{slide_title}}');
  // InsightCard: padding 28px sisi & atas, 36px bawah; label INSIGHT 15px; isi 18px, line-height 1,6.
  // Tinggi kartu disesuaikan dengan panjang teks saat generate (kartu menempel ke atas, tidak meregang).
  const I = L.INSIGHT;
  addRect(slide, I.left, I.top, I.width, I.height, C.TINT, { round: true, border: C.BORDER });
  addText(slide, 'INSIGHT', I.left + I.padX, I.top + I.padTop, I.width - 2 * I.padX, T.EYEBROW * 1.3,
    { size: T.EYEBROW, weight: W.HEAVY, color: C.GREEN });
  const tTop = I.top + I.padTop + T.EYEBROW * 1.3 + 6.75;
  addText(slide, '{{ai_insight}}', I.left + I.padX, tTop, I.width - 2 * I.padX, I.top + I.height - I.padBottom - tTop,
    { size: T.BODY, color: C.MUTED, lineSpacing: 160 });
  addContentChrome(slide);
  return slide;
}

/** Penutup: "Terima Kasih" + #TerusTumbuh di area putih di bawah foto. */
function buildClosingSlide(pres) {
  const C = DECK_CONFIG.COLOR, L = DECK_CONFIG.LAYOUT, T = DECK_CONFIG.TYPE, W = DECK_CONFIG.WEIGHT;
  const slide = newBlankSlide(pres);
  setPhotoBackground(slide, 'CLOSING_BG', sl => {
    addRect(sl, 0, 0, 720, 191, C.GREEN);
    addAssetImage(sl, 'LOGO', 560, 120, 110, 110);   // logo hanya di cover, pembatas, dan penutup
    drawFooterBandFallback(sl);
  });
  const x = L.CLOSING_TEXT.left, y = L.CLOSING_TEXT.top, w = L.CLOSING_TEXT.width;
  addText(slide, 'Terima Kasih', x, y, w, 46, { size: T.SECTION_TITLE, weight: W.HEAVY, color: C.INK, valign: 'MIDDLE' });
  addText(slide, '#TerusTumbuh', x, y + 50, w, 22, { size: T.METRIC, weight: W.HEAVY, color: C.GREEN, valign: 'MIDDLE' });
  return slide;
}
