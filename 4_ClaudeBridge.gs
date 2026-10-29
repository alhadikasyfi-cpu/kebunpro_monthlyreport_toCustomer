/**
 * File 4: ClaudeBridge.gs
 * Script TIDAK memanggil API AI apa pun (tanpa UrlFetchApp, tanpa API key, tanpa izin keluar internet).
 * Teks narasi deck (judul, insight, speaker notes, ringkasan, temuan, rekomendasi) ditulis Claude DI CHAT,
 * lalu ditempel pengguna ke sel D1, D2, D3, ... pada sheet customer.
 *
 * Alur:
 *  1. Menu "1. Salin Paket Data untuk Claude" -> showClaudePacket(): script menghitung analisis sheet aktif dan menampilkan
 *     PAKET DATA (siap tempel ke chat Claude setelah PANDUAN_CLAUDE.md).
 *  2. Claude membalas beberapa blok JSON satu baris; pengguna menempelkannya ke D1, D2, D3, ...
 *  3. Menu "2. Generate Slide Customer Saat Ini" -> loadClaudeAnswer() membaca D1.. sebagai pengganti AI.
 *     Sel kosong / JSON rusak / tidak cocok -> teks cadangan dari data (fallback* di bagian bawah file ini).
 *
 * Pengaman:
 *  - ID_PAKET (hash isi paket) dicocokkan: jawaban sheet customer lain atau data yang sudah berubah terdeteksi.
 *  - Nama orang & lokasi disamarkan (alias) di paket dan dikembalikan saat jawaban dibaca (ANONYMIZE_FOR_AI).
 *  - Sel jawaban disembunyikan dari pembaca data kebun (maskedSheetView), jadi tidak mengganggu pembacaan tabel.
 */

const IMPACT_OPTIONS = ['produksi naik', 'mutu TBS membaik', 'biaya turun', 'pendapatan naik', 'risiko berkurang', 'data lebih akurat'];
const TIMELINE_OPTIONS = ['segera (bulan ini)', '1–3 bulan', '3–12 bulan'];

const AI_LIMITS = { HEADLINE_MAX_CHARS: 45, MAIN_INSIGHT_MAX_CHARS: 220, SUMMARY_MAX_CHARS: 380, INSIGHT_MAX_CHARS: 300, BRIDGE_MAX_CHARS: 150, NOTES_MAX_CHARS: 1200, ACTION_TITLE: 60, ACTION_DETAIL: 155,
                    AGENDA_TITLE: 40, AGENDA_DESC: 60, OUTCOME_MAX_CHARS: 90 };

/** Catatan peringatan selama satu kali generate (ditampilkan di dialog akhir). */
var RUN_WARNINGS = [];

function trimToSentence(text, maxChars, keepBold) {
  // keepBold: pertahankan penanda **...** (angka kunci ditebalkan di slide); markdown lain dibuang
  let t = String(text || '');
  t = keepBold ? t.replace(/\*\*/g, '\u0001').replace(/[*#`]/g, '').replace(/\u0001/g, '**') : t.replace(/[*#`]/g, '');
  t = t.replace(/\s+/g, ' ').trim();
  const visible = t.replace(/\*\*/g, '');
  if (visible.length <= maxChars) return t;
  const cut = t.slice(0, maxChars + (t.length - visible.length));
  // akhir kalimat = tanda titik/tanya/seru yang diikuti spasi (titik ribuan seperti 1.842 tidak dihitung)
  let end = -1;
  cut.replace(/[.!?](?=\s)/g, (m, i) => { end = i; return m; });
  let out = end > maxChars * 0.35 ? cut.slice(0, end + 1) : cut.replace(/\s+\S*$/, '') + '.';
  if ((out.match(/\*\*/g) || []).length % 2) out = out.replace(/\*\*(?!.*\*\*)/, '');   // penanda tebal tak berpasangan
  return out;
}

/**
 * Bersihkan judul dari AI: tanpa markdown, tanpa titik akhir, dan harus muat SATU baris slide-title.
 * Judul yang tidak muat dikosongkan (script lalu memakai judul otomatis dari data, lalu nama topik).
 */
function cleanHeadline(text, where) {
  const h = String(text || '').replace(/[*#`]/g, '').replace(/\s+/g, ' ').trim().replace(/[.。]$/, '');
  if (!h) return '';
  if (!titleFits(h)) {
    RUN_WARNINGS.push(`Judul ${where} "${h}" lebih dari satu baris; dipakai judul otomatis.`);
    return '';
  }
  return h;
}

/* ------------------------------------------------------------------------- */
/* Sel jawaban Claude di sheet customer (D1, D2, D3, ...)                     */
/* ------------------------------------------------------------------------- */

function tryUi() { try { return SpreadsheetApp.getUi(); } catch (e) { return null; } }

/** Daftar sel jawaban (DECK_CONFIG.CLAUDE_INPUT.CELLS), mis. ['D1','D2','D3','F1','F2','F3']. */
function claudeCells() { return (DECK_CONFIG.CLAUDE_INPUT.CELLS || ['D1', 'D2', 'D3', 'F1', 'F2', 'F3']).map(a => String(a).trim().toUpperCase()); }

/** Alamat sel jawaban ke-i: 0 = D1, 1 = D2, 2 = D3, 3 = F1, 4 = F2, 5 = F3 (urutan di CLAUDE_INPUT.CELLS). */
function claudeCellA1(i) {
  const cells = claudeCells();
  return cells[i] || `(sel ke-${i + 1} belum diatur)`;
}

/** "F1" -> {r: 0, c: 5} (indeks mulai 0). */
function a1ToRC(a1) {
  const m = String(a1).toUpperCase().match(/^([A-Z]+)(\d+)$/);
  if (!m) return null;
  const c = m[1].split('').reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0) - 1;
  return { r: Number(m[2]) - 1, c };
}

/** 8 karakter pertama hash MD5 (ID paket). */
function shortHash(text) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, text, Utilities.Charset.UTF_8);
  return bytes.map(b => ('0' + (b < 0 ? b + 256 : b).toString(16)).slice(-2)).join('').slice(0, 8);
}

/** True bila isi sel adalah blok jawaban Claude (JSON yang memuat packet_id). */
function isAiBlockText(v) {
  if (typeof v !== 'string') return false;
  const t = v.trim().replace(/^```(?:json)?\s*/i, '');
  return t.charAt(0) === '{' && t.indexOf('"packet_id"') > 0;
}

/** Kosongkan sel jawaban Claude pada salinan data (di memori) agar teks JSON besar tidak dibaca sebagai data kebun. */
function maskAiCells(grid) {
  claudeCells().map(a1ToRC).filter(Boolean).forEach(({ r, c }) => {
    if (grid[r] && grid[r].length > c && isAiBlockText(grid[r][c])) grid[r][c] = '';
  });
  return grid;
}

/**
 * Pembungkus sheet untuk getSheetData(): sama seperti sheet asli, tetapi sel jawaban Claude (D1, D2, ...) disembunyikan.
 * Sheet asli tidak diubah.
 */
function maskedSheetView(sheet) {
  return {
    getName: function () { return sheet.getName(); },
    getDataRange: function () {
      const rng = sheet.getDataRange();
      return {
        getValues: function () { return maskAiCells(rng.getValues()); },
        getDisplayValues: function () { return maskAiCells(rng.getDisplayValues()); }
      };
    }
  };
}

/** Parse satu blok jawaban: toleran pada pagar kode ``` dan teks di luar kurung kurawal. -> {value} | {error} */
function parseAnswerJson(raw) {
  const t = String(raw || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try { return { value: JSON.parse(t) }; } catch (e1) {
    const a = t.indexOf('{'), b = t.lastIndexOf('}');
    if (a >= 0 && b > a) {
      try { return { value: JSON.parse(t.slice(a, b + 1)) }; } catch (e2) { return { error: String(e2.message).slice(0, 140) }; }
    }
    return { error: String(e1.message).slice(0, 140) };
  }
}

/** Baca sel D1, D2, ... berurutan; berhenti di sel pertama yang bukan blok jawaban. -> {blocks:[{a1, obj|null}], errors:[]} */
function readAnswerBlocks(sheet) {
  const blocks = [], errors = [];
  for (let i = 0; i < claudeCells().length; i++) {
    const a1 = claudeCellA1(i);
    const v = sheet.getRange(a1).getValue();
    if (!isAiBlockText(v)) break;
    const p = parseAnswerJson(v);
    if (p.error) { errors.push(`Sel ${a1}: JSON tidak valid (${p.error}). Tempel ulang blok itu dari chat Claude.`); blocks.push({ a1, obj: null }); continue; }
    blocks.push({ a1, obj: p.value });
  }
  return { blocks, errors };
}

/** Gabungkan blok: kunci biasa digabung, `slides` disambung. -> {out, ids:[{a1, id}]} */
function mergeAnswerBlocks(blocks) {
  const out = { slides: [] }, ids = [];
  blocks.forEach(b => {
    if (!b.obj || typeof b.obj !== 'object') return;
    Object.keys(b.obj).forEach(k => {
      if (k === 'slides') out.slides = out.slides.concat(Array.isArray(b.obj.slides) ? b.obj.slides : []);
      else if (k === 'packet_id') ids.push({ a1: b.a1, id: String(b.obj.packet_id).trim() });
      else out[k] = b.obj[k];
    });
  });
  return { out, ids };
}

/* ------------------------------------------------------------------------- */
/* PAKET DATA untuk Claude (menu "1. Salin Paket Data untuk Claude")           */
/* ------------------------------------------------------------------------- */

/**
 * Paket = data & hasil analisis script untuk SATU kebun (angka, sinyal tren, anomali, katalog rekomendasi, struktur slide
 * dan nomor halamannya). Aturan menulis ada di PANDUAN_CLAUDE.md (ditempel sekali per chat Claude), bukan di sini.
 * ID_PAKET = hash isi paket; Claude menyalinnya ke setiap blok jawaban agar jawaban sheet lain / data lama terdeteksi.
 * Mengembalikan {text (sudah disamarkan bila ANONYMIZE_FOR_AI), id, blocks, cells}.
 */
function buildClaudePacket(data, plan) {
  const cfg = DECK_CONFIG.CLAUDE_INPUT, sec = DECK_CONFIG.SECURITY || {};
  const mains = plan.mains, leads = plan.leads, appendix = plan.appendix;
  const summaryMains = (plan.costMain ? [plan.costMain] : []).concat(mains);
  const content = leads.concat(appendix);
  const detected = detectAnomalies(plan.topics, data);
  const candidates = detectRecommendations(data, plan.topics, detected);
  const first = data.yield[0], last = data.yield[data.yield.length - 1];
  const scope = first && last ? `${monthLong(first.p)} hingga ${monthLong(last.p)}` : (data.period || '-');

  // Rencana blok: sel pertama = blok UTAMA; sel berikutnya = slide lampiran (maks. SLIDES_PER_BLOCK per sel)
  const per = appendix.length ? Math.ceil(appendix.length / Math.ceil(appendix.length / cfg.SLIDES_PER_BLOCK)) : 0;
  const slideBlocks = [];
  for (let i = 0; i < appendix.length; i += per) slideBlocks.push(appendix.slice(i, i + per));
  const blocks = [{ a1: claudeCellA1(0), kind: 'utama', slides: [] }]
    .concat(slideBlocks.map((arr, i) => ({ a1: claudeCellA1(i + 1), kind: 'slides', slides: arr })));
  if (blocks.length > claudeCells().length) RUN_WARNINGS.push(`Jawaban butuh ${blocks.length} sel, tetapi CLAUDE_INPUT.CELLS hanya ${claudeCells().length} sel (${claudeCells().join(', ')}); tambahkan sel kosong di DECK_CONFIG.`);
  const blockPlan = blocks.map((b, i) => b.kind === 'utama'
    ? `- Sel ${b.a1} (blok UTAMA): packet_id, storyline, agenda (outcomes), agenda_notes, summaries (id: ${summaryMains.map(m => m.id).join(', ')}), executive_summary, intro_notes, anomalies, anomaly_notes, conclusion.`
    : `- Sel ${b.a1} (blok SLIDE ${i}/${slideBlocks.length}): packet_id dan slides untuk id berikut, URUT: ${b.slides.map(t => t.id).join(', ')}.`).join('\n');

  const flow = content.map(t => [
    `Slide ${t.page} [id=${t.id}] ${t.section} — ${t.title}`,
    `  Pertanyaan yang dijawab: ${t.question || '-'}`,
    `  Menyambung dari: ${t.prev ? `slide ${t.prev.page} (${t.prev.title})` : `Kinerja Bulan Ini (slide ${plan.introPage || 3})`} — relasi: ${t.link || '-'}`,
    `  Visual: ${t.visual}`
  ].join('\n')).join('\n');

  const body = `
PROFIL: kebun ${data.title}${data.location ? `, lokasi ${data.location}` : ' (lokasi tidak dicatat)'}; data ${scope}, ${data.months} bulan${data.currentMonthIncluded ? '' : ' lengkap'}${data.partialMonth ? ` (${data.partialMonth} bulan berjalan, tidak dianalisis)` : ''}${data.currentMonthIncluded ? ` (${monthLong(data.currentMonthIncluded.p)} masih berjalan, data s.d. tanggal ${data.currentMonthIncluded.day}; ikut dianalisis, angkanya masih bisa bertambah)` : ''}${data.reportP ? ` BULAN LAPORAN: ${monthLong(data.reportP)} (pakai bulan ini di judul, KPI, dan ringkasan; bila suatu angka belum tercatat di bulan ini, sebutkan terus terang).` : ''}${data.snapshot ? `
MODE RINGKASAN: data kurang dari ${DECK_CONFIG.MIN_MONTHS_FOR_TREND} bulan. JANGAN menyimpulkan tren naik/turun; fokus pada kondisi saat ini, perbandingan dengan acuan umur tanaman, dan kelengkapan data. Pilih trend "data kurang".` : ''}
ASAL TONASE: janjang ${DECK_CONFIG.TONASE_BASIS === 'terjual' ? 'TERJUAL' : 'DIPANEN'} (pakai penjelasan yang sesuai di panduan, bagian pengetahuan agronomi).

BATAS KARAKTER (kelebihan dipotong script): judul ≤ ${AI_LIMITS.HEADLINE_MAX_CHARS}; judul agenda ≤ ${AI_LIMITS.AGENDA_TITLE}; deskripsi agenda ≤ ${AI_LIMITS.AGENDA_DESC}; hasil yang dituju ≤ ${AI_LIMITS.OUTCOME_MAX_CHARS}; insight slide lampiran ≤ ${AI_LIMITS.INSIGHT_MAX_CHARS} (30–45 kata); insight ringkasan ≤ ${AI_LIMITS.MAIN_INSIGHT_MAX_CHARS}; executive_summary ≤ ${AI_LIMITS.SUMMARY_MAX_CHARS}; bridge ≤ ${AI_LIMITS.BRIDGE_MAX_CHARS}; speaker_notes ≤ ${AI_LIMITS.NOTES_MAX_CHARS}; detail rekomendasi ≤ ${AI_LIMITS.ACTION_DETAIL}; custom_title ≤ ${AI_LIMITS.ACTION_TITLE}.

PILIHAN TETAP (isi persis salah satu, huruf kecil):
- trend: ${JSON.stringify(TREND_OPTIONS)}
- status: ${JSON.stringify(STATUS_OPTIONS)}
- impact: ${JSON.stringify(IMPACT_OPTIONS)}
- timeline: ${JSON.stringify(TIMELINE_OPTIONS)}
- priority: ["tinggi","sedang"]
- code rekomendasi: ${JSON.stringify(RECO_CODES)}

TARGET OWNER (diisi di sheet; pembanding utama bila ada): ${targetLine(data)}

KINERJA BULAN INI: EMPAT PILAR KPI DI SLIDE ${plan.introPage || 3} (dihitung script; realisasi | pembanding)
${computePillars(data).map(pl => `- ${pl.title.toUpperCase()}: ` + [pl.main, pl.sub].filter(Boolean).map(k => `${k.name} ${k.value}${k.unit ? ' ' + k.unit : ''} (${k.note})`).join('; ')).join('\n')}

RENCANA KERJA HARIAN (RKH)
${describeRkh(data) || '-'}

PRODUK SAWITPRO YANG BOLEH DISARANKAN (field product; pilih hanya bila langsung membantu masalahnya)
${(DECK_CONFIG.SAWITPRO_PRODUCTS || []).map(x => `- ${x.name} | ${x.benefit} | cocok untuk kode: ${(x.codes || []).join(', ') || '-'}`).join('\n') || '-'}

RENCANA BLOK JAWABAN (tiap blok = SATU objek JSON satu baris, ditempel pengguna ke satu sel)
${blockPlan}

STRUKTUR DECK (agenda tetap, disusun script)
DECK UTAMA: slide 1 cover; slide 2 Agenda & Tujuan Pertemuan (agenda.outcomes + agenda_notes); slide ${plan.introPage || 3} Kinerja Bulan Ini (executive_summary + intro_notes, di atas EMPAT PILAR KPI); slide ${plan.anomTopic ? plan.anomTopic.page : '-'} Temuan (anomalies); slide ${plan.conclTopic ? plan.conclTopic.page : '-'} Actionable Item (conclusion); slide ${plan.costMain ? plan.costMain.page : '-'} Struktur Biaya (summaries id m_biaya); slide ${plan.closingPage || '-'} Terima Kasih.
DATA PENDUKUNG: slide ${plan.dividerPage || '-'} pembatas Lampiran, slide ${plan.tocPage || '-'} Daftar Data Pendukung, lalu tiap bagian = slide ringkasan bagian + slide lampirannya (lihat "ALUR LAMPIRAN").
SLIDE RINGKASAN (summaries; Struktur Biaya di deck utama, ringkasan bagian di data pendukung):
${summaryMains.map(m => `Slide ${m.page} [id=${m.id}] ${m.title} — pertanyaan owner: ${(m.group && m.group.question) || '-'}; merangkum lampiran: ${m.members.map(x => `slide ${x.page} ${x.title}`).join('; ') || '-'}; ` +
  (m.structure ? `visual yang tampil: batang komposisi biaya + tabel komponen.\n${m.structure.facts}\nCatatan di slide: ${m.structure.caption}`
    : m.summary ? `visual yang tampil: grafik kesimpulan ${m.summary.desc || ''} (${m.summary.curLabel} vs ${m.summary.refLabel}): ${summaryLine(m.summary)}` : `visual yang tampil: ${m.chartTopic.title}`)).join('\n') || '-'}

ALUR LAMPIRAN (sudah ditetapkan, ikuti urutannya)
Logika besar: kinerja bulan ini (hasil, uang masuk, biaya, laba) → alur panen ke muat yang tidak tercatat (data panen, muat, dan penjualan yang belum diinput) → penyebab naik-turun hasil (JJG/ha, BJR, umur tanaman) → keuangan (laba kotor, komposisi biaya, harga, margin) → tim kerja → tindakan.
${flow}

DATA BULANAN (CSV, pemisah ';', format mesin)
${buildMonthlyTable(data)}

HUBUNGAN & KONSISTENSI ANTAR-METRIK (dihitung script)
${describeRelations(data)}

DATA BLOK
${describeBlocks(data)}

PRODUKSI PER BLOK (janjang dipanen per blok vs standar Marihat umurnya)
${describeBlockProduction(data)}

STATUS PEMUPUKAN, JENIS TANAH & BUKTI PENDUKUNG (dasar rekomendasi uji daun dan uji tanah Dokter Sawit)
${describeFertStatus(data)}
${describeSoil(data)}
${describeNpk(data)}
${describeFertilizer(data)}

FAKTA PER SLIDE
${content.filter(t => t.facts).map(t => `[${t.id}] ${t.facts}`).join('\n\n')}

ANOMALI TERDETEKSI OLEH SCRIPT (bahan slide Temuan)
${detected.map((a, i) => `${i + 1}. [slide ${a.page || '-'} ${a.slide}] ${a.text}`).join('\n') || '-'}

KATALOG REKOMENDASI STANDAR SAWIT (pilihan untuk conclusion)
${catalogForPrompt()}

REKOMENDASI YANG TERINDIKASI OLEH SCRIPT (kode | bukti dari data | slide)
${candidates.map(c => `${c.code} ${c.title} | ${c.evidence} | slide ${c.pages.join(', ') || '-'}`).join('\n') || '-'}
`.trim();

  const id = shortHash(body);
  let text = ['=== PAKET DATA KEBUNPRO ===', `ID_PAKET: ${id}`,
    'Ikuti PANDUAN di pesan pertama. Tulis jawaban sebagai blok JSON satu baris per sel sesuai RENCANA BLOK JAWABAN, dan salin ID_PAKET persis ke field packet_id setiap blok.',
    '', body, '', '=== AKHIR PAKET ==='].join('\n');
  if (sec.ANONYMIZE_FOR_AI) {
    const aliasMap = buildAliasMap(data);
    if (aliasMap.length) text = applyAliases(text, aliasMap);
  }
  return { text, id, blocks, cells: blocks.map(b => b.a1) };
}

/** Angka grafik kesimpulan slide utama untuk paket: "TBS terjual 235 vs 210 ton; ..." */
function summaryLine(s) {
  return (s.rows || []).filter(r => r.cur !== null && r.cur !== undefined)
    .map(r => `${r.label} ${r.f ? r.f(r.cur) : r.cur}${r.ref !== null && r.ref !== undefined ? ` vs ${r.f ? r.f(r.ref) : r.ref}` : ''} ${r.unit || ''}`.trim()).join('; ') +
    (s.caption ? `. Catatan: ${s.caption}` : '');
}

/** Ringkasan target owner untuk paket (kosong = "belum diisi"). */
function targetLine(data) {
  const t = data.targets || {};
  const part = (label, v, f) => `${label} ${v ? f(v) : 'belum diisi'}`;
  return [part('TBS', t.tbs, v => `${fmt(v, 0)} ton/bulan`), part('yield', t.yield, v => `${fmt(v, 2)} ton/ha/bulan`),
          part('BJR', t.bjr, v => `${fmt(v, 1)} kg`), part('pendapatan', t.revenue, v => `${fmtRpShort(v)}/bulan`)].join('; ') +
    (t.tbs || t.yield || t.bjr || t.revenue ? '' : '. Pakai pembanding bulan sebelumnya atau rata-rata periode.');
}

/** Menu "1. Salin Paket Data untuk Claude": hitung analisis sheet aktif lalu tampilkan paket siap salin. */
function showClaudePacket() {
  RUN_WARNINGS = [];
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) return showErrorAlert('Error: Tidak ada Google Sheets aktif yang terbuka!');
  const sheet = ss.getActiveSheet();
  let data, plan, packet;
  try {
    data = loadSheetData(sheet);
    if (!data.yield.length) return showErrorAlert(`Header 'ton/ha' tidak ditemukan di sheet '${sheet.getName()}'.`);
    plan = planDeck(data);
    packet = buildClaudePacket(data, plan);
  } catch (e) {
    Logger.log(e.stack || e.message);
    return showErrorAlert(`Paket data gagal dibuat: ${e.message}`);
  }
  const cells = packet.cells.join(', ');
  const warn = RUN_WARNINGS.length ? `<p style="color:#b45309;margin:6px 0"><b>Catatan:</b><br>${RUN_WARNINGS.map(escHtml).join('<br>')}</p>` : '';
  const html = `
    <div style="font-family:Arial,sans-serif;font-size:13px;line-height:1.5;padding:4px">
      <p style="margin:0 0 6px"><b>${escHtml(data.title || data.sheetName)}</b> · ID_PAKET <b>${packet.id}</b> · ${packet.text.length} karakter · jawaban Claude ${packet.blocks.length} blok (sel ${cells})</p>
      <ol style="margin:0 0 8px 18px;padding:0">
        <li>Buka chat baru Claude, tempel isi <b>PANDUAN_CLAUDE.md</b> (sekali per chat), tunggu balasan "Siap".</li>
        <li>Klik <b>Salin paket</b>, lalu tempel ke chat sebagai pesan kedua.</li>
        <li>Claude membalas ${packet.blocks.length} blok JSON. Tempel tiap blok ke sel yang tertulis di sheet <b>${escHtml(data.sheetName)}</b> (${cells}).</li>
        <li>Jalankan menu <b>2. Generate Slide Customer Saat Ini</b>.</li>
      </ol>
      ${warn}
      <button onclick="copyAll()" style="background:#007200;color:#fff;border:0;border-radius:6px;padding:8px 14px;font-weight:bold;cursor:pointer">Salin paket</button>
      <span id="msg" style="margin-left:8px;color:#007200"></span>
      <textarea id="p" readonly style="width:100%;height:300px;margin-top:8px;font-family:monospace;font-size:11px">${escHtml(packet.text)}</textarea>
    </div>
    <script>
      function copyAll() {
        var t = document.getElementById('p'), m = document.getElementById('msg'), ok = false;
        t.focus(); t.select(); t.setSelectionRange(0, t.value.length);
        try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
        m.textContent = ok ? 'Tersalin. Tempel ke chat Claude.' : 'Gagal menyalin otomatis: klik kotak teks, tekan Ctrl+A lalu Ctrl+C.';
      }
    </script>`;
  try {
    SpreadsheetApp.getUi().showModalDialog(HtmlService.createHtmlOutput(html).setWidth(880).setHeight(660), 'Paket Data untuk Claude');
  } catch (e) { Logger.log('Dialog paket tidak bisa ditampilkan (konteks non-UI).'); }
}

/* ------------------------------------------------------------------------- */
/* Membaca jawaban Claude saat Generate                                       */
/* ------------------------------------------------------------------------- */

/**
 * Baca D1, D2, ... lalu kembalikan {ai} (struktur yang dipakai deck) atau {ai:null} (teks cadangan dari data) atau {abort:true}.
 * Pengaman: sel kosong / JSON rusak / ID_PAKET tidak cocok (jawaban sheet lain atau data berubah) -> tanya pengguna.
 */
function loadClaudeAnswer(sheet, data, plan) {
  const ui = tryUi();
  const packet = buildClaudePacket(data, plan);
  const read = readAnswerBlocks(sheet);
  read.errors.forEach(e => RUN_WARNINGS.push(e));
  const usable = read.blocks.filter(b => b.obj);

  if (!usable.length) {
    const why = read.blocks.length ? `Isi sel ${read.blocks.map(b => b.a1).join(', ')} tidak bisa dibaca (JSON rusak).` : `Sel ${claudeCellA1(0)} belum berisi jawaban Claude.`;
    if (ui) {
      const r = ui.alert('Jawaban Claude belum bisa dipakai',
        `${why}\n\nLanjut membuat deck dengan teks otomatis dari data (tanpa judul, insight, dan rekomendasi dari Claude)?\n\nTidak = berhenti; buat paket lewat menu 1 lalu tempel jawabannya.`, ui.ButtonSet.YES_NO);
      if (r !== ui.Button.YES) return { abort: true };
    }
    RUN_WARNINGS.push(`${why} Teks deck diisi otomatis dari data.`);
    return { ai: null };
  }

  const merged = mergeAnswerBlocks(usable);
  const wrong = merged.ids.filter(x => x.id !== packet.id);
  if (wrong.length) {
    let choice = 'NO';   // tanpa UI: jangan pakai jawaban yang tidak cocok
    if (ui) {
      const r = ui.alert('Jawaban Claude tidak cocok dengan data',
        `Jawaban di ${wrong.map(x => x.a1).join(', ')} dibuat untuk paket data yang berbeda (kemungkinan jawaban sheet customer lain, atau data sheet ini sudah berubah sejak paket dibuat).\n\n` +
        'Ya = tetap pakai jawaban itu\nTidak = pakai teks otomatis dari data\nBatal = hentikan, lalu buat paket baru lewat menu 1', ui.ButtonSet.YES_NO_CANCEL);
      if (r === ui.Button.CANCEL || r === ui.Button.CLOSE) return { abort: true };
      choice = r === ui.Button.YES ? 'YES' : 'NO';
    }
    if (choice === 'NO') {
      RUN_WARNINGS.push(`Jawaban di ${wrong.map(x => x.a1).join(', ')} tidak cocok dengan data sheet ini (ID paket berbeda), jadi tidak dipakai. Teks deck diisi otomatis dari data.`);
      return { ai: null };
    }
    RUN_WARNINGS.push('Jawaban Claude dipakai walau ID paket berbeda; periksa isi slide dengan teliti.');
  }
  if (usable.length < packet.blocks.length) {
    RUN_WARNINGS.push(`Hanya ${usable.length} dari ${packet.blocks.length} blok jawaban terbaca (sel ${packet.cells.join(', ')}); bagian yang kosong memakai teks otomatis.`);
  }

  let out = cleanAiArtifacts(merged.out);
  const aliasMap = (DECK_CONFIG.SECURITY || {}).ANONYMIZE_FOR_AI ? buildAliasMap(data) : [];
  if (aliasMap.length) out = restoreAliases(out, aliasMap);
  return { ai: normalizeAiAnswer(out, plan) };
}

/** Agenda & hasil yang dituju dari jawaban Claude -> {items:[{title, desc, minutes, pages}], outcomes:[...], notes}. */
function normalizeAgenda(out) {
  const ag = out.agenda && typeof out.agenda === 'object' ? out.agenda : {};
  const items = (Array.isArray(ag.items) ? ag.items : []).filter(Boolean).slice(0, 6).map(it => ({
    title: trimToSentence(it.title, AI_LIMITS.AGENDA_TITLE).replace(/\.$/, ''),
    desc: trimToSentence(it.description || it.desc, AI_LIMITS.AGENDA_DESC).replace(/\.$/, ''),
    minutes: Math.max(0, Math.min(60, Math.round(Number(it.minutes) || 0))),
    pages: (Array.isArray(it.pages) ? it.pages : []).map(Number).filter(n => n > 0)
  })).filter(it => it.title);
  const outcomes = (Array.isArray(ag.outcomes) ? ag.outcomes : []).map(o => trimToSentence(o, AI_LIMITS.OUTCOME_MAX_CHARS)).filter(Boolean).slice(0, 4);
  if (!outcomes.length) RUN_WARNINGS.push('Hasil yang dituju dari Claude belum ada; diisi otomatis.');
  return { items, outcomes, notes: trimToSentence(out.agenda_notes, AI_LIMITS.NOTES_MAX_CHARS) };
}

/** Pilihan enum dibandingkan tanpa membedakan huruf besar/kecil. */
function pickOption(value, options) {
  const v = String(value || '').trim().toLowerCase();
  return options.find(o => String(o).toLowerCase() === v) || null;
}

/**
 * Rapikan jawaban Claude menjadi struktur yang dipakai deck:
 * {storyline, summaries:{id:{headline,insight,speaker_notes}}, anomalies, anomaly_notes, executive_summary, intro_notes,
 *  byId:{id:{trend,status,headline,bridge,insight,speaker_notes,mismatch}}, conclusion:{actions, speaker_notes}}
 * Semua teks dipotong sesuai AI_LIMITS; bagian yang tidak ada dibiarkan kosong (deck memakai teks cadangan).
 */
function normalizeAiAnswer(out, plan) {
  const sec = DECK_CONFIG.SECURITY || {};
  if (out.storyline && sec.LOG_AI_OUTPUT) Logger.log(`[Storyline] ${JSON.stringify(out.storyline).slice(0, 3000)}`);
  const known = {};
  plan.leads.concat(plan.appendix).forEach(t => { known[t.id] = t; });
  const byId = {};
  (Array.isArray(out.slides) ? out.slides : []).forEach(s => {
    const t = s && known[s.id];
    if (!t) { RUN_WARNINGS.push(`Jawaban Claude memuat slide dengan id tidak dikenal (${s && s.id}); diabaikan.`); return; }
    s.trend = pickOption(s.trend, TREND_OPTIONS);
    s.status = pickOption(s.status, STATUS_OPTIONS);
    const bridge = trimToSentence(s.bridge, AI_LIMITS.BRIDGE_MAX_CHARS);
    const mismatch = !!(t.signal && t.signal.trend !== 'data kurang' && s.trend && s.trend !== t.signal.trend);
    if (mismatch) RUN_WARNINGS.push(`Slide ${t.page} (${t.title}): Claude memilih tren "${s.trend}" padahal data "${t.signal.trend}"; judul & insight diganti teks otomatis.`);
    byId[s.id] = {
      mismatch, status: s.status || null, trend: s.trend || null,
      headline: mismatch ? '' : cleanHeadline(s.headline, `slide ${t.page}`),
      bridge: t.prev && bridge ? `Dari slide ${t.prev.page}: ${bridge}` : bridge,
      insight: trimToSentence(s.insight, AI_LIMITS.INSIGHT_MAX_CHARS, true),
      speaker_notes: trimToSentence(s.speaker_notes, AI_LIMITS.NOTES_MAX_CHARS)
    };
  });

  const mainIds = {}, summaryMains = plan.mains.concat(plan.costMain ? [plan.costMain] : []);
  summaryMains.forEach(m => { mainIds[m.id] = true; });
  const summaries = {};
  (Array.isArray(out.summaries) ? out.summaries : []).forEach(m => {
    if (!m || !mainIds[m.id]) return;
    summaries[m.id] = { headline: cleanHeadline(m.headline, `ringkasan ${m.id}`),
                        insight: trimToSentence(m.insight, AI_LIMITS.MAIN_INSIGHT_MAX_CHARS, true),
                        speaker_notes: trimToSentence(m.speaker_notes, AI_LIMITS.NOTES_MAX_CHARS) };
  });

  const missSlides = plan.appendix.filter(t => !byId[t.id]);
  if (missSlides.length) RUN_WARNINGS.push(`Jawaban Claude belum memuat lampiran ${missSlides.map(t => t.appx).join(', ')}; teks lampiran itu diisi otomatis dari data.`);
  const missMain = summaryMains.filter(m => !summaries[m.id]);
  if (missMain.length) RUN_WARNINGS.push(`Jawaban Claude belum memuat ringkasan ${missMain.map(m => `"${m.title}"`).join(', ')}; diisi otomatis dari data.`);

  const c = out.conclusion && typeof out.conclusion === 'object' ? out.conclusion : {};
  const actions = (Array.isArray(c.actions) ? c.actions : []).map(a => {
    if (!a) return null;
    a.code = pickOption(a.code, RECO_CODES) ? String(a.code).trim().toUpperCase() : a.code;
    a.impact = pickOption(a.impact, IMPACT_OPTIONS) || '';
    a.timeline = pickOption(a.timeline, TIMELINE_OPTIONS) || '';
    a.priority = pickOption(a.priority, ['tinggi', 'sedang']) || 'sedang';
    const r = recoByCode(a.code);
    if (!r && a.code !== 'LAINNYA') { RUN_WARNINGS.push(`Rekomendasi dengan kode tidak dikenal (${a.code}) diabaikan.`); return null; }
    const title = r ? r.title : trimToSentence((a.custom_title || '').trim() || 'Tindak lanjut khusus', AI_LIMITS.ACTION_TITLE).replace(/\.$/, '');
    const pf = productsFrom(a.product);
    pf.unknown.forEach(n => RUN_WARNINGS.push(`Produk "${n}" tidak ada di DECK_CONFIG.SAWITPRO_PRODUCTS; tidak ditampilkan.`));
    const product = pf.list.length ? pf.list : null;
    return { code: a.code, title, evidence: trimToSentence(a.evidence, 140), detail: trimToSentence(a.detail, AI_LIMITS.ACTION_DETAIL),
             impact: a.impact || '', timeline: a.timeline || '', priority: a.priority || 'sedang', basis_pages: Array.isArray(a.basis_pages) ? a.basis_pages : [],
             product };
  }).filter(Boolean).filter((a, i, arr) => arr.findIndex(x => x.code === a.code && a.code !== 'LAINNYA') === i).slice(0, 4);
  if (actions.length < 2) RUN_WARNINGS.push('Rekomendasi dari Claude kurang dari 2; rekomendasi diisi otomatis dari katalog.');

  return {
    summaries,
    storyline: Array.isArray(out.storyline) ? out.storyline : [],
    anomalies: (Array.isArray(out.anomalies) ? out.anomalies : []).filter(Boolean).slice(0, 4).map(a => {
      const pr = productsFrom(a.product).list;
      return { finding: trimToSentence(a.finding, 45).replace(/\.$/, ''), evidence: trimToSentence(a.evidence, 90),
        argument: trimToSentence(a.argument, 100),
        follow_up: trimToSentence(a.follow_up, 90) + (pr.length ? ` Solusi SawitPRO: ${pr.map(p => p.name).join(', ')}.` : ''),
        pages: Array.isArray(a.pages) ? a.pages : [] };
    }),
    agenda: normalizeAgenda(out),
    anomaly_notes: trimToSentence(out.anomaly_notes, AI_LIMITS.NOTES_MAX_CHARS),
    executive_summary: trimToSentence(out.executive_summary, AI_LIMITS.SUMMARY_MAX_CHARS, true),
    intro_notes: trimToSentence(out.intro_notes, AI_LIMITS.NOTES_MAX_CHARS),
    byId,
    conclusion: { actions, speaker_notes: trimToSentence(c.speaker_notes, AI_LIMITS.NOTES_MAX_CHARS) }
  };
}

/* ------------------------------------------------------------------------- */
/* Fallback berbasis data (dipakai bila jawaban Claude tidak ada)             */
/* ------------------------------------------------------------------------- */

function fallbackSummary(data) {
  // paragraf pembuka 2–4 baris: temuan utama + satu angka kunci tebal (**...**)
  const y = seriesStats(data.yield);
  const scope = data.dataPeriod ? ` periode ${data.dataPeriod}` : '';
  let s = `Laporan ini merangkum kinerja kebun ${data.title}${scope}.`;
  if (y) s += ` Yield rata-rata **${fmt(y.avg, 2)} ton/ha** per bulan, tertinggi ${fmt(y.max.value, 2)} ton/ha pada ${monthLong(y.max.p)} dan terendah ${fmt(y.min.value, 2)} ton/ha pada ${monthLong(y.min.p)}.`;
  const fc = data.flow && (data.flow.cur || data.flow);
  if (fc && !fc.overSold && fc.lossJjg) s += ` Sebanyak ${fmt(fc.lossJjg, 0)} janjang dari panen sebelumnya belum tercatat terjual${fc.p ? ` hingga akhir ${monthLong(fc.p)}` : ''}${fc.lossRp ? ` (±${fmtRp(fc.lossRp)})` : ''}; sebagian besar karena data belum diinput.`;
  return trimToSentence(s, AI_LIMITS.SUMMARY_MAX_CHARS, true);
}

/** Saran cadangan per slide, dipilih berdasarkan SINYAL tren (generik untuk semua kebun). */
const NOTES_RECO = {
  tanpaberat: { default: 'Saran tindakan: input berat dari tiket timbang untuk setiap trip di hari yang sama, dan cek mingguan trip yang belum ada data penjualannya.' },
  blokunsale: { default: 'Saran tindakan: telusuri blok yang berulang kali tanpa penjualan bersama mandor panen dan muat.' },
  laba: { turun: 'Saran tindakan: laba kotor menurun; cek bulan dengan biaya pekerja melonjak dan rencanakan pengeluaran besar di bulan berpendapatan tinggi.',
          default: 'Saran tindakan: pantau bulan dengan laba kotor terendah dan cocokkan dengan rincian biaya pekerjanya.' },
  biayakomposisi: { naik: 'Saran tindakan: biaya pekerja meningkat; tinjau hari kerja dan output per orang pada komponen terbesar.',
                    default: 'Saran tindakan: pantau komponen biaya terbesar dan bandingkan dengan janjang yang dihasilkan.' },
  alurjjg: { default: 'Saran tindakan: input panen, muat, dan penjualan setiap hari (paling lambat H+1), lalu cocokkan jumlahnya tiap akhir minggu.' },
  restan: { naik: 'Saran tindakan: selisih panen-muat makin besar; pastikan data muat diinput setiap hari, lalu cek janjang yang benar-benar tertinggal di TPH.',
            default: 'Saran tindakan: input data muat setiap hari agar selisih panen-muat hanya menunjukkan janjang yang benar-benar menginap di TPH.' },
  scorecard: { default: 'Mulai diskusi dari indikator dengan selisih terbesar terhadap rata-rata.' },
  produksi: { turun: 'Saran tindakan: telusuri apakah penurunan produksi berasal dari luas panen atau yield, lalu fokus pada komponen yang turun.',
              naik: 'Saran tindakan: pastikan tenaga panen dan armada angkut cukup untuk menampung kenaikan produksi.',
              fluktuatif: 'Saran tindakan: ratakan jadwal rotasi panen agar produksi bulanan tidak naik-turun tajam.',
              default: 'Saran tindakan: gunakan data produksi untuk merencanakan tenaga panen dan armada angkut.' },
  panen: { default: 'Saran tindakan: pisahkan luas blok dan luas panen berulang (rotasi) agar yield per hektar dapat dibandingkan.' },
  yield: { turun: 'Saran tindakan: cek apakah penurunan berasal dari jumlah tandan (JJG/ha) atau berat tandan (BJR).',
           fluktuatif: 'Saran tindakan: telusuri bulan terendah terhadap rotasi panen dan pemupukan untuk menstabilkan yield.',
           default: 'Saran tindakan: pertahankan rotasi panen dan kriteria matang panen yang konsisten.' },
  jjg: { turun: 'Saran tindakan: periksa rotasi panen lewat RKH dan buah matang yang tertinggal di pokok.',
         default: 'Saran tindakan: jadwalkan rotasi panen lewat RKH agar janjang matang tidak tertinggal.' },
  bjr: { turun: 'Saran tindakan: tegakkan kriteria matang panen dan cocokkan BJR dengan tiket timbangan.',
         fluktuatif: 'Saran tindakan: cocokkan BJR ekstrem dengan tiket timbangan dan jumlah janjang.',
         default: 'Saran tindakan: pantau BJR per blok untuk melihat blok dengan tandan ringan.' },
  umur: { default: 'Saran tindakan: susun rencana peremajaan bertahap untuk blok lewat umur ekonomis.' },
  umuryield: { default: 'Saran tindakan: bandingkan yield bulan yang didominasi blok tua dengan bulan yang didominasi blok muda.' },
  replanting: { default: 'Saran tindakan: prioritaskan peremajaan blok terluas dan tertua.' },
  upkeep: { default: 'Saran tindakan: evaluasi aktivitas dengan porsi biaya terbesar terhadap jadwal dan hasil kerja.' },
  upkeepakt: { default: 'Saran tindakan: cocokkan pekerjaan yang melonjak dengan bukti kerja (HK, luas, bahan) sebelum dibayar.' },
  biayakg: { default: 'Saran tindakan: pantau kenaikan upah per kg agar sebanding dengan harga jual TBS.' },
  efisiensi: { naik: 'Saran tindakan: porsi upah meningkat; tinjau tarif dan output per hari kerja.',
               default: 'Saran tindakan: tetapkan batas porsi upah terhadap harga jual sebagai alarm bulanan.' },
  biayaha: { default: 'Saran tindakan: jadwalkan biaya besar di bulan dengan pendapatan tinggi.' },
  margin: { turun: 'Saran tindakan: margin menurun; tinjau biaya terbesar dan rencana pengeluaran bulan depan.',
            default: 'Saran tindakan: telusuri bulan bermargin rendah atau negatif dan pastikan pengeluarannya terencana.' },
  mandorpanen: { default: 'Saran tindakan: jadikan capaian mandor panen terbaik sebagai acuan target harian.' },
  mandormuat: { default: 'Saran tindakan: pastikan kapasitas muat sebanding dengan janjang yang dipanen agar tidak restan.' },
  rawat: { default: 'Saran tindakan: bandingkan hari rawat tiap mandor dengan luas blok tanggung jawabnya.' },
  anomali: { default: 'Gunakan daftar ini sebagai checklist verifikasi data bersama tim kebun sebelum laporan berikutnya.' }
};

function recoFor(task) {
  const r = NOTES_RECO[task.id];
  if (!r) return 'Saran tindakan: lengkapi dan verifikasi data bulan berjalan.';
  return (task.signal && r[task.signal.trend]) || r.default;
}

function fallbackNotes(task) {
  const anomalies = String(task.facts || '').split('\n')
    .filter(l => /ANOMALI|PERLU DICEK|NEGATIF|TIDAK KONSISTEN/.test(l))
    .map(l => l.replace(/^-\s*/, '').replace(/ANOMALI( DATA)?:\s*/, '').replace(/PERLU DICEK:\s*/, 'perlu dicek, '))
    .join('; ');
  let t = task.fallback;
  if (anomalies) t += ` Catatan data: ${anomalies}.`;
  return `${t} ${recoFor(task)}`;
}

function fallbackIntroNotes(data, tasks) {
  // Slide Kinerja Bulan Ini: bacakan empat pilar, lalu alur deck utama; rincian ada di data pendukung
  const pl = computePillars(data).map(p => `${p.title}: ${[p.main, p.sub].filter(Boolean).map(k => `${k.name} ${k.value}${k.unit ? ' ' + k.unit : ''} (${k.note})`).join('; ')}`);
  return `${fallbackSummary(data)} Kinerja bulan ini per pilar. ${pl.join('. ')}. Setelah ini dibahas temuan, actionable item, dan struktur biaya; ` +
    `rincian setiap angka ada di data pendukung (${(tasks || []).map(t => t.title).join(', ')}).`;
}

/** Aksi owner cadangan, dipilih dari kondisi data (bukan teks tetap per kebun). */
function fallbackActions(data, pageOf) {
  const out = [];
  const B = data.blocks;
  if (B && B.replant.length) {
    const ha = B.replant.reduce((s, b) => s + b.ha, 0);
    out.push({ title: 'Susun rencana peremajaan blok tua',
      detail: `${B.replant.length} blok (${fmt(ha, 1)} ha) berumur lebih dari ${DECK_CONFIG.THRESHOLDS.REPLANT_AGE} tahun, terbesar ${B.replant.slice(0, 3).map(b => b.name).join(', ')}. Mulai survei dan rencana replanting bertahap.`,
      priority: 'tinggi', basis_pages: [pageOf('umur'), pageOf('replanting')] });
  }
  const m = seriesStats(data.margin);
  if (m && m.negatives.length) out.push({ title: 'Kendalikan biaya di bulan bermargin negatif',
    detail: `Margin/ha negatif pada ${m.negatives.map(x => monthLong(x.p)).join(', ')}. Jadwalkan biaya besar di bulan berpendapatan tinggi dan setujui pengeluaran di atas rata-rata lebih dulu.`,
    priority: 'tinggi', basis_pages: [pageOf('margin'), pageOf('biayaha')] });
  const mp = data.mandorPanen;
  if (mp && mp.rows.length > 1) {
    const li = mp.periods.map((p, i) => (p.partial ? null : i)).filter(i => i !== null).pop() || 0;
    const rated = mp.rows.filter(r => r.vals[li] && r.vals[li].rate);
    if (rated.length > 1) {
      const hi = rated.reduce((a, r) => (r.vals[li].rate > a.vals[li].rate ? r : a)), lo = rated.reduce((a, r) => (r.vals[li].rate < a.vals[li].rate ? r : a));
      if (hi.vals[li].rate > lo.vals[li].rate * 1.3) out.push({ title: 'Samakan produktivitas antar-mandor panen',
        detail: `Pada ${mp.periods[li].label} ${hi.name} mencapai ${fmt(hi.vals[li].rate, 0)} JJG/hari, ${lo.name} ${fmt(lo.vals[li].rate, 0)} JJG/hari. Jadikan capaian tertinggi acuan target dan tinjau pembagian ancak.`,
        priority: 'sedang', basis_pages: [pageOf('mandorpanen')] });
    }
  }
  const y = seriesStats(data.yield), gy = signals(data.yield);
  if (y && gy.trend !== 'data kurang') {
    const up = gy.trend === 'naik';
    out.push({ title: up ? 'Pertahankan praktik yang menaikkan yield' : 'Stabilkan produktivitas panen bulanan',
      detail: up
        ? `Yield naik hingga ${fmt(y.max.value, 2)} ton/ha pada ${monthLong(y.max.p)}. Catat praktik rotasi panen dan perawatan yang berjalan agar tetap dijaga.`
        : `Yield berkisar ${fmt(y.min.value, 2)}–${fmt(y.max.value, 2)} ton/ha dengan tren ${gy.trend}. Jaga rotasi panen dan tegakkan kriteria matang panen mulai bulan depan.`,
      priority: up ? 'sedang' : 'tinggi', basis_pages: [pageOf('yield'), pageOf('jjg'), pageOf('bjr')] });
  }
  const missing = checkDataCompleteness(data);
  const inconsistent = describeRelations(data).split('\n').filter(l => /ANOMALI DATA|TIDAK KONSISTEN/.test(l));
  if (missing.length || inconsistent.length) out.push({ title: 'Lengkapi dan selaraskan data kebun',
    detail: [missing.length ? `Data belum tersedia: ${missing.slice(0, 4).join(', ')}${missing.length > 4 ? ', dan lainnya' : ''}.` : '',
             inconsistent.length ? `Ada ${inconsistent.length} ketidaksesuaian antar-tabel yang perlu dicek.` : ''].join(' ').trim() + ' Perbaiki sebelum laporan berikutnya.',
    priority: 'sedang', basis_pages: [pageOf('anomali')] });
  return out.slice(0, 4).map(a => ({ ...a, basis_pages: a.basis_pages.filter(Boolean) }));
}

/** Anomali cadangan dari deteksi script (bila Claude gagal). */
function fallbackAnomalies(detected) {
  const why = t => /ANOMALI DATA|TIDAK KONSISTEN/.test(t) ? ['Dua tabel berbeda untuk hal yang sama; laporan bisa keliru.', 'Samakan sumber data. PIC: admin kebun · sebelum laporan berikut.']
    : /NEGATIF/.test(t) ? ['Biaya melebihi pendapatan; bila berulang, kebun merugi.', 'Cek rincian biaya bulan itu. PIC: owner · bulan ini.']
    : /RKH/.test(t) ? ['Tanpa RKH, rotasi panen di lapangan tidak bisa dibandingkan dengan rencananya.', 'Isi RKH tiap hari untuk ancak panen & rawat. PIC: asisten/mandor · mulai minggu ini.']
    : /TIDAK BISA DIUKUR/.test(t) ? ['Input panen belum lengkap; alur panen ke muat tidak bisa dinilai.', 'Input semua janjang panen setiap hari. PIC: mandor panen · mulai minggu ini.']
    : /tidak ada janjang terjual tercatat/.test(t) ? ['Satu bulan panen tanpa penjualan tercatat; pendapatan belum masuk laporan.', 'Input penjualan bulan itu. PIC: admin kebun · minggu ini.']
    : /penjualan[^.]*belum diinput/.test(t) ? ['Tonase dan pendapatan tampak lebih kecil dari sebenarnya.', 'Input berat tiket timbang tiap trip. PIC: admin kebun · mulai minggu ini.']
    : /alur panen tidak tercatat/.test(t) ? ['Panen belum tercatat dimuat/terjual; umumnya data belum diinput.', 'Input panen, muat, jual tiap hari (H+1). PIC: mandor & admin · minggu ini.']
    : /melebihi/.test(t) && /janjang/.test(t) ? ['Catatan antar-tahap tidak sinkron; alur panen sulit dinilai.', 'Input janjang panen & muat tiap hari. PIC: mandor panen · bulan ini.']
    : /acuan umur/.test(t) ? ['Tandan lebih ringan dari wajarnya; tonase tertahan.', 'Cek kematangan buah & timbangan. PIC: mandor panen · minggu ini.']
    : /restan/.test(t) ? ['Janjang tak segera dimuat menurunkan mutu dan harga.', 'Cek armada & catatan muat. PIC: mandor muat · minggu ini.']
    : /ANOMALI/.test(t) ? ['Data kosong membuat analisis tidak bisa dinilai.', 'Lengkapi data di sheet. PIC: admin kebun · sebelum generate.']
    : ['Nilai jauh dari kebiasaan: kejadian nyata atau salah input.', 'Cocokkan dengan catatan lapangan. PIC: admin kebun · bulan ini.'];
  return (detected || []).filter(a => !/bulan berjalan/.test(a.text)).slice(0, 4).map(a => {
    const text = a.text.replace(/^(ANOMALI( DATA)?|PERLU DICEK|TIDAK KONSISTEN[^:]*):\s*/, '');
    const [argument, follow_up] = why(a.text);
    return { finding: (a.slide && a.slide !== '-' ? a.slide : 'Catatan data').replace(/\s*\(.*\)$/, ''), evidence: trimToSentence(text, 90), argument, follow_up, pages: a.page ? [a.page] : [] };
  });
}

/* ------------------------------------------------------------------------- */
/* Penyamaran nama di paket data untuk Claude                                 */
/* ------------------------------------------------------------------------- */

function escapeRe(x) { return String(x).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/**
 * Peta nama asli -> alias: pemilik kebun, lokasi, nama mandor, dan nama blok yang mengandung nama orang
 * (kata alfabet ≥ 4 huruf, mis. "L2 Robert D"; kode blok seperti "A08" atau "KP-B08" tidak disamarkan).
 */
function buildAliasMap(d) {
  const map = [];
  const add = (real, alias) => {
    const r = String(real || '').trim();
    if (r.length >= 3 && !map.some(m => m.real === r)) map.push({ real: r, alias });
  };
  add(d.title, 'KEBUN_X');
  if (d.location) add(d.location, 'LOKASI_X');
  if (d.sheetName && d.sheetName !== d.title) add(d.sheetName, 'KEBUN_S');
  const people = [];
  [d.panen, d.muat, d.rawat].forEach(t => { if (t) t.rows.forEach(r => { if (r[0] && people.indexOf(String(r[0]).trim()) < 0) people.push(String(r[0]).trim()); }); });
  people.forEach((n, i) => add(n, `MANDOR_${String.fromCharCode(65 + (i % 26))}${i >= 26 ? Math.floor(i / 26) : ''}`));
  const blocks = d.blocks ? d.blocks.blocks.map(b => b.name) : [];
  let k = 1;
  const generic = /^(blok|block|divisi|afdeling|kebun|jalan)$/i;
  blocks.forEach(n => {
    const words = String(n).match(/[A-Za-z]{4,}/g) || [];
    if (words.some(w => !generic.test(w))) add(n, `BLOK_N${String(k++).padStart(2, '0')}`);
  });
  return map.sort((a, b) => b.real.length - a.real.length);
}

function applyAliases(text, map) {
  let t = String(text);
  map.forEach(m => { t = t.replace(new RegExp(`(^|[^A-Za-z0-9])${escapeRe(m.real)}(?=$|[^A-Za-z0-9])`, 'g'), `$1${m.alias}`); });
  return t;
}

/**
 * Bersihkan sisa format chat AI di semua teks jawaban: penanda sitasi ("[cite: 2]", "[cite_start]", "【4†source】"),
 * spasi ganda, dan spasi sebelum tanda baca yang tertinggal setelah penanda dibuang.
 */
function cleanAiArtifacts(obj) {
  const fix = s => s.replace(/[ \t]*\[cite(?:_start|_end)?(?::[^\]]*)?\][ \t]*/gi, ' ').replace(/[ \t]*【[^】]*】[ \t]*/g, ' ')
    .replace(/[ \t]{2,}/g, ' ').replace(/ +([.,;:!?)])/g, '$1').replace(/ +\n/g, '\n').trim();
  const walk = v => Array.isArray(v) ? v.map(walk)
    : (v && typeof v === 'object') ? Object.keys(v).reduce((o, k) => { o[k] = walk(v[k]); return o; }, {})
    : (typeof v === 'string' ? fix(v) : v);
  return walk(obj);
}

/** Kembalikan alias -> nama asli di semua string dalam objek jawaban AI. */
function restoreAliases(obj, map) {
  const uniq = {};
  map.forEach(m => { if (!(m.alias in uniq)) uniq[m.alias] = m.real; });
  const keys = Object.keys(uniq).sort((a, b) => b.length - a.length);
  // Alias bisa ditulis ulang oleh AI: "KEBUN_X", "Kebun X", "KebunX", "Blok N01" -> semuanya dikembalikan
  const aliasRe = a => { const m = a.match(/^([A-Z]+)_([A-Z0-9]+)$/);
    return new RegExp(m ? `\\b${m[1]}[_ ]?${m[2]}\\b` : escapeRe(a), 'gi'); };
  const fix = s => keys.reduce((t, a) => t.replace(aliasRe(a), uniq[a]), s);
  const walk = v => Array.isArray(v) ? v.map(walk)
    : (v && typeof v === 'object') ? Object.keys(v).reduce((o, k2) => { o[k2] = walk(v[k2]); return o; }, {})
    : (typeof v === 'string' ? fix(v) : v);
  const out = walk(obj);
  const left = JSON.stringify(out).match(/\b(KEBUN[_ ]?[XS]|LOKASI[_ ]?X|MANDOR_[A-Z]\d*|BLOK[_ ]?N\d{2})\b/i);
  if (left) RUN_WARNINGS.push(`Sebagian alias penyamaran (${left[0]}) tidak bisa dikembalikan; cek teks deck.`);
  return out;
}
