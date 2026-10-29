const vm = require('vm'), fs = require('fs'), crypto = require('crypto');
const OUT = process.env.GS_DIR || '/mnt/user-data/outputs/';   // folder berisi file .gs
let UI_ON = false, CAPTURED = null;
const cells = {};   // A1 -> isi sel

const ctx = {
  console, JSON, Math, Date, Object, Array, String, Number, RegExp, Error,
  Logger: { log() {} },
  Utilities: {
    DigestAlgorithm: { MD5: 'MD5' }, Charset: { UTF_8: 'UTF_8' },
    computeDigest: (alg, text) => Array.from(crypto.createHash('md5').update(text, 'utf8').digest()).map(b => (b > 127 ? b - 256 : b)),
    getUuid: () => crypto.randomUUID(), sleep() {}
  },
  SpreadsheetApp: {
    getUi() {
      if (!UI_ON) throw new Error('no ui');
      return { ButtonSet: { YES_NO: 1, YES_NO_CANCEL: 2 }, Button: { YES: 'Y', NO: 'N', CANCEL: 'C', CLOSE: 'X' },
        alert(...a) { CAPTURED = a; return 'Y'; }, showModalDialog(o) { CAPTURED = o.html; } };
    },
    getActiveSpreadsheet() { return { getActiveSheet: () => sheet }; }
  },
  HtmlService: { createHtmlOutput(html) { return { html, setWidth() { return this; }, setHeight() { return this; } }; } },
  SlidesApp: { ShapeType: {} }
};
vm.createContext(ctx);
const load = (code, name) => vm.runInContext(code, ctx, { filename: name });

// --- stub untuk file 3 / 7 / 8 (tidak ada di folder output) ---
load(`
const TREND_OPTIONS = ['naik','turun','stabil','fluktuatif','data kurang'];
const STATUS_OPTIONS = ['baik','perlu perhatian','kritis','data belum cukup'];
const RECO_CODES = ['R01','R18','R20','LAINNYA'];
function recoByCode(c){ return ({R01:{code:'R01',title:'Perketat rotasi panen'},R18:{code:'R18',title:'Telusuri kebocoran janjang per tahap'},R20:{code:'R20',title:'Wajibkan timbang'}})[c] || null; }
function catalogForPrompt(){ return 'R01 | Perketat rotasi panen | tindakan standar ...'; }
function detectRecommendations(){ return [{code:'R18',title:'Telusuri kebocoran',evidence:'51% janjang hilang',priority:'tinggi',pages:[17]}]; }
function describeRelations(){ return 'KONSISTEN: ok\\nPERLU DICEK: 95% janjang terjual tanpa catatan berat'; }
function describeBlocks(){ return 'Blok dipanen (3 blok)'; }
function buildMonthlyTable(){ return 'bulan;yield\\nOkt 25;1.2'; }
function monthLong(){ return 'Mei 2026'; }
function checkDataCompleteness(){ return []; }
function describeSoil(){ return 'JENIS TANAH BLOK: Belum tercatat 100%'; }
function describeFertilizer(){ return 'KEBUTUHAN PUPUK INDIKATIF: -'; }
function describeNpk(){ return 'REKOMENDASI NPK UMUM: -'; }
function buildNpkRecommendation(){ return null; }
function buildFertilizerNeed(){ return null; }
function readHaraVegetatif(){ return 0; }
function buildFertilizerStatus(){ return null; }
function describeFertStatus(){ return 'STATUS PEMUPUKAN: -'; }
function buildBlockProduction(){ return null; }
function describeBlockProduction(){ return 'PRODUKSI PER BLOK: -'; }
function describeRkh(){ return 'PERLU DICEK: RKH (Rencana Kerja Harian) belum diisi'; }
function blockProdTableRows(){ return null; }
function mkey(p){ return p.y + '-' + p.m; }
const KPI_LIBRARY = {};
function fmt(n, d){ if (n===null||n===undefined||isNaN(n)) return '-'; const p=Math.abs(n).toFixed(d===undefined?2:d).split('.'); p[0]=p[0].replace(/(?=(?:[0-9]{3})+$)(?!^)/g,'.'); return (n<0?'-':'')+p.join(','); }
function fmtPct(n,d){ return fmt(n, d===undefined?1:d)+'%'; }
function fmtRpShort(n){ return 'Rp'+fmt(n/1e6,1)+' juta'; }
function rpParts(n){ return { value: fmt(n/1e6,1), unit: 'juta Rp' }; }
function monthShort(p){ return ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'][p.m]+' '+String(p.y).slice(2); }
function valAt(s,p){ const x = p && (s||[]).find(z=>z.p.y===p.y&&z.p.m===p.m); return x ? x.value : null; }
function seriesStats(s){ const pts=(s||[]).filter(x=>x.value!==null); if(!pts.length) return null; const v=pts.map(x=>x.value), avg=v.reduce((a,b)=>a+b,0)/v.length;
  return { n:(s||[]).length, avg, sum:v.reduce((a,b)=>a+b,0), last:pts[pts.length-1], prev:pts.length>1?pts[pts.length-2]:null, negatives:pts.filter(x=>x.value<0), max:pts[0], min:pts[0] }; }
function parseNum(v){ const n = Number(String(v).split('.').join('').replace(',','.')); return v===''||isNaN(n)?null:n; }
function findCell(values, aliases){ const l = aliases.map(a=>a.toLowerCase()); for (let r=0;r<values.length;r++) for (let c=0;c<values[r].length;c++) if (l.indexOf(String(values[r][c]).trim().toLowerCase())>=0) return {r,c}; return null; }
function valueRightOf(display, aliases, fb){ for (const row of display) for (let c=0;c<row.length-1;c++) if (aliases.map(a=>a.toLowerCase()).indexOf(String(row[c]).toLowerCase())>=0) return row[c+1]===''?fb:String(row[c+1]); return fb; }
`, 'stub.js');
for (const f of ['1_ConfigAndStyle.gs', '4_ClaudeBridge.gs', '5_MainController.gs', '6_ShapeCharts.gs']) load(fs.readFileSync(OUT + f, 'utf8'), f);

// --- stub getSheetData & buildTopics (menimpa fungsi file 3 / 5 untuk uji) ---
load(`
var GRID_SEEN = null;
function getSheetData(sh) {
  const r = sh.getDataRange(); const v = r.getValues(), d = r.getDisplayValues();
  GRID_SEEN = { v: v[0][3], d: d[0][3], v2: v[1][3] };
  return { sheetName: sh.getName(), title: 'Kebun Pak Budi', location: 'Dumai', period: '', months: 6, partialMonth: null, snapshot: false,
           yield: [{ p: { y: 2026, m: 4 }, value: 1.2 }], panen: null, muat: null, rawat: null, blocks: null };
}
function buildTopics(d) {
  const ids = ['scorecard','produksi','panen','yield','marihat','alurjjg','tanpaberat','blokunsale','restan','jjg','bjr','umur','umuryield','replanting',
               'laba','biayakomposisi','biayakg','efisiensi','biayaha','upkeep','margin','mandorpanen','mandormuat','rawat'];
  const T = ids.map(id => ({ id, section: 'S', title: 'Judul ' + id, visual: 'v ' + id, facts: 'fakta ' + id + ' Kebun Pak Budi', fallback: 'Fallback ' + id + '.',
    question: 'q ' + id, link: 'l ' + id, signal: id === 'bjr' ? { trend: 'stabil', position: 'sekitar rata-rata' } : undefined }));
  T.push({ id: 'anomali', kind: 'anomali', title: 'Anomali', visual: 'v', facts: '', fallback: '' });
  T.push({ id: 'kesimpulan', kind: 'conclusion', title: 'Kesimpulan', visual: 'v', facts: '', fallback: '' });
  return T;
}
`, 'stub2.js');

// --- sheet palsu ---
// Sheet tiruan: baris 1–3 Title/Period/Lokasi (sel jawaban D1–D3 dan F1–F3), baris 4 = header tabel (D4 = luas panen), baris 5 = target
const grid = disp => { const g = [];
  for (let r = 0; r < 5; r++) {
    if (r === 3) g.push(['year_month', 'ton/ha', 'jjg/ha', 'luas panen', 'hargajual/kg', 'total_janjang']);
    else if (r === 4) g.push(['Target TBS', disp ? '1.200' : 1200, '', cells['D5'] || '', '', '']);
    else g.push(['Title', 'x', '', cells['D' + (r + 1)] || '', '', cells['F' + (r + 1)] || '']);
  }
  return g; };
const sheet = {
  getName: () => 'Sheet Budi', getDataRange: () => ({ getValues: () => grid(false), getDisplayValues: () => grid(true) }),
  getRange: a1 => ({ getValue: () => cells[a1] || '' })
};
ctx.sheet = sheet; ctx.cells0 = cells;
const run = code => vm.runInContext(code, ctx);
const ok = (c, m) => { console.log((c ? 'OK   ' : 'GAGAL'), m); if (!c) process.exitCode = 1; };

// 1. Rencana + paket
const data = run('loadSheetData(sheet)');
const plan = run('planDeck(loadSheetData(sheet))');
ctx.plan = plan; ctx.data = data;
ok(plan.mains.length === 5 && plan.appendix.length === 24 && plan.appendix[0].id === 'scorecard', `rencana: ${plan.mains.length} slide ringkasan, ${plan.appendix.length} lampiran`);
ok(data.targets.tbs === 1200, 'target owner terbaca dari sheet (Target TBS = 1.200)');
// Deck utama: Kinerja (3) → Temuan (4) → Actionable (5) → [Struktur Biaya] → Terima Kasih → pembatas → daftar → data pendukung
ok(plan.introPage === 3 && plan.anomTopic.page === 4 && plan.conclTopic.page === 5 && !plan.costMain && plan.closingPage === 6 && plan.tocPage === 8 &&
   plan.mains[0].page === 9 && plan.appendix[0].page === 10 && plan.mains[1].page === 15,
  `halaman: temuan ${plan.anomTopic.page}, actionable ${plan.conclTopic.page}, penutup ${plan.closingPage}, ringkasan bagian ${plan.mains.map(m => m.page)}, A1 hlm ${plan.appendix[0].page}`);
ok(plan.support.map(t => t.page).every((pg, i) => pg === 9 + i) && plan.support[1] === plan.appendix[0], 'data pendukung: ringkasan bagian langsung diikuti lampirannya, nomor halaman berurutan');
const packet = run('buildClaudePacket(data, plan)');
ctx.packet = packet;
ok(/^[0-9a-f]{8}$/.test(packet.id), 'ID paket 8 hex: ' + packet.id);
ok(packet.blocks.length === 3 && packet.cells.join() === 'D1,D2,D3', 'blok jawaban: ' + packet.cells.join(','));
ok(!/Pak Budi|Dumai/.test(packet.text) && /KEBUN_X/.test(packet.text) && /LOKASI_X/.test(packet.text), 'nama disamarkan di paket (KEBUN_X, LOKASI_X)');
ok(/TARGET OWNER .*TBS 1\.200 ton\/bulan/.test(packet.text) && /PRODUK SAWITPRO/.test(packet.text) && /Dokter Sawit/.test(packet.text) && /agenda \(outcomes\), agenda_notes/.test(packet.text) && /EMPAT PILAR KPI/.test(packet.text) && /RKH/.test(packet.text), 'paket memuat target owner, produk SawitPRO, agenda, empat pilar KPI, dan RKH');
ok(packet.text.indexOf('ID_PAKET: ' + packet.id) > 0 && /=== AKHIR PAKET ===/.test(packet.text), 'header & penutup paket ada');
const packet2 = run('buildClaudePacket(data, plan)');
ok(packet2.id === packet.id, 'ID paket stabil untuk data yang sama');
console.log('--- cuplikan rencana blok ---\n' + packet.text.split('\n').filter(l => /^- Sel D/.test(l)).join('\n').slice(0, 700));

// 2. Dialog paket
UI_ON = true; run('showClaudePacket()'); UI_ON = false;
ok(typeof CAPTURED === 'string' && CAPTURED.indexOf('Salin paket') > 0 && CAPTURED.indexOf('textarea') > 0 && CAPTURED.indexOf('D1, D2, D3') > 0, 'dialog paket tampil (tombol salin, D1, D2, D3)');

// 3. Jawaban Claude palsu -> D1..D3
const mk = (id, extra) => Object.assign({ id, trend: id === 'bjr' ? 'stabil' : 'naik', status: 'baik', main_message: 'm', headline: 'Judul pendek ' + id.slice(0, 8), bridge: 'Menyambung.',
  insight: 'KEBUN_X mencatat **123** ton. Artinya baik.', speaker_notes: 'Catatan presenter. '.repeat(10) }, extra || {});
const per = Math.ceil(plan.appendix.length / Math.ceil(plan.appendix.length / 12));
const chunks = []; for (let i = 0; i < plan.appendix.length; i += per) chunks.push(plan.appendix.slice(i, i + per));
const main = { packet_id: packet.id, storyline: [], agenda: { items: [{ title: 'Kinerja dan Laba Bulan Ini', description: 'Hasil, pendapatan, dan laba', minutes: 15, pages: [4] }, { title: 'Kebocoran Janjang', description: 'Janjang tanpa berat 95%', minutes: 20, pages: [5] }, { title: 'Penyebab Hasil Rendah', description: 'BJR jauh di bawah standar', minutes: 15, pages: [6] }, { title: 'Keputusan', description: 'Tindakan, PIC, tenggat', minutes: 20, pages: [9] }], outcomes: ['Kesepakatan wajib timbang seluruh penjualan mulai Oktober 2026', 'Daftar tindak lanjut dengan PIC dan tenggat', 'Persetujuan konsultasi agronomis untuk blok BJR rendah'] }, agenda_notes: 'Catatan agenda.', summaries: plan.mains.map(m => ({ id: m.id, headline: 'Hasil rendah: BJR 6,4 kg, 45% standar', insight: 'KEBUN_X: **BJR** rendah.', speaker_notes: 'Notes.' })),
  executive_summary: 'Ringkasan **6,4 kg**.', intro_notes: 'Intro.', anomalies: [{ finding: 'Janjang tanpa berat', evidence: '95%', argument: 'Pendapatan tersembunyi', follow_up: 'PIC: admin', pages: [17], product: 'Dokter Sawit' }],
  anomaly_notes: 'AN', conclusion: { actions: [{ code: 'r18', custom_title: '', evidence: 'e', detail: 'd PIC: x', impact: 'Risiko Berkurang', timeline: 'segera (bulan ini)', priority: 'tinggi', basis_pages: [17], product: 'dokter sawit' },
    { code: 'R20', custom_title: '', evidence: 'e', detail: 'd', impact: 'data lebih akurat', timeline: '1–3 bulan', priority: 'sedang', basis_pages: [18], product: 'Produk Fiktif' }], speaker_notes: 'CN' } };
const setAnswer = (pid) => {
  cells.D1 = JSON.stringify(Object.assign({}, main, { packet_id: pid }));
  chunks.forEach((arr, i) => { cells['D' + (i + 2)] = JSON.stringify({ packet_id: pid, slides: arr.map(t => mk(t.id)) }); });
};
setAnswer(packet.id);
ok(!/\n|\t/.test(cells.D1 + cells.D2 + cells.D3), 'blok jawaban satu baris tanpa tab');

let res = run('loadClaudeAnswer(sheet, data, plan)');
const ai = res.ai;
ok(ai && Object.keys(ai.byId).length === 24 && Object.keys(ai.summaries).length === 5, `jawaban terbaca: ${ai && Object.keys(ai.byId).length} lampiran, ${ai && Object.keys(ai.summaries).length} ringkasan`);
ok(ai.summaries.m_kinerja.insight.indexOf('Kebun Pak Budi') === 0, 'nama asli dikembalikan dari alias: ' + ai.summaries.m_kinerja.insight);
ok(ai.conclusion.actions.length === 2 && ai.conclusion.actions[0].code === 'R18' && ai.conclusion.actions[0].impact === 'risiko berkurang', 'rekomendasi dinormalkan (kode & pilihan tetap)');
ok(ai.byId.bjr.headline === 'Judul pendek bjr' && ai.byId.bjr.mismatch === false, 'judul slide & tren cocok');
ok(GRID().v === '' && GRID().d === '' && GRID().v2 === '', 'sel D1/D2 disembunyikan dari pembaca data (masking)');
function GRID() { return run('GRID_SEEN'); }
ok(ai.agenda.items.length === 4 && ai.agenda.outcomes.length === 3 && ai.agenda.items[0].minutes === 15 && ai.agenda.items[3].pages[0] === 9, 'agenda & hasil yang dituju terbaca');
ok(ai.conclusion.actions[0].product && ai.conclusion.actions[0].product[0].name === 'Dokter Sawit' && ai.conclusion.actions[1].product === null, 'produk: nama dikenali (tanpa beda huruf), produk fiktif ditolak');
ok(/Solusi SawitPRO: Dokter Sawit/.test(ai.anomalies[0].follow_up), 'produk di temuan ditambahkan ke tindak lanjut');
ok(run('RUN_WARNINGS').length === 1 && /Produk Fiktif/.test(run('RUN_WARNINGS')[0]), 'satu-satunya peringatan: produk fiktif');
// produk untuk rekomendasi cadangan
const acts = run(`attachProducts([{ code: 'R04' }, { code: 'R20' }, { code: 'R07' }, { code: 'R01' }])`);
ok(acts[0].product.map(x => x.name).join() === 'Uji Tanah Dokter Sawit,Uji Daun Dokter Sawit' && acts[1].product === null && acts[2].product === null && acts[3].product === null && !JSON.stringify(acts).includes('KebunPRO'), 'cadangan: R04 -> uji tanah + uji daun; KebunPRO tidak pernah disarankan');
// KPI berpembanding
const kd = run(`({ produksiActual: true, targets: { tbs: 250 }, produksi: [{p:{y:2026,m:7},value:210},{p:{y:2026,m:8},value:234.8}],
  yield: [{p:{y:2026,m:7},value:1.1},{p:{y:2026,m:8},value:1.3}], bjr: [{p:{y:2026,m:7},value:7.0},{p:{y:2026,m:8},value:6.4}], bjrSoldCum: 6.4, marihat: { cls:'S3', pot:{ rbt:14.1, ton:28 }, achTon:0.29, realTonHa:8.1 },
  revenueTotal: [{p:{y:2026,m:7},value:2.1e8},{p:{y:2026,m:8},value:2.75e8}], flow: { overSold:false, lossJjg: 9256, lossPct: 51.4, lossRp: 6.569e8,
    cur: { p:{y:2026,m:8}, overSold:false, lossJjg: 1500, lossPct: 20, lossRp: 6.0e7 }, prev: { p:{y:2026,m:7}, overSold:false, lossJjg: 900, lossPct: 12, lossRp: 4.0e7 } } })`);
ctx.kd = kd; const kp = run('computeOwnerKpis(kd)');
console.log(kp.map(k => `   ${k.name}: ${k.value} ${k.unit} | ${k.note} [${k.tone}]`).join('\n'));
ok(kp[0].note === 'Target 250 ton · tercapai 94%' && kp[0].tone === 'neutral', 'TBS vs target owner');
ok(/vs rata-rata 2 bulan/.test(kp[1].note) && kp[1].tone === 'good', 'yield vs rata-rata periode');
ok(kp[2].name === 'BJR Sep 26' && /▼ 4% vs rata-rata 2 bulan \(6,7 kg\)/.test(kp[2].note) && kp[2].tone === 'bad', 'BJR bulan laporan vs rata-rata periode (tanpa target)');
ok(/▲ 31% vs Agu 26/.test(kp[3].note), 'pendapatan vs bulan lalu');
ok(kp[5].name === 'Nilai belum tercatat Sep 26' && kp[5].value === '60,0' && /1\.500 jjg belum tercatat >1 bln · ▲ 50% vs Agu 26/.test(kp[5].note) && kp[5].tone === 'bad', 'alur panen tidak tercatat BULAN LAPORAN (bukan kumulatif) vs bulan lalu');
run('kd.targets = { tbs: null, yield: null, bjr: null, revenue: null }');
const kn = run('computeOwnerKpis(kd)');
console.log(kn.slice(0, 4).map(k => `   ${k.name}: ${k.value} ${k.unit} | ${k.note} [${k.tone}]`).join('\n'));
ok(/vs Agu 26/.test(kn[0].note) && /vs rata-rata/.test(kn[1].note) && /vs rata-rata/.test(kn[2].note) && /vs Agu 26/.test(kn[3].note), 'tanpa target: bulan lalu (TBS, pendapatan) & rata-rata (yield, BJR)');
run('kd.targets = { tbs: 250 }');
// gambar slide agenda, KPI, rekomendasi (permintaan Slides API saja)
run('RUN_WARNINGS = []');
const nreq = run(`(function(){ const b = new SlideBatch('pg','agenda'); drawAgenda(b, [{title:'Kinerja dan Laba Bulan Ini',desc:'Hasil, pendapatan, dan laba',minutes:15,pageId:'p4'},{title:'Kebocoran Janjang',desc:'Janjang tanpa berat',minutes:20},{title:'Penyebab Hasil Rendah',desc:'BJR rendah',minutes:15},{title:'Keputusan',desc:'Tindakan, PIC, tenggat',minutes:20}], ['Kesepakatan wajib timbang seluruh penjualan mulai Oktober 2026','Daftar tindak lanjut dengan PIC dan tenggat','Persetujuan konsultasi agronomis']); return JSON.stringify(b.req); })()`);
ok(/HASIL YANG DITUJU/.test(nreq) && /Durasi total 70 menit/.test(nreq) && /"pageObjectId":"p4"/.test(nreq) && run('RUN_WARNINGS').length === 0, 'slide agenda tergambar (hasil yang dituju, total 70 menit, judul dapat diklik)');
const creq = run(`(function(){ const b = new SlideBatch('pg','k'); drawConclusionCards(b, [{title:'Wajibkan timbang',detail:'d',priority:'tinggi',timeline:'1–3 bulan',basis_pages:[],product:{name:'Dokter Sawit',short:'konsultasi agronomis'}},{title:'Rotasi',detail:'d',priority:'sedang',basis_pages:[],product:null}], null); return JSON.stringify(b.req); })()`);
ok(/Solusi SawitPRO: Dokter Sawit \(konsultasi agronomis\)/.test(creq), 'kartu rekomendasi menampilkan Solusi SawitPRO satu baris');
// Tata letak seperti screenshot: 4 kartu, judul 2 baris, detail 3 baris, 2 kartu dengan produk -> tidak boleh tumpang tindih
run('RUN_WARNINGS = []');
const lay = run(`(function(){ const b = new SlideBatch('pg','k2'); const D = 'Rekonsiliasi harian janjang TPH, muat, dan tiket timbang, mulai Blok 17 dan 12; target selisih ≤5%. PIC: mandor muat · tenggat 31 Okt 2026';
  const P = {name:'Dokter Sawit',short:'konsultasi agronomis'};
  drawConclusionCards(b, [{title:'Telusuri kebocoran janjang per tahap',detail:D,priority:'tinggi',timeline:'segera (bulan ini)',basis_pages:[14],product:null},
    {title:'Seimbangkan kapasitas muat dengan panen',detail:D,priority:'tinggi',timeline:'1–3 bulan',basis_pages:[17],product:null},
    {title:'Wajibkan timbang setiap janjang terjual',detail:D,priority:'tinggi',timeline:'segera (bulan ini)',basis_pages:[15],product:P},
    {title:'Tegakkan kriteria matang panen',detail:D,priority:'sedang',timeline:'1–3 bulan',basis_pages:[13],product:P}], pg => ({pageId:'x', label:'→ Lampiran A5'}));
  return b.texts; })()`);
const prods = lay.filter(t => /^Solusi SawitPRO/.test(t.txt)), metas = lay.filter(t => /^Prioritas/.test(t.txt));
const overlapFree = prods.every(p => { const m = metas.find(m => Math.abs(m.x - p.x) < 20 && m.y > p.y); return m && p.y + p.h <= m.y; });
const bottom = Math.max.apply(null, metas.map(m => m.y + m.h));
ok(prods.length === 2 && overlapFree && bottom <= run('DECK_CONFIG.LAYOUT.BOTTOM') && !/Kartu rekomendasi/.test(run('RUN_WARNINGS').join(' ')), `kartu rekomendasi tanpa tumpang tindih (baris produk di atas baris prioritas; bawah ${bottom.toFixed(1)} ≤ ${run('DECK_CONFIG.LAYOUT.BOTTOM')})`);
const kreq = run(`(function(){ const b = new SlideBatch('pg','kpi'); drawKpiCards(b, computeOwnerKpis(kd), 160); return JSON.stringify(b.req); })()`);
ok(/vs rata-rata 2 bulan/.test(kreq), 'kartu KPI menampilkan pembanding');
const agf = run('fallbackAgenda(plan)');
ok(agf.items.map(i => i.title).join('|') === 'Kinerja Bulan Ini|Temuan (Findings)|Actionable Item|Data Pendukung' && agf.items[0].pages[0] === 3 &&
   agf.items[3].pages[0] === plan.dividerPage && agf.outcomes.length === 3, `agenda tetap: ${agf.items.map(i => `${i.title} (hlm ${i.pages[0]})`).join(', ')}`);
run('RUN_WARNINGS = []');

// 4. ID tidak cocok (tanpa UI -> tidak dipakai)
setAnswer('deadbeef'); run('RUN_WARNINGS = []');
res = run('loadClaudeAnswer(sheet, data, plan)');
ok(res.ai === null && !res.abort && /tidak cocok/.test(run('RUN_WARNINGS').join(' ')), 'ID paket beda -> jawaban tidak dipakai + peringatan');
// 4b. ID tidak cocok dengan UI (Ya = tetap pakai)
UI_ON = true; run('RUN_WARNINGS = []'); res = run('loadClaudeAnswer(sheet, data, plan)'); UI_ON = false;
ok(res.ai && /berbeda/.test(CAPTURED[1]), 'dengan UI: dialog konfirmasi muncul, pilihan Ya memakai jawaban');

// 5. JSON rusak di D3
setAnswer(packet.id); cells.D3 = cells.D3.slice(0, 200); run('RUN_WARNINGS = []');
res = run('loadClaudeAnswer(sheet, data, plan)');
const w = run('RUN_WARNINGS').join(' | ');
ok(res.ai && /D3: JSON tidak valid/.test(w) && /lampiran/.test(w) && Object.keys(res.ai.byId).length === chunks[0].length, 'D3 rusak -> D1 & D2 tetap dipakai, lampiran sisanya cadangan');

// 6. Tren bertentangan & judul terlalu panjang
setAnswer(packet.id);
const d2 = JSON.parse(cells.D2); const bj = d2.slides.concat(JSON.parse(cells.D3).slides).find(s => s.id === 'bjr');
const blockWith = JSON.parse(bj ? cells.D2 : cells.D3); const sl = blockWith.slides.find(s => s.id === 'bjr');
sl.trend = 'naik'; sl.headline = 'Judul yang sangat panjang sekali sehingga pasti tidak muat dalam satu baris judul slide';
cells[bj ? 'D2' : 'D3'] = JSON.stringify(blockWith); run('RUN_WARNINGS = []');
res = run('loadClaudeAnswer(sheet, data, plan)');
ok(res.ai.byId.bjr.mismatch === true && res.ai.byId.bjr.headline === '', 'tren bertentangan dengan sinyal -> ditolak (judul/insight cadangan)');

// 7. Sel kosong
for (const k of Object.keys(cells)) delete cells[k];
run('RUN_WARNINGS = []'); res = run('loadClaudeAnswer(sheet, data, plan)');
ok(res.ai === null && !res.abort && /belum berisi/.test(run('RUN_WARNINGS').join(' ')), 'D1 kosong -> teks cadangan + peringatan');
UI_ON = true; CAPTURED = null; res = run('loadClaudeAnswer(sheet, data, plan)'); UI_ON = false;
ok(res.ai === null && CAPTURED && /belum berisi/.test(CAPTURED[1]), 'D1 kosong dengan UI: pengguna ditanya dulu');

// 8. Isi sel non-JSON tidak ikut terbaca
cells.D1 = 'Catatan biasa'; res = run('readAnswerBlocks(sheet)');
ok(res.blocks.length === 0, 'sel D berisi teks biasa tidak dianggap jawaban');
// 8b. Sel jawaban = D1, D2, D3, F1 (D4 adalah header tabel); blok ke-4 dibaca dari F1 dan disembunyikan dari pembaca data
ok(run('claudeCells().join()') === 'D1,D2,D3,F1,F2,F3' && run('claudeCellA1(3)') === 'F1' && run('claudeCellA1(5)') === 'F3', 'sel jawaban: D1, D2, D3, F1, lalu F2, F3 (bukan D4 yang berisi header tabel)');
for (const k of Object.keys(cells)) delete cells[k];
setAnswer(packet.id); cells.F1 = JSON.stringify({ packet_id: packet.id, slides: [] });
res = run('readAnswerBlocks(sheet)'); run('loadSheetData(sheet)');
ok(res.blocks.map(b => b.a1).join() === 'D1,D2,D3,F1' && GRID().v === '' && run('maskAiCells([["Title","x","",cells0.D1,"",cells0.F1]])[0][5]') === '',
  'F1 terbaca sebagai blok ke-4 dan ikut disembunyikan dari pembaca data');
// 8c. Slide lebih banyak -> F2 dan F3 ikut dipakai, dibaca berurutan, dan disembunyikan dari pembaca data
const bigPlan = Object.assign({}, plan, { appendix: plan.appendix.concat(plan.appendix, plan.appendix.slice(0, 7)).map((t, i) => Object.assign({}, t, { id: t.id + '_' + i })) });
ctx.bigPlan = bigPlan;
const bigPk = run('buildClaudePacket(data, bigPlan)');
ok(bigPk.cells.join() === 'D1,D2,D3,F1,F2,F3' && /Sel F3 \(blok SLIDE 5\/5\)/.test(bigPk.text) && !/hanya .* sel/.test(run('RUN_WARNINGS').join(' ')),
  `${bigPlan.appendix.length} slide lampiran -> sel ${bigPk.cells.join(', ')} tanpa peringatan sel kurang`);
cells.F2 = JSON.stringify({ packet_id: packet.id, slides: [] }); cells.F3 = JSON.stringify({ packet_id: packet.id, slides: [] });
res = run('readAnswerBlocks(sheet)');
ok(res.blocks.map(b => b.a1).join() === 'D1,D2,D3,F1,F2,F3' && run('JSON.stringify(maskAiCells([["T","x","",cells0.D1,"",cells0.F1],["P","x","",cells0.D2,"",cells0.F2],["L","x","",cells0.D3,"",cells0.F3]]).map(r => r[3] + r[5]))') === '["","",""]',
  'F2 dan F3 terbaca sebagai blok ke-5 dan ke-6 dan ikut disembunyikan dari pembaca data');
// 9. Grafik kesimpulan slide utama (bulan laporan vs pembanding), dengan data tiruan
const sumK = run(`MAIN_SUMMARY.m_kinerja({ produksiActual: true, produksi: [{p:{y:2026,m:7},value:210},{p:{y:2026,m:8},value:234.8}],
  revenueTotal: [{p:{y:2026,m:7},value:2.1e8},{p:{y:2026,m:8},value:2.75e8}], costTotal: [{p:{y:2026,m:7},value:3.0e7},{p:{y:2026,m:8},value:3.6e7}],
  profit: [{p:{y:2026,m:7},value:1.8e8},{p:{y:2026,m:8},value:2.39e8}] })`);
ok(sumK && sumK.rows.length === 4 && sumK.rows[2].goodUp === false && /Sep 26/.test(sumK.curLabel) && /Agu 26/.test(sumK.refLabel), 'grafik kesimpulan Kinerja: 4 indikator, Sep 26 vs Agu 26, biaya = makin kecil makin baik');
ctx.sumK = sumK; run('RUN_WARNINGS = []');
const cmp = run(`(function(){ const b = new SlideBatch('pg','sum'); drawCompareRows(b, sumK); return { req: JSON.stringify(b.req), texts: b.texts }; })()`);
const A = run('DECK_CONFIG.LAYOUT.CONTENT');
ok(/▲ 20%/.test(cmp.req) && /Sep 26 \(bulan laporan\)/.test(cmp.req) && cmp.texts.every(t => t.y >= A.top - 1 && t.y + t.h <= A.top + A.height + 1 && t.x + t.w <= A.left + A.width + 1),
  'grafik kesimpulan tergambar di area konten (legenda, selisih %, tidak keluar batas)');

// 10. Uji integrasi: file 1–9 ASLI (tanpa tiruan) dengan sheet tiruan berformat terbaru (blok + jenis tanah)
const ctx2 = Object.assign({}, ctx); delete ctx2.sheet; vm.createContext(ctx2);
for (const f of ['1_ConfigAndStyle.gs', '3_TextAndDataMapper.gs', '4_ClaudeBridge.gs', '5_MainController.gs', '6_ShapeCharts.gs',
                 '7_RecommendationCatalog.gs', '8_StandarMarihat.gs', '9_TanahPupuk.gs', '10_ProduksiBlok.gs', '11_BiayaPerawatan.gs']) vm.runInContext(fs.readFileSync(OUT + f, 'utf8'), ctx2, { filename: f });
vm.runInContext('function setupTemplate() {}', ctx2);   // file 2 (SlidesApp/Drive) tidak dijalankan di Node
const W = 20, blank = () => Array(W).fill('');
const G = []; for (let i = 0; i < 60; i++) G.push(blank());
const put = (r, c, v) => { G[r][c] = v; };
put(0, 0, 'Title'); put(0, 1, 'Kebun Uji'); put(0, 2, 'Dosis NPK Aktual'); put(0, 3, 5); put(1, 2, 'Harga Pupuk NPK'); put(1, 3, 12000); put(1, 0, 'Period'); put(1, 1, 'Mar 2026 - Sep 2026'); put(2, 0, 'Lokasi'); put(2, 1, 'Dumai');
['year_month', 'ton/ha', 'jjg/ha', 'luas panen', 'hargajual/kg', 'total_janjang', 'total_sale_jjg', 'janjang_terjual_tanpa_berat', 'total_tonasehasil', 'avg_bjr_kg',
 'block sale (name, luas, tahun tanam, soil type, total janjang)', 'block unsale (name, luas, tahun tanam, soil type, total janjang)'].forEach((h, c) => put(3, c, h));
['Month', 'jjg Dipanen', 'jjg Dimuat', 'jjg Masuk trip', 'jjg Terjual', 'jjg Terjual tanpa berat'].forEach((h, i) => put(3, 14 + i, h));
// Blok + janjang dipanen per blok (bagian ke-5). A1 rutin dipanen tetapi janjang rendah; B1 dipanen jarang (rotasi);
// A2 lewat umur ekonomis; Robert C produktif (±110% standar). Jumlah per bulan disamakan dengan total janjang kebun.
const blokJjg = (i, pn) => { const a1 = 300, a2 = 200, b1 = i % 3 === 0 ? 900 : 0, b2 = i % 2 ? 400 : 0, c1 = 0;
  const rc = pn - a1 - a2 - b1 - b2 - c1; return { a1, a2, b1, b2, rc }; };
const saleOf = (i, pn) => { const j = blokJjg(i, pn); return `A1, 20 ha, 2007, Gambut, ${j.a1}; A2, 15 ha, 1998, Podsolik Merah Kuning, ${j.a2}; B1, 10 ha, 2015, -, ${j.b1}; Robert C, 50 ha, 2010, -, ${j.rc}`; };
const unsaleOf = (i, pn) => `B2, 12 ha, 2016, Gambut, ${blokJjg(i, pn).b2}; C1, 5 ha, 0, -`;
const M = [ // bulan, panen, terjual berberat, tanpa berat, ton, harga
  [2, 6000, 5600, 100, 110, 2900], [3, 6200, 5900, 50, 118, 2950], [4, 5800, 5500, 0, 112, 2800], [5, 6500, 6000, 200, 121, 2750],
  [6, 6400, 6100, 100, 125, 2960], [7, 6100, 5300, 300, 108, 2890], [8, 6600, 4800, 400, 96, 2910]];
M.forEach(([m, pn, sold, nw, ton, h], i) => {
  const r = 4 + i, date = `1/${m + 1}/2026`, lp = 53;
  [date, ton / lp, sold / lp, lp, h, pn, sold, nw, ton, (ton * 1000) / sold, saleOf(i, pn), i % 2 ? unsaleOf(i, pn) : ''].forEach((v, c) => put(r, c, v));
  [date, pn, pn - 100, pn - 100, sold, nw].forEach((v, k) => put(r, 14 + k, v));
});
put(24, 0, 'Analisis Pengeluaran');
['year_month', 'total_harvested_area_ha', 'total_supply_ton', 'upkeep_cost_idr', 'harvest_cost_idr', 'load_cost_idr', 'total_cost_idr', 'revenue_idr', 'total_cost_per_kg', 'revenue_per_kg', 'total_cost_per_ha', 'revenue_per_ha']
  .forEach((h, c) => put(25, 5 + c, h));
M.forEach(([m, pn, sold, nw, ton, h], i) => {
  const cost = 2.0e7 + i * 1e6, rev = ton * 1000 * h;
  [`1/${m + 1}/2026`, 53, ton, 0, cost, 0, cost, rev, cost / (ton * 1000), h, cost / 53, rev / 53].forEach((v, c) => put(26 + i, 5 + c, v));
});
put(44, 5, 'Top Mandor Panen'); ['Nama', '2 Bulan Lalu', 'Bulan Lalu', 'Bulan Ini'].forEach((h, c) => put(45, 5 + c, h));
put(46, 5, 'Robert C'); put(46, 6, '600 jjg/hari; 22 hari'); put(46, 7, '650 jjg/hari; 21 hari'); put(46, 8, '300 jjg/hari; 5 hari');
put(47, 5, 'Budi'); put(47, 6, '420 jjg/hari; 20 hari'); put(47, 7, '380 jjg/hari; 22 hari'); put(47, 8, '-');
const disp = G.map(r => r.map(v => (typeof v === 'number' ? String(v) : v)));
ctx2.sheet2 = { getName: () => 'Kebun Uji', getDataRange: () => ({ getValues: () => G.map(r => r.slice()), getDisplayValues: () => disp.map(r => r.slice()) }), getRange: () => ({ getValue: () => '' }) };
const run2 = code => vm.runInContext(code, ctx2);
run2('RUN_WARNINGS = []; var D2 = loadSheetData(sheet2); var P2 = planDeck(D2);');
const D2 = run2('D2'), P2 = run2('P2');
ok(D2.blocks && D2.blocks.blocks.length === 6 && D2.blocks.blocks.find(b => b.name === 'A1').soil === 'Gambut', `blok format terbaru terbaca: ${D2.blocks && D2.blocks.blocks.length} blok unik, jenis tanah per blok`);
ok(D2.soil && D2.soil.groups.map(g => g.name).join() === 'Gambut,Podsolik Merah Kuning,Belum tercatat' && Math.round(D2.soil.unknownHa) === 65,
  `jenis tanah: ${D2.soil && D2.soil.groups.map(g => `${g.name} ${g.ha} ha`).join(', ')}`);
ok(D2.fertilizer && D2.fertilizer.totalTon > 0 && D2.fertilizer.haNoAge === 5, `kebutuhan pupuk indikatif ${D2.fertilizer && D2.fertilizer.totalTon.toFixed(1)} ton/tahun (blok tanpa tahun tanam tidak dihitung)`);
const c2 = D2.flow.cur, p2 = D2.flow.prev;
ok(c2 && c2.p.m === 8 && c2.lossJjg === 0 && c2.agedStock === 0 && c2.pendingJjg === c2.balance && c2.balance === 3250 && p2.p.m === 7 && p2.lossJjg === 0 && p2.pendingJjg === 1850,
  `kebocoran per bulan: Sep 26 belum terjual ${c2 && c2.pendingJjg} + tertahan >1 bln ${c2 && c2.lossJjg} jjg vs Agu 26 ${p2 && p2.lossJjg} jjg (bukan kumulatif ${D2.flow.lossJjg} jjg)`);
// Restan terbawa: panen Jun belum terjual lalu terjual Jul -> Jun "belum terjual" (bukan kerugian), Jul tidak ada kerugian
const pm = m => ({ y: 2026, m }), ser = arr => arr.map((v, i) => ({ p: pm(5 + i), label: 'x', value: v }));
ctx2.dR = { flowPanen: ser([18000, 23000, 20000]), flowMuat: ser([0, 41000, 19000]), flowTrip: [], flowSold: ser([0, 41000, 19000]), flowSoldNoWeight: [],
  produksi: ser([0, 700, 330]), bjr: ser([null, 17, 17]), hargaJual: ser([2500, 2500, 2500]), revKg: [], totalJjg: ser([18000, 23000, 20000]), bjrSoldMonthly: [] };
const FR = run2('buildFlow(dR)'), FRm = FR.monthly;
ok(FRm[0].pendingJjg === 18000 && FRm[0].lossJjg === 0 && FRm[1].carrySold === 18000 && FRm[1].lossJjg === 0 && !FRm[1].overSold && FRm[2].pendingJjg === 1000 && FRm[2].lossJjg === 0,
  `restan Jun terjual Jul: Jun belum terjual ${FRm[0].pendingJjg} (kerugian ${FRm[0].lossJjg}), Jul sisa terjual ${FRm[1].carrySold}, Agu kerugian ${FRm[2].lossJjg}`);
ctx2.dR.flowSold = ser([0, 20000, 19000]); ctx2.dR.flowMuat = ser([0, 20000, 19000]);
const FR2 = run2('buildFlow(dR)').monthly;
ctx2.dR.partialFlow = { p: pm(8), panen: 2000, sold: 12000 };
const FR3 = run2('buildFlow(dR)').cur;
ok(FR3.soldLater === 10000 && FR3.lossJjg === 0 && FR3.agedStock === 0 && FR3.pendingJjg === 20000 - 8000,
  `sisa yang sudah terjual di bulan berjalan tidak dihitung kerugian: ${FR3.soldLater} jjg terjual Sep -> tertahan ${FR3.lossJjg} jjg`);
delete ctx2.dR.partialFlow;
ok(FR2[2].lossJjg === 2000 && FR2[2].agedStock === 2000 && FR2[2].pendingJjg === 20000 && FR2[2].lossRp > 0,
  `janjang lama terjual lebih dulu: Jul menjual sisa Jun dulu, Agu baru tertahan >1 bulan ${FR2[2].lossJjg} jjg (jumlah minimal), panen Agu belum terjual ${FR2[2].pendingJjg}`);
const k2 = run2('computeOwnerKpis(D2)').find(k => /tercatat/i.test(k.name));
ok(k2 && /Sep 26/.test(k2.name) && /pastikan muat & jual diinput/.test(k2.note), `KPI alur panen tidak tercatat: ${k2 && `${k2.name} ${k2.value} ${k2.unit} | ${k2.note}`}`);
ok(P2.mains.every(m => m.summary && m.summary.rows.some(r => r.cur !== null)), `semua slide utama punya grafik kesimpulan: ${P2.mains.map(m => m.id + '=' + (m.summary ? m.summary.rows.length : 0)).join(', ')}`);
ok(P2.appendix.some(t => t.id === 'tanah') && P2.appendix.some(t => t.id === 'pupuk') && P2.appendix.find(t => t.id === 'tanah').mainOf.id === 'm_penyebab', 'lampiran Jenis Tanah & Kebutuhan Pupuk masuk tema Penyebab');
const pk2 = run2('buildClaudePacket(D2, P2)');
ok(/ALUR PANEN KE MUAT\/JUAL BULAN LAPORAN/.test(pk2.text) && /JENIS TANAH BLOK/.test(pk2.text) && /REKOMENDASI PUPUK PREDIKSI/.test(pk2.text) && /NERACA HARA/.test(pk2.text) && /grafik kesimpulan/.test(pk2.text) && /Uji Tanah Dokter Sawit/.test(pk2.text) && !/Robert C/.test(pk2.text),
  'paket: kebocoran bulan laporan, jenis tanah, kebutuhan pupuk, grafik kesimpulan, produk uji tanah; nama tetap disamarkan');
const rc2 = run2('detectRecommendations(D2, P2.topics, detectAnomalies(P2.topics, D2))').map(r => r.code);
ok(rc2.indexOf('R22') >= 0 && rc2.indexOf('R24') >= 0, `rekomendasi terindikasi: ${rc2.join(', ')} (R22 uji tanah, R24 pupuk sesuai tanah)`);
const ap2 = run2(`attachProducts([{ code: 'R22' }, { code: 'R24' }, { code: 'R04' }])`);
ok(ap2[0].product[0].name === 'Uji Tanah Dokter Sawit' && ap2[1].product.map(x => x.name).join() === 'Dokter Sawit,Pupuk SawitPRO' && ap2[2].product === null, 'produk cadangan: uji tanah, pupuk; maks. 2 kartu berproduk');
run2('RUN_WARNINGS = []');
const lay2 = run2(`(function(){ const out = []; P2.mains.forEach(m => { const b = new SlideBatch('pg', m.id); drawCompareRows(b, m.summary); out.push(b.texts); }); return out; })()`);
const A2 = run2('DECK_CONFIG.LAYOUT.CONTENT');
ok(lay2.every(ts => ts.every(t => t.y >= A2.top - 1 && t.y + t.h <= A2.top + A2.height + 1)), 'grafik kesimpulan kelima slide utama muat di area konten');
const tbl2 = run2(`(function(){ const t = P2.appendix.find(x => x.id === 'pupuk'); const b = new SlideBatch('pg','pupuk'); t.draw(b); const t2 = P2.appendix.find(x => x.id === 'alurjjg'); const b2 = new SlideBatch('pg','alur'); t2.draw(b2); return JSON.stringify(b.req) + JSON.stringify(b2.req); })()`);
ok(/"text":"Kesimpulan"/.test(tbl2) && /Pastikan dengan Uji Daun dan Uji Tanah Dokter Sawit/.test(tbl2) && /"text":"6.600"/.test(tbl2), 'lampiran Status Pemupukan tergambar (kesimpulan + saran uji); corong alur janjang memakai bulan laporan (6.600 dipanen)');
const N2 = D2.npk, rowOf = (age, soil) => N2.rows.find(r => r.age === age && r.soil === soil);
ok(N2 && N2.actual === 5 && N2.price === 12000, 'dosis NPK aktual 5 kg & harga Rp12.000/kg terbaca dari nilai asli sel (bukan tampilan "12.000")');
const g1419 = rowOf('TM 14–20 th', 'Gambut'), m913 = rowOf('TM 9–13 th', 'Belum tercatat'), pmk = rowOf('TM >20 th', 'Podsolik Merah Kuning');
ok(m913 && m913.dose.urea === 2.5 && m913.dose.sp36 === 2.25 && m913.dose.mop === 2.25 && m913.dose.kies === 1.5,
  'prediksi tanah mineral = tabel Permentan 131/2013 (TM 9–13 th: Urea 2,5; SP-36 2,25; MOP 2,25; Kieserit 1,5 kg/pohon/th)');
ok(g1419 && Math.abs(g1419.dose.urea - 2.75) < 1e-9 && Math.abs(g1419.dose.mop - 2.2) < 1e-9 && Math.abs(g1419.npk - 2.2 * 0.6 / 0.27) < 1e-9 && g1419.status === 'sesuai',
  `gambut = Permentan × 1,1 dan setara NPK 13-6-27-4 ${g1419 && g1419.npk.toFixed(2)} kg (status sesuai untuk dosis aktual 5 kg)`);
ok(pmk && pmk.status === 'berlebih' && pmk.gapRp > 0 && N2.lebihHa === 15 && N2.haNoAge === 5,
  `umur >20 th (interpolasi): dosis aktual 5 kg BERLEBIH ≈ Rp${pmk && Math.round(pmk.gapRp).toLocaleString('id-ID')}/tahun; blok tanpa tahun tanam tidak dihitung`);
ok(g1419.veg && g1419.veg.N === 223 && g1419.serapanPot && g1419.serapanPot.K2O > g1419.veg.K2O && g1419.serapanReal,
  'neraca hara: vegetatif dari tabel sheet "pupuk" + terangkut panen (realisasi & potensi Marihat)');
console.log(N2.rows.map(r => `   ${r.ageShort} | ${r.soil} | ${r.ha} ha | Urea ${r.dose.urea.toFixed(2)} SP36 ${r.dose.sp36.toFixed(2)} MOP ${r.dose.mop.toFixed(2)} Kies ${r.dose.kies.toFixed(2)} | NPK ${r.npk.toFixed(2)} | ${r.status}${r.gapRp ? ' Rp' + Math.round(r.gapRp) : ''}`).join('\n'));
const np2 = run2(`(function(){ const t = P2.appendix.find(x => x.id === 'pupuk'); const b = new SlideBatch('pg','npk'); t.draw(b); return t.title + '|' + JSON.stringify(b.req) + t.facts; })()`);
const FS2 = D2.fertStatus;
ok(/^Status Pemupukan Kebun\|/.test(np2) && /STATUS PEMUPUKAN \(PESAN UTAMA/.test(np2) && /bukti pendukung/.test(np2) && /Dosis NPK aktual/.test(np2) && /Permentan 131\/2013/.test(np2) && /NERACA HARA/.test(np2),
  `lampiran Status Pemupukan: ${FS2.label} (${FS2.reason}); bukti: ${FS2.evidence.map(e => e.indikator).join(', ')}`);
// Status pemupukan dari data tiruan: kurang (hasil rendah), berlebih (dosis aktual), tidak ada indikasi, belum dapat dinilai
const st = obj => { ctx2.dS = obj; return run2('buildFertilizerStatus(dS)'); };
const Mlow = { nMonths: 12, achTon: 0.29, achBjr: 0.55, achJjg: 0.6, realTonHa: 8.1, pot: { ton: 28, rbt: 20, rjt: 10 }, realBjr: 11, realRjt: 6, cls: 'S3' };
const Mok = Object.assign({}, Mlow, { achTon: 0.95, achBjr: 0.97, achRjt: 0.95 });
const base = { hargaJual: [], revKg: [], upkeep: { headers: ['activity_group', 'total_upkeep_cost'], rows: [['Pemupukan', '25000000'], ['Panen', '10000000']] } };
const sK = st(Object.assign({}, base, { marihat: Mlow })), sOk = st(Object.assign({}, base, { marihat: Mok })), sB = st(Object.assign({}, base, {}));
const sL = st(Object.assign({}, base, { marihat: Mok, npk: { actual: 6, rows: [{ lo: 3, hi: 4 }], ha: 50, kurangHa: 0, lebihHa: 40, lebihRp: 5e7 } }));
ok(sK.verdict === 'kurang' && /29% dari standar/.test(sK.reason) && sOk.verdict === 'sesuai' && sB.verdict === 'belum' && sL.verdict === 'berlebih' && /di atas prediksi untuk 40 ha/.test(sL.reason),
  `status pemupukan: "${sK.label}" / "${sL.label}" / "${sOk.label}" / "${sB.label}"`);
ok(sK.evidence.find(e => e.indikator === 'Pemupukan tercatat').arah === 'netral' && st(Object.assign({}, base, { marihat: Mlow, upkeep: { headers: [], rows: [['Panen', '1000']] } })).evidence.find(e => e.indikator === 'Pemupukan tercatat').kebun === 'tidak tercatat',
  'bukti catatan pemupukan dari biaya upkeep (tidak tercatat = mendukung indikasi kurang)');
const r23 = run2(`attachProducts([{ code: 'R23' }])`)[0];
ok(r23.product.map(x => x.name).join() === 'Uji Tanah Dokter Sawit,Uji Daun Dokter Sawit', 'R23 (status pupuk) -> produk Uji Tanah + Uji Daun Dokter Sawit');
ctx2.dS = Object.assign({}, D2, { fertStatus: sK, marihat: Mlow });
ok(/^Indikasi kurang pupuk: hasil 29% dari standar$/.test(run2('dataHeadline("pupuk", dS)')) && /Indikasi kurang pupuk/.test(run2('MAIN_SUMMARY.m_penyebab(dS).caption')) && /Uji Daun/.test(run2('MAIN_SUMMARY.m_penyebab(dS).caption')),
  `judul "${run2('dataHeadline("pupuk", dS)')}" dan keterangan slide Penyebab memuat status pupuk + ajakan uji`);
// Data < 3 bulan: produktivitas disetahunkan hanya indikatif (tidak jadi dasar status), BJR tetap berlaku
const sShort = st(Object.assign({}, base, { marihat: Object.assign({}, Mlow, { nMonths: 1, achBjr: 0.95 }) }));
const sShortB = st(Object.assign({}, base, { marihat: Object.assign({}, Mlow, { nMonths: 1 }) }));
ok(sShort.verdict === 'belum' && /indikatif/.test(sShort.evidence[0].arti) && sShortB.verdict === 'belum' && /data 1 bulan, indikatif/.test(sShortB.evidence.find(e => e.indikator === 'BJR').arti),
  `data 1 bulan: hasil & BJR rendah -> "${sShortB.label}" (angka per tahun dan BJR satu bulan masih indikatif)`);
const sNw = st(Object.assign({}, base, { marihat: Object.assign({}, Mlow, { achTon: 0.95 }), noWeight: { share: 96 } }));
const sBjr = st(Object.assign({}, base, { marihat: Object.assign({}, Mlow, { achTon: 0.95 }) }));
ok(sNw.verdict !== 'kurang' && /dari 4% janjang ditimbang/.test(sNw.evidence.find(e => e.indikator === 'BJR').arti) && sBjr.verdict === 'kurang' && /^BJR 55%/.test(sBjr.reason),
  `BJR dari 4% janjang ditimbang tidak jadi dasar status ("${sNw.label}"); BJR dari data timbang cukup -> "${sBjr.label}"`);
ctx2.dS = Object.assign({}, D2, { fertStatus: Object.assign({}, sK, { reason: '2 blok (35% luas) rutin dipanen tetapi janjangnya di bawah 60% standar', priorityBlocks: ['A1', 'B3'] }), marihat: Object.assign({}, Mok) });
ok(run2('dataHeadline("pupuk", dS)') === 'Indikasi kurang pupuk di 2 blok rutin panen', `status kurang dari bukti blok saja -> judul "${run2('dataHeadline("pupuk", dS)')}" (bukan BJR)`);
ok(rc2.indexOf('R24') >= 0 && /di atas acuan/.test(run2('detectRecommendations(D2, P2.topics, detectAnomalies(P2.topics, D2))').find(r => r.code === 'R24').evidence), 'R24 hanya bila dosis aktual menyimpang (di atas prediksi)');
// Tabel sheet "pupuk" dibaca langsung bila ada (mengganti tabel bawaan), lalu kembalikan tabel bawaan
const pupukGrid = [['Keperluan Hara untuk Vegetative Growth Berdasarkan Umur Tanaman', '', '', '', ''], ['Age', 'N', 'P2O5', 'K2O', 'MgO'], ['', '', '', '', ''],
  [4, 543, 134.9, 1664, 242], [5, 446, 116, 1308, 185], [6, 293, 68, 779, 115], [7, 300, 53, 623, 94]];
ctx2.ssMock = { getSheetByName: n => (n === 'pupuk' ? { getDataRange: () => ({ getValues: () => pupukGrid }) } : null) };
ok(run2('readHaraVegetatif(ssMock)') === 4 && run2('haraVegetatifAt(7).N') === 300 && run2('haraVegetatifAt(30).N') === 300,
  'tabel hara vegetatif dibaca dari sheet "pupuk" (umur di atas tabel memakai baris terakhir)');
run2('HARA_VEGETATIF = HARA_VEGETATIF_DEFAULT');
ok(run2('dataHeadline("m_kebocoran", D2)') && /Sep|September/.test(run2('dataHeadline("m_kebocoran", D2)')), `judul otomatis kebocoran: "${run2('dataHeadline("m_kebocoran", D2)')}"`);

// 10b. Temuan audit data asli: label pembanding, tabel upkeep berketerangan, blok tanpa janjang, pemicu rekomendasi
ok(run2('refMonthLabel({y:2026,m:8},{y:2026,m:7})') === 'Agu 26 (bulan lalu)' && run2('refMonthLabel({y:2026,m:8},{y:2026,m:6})') === 'Jul 26 (pembanding terakhir; Agu 26 kosong)',
  'pembanding "bulan lalu" hanya untuk bulan kalender sebelumnya; bulan kosong disebut terus terang');
const upGrid = [['Upkeep Cost 12 bulan juga', ''], ['activity_group', 'total_upkeep_cost'], ['PRUNING', '1618000'], ['Pemupukan', '500000'], ['', '']];
ctx2.upGrid = upGrid;
ok(run2('readTableBelow(upGrid, DECK_CONFIG.HEADERS.UPKEEP_LABEL, DECK_CONFIG.HEADERS.UPKEEP_HEADER).rows.length') === 2 &&
   run2(`readTableBelow([['Upkeep Cost (catatan lain)'],['activity_group','total_upkeep_cost'],['A','1']].map(r => r.concat(['',''])), ['Upkeep Cost'], ['activity_group']).rows.length`) === 1,
  'tabel upkeep terbaca walau judulnya diberi catatan ("Upkeep Cost 12 bulan juga")');
const BA = run2(`buildBlockAnalytics({ blocksRaw: [1, 2, 3].map(m => ({ p: { y: 2026, m }, label: 'x', value: 'X1, 10 ha, 2015, -, 0; Y1, 5 ha, 2015, -, 100; Z1, 3 ha, 2027, -, 50' })) })`);
ok(BA.zeroJjg.map(b => b.name).join() === 'X1' && BA.zeroJjgHa === 10 && BA.yearAfterHarvest.map(b => b.name).join() === 'Z1',
  'blok dengan janjang 0 di semua bulan dikeluarkan dari pembagi; tahun tanam setelah panen pertama ditandai');
const reco = c => run2(`RECO_CATALOG.find(r => r.code === '${c}')`);
ctx2.r09 = reco('R09'); ctx2.r04 = reco('R04'); ctx2.r17 = reco('R17');
ok(run2(`r09.when({ flow: null }, { detected: [{ text: 'PERLU DICEK: janjang dimuat melebihi dipanen 5.021 jjg; cek pencatatan panen dan restan awal periode.' }] })`) === null &&
   run2(`!!r09.when({ flow: null }, { detected: [{ text: 'PERLU DICEK: restan menumpuk 3 bulan' }] })`),
  'R09 (kapasitas muat) tidak terpicu oleh temuan "dimuat melebihi dipanen"');
ok(run2(`r04.when({ yield: [], upkeep: null, marihat: { reliable: false, achTon: 0.28, realTonHa: 5.4, pot: { ton: 19.6 }, cls: 'S3' } })`) === null &&
   run2(`r04.when({ yield: [], upkeep: null, marihat: { reliable: true, achTon: 0.28, realTonHa: 5.4, pot: { ton: 19.6 }, cls: 'S3' } }).priority`) === 'tinggi',
  'R04 tidak terpicu dari produktivitas yang disetahunkan dari data pendek');
ctx2.yUp = [5, 6, 7, 8, 9, 10].map((v, i) => ({ p: { y: 2026, m: i }, label: 'x', value: v }));
ok(run2(`r17.when({ yield: yUp, marihat: { achTon: 0.29 } })`) === null && !!run2(`r17.when({ yield: yUp, marihat: { achTon: 0.95 } })`),
  'R17 (pertahankan praktik baik) tidak muncul bila hasil masih < 70% standar');

// 10c. File script belum lengkap -> pesan menyebut nama file (bukan "buildBlockProduction is not defined")
const missMsg = run2(`(function(){ const f = buildBlockProduction; buildBlockProduction = undefined;
  try { checkProjectFiles(); return ''; } catch (e) { return e.message; } finally { buildBlockProduction = f; } })()`);
ok(/10_ProduksiBlok\.gs/.test(missMsg) && !/9_TanahPupuk/.test(missMsg) && run2('checkProjectFiles()') === undefined,
  `file belum lengkap -> pesan jelas: "${missMsg.slice(0, 70)}..."`);

// 10d. Sheet seperti KT Segati: semua blok 0 ha, bulan Agustus tidak ada, BJR 40 kg dari sedikit janjang ditimbang
const BZ = run2(`buildBlockAnalytics({ totalJjg: [], blocksRaw: [{ p: { y: 2026, m: 8 }, label: 'x', value: 'TAUNAN 1, 0 ha, 2009, -, 72; SEMUTAN, 0 ha, 2009, Gambut, 89' }] })`);
ctx2.dZ = { blocks: BZ, unsale: null };
const SZ = run2('buildSoilAnalytics(dZ)');
ok(SZ.byCount && SZ.unknownPct === 50 && SZ.groups.every(g => g.pct === 50) && run2('buildFertilizerPlan(Object.assign({}, dZ, { yield: [], luasPanen: [], hargaJual: [], revKg: [] })).empty') === true,
  'blok 0 ha: porsi jenis tanah dihitung per jumlah blok, kebutuhan pupuk tidak dihitung (tidak error)');
ctx2.dG = { flowPanen: [ser([1713, 66])[0], ser([1713, 66])[1], { p: pm(8), label: 'x', value: 4142 }], flowMuat: [], flowTrip: [], flowSoldNoWeight: [],
  produksi: [], bjr: [], hargaJual: [], revKg: [], totalJjg: [], bjrSoldMonthly: [] };
ctx2.dG.flowMuat = [{ p: pm(5), value: 0 }, { p: pm(6), value: 0 }, { p: pm(8), value: 3033 }].map(x => Object.assign({ label: 'x' }, x));
ctx2.dG.flowSold = ctx2.dG.flowMuat;
const FG = run2('buildFlow(dG)');
ok(FG.cur.afterGap && FG.cur.carryIn === 0 && FG.cur.lossJjg === 0 && FG.cur.pendingJjg === 1109 && FG.monthly.filter(s => s.salesMissing).length === 2 && !FG.prev,
  'bulan kosong di antaranya (Agustus): sisa Juni–Juli tidak dibawa ke September, pembanding disebut "terakhir"');

// BJR di atas batas wajar (> 35 kg) tidak dipakai dan ditandai
const GB = G.map(r => r.slice()); GB[10][9] = 40.5;
ctx2.sheetB = { getName: () => 'Kebun Uji', getDataRange: () => ({ getValues: () => GB.map(r => r.slice()), getDisplayValues: () => GB.map(r => r.map(v => (typeof v === 'number' ? String(v) : v))) }), getRange: () => ({ getValue: () => '' }) };
const DB = run2('loadSheetData(sheetB)');
ok(DB.bjr.every(x => x.value === null || x.value <= 35) && DB.zeroFixes.some(z => /BJR tidak wajar \(di atas 35 kg\)/.test(z) && /40,5 kg/.test(z)),
  'BJR 40,5 kg ditandai tidak wajar dan tidak dipakai untuk tonase/rupiah');

// 10e. Sisa format chat AI: penanda sitasi dibuang, alias yang ditulis ulang ("Kebun X") tetap dikembalikan ke nama asli
ok(run2(`cleanAiArtifacts({ a: 'laba Rp7,9 juta[cite: 2], namun [cite_start]data blok[cite: 2].\\nBaris kedua【4†source】.' }).a`) === 'laba Rp7,9 juta, namun data blok.\nBaris kedua.' &&
   run2(`restoreAliases({ a: 'Kinerja Kebun X dan KEBUN_X; Blok N01 oleh MANDOR_A' }, [{ real: 'KT Segati Kiri', alias: 'KEBUN_X' }, { real: 'L2 Robert', alias: 'BLOK_N01' }, { real: 'Ador', alias: 'MANDOR_A' }]).a`) === 'Kinerja KT Segati Kiri dan KT Segati Kiri; L2 Robert oleh Ador',
  'penanda "[cite: 2]" dibuang; "Kebun X" dikembalikan ke nama kebun asli');

// 10f. Kerapian slide: baris teks dihitung per kata, nama kebun panjang di cover diperkecil, tabel temuan muat, sumbu Rp kecil
ok(run2(`estLines('Kesepakatan prioritas pembenahan administrasi timbang dan rekonsiliasi alur janjang', 10.1, 162.25)`) === 4,
  'perkiraan baris memakai pemotongan per kata (cocok dengan tampilan kartu Hasil yang dituju: 4 baris)');
const coverShape = { size: null, getText: () => ({ asString: () => 'Business Farm Estate KT Segati Kiri', getTextStyle: () => ({ setFontSize: v => { coverShape.size = v; } }) }), getWidth: () => 600 };
ctx2.presMock = { getSlides: () => [{ getShapes: () => [coverShape] }] };
run2(`fitCoverTitle(presMock, 'Business Farm Estate KT Segati Kiri')`);
ok(coverShape.size >= 20 && coverShape.size < 36 && run2(`estWidth('Business Farm Estate KT Segati Kiri', ${coverShape.size}, true)`) <= 592,
  `nama kebun panjang di cover diperkecil ke ${coverShape.size} pt agar satu baris`);
ok(run2('jtAxis(0.35)') === '0,35 jt' && run2('jtAxis(100)') === '100 jt', 'sumbu Rp juta untuk nilai kecil tidak lagi "0 jt"');
ok(/baru tercatat pada September 2026/.test(run2(`signalSentence('Produksi TBS', 'ton', [{ p: { y: 2026, m: 5 }, value: null }, { p: { y: 2026, m: 8 }, value: 6.3 }], v => fmt(v, 1))`)),
  'satu bulan data: insight "baru tercatat", bukan "tetap ... di seluruh periode"');
const longRows = [1, 2, 3, 4].map(i => ({ finding: 'Profil luas 24 blok belum tercatat di aplikasi KebunPRO', evidence: '24 blok tercatat 0,0 ha di KebunPRO sejak Juni hingga September 2026',
  argument: 'Metrik yield ton/ha dan dosis pupuk presisi tidak dapat dihitung untuk blok mana pun', follow_up: 'Pengukuran luas dan analisis tanah · PIC: Tim SawitPRO · tenggat 30 Nov · Solusi SawitPRO: Uji Tanah Dokter Sawit', pages: [] }));
ctx2.longRows = longRows;
const anomFs = run2(`(function(){ RUN_WARNINGS = []; const b = new SlideBatch('pg','an'); drawAnomalyTable(b, longRows, null);
  const f = b.req.filter(r => r.updateTextStyle && r.updateTextStyle.style && r.updateTextStyle.style.fontSize).map(r => r.updateTextStyle.style.fontSize.magnitude); return { min: Math.min.apply(null, f), warn: RUN_WARNINGS.join(' ') }; })()`);
ok(anomFs.min < 10.1 && !/melebihi tinggi slide/.test(anomFs.warn), `tabel temuan panjang: huruf diperkecil ke ${anomFs.min} pt agar tidak terpotong footer`);

// 10g. Bulan berjalan: ikut dianalisis bila sudah lewat tanggal 25
const partialAt = day => run2(`(function(){ DECK_CONFIG.TODAY = '2026-10-${day}'; const r = isPartialMonth({ y: 2026, m: 9 }); DECK_CONFIG.TODAY = null; return r; })()`);
ok(partialAt('20') === true && partialAt('25') === true && partialAt('26') === false && partialAt('28') === false &&
   run2(`(function(){ DECK_CONFIG.TODAY = '2026-10-28'; const r = isPartialMonth({ y: 2026, m: 8 }); DECK_CONFIG.TODAY = null; return r; })()`) === false,
  'bulan berjalan: tanggal ≤ 25 dikecualikan, tanggal 26–31 ikut dianalisis (28 Oktober -> Oktober masuk)');
const GO = G.map(r => r.slice()); GO[11][0] = new Date(2026, 9, 1); GO[11][5] = 9999;
ctx2.sheetO = { getName: () => 'Kebun Uji', getDataRange: () => ({ getValues: () => GO.map(r => r.slice()), getDisplayValues: () => GO.map(r => r.map(v => (v instanceof Date ? '01/10/2026' : typeof v === 'number' ? String(v) : v))) }), getRange: () => ({ getValue: () => '' }) };
const monthsAt = day => run2(`(function(){ DECK_CONFIG.TODAY = '2026-10-${day}'; RUN_WARNINGS = []; const d = loadSheetData(sheetO); DECK_CONFIG.TODAY = null;
  return { last: monthShort(d.totalJjg[d.totalJjg.length - 1].p), partial: d.partialMonth, inc: !!d.currentMonthIncluded, w: RUN_WARNINGS.join(' ') }; })()`);
const m20 = monthsAt('20'), m28 = monthsAt('28');
ok(m20.last === 'Sep 26' && m20.partial === 'Oktober 2026' && m28.last === 'Okt 26' && m28.inc && /ikut dianalisis karena sudah 28 hari/.test(m28.w),
  `data Oktober: tgl 20 -> bulan terakhir ${m20.last} (Okt dikecualikan); tgl 28 -> bulan terakhir ${m28.last} (ikut dianalisis)`);

// 10h. Upkeep per bulan (file 11): parser, kamus pekerjaan, lonjakan, nilai tidak wajar, bukti pemupukan, rekomendasi
const upG = [['Upkeep Cost 12 bulan juga', '', ''], ['month', 'activity_group (name; cost)', 'total_cost']];
const upRows = [[3, 'PRUNING; 2000000, SLASHING; 3000000, FERTILIZING; 1500000', 6500000], [4, 'PRUNINIG; 2100000, SLASHING; 2900000', 5000000],
  [5, 'SLASHING; 178482500, SPRAYING; 1000000, PRUNING; 1900000', 181382500], [6, 'SLASHING; 3100000, PRUNING; 2000000, LATE_ROTATION_SHRUB_PRUNING; 500000', 5600000],
  [7, 'SLASHING; 2800000, PRUNING; 2200000', 5000000], [8, 'SLASHING; 3000000, PRUNING; 2000000, ROAD_MAINTENANCE; 1000000', 6000000]];
upRows.forEach(([m, t, tot]) => upG.push([new Date(2026, m, 1), t, tot]));
ctx2.upV = upG; ctx2.upD = upG.map(r => r.map(v => (v instanceof Date ? `01/${String(v.getMonth() + 1).padStart(2, '0')}/2026` : String(v))));
const UM = run2('readUpkeepMonthly(upV, upD)');
ok(UM.length === 6 && UM[1].items.find(i => i.code === 'PRUNING').name === 'Penunasan' && UM[1].total === 5000000 && UM[3].items.some(i => i.name === 'Penunasan rotasi terlambat' && i.cat === 'tanaman'),
  'tabel upkeep per bulan terbaca; kode diterjemahkan (PRUNINIG -> Penunasan, LATE_ROTATION_SHRUB_PRUNING -> Penunasan rotasi terlambat)');
ctx2.dUp = { upkeepMonthly: UM, totalJjg: UM.map(m => ({ p: m.p, value: 1000 })), flowPanen: [], yield: [], produksi: UM.map(m => ({ p: m.p, value: 50 })),
  luasPanen: [], costUpkeep: UM.map(m => ({ p: m.p, value: m.p.m === 7 ? 9000000 : m.total })), marihat: { area: 100 }, blocks: null };
const UA = run2('buildUpkeepAnalysis(dUp)');
ok(UA.cur && UA.cur.label === 'Sep 26' && UA.prev.label === 'Agu 26' && UA.spikes[0].name === 'Pembabatan' && UA.spikes[0].p.m === 5 &&
   UA.crossMismatch.length === 1 && UA.fert.months === 1 && UA.fert.monthsSince === 5,
  `analisis upkeep: lonjakan ${UA.spikes[0].name} Jun ${Math.round(UA.spikes[0].ratio)}×, beda antar-tabel ${UA.crossMismatch.length} bulan, pemupukan ${UA.fert.months}/${UA.fert.of} bln (terakhir ${UA.fert.monthsSince} bln lalu)`);
ctx2.dUp.upkeepAnalysis = UA;
ok(/PERLU DICEK: biaya Pembabatan Juni 2026/.test(run2('describeUpkeepMonthly(dUp)')) && run2(`RECO_CATALOG.find(r => r.code === 'R25').when(dUp)`).evidence.indexOf('Pembabatan') === 0,
  'lonjakan biaya ditandai PERLU DICEK dan memicu R25 (cocokkan biaya dengan bukti kerja)');
ctx2.dUp2 = Object.assign({}, ctx2.dUp, { upkeepMonthly: UM.concat([{ p: { y: 2026, m: 9 }, label: 'Okt 26', items: [{ code: 'X', name: 'X', cat: 'lain', cost: 7.5e11 }], itemSum: 7.5e11, total: 7.5e11 }]),
  totalJjg: ctx2.dUp.totalJjg.concat([{ p: { y: 2026, m: 9 }, value: 1000 }]) });
const UA2 = run2('buildUpkeepAnalysis(dUp2)');
ok(UA2.curAbsurd && UA2.totalSeries[UA2.totalSeries.length - 1].value === null && UA2.avgPrev < 1e8 && /TIDAK WAJAR/.test(run2('describeUpkeepMonthly(Object.assign({}, dUp2, { upkeepAnalysis: buildUpkeepAnalysis(dUp2) }))')),
  'upkeep Rp750 miliar (Rp7,5 miliar/ha sebulan) ditandai TIDAK WAJAR dan tidak dipakai sebagai pembanding/grafik');
ok(run2(`RECO_CATALOG.find(r => r.code === 'R06').when({ upkeepAnalysis: { cur: { total: 1, items: [{ name: 'Penyemprotan herbisida', cost: 1, cat: 'gulma' }] }, months: [1] } })`) === null,
  'R06 (hama & penyakit) tidak terpicu oleh penyemprotan herbisida (itu pengendalian gulma)');
const evPupuk = run2(`buildFertilizerStatus(Object.assign({}, D2, { upkeepAnalysis: { months: [1,2,3,4,5,6], fert: { months: 0, of: 6, last: null, monthsSince: null, rp: 0, perYear: 0 } } })).evidence.find(e => e.indikator === 'Pemupukan tercatat')`);
ok(evPupuk.arah === 'kurang' && /tidak ada dalam 6 bulan/.test(evPupuk.kebun), 'tidak ada biaya pemupukan dalam 6 bulan upkeep -> bukti indikasi kurang pupuk');
ok(run2('arrowPct(1859)') === '▲ 20×' && run2('arrowPct(-30)') === '▼ 30%', 'kenaikan > 5 kali ditulis "▲ 20×", bukan persen ribuan');

// 10i. Biaya pekerja tidak wajar (Rp23 juta/ha sebulan) tidak dipakai untuk laba; KPI menyebut bulan laporan yang belum tercatat
const GC = G.map(r => r.slice()); GC[32][11] = 1.2e9; GC[32][15] = 1.2e9 / 53;   // Sep: total biaya Rp1,2 miliar di 53 ha
ctx2.sheetC = { getName: () => 'Kebun Uji', getDataRange: () => ({ getValues: () => GC.map(r => r.slice()), getDisplayValues: () => GC.map(r => r.map(v => (typeof v === 'number' ? String(v) : v))) }), getRange: () => ({ getValue: () => '' }) };
const DC = run2('loadSheetData(sheetC)');
ok(DC.costOutliers.length === 1 && DC.profit.find(x => x.p.m === 8).value === null && DC.zeroFixes.some(z => /biaya pekerja September 2026 .* tidak wajar/.test(z)),
  'biaya pekerja Rp22,6 juta/ha sebulan ditandai tidak wajar; laba bulan itu tidak dihitung');
const kpOct = run2(`computeOwnerKpis(Object.assign({}, D2, { reportP: { y: 2026, m: 9 } }))`);
ok(kpOct.filter(k => / Sep 26$/.test(k.name)).every(k => /^Okt 26 belum tercatat · /.test(k.note)) && kpOct.some(k => / Sep 26$/.test(k.name)),
  'KPI dari bulan sebelum bulan laporan diberi keterangan "Okt 26 belum tercatat"');

// 10j. Hasil audit data asli
// Penjualan belum diinput (muat = jual = tonase = 0): tidak dinilai, panen dibawa ke bulan berikutnya (pola Mahato Jun -> Jul)
ctx2.dM = { flowPanen: ser([18332, 22995, 20000]), flowMuat: ser([0, 40000, 19000]), flowTrip: [], flowSold: ser([0, 40000, 19000]), flowSoldNoWeight: [],
  produksi: ser([null, 726, 330]), tonase: ser([0, 726, 330]), bjr: [], hargaJual: ser([2900, 2900, 2900]), revKg: [], totalJjg: [], bjrSoldMonthly: [] };
const FM = run2('buildFlow(dM)');
ok(FM.monthly[0].salesMissing && FM.monthly[0].lossJjg === 0 && !FM.monthly[1].overSold && FM.monthly[1].carrySold === 18332 && FM.cur.p.m === 7,
  'bulan tanpa penjualan diinput (Jun) tidak dinilai; Juli menjual sisa Juni sehingga tidak dianggap "terjual melebihi dipanen"');
ctx2.dM.flowMuat = ser([20000, 23000, 0]); ctx2.dM.flowSold = ser([18000, 22000, 0]); ctx2.dM.tonase = ser([300, 400, 0]);
const FM2 = run2('buildFlow(dM)');
ok(FM2.cur.p.m === 6 && FM2.salesMissing.length === 1 && /PENJUALAN BELUM DIINPUT: Agustus 2026/.test(run2('describeFlow({ flow: buildFlow(dM) })')),
  'bulan terakhir dengan penjualan belum diinput: kebocoran memakai bulan terakhir yang terukur, bukan "kerugian" (pola Mutiara Okt)');
// Upkeep: kode varian digabung; "baru bulan ini" hanya bila memang belum pernah ada; bulan lonjakan tidak masuk "biasanya"
ok(run2(`parseUpkeepItems('SPRAYING; 2560000, SPRAYING_TOTAL; 1990000, ROAD_MAINTENNANCE; 100, ROAD_MAINTENANCE; 4290000').map(i => i.code + ':' + i.cost).join()`) === 'SPRAYING:4550000,ROAD_MAINTENANCE:4290100',
  'kode varian digabung (SPRAYING_TOTAL -> SPRAYING, ROAD_MAINTENNANCE -> ROAD_MAINTENANCE)');
const UT = run2(`(function(){ const mk = (m, t) => ({ p: { y: 2026, m }, label: 'b' + m, items: parseUpkeepItems(t), total: parseUpkeepItems(t).reduce((a, x) => a + x.cost, 0) });
  const M = [mk(5, 'ROAD_MAINTENANCE; 350000000, PRUNING; 1000000'), mk(6, 'SLASHING; 259904000, PRUNING; 1000000, OTHERS; 100000'), mk(7, 'SLASHING; 7000000, PRUNING; 1000000, OTHERS; 7000000'),
    mk(8, 'SLASHING; 6000000, PRUNING; 1200000'), mk(9, 'OTHERS; 5100000, SLASHING; 1000000')];
  return buildUpkeepAnalysis({ upkeepMonthly: M, totalJjg: M.map((m, i) => ({ p: m.p, value: [1813, 66, 4000, 4142, 6686][i] })), flowPanen: [], yield: [], produksi: [], luasPanen: [], costUpkeep: [], marihat: null, blocks: null }); })()`);
ok(UT.absurd.length === 2 && UT.avgPrev < 2e7 && UT.top.find(t => t.code === 'OTHERS').isNew === false,
  `tanpa luas: bulan > Rp100 ribu/janjang ditandai tidak wajar (${UT.absurd.length} bulan), "biasanya" Rp${Math.round(UT.avgPrev / 1e6)} juta, OTHERS tidak disebut baru`);
// R11: rugi yang hilang bila lonjakan biaya disisihkan bukan rugi nyata; R13 tidak bertentangan dengan bulan laporan
ctx2.dL = { margin: [{ p: { y: 2026, m: 4 }, value: 500 }, { p: { y: 2026, m: 5 }, value: -300 }, { p: { y: 2026, m: 6 }, value: 400 }],
  profit: [{ p: { y: 2026, m: 5 }, value: -4.4e7 }], upkeepAnalysis: { spikeLoss: (p, v) => (p.m === 5 && v > -1.7e8 ? { name: 'Pembabatan' } : null) } };
ok(run2(`RECO_CATALOG.find(r => r.code === 'R11').when(dL)`) === null, 'R11 tidak menyebut "margin negatif" bila ruginya akibat lonjakan biaya yang perlu dicek (R25)');
ctx2.dR13 = { upahRatio: [3, 15, 20, 10].map((v, i) => ({ p: { y: 2026, m: 5 + i }, value: v })) };
ok(run2(`RECO_CATALOG.find(r => r.code === 'R13').when(dR13)`) === null, 'R13 tidak terpicu bila porsi upah bulan laporan justru turun');
// KPI tonase dengan banyak janjang tanpa berat tidak diberi panah naik/turun
const kNw = run2(`OWNER_KPIS.produksi_total(Object.assign({}, D2, { noWeight: { monthly: [{ p: { y: 2026, m: 8 }, share: 64, ton: 250 }] } }))`);
ok(/Penjualan 64% janjang belum diinput/.test(kNw.note) && kNw.tone === 'neutral', `KPI tonase: "${kNw.note}"`);

// Blok yang baru muncul disetahunkan sejak bulan pertamanya; blok besar hampir tanpa janjang -> pencapaian Marihat dua versi
const bpLate = run2(`(function(){ const b = D2.blocks.blocks.find(x => x.name === 'Robert C'), f = b.firstP; b.firstP = D2.blocks.monthly[D2.blocks.monthly.length - 1].p;
  const P = buildBlockProduction(D2); b.firstP = f; return P.rows.find(r => r.name === 'Robert C'); })()`);
ok(bpLate.monthsOf === 1, 'blok yang baru muncul di bulan terakhir disetahunkan dari 1 bulan, bukan seluruh periode');
const mVL = run2(`(function(){ const b = D2.blocks.blocks.find(x => x.name === 'A2'), ha = b.ha, js = b.jjgSum; b.ha = 300; b.jjgSum = 10;
  const M = buildMarihat(D2); b.ha = ha; b.jjgSum = js; return M; })()`);
ok(mVL.veryLow && mVL.veryLow.blocks[0].name === 'A2' && mVL.veryLow.achTon > mVL.achTon,
  `blok 300 ha hampir tanpa janjang: pencapaian ${Math.round(mVL.achTon * 100)}% dengan blok itu, ${Math.round(mVL.veryLow.achTon * 100)}% tanpa blok itu (keduanya dilaporkan)`);

// 11. Produksi per blok (janjang dipanen per blok) + kaitan dengan status pupuk
const pb = run2(`parseBlocks('F10, 3.39 ha, 2012, -, 342; B8, 1.49 ha, 2017, -; Blok Pasar Bingung, 5 ha, 2009, Gambut, 1084')`);
ok(pb[0].jjg === 342 && pb[0].soil === null && pb[1].jjg === null && pb[2].soil === 'Gambut' && pb[2].jjg === 1084,
  'format blok 5 bagian: janjang per blok terbaca; isian tanpa janjang = belum tercatat (bukan nol)');
const BP = D2.blockProd, rowB = n => BP.rows.find(r => r.name === n);
ok(BP && rowB('A1').cat === 'hara' && rowB('A2').cat === 'tua' && rowB('B1').cat === 'rotasi' && rowB('B2').cat === 'rotasi' && rowB('Robert C').cat === 'baik' && !BP.mismatchMonths.length,
  `penyebab blok rendah dipisahkan: A1 ${(rowB('A1').ach * 100).toFixed(0)}% standar & rutin dipanen (hara), B1 dipanen ${rowB('B1').harvestMonths}/${BP.nMonths} bln (rotasi), A2 umur ${rowB('A2').age} th (peremajaan)`);
ok(Math.abs(rowB('A1').jjgHa - 300 * 12 / 20) < 1e-9 && Math.abs(rowB('A1').std.jjgHa - 24000 / 29.8) < 1e-9 && rowB('A1').rjt === null && BP.fertRows.map(r => r.name).join() === 'A1' && BP.gapJjgTotal > 0 && BP.pareto.blocks >= 1,
  `janjang/ha/tahun per blok vs standar Marihat (ton ÷ BJR standar, tanpa asumsi pokok/ha); potensi belum tercapai ±${Math.round(BP.gapJjgTotal)} jjg/th`);
// Blok dengan janjang/pokok tak wajar (>200% standar) dikeluarkan dari analisis; catatan blok di atas ambang tapi <100% tidak disebut "sesuai"
const bpS = run2(`(function(){ const r = D2.blocks.blocks.find(b => b.name === 'Robert C'), ha = r.ha; r.ha = ha / 20;
  const P = buildBlockProduction(D2); D2.__txt = describeBlockProduction(Object.assign({}, D2, { blockProd: P })); r.ha = ha; return P; })()`);
const rcS = bpS.rows.find(r => r.name === 'Robert C');
ok(rcS.cat === 'cek' && bpS.suspectRows.length === 1 && bpS.best.name !== 'Robert C' && !bpS.priority.some(r => r.cat === 'cek') && /PERLU DICEK DATA: 1 blok/.test(D2.__txt),
  `blok >200% standar (Robert C ${Math.round(rcS.ach * 100)}%) ditandai "cek luas/nama blok", tidak jadi blok terbaik`);
ok(run2(`blockNote({ cat: 'baik', ach: 0.69 })`) === 'di bawah standar, masih di atas ambang 60%' && run2(`blockNote({ cat: 'baik', ach: 1.1 })`) === 'sesuai atau di atas standar',
  'catatan blok 69% standar tidak lagi disebut "sesuai standar"');
const bpShort = run2(`(function(){ const T = DECK_CONFIG.THRESHOLDS, old = T.MIN_MONTHS_ANNUAL; T.MIN_MONTHS_ANNUAL = 99;
  const P = buildBlockProduction(D2); D2.__txtS = describeBlockProduction(Object.assign({}, D2, { blockProd: P })); T.MIN_MONTHS_ANNUAL = old; return P; })()`);
ok(bpShort.shortData && !bpShort.fertRows.length && bpShort.rows.find(r => r.name === 'A1').cat === 'pantau' && bpShort.rows.find(r => r.name === 'A2').cat === 'tua' && /INDIKATIF/.test(D2.__txtS),
  'data blok terlalu pendek: blok rendah "pantau" (penyebab belum disimpulkan), tidak ada blok prioritas pupuk, catatan indikatif');
const FS3 = D2.fertStatus;
const blokEv = F => F.evidence.find(e => e.indikator === 'Blok janjang rendah');
ctx2.dW = Object.assign({}, D2, { blockProd: Object.assign({}, D2.blockProd, { fertPct: 35 }) });
const FS4 = run2('buildFertilizerStatus(dW)');
ok(FS3.priorityBlocks.join() === 'A1' && blokEv(FS3).arah === 'netral' && blokEv(FS4).arah === 'kurang' && FS4.verdict === 'kurang',
  `status pupuk memakai bukti per blok (${Math.round(D2.blockProd.fertPct)}% luas = netral, 35% = mendukung kurang): ${FS4.label}; blok prioritas uji daun & tanah: ${FS3.priorityBlocks.join(', ')}`);
const bpT = P2.appendix.find(t => t.id === 'blokprod');
const bpReq = run2(`(function(){ const t = P2.appendix.find(x => x.id === 'blokprod'); const b = new SlideBatch('pg','bp'); t.draw(b); return JSON.stringify(b.req); })()`);
ok(bpT && bpT.mainOf.id === 'm_penyebab' && /Prioritas uji daun & tanah/.test(bpReq) && /Cek rotasi panen/.test(bpReq) && /Kandidat peremajaan/.test(bpReq) && /Standar\\njjg\/ha\/th/.test(bpReq),
  'lampiran Produktivitas per Blok (tema Penyebab): tabel blok prioritas + catatan penyebab');
ok(D2.unsale.jjgTotal === 1200 && /Janjang\\ndipanen/.test(run2(`(function(){ const t = P2.appendix.find(x => x.id === 'blokunsale'); const b = new SlideBatch('pg','bu'); t.draw(b); return JSON.stringify(b.req); })()`)),
  `blok tanpa penjualan kini menghitung janjang dipanen per blok (${D2.unsale.jjgTotal} jjg)`);
ok(/PRODUKSI PER BLOK/.test(pk2.text) && /Blok prioritas uji daun dan uji tanah/.test(pk2.text) &&
   run2(`MAIN_SUMMARY.m_penyebab(D2).rows.map(r => r.label).join()`).indexOf('Luas blok sesuai standar') >= 0 &&
   /^1 blok (rutin dipanen|janjang rendah)/.test(run2('dataHeadline("blokprod", D2)')) && run2('dataHeadline("blokprod", D2)').length <= 45 &&
   /mulai dari blok A1/.test(run2('detectRecommendations(D2, P2.topics, detectAnomalies(P2.topics, D2))').find(r => r.code === 'R23').evidence),
  'paket, grafik kesimpulan Penyebab, judul otomatis, dan R23 memakai produksi per blok');

// 11. Susunan deck baru: Kinerja Bulan Ini (4 pilar) → Temuan → Actionable Item → Struktur Biaya → Terima Kasih → data pendukung
ok(P2.costMain && P2.anomTopic.page === 4 && P2.conclTopic.page === 5 && P2.costMain.page === 6 && P2.closingPage === 7 && P2.dividerPage === 8 &&
   P2.support[0] === P2.mains[0] && P2.support[0].page === 10 && P2.costMain.members.every(t => t.mainOf.id === 'm_keuangan'),
  `deck utama: temuan ${P2.anomTopic.page}, actionable ${P2.conclTopic.page}, struktur biaya ${P2.costMain.page}, terima kasih ${P2.closingPage}; data pendukung mulai hlm ${P2.support[0].page}`);
const PL = run2('computePillars(D2)');
ok(PL.map(p => p.title).join('|') === 'Panen|Penjualan & Pendapatan|Perawatan|Produktivitas' && PL[0].main.name === 'TBS terjual' && PL[0].main.note === '▼ 11% vs Agu 26' && PL[0].sub.name === 'BJR' && PL[0].sub.unit === 'kg/jjg' &&
   PL[1].main.name === 'Pendapatan' && /^Rp279,4$/.test(PL[1].main.value) && PL[1].main.unit === 'juta' && PL[1].sub.name === 'Harga jual' &&
   PL[3].main.name === 'Yield' && PL[3].sub.name === 'Capaian standar Marihat' && PL.every(p => p.main && p.main.note && !/\(.*\d.*\)$/.test(p.main.note)),
  `empat pilar KPI: ${PL.map(p => `${p.title}: ${p.main.name} ${p.main.value} (${p.main.note})${p.sub ? ` + ${p.sub.name}` : ''}`).join(' | ')}`);
ok(PL[2].main.value === '-' && /belum tersedia/.test(PL[2].main.note), 'pilar Perawatan tanpa data upkeep: ditulis "Data belum tersedia", bukan angka 0');
const CS = run2('buildCostStructure(D2)');
const csRow = n => CS.rows.find(r => r.name === n);
ok(CS && mkeyT(CS.p) === '2026-8' && csRow('Panen').share === 100 && Math.round(csRow('Total biaya pekerja').cur) === 2.6e7 && csRow('Laba kotor') && CS.refN === 6 &&
   /belum termasuk pupuk dan bahan/.test(CS.caption) && /STRUKTUR BIAYA September 2026/.test(CS.facts),
  `struktur biaya ${run2('monthLong(buildCostStructure(D2).p)')}: ${CS.rows.map(r => `${r.name} ${Math.round(r.cur / 1e6)} jt`).join(', ')}; ${CS.caption}`);
function mkeyT(p) { return p.y + '-' + p.m; }
const csDraw = run2(`(function(){ RUN_WARNINGS = []; const b = new SlideBatch('pg','cs'); drawCostStructure(b, buildCostStructure(D2)); return { req: JSON.stringify(b.req), texts: b.texts, w: RUN_WARNINGS.slice() }; })()`);
const CSA = run2('DECK_CONFIG.LAYOUT.CONTENT');
ok(/Dari pendapatan September 2026/.test(csDraw.req) && /Biaya pekerja September 2026: Rp26,0 juta, terdiri dari/.test(csDraw.req) && /Laba kotor Rp253/.test(csDraw.req) &&
   /1 kotak = 1% biaya pekerja/.test(csDraw.req) && (csDraw.req.match(/createShape/g) || []).length > 100 && !csDraw.w.length &&
   csDraw.texts.every(t => t.y + t.h <= CSA.top + CSA.height + 1 && t.x + t.w <= CSA.left + CSA.width + 1), 'slide Struktur Biaya tergambar: batang pendapatan → biaya vs laba, diagram 100 kotak + legenda, tidak keluar batas');
// Komponen yang rutin tercatat tetapi kosong di bulan laporan = "belum diinput", bukan biaya nol
ctx2.dMiss = Object.assign({}, D2, { costHarvest: D2.costHarvest.map(x => (x.p.m === 8 ? Object.assign({}, x, { value: 0 }) : x)),
  costUpkeep: D2.costTotal.map(x => ({ p: x.p, label: x.label, value: x.value })) });
const CSM = run2('buildCostStructure(dMiss)');
ok(CSM.missing.length === 1 && CSM.missing[0].name === 'Panen' && CSM.rows.find(r => r.name === 'Panen').cur === null && /Biaya panen belum diinput/.test(CSM.caption) &&
   run2('dataHeadline("m_biaya", dMiss)') === 'Biaya panen Sep belum diinput' && /Belum diinput \(biasanya/.test(run2(`(function(){ const b = new SlideBatch('pg','m'); drawCostStructure(b, buildCostStructure(dMiss)); return JSON.stringify(b.req); })()`)),
  `biaya panen yang rutin tercatat tetapi kosong bulan ini ditulis "belum diinput": ${CSM.caption.split('. ')[0]}`);
const plDraw = run2(`(function(){ RUN_WARNINGS = []; const b = new SlideBatch('pg','pl'); drawPillarCards(b, computePillars(D2), 150); return { req: JSON.stringify(b.req), texts: b.texts, w: RUN_WARNINGS.slice() }; })()`);
const BOT = run2('DECK_CONFIG.LAYOUT.BOTTOM');
ok(/PENJUALAN & PENDAPATAN/.test(plDraw.req) && /PRODUKTIVITAS/.test(plDraw.req) && !plDraw.w.length && plDraw.texts.every(t => t.y + t.h <= BOT + 1),
  `kartu empat pilar tergambar tanpa peringatan dan di atas footer (bawah ${Math.max.apply(null, plDraw.texts.map(t => t.y + t.h)).toFixed(1)} ≤ ${BOT})`);
ok(/Biaya pekerja \d+% dari pendapatan Sep/.test(run2('dataHeadline("m_biaya", D2)')) && run2('dataHeadline("m_biaya", D2)').length <= 45, `judul otomatis Struktur Biaya: "${run2('dataHeadline("m_biaya", D2)')}"`);
// RKH: belum diisi -> temuan + rekomendasi R26; terisi lengkap -> tidak ada temuan
const anomR = run2('detectAnomalies(P2.topics, D2)');
const recR = run2('detectRecommendations(D2, P2.topics, detectAnomalies(P2.topics, D2))');
ok(!D2.rkh.filled && anomR.some(a => /RKH/.test(a.text)) && recR.some(r => r.code === 'R26' && r.priority === 'tinggi' && /RKH belum diisi/.test(r.evidence)) && /RENCANA KERJA HARIAN \(RKH\)\nPERLU DICEK: RKH/.test(pk2.text),
  'RKH belum diisi: masuk temuan, paket, dan rekomendasi R26 (rotasi panen lewat RKH)');
ctx2.dK = Object.assign({}, D2, { rkhRaw: D2.yield.map(x => ({ p: x.p, value: 25 })) });
run2('dK.rkh = buildRkh(dK)');
ok(ctx2.dK.rkh.filled && ctx2.dK.rkh.coverage === 1 && run2(`RECO_CATALOG.find(r => r.code === 'R26').when(dK)`) === null && !/PERLU DICEK/.test(run2('describeRkh(dK)')),
  'RKH terisi semua bulan: tidak ada temuan dan R26 tidak terpicu');
ok(run2(`findCell([['x', 'RKH count (Created; completed)']], DECK_CONFIG.HEADERS.RKH) !== null`) && run2(`JSON.stringify(parseRkhCell('45; 30'))`) === '{"created":45,"completed":30}',
  'kolom RKH dikenali dari header "RKH count (Created; completed)" dan isi "45; 30" = 45 dibuat, 30 selesai');
ctx2.dRk = Object.assign({}, D2, { rkhRaw: D2.yield.map(x => ({ p: x.p, value: '45; 30' })) });
run2('dRk.rkh = buildRkh(dRk)');
const rk26 = run2(`RECO_CATALOG.find(r => r.code === 'R26').when(dRk)`);
ok(ctx2.dRk.rkh.cur.done === 30 / 45 && /RKH September 2026 baru selesai 30 dari 45 yang dibuat \(67%\)/.test(run2('describeRkh(dRk)')) && rk26 && rk26.priority === 'sedang' && /selesai 30 dari 45/.test(rk26.evidence),
  `RKH terisi tetapi baru selesai 67%: temuan + R26 (${rk26 && rk26.evidence})`);
// Tabel panjang dipaskan: huruf diperkecil / baris dikurangi agar tidak melewati footer; baris kesimpulan tetap ada
const longRowsT = Array.from({ length: 9 }, (_, i) => ['Blok ' + i, 'teks panjang '.repeat(8), '1', 'catatan yang panjang sekali '.repeat(4)]).concat([['Kesimpulan', 'x', 'y', 'z']]);
ctx2.longRowsT = longRowsT;
const ft = run2(`(function(){ RUN_WARNINGS = []; const A = DECK_CONFIG.LAYOUT.CONTENT; return fitTable(['Indikator','Kebun','Acuan','Artinya'], longRowsT, { colWidths: [1.8, 2, 1.7, 3.5], keepLast: true }, A.width, A.height); })()`);
ok(ft.rows.length < 10 && ft.rows[ft.rows.length - 1][0] === 'Kesimpulan' && ft.o.fontSize === run2('DECK_CONFIG.TYPE.TABLE_CELL_MIN') && /dipotong/.test(run2('RUN_WARNINGS.join()')),
  `tabel panjang dipaskan ke slide: ${ft.rows.length} baris, huruf ${ft.o.fontSize} pt, baris kesimpulan tetap ada`);
// Istilah: tidak ada "kebocoran", "kerugian janjang", atau "terjual tanpa berat" di paket dan teks deck
const deckText = pk2.text + JSON.stringify(PL) + JSON.stringify(run2('fallbackAnomalies(detectAnomalies(P2.topics, D2))')) +
  JSON.stringify(run2('MAIN_SUMMARY.m_kebocoran(D2)')) + P2.appendix.map(t => t.fallback + t.title).join(' ') + P2.mains.map(m => m.title).join(' ');
// id internal (m_kebocoran) dan larangan untuk Claude ("BUKAN janjang hilang", "jangan menulisnya ...") bukan teks deck
const bad = deckText.replace(/m_kebocoran|BUKAN janjang hilang|sebagai janjang hilang|jangan menulisnya "terjual tanpa berat"/g, '').match(/kebocoran|kerugian janjang|terjual tanpa (catatan )?berat|janjang hilang|estimasi kerugian/gi);
ok(!bad, `istilah baru dipakai di paket & deck (penjualan belum diinput, alur panen ke muat tidak tercatat)${bad ? `; masih ada: ${[...new Set(bad)].join(', ')}` : ''}`);
ok(/data penjualannya \(berat\/tiket timbang\) belum diinput/.test(run2('describeNoWeight(D2)')) && /Data Penjualan Belum Diinput/.test(P2.appendix.find(t => t.id === 'tanpaberat').title) &&
   P2.mains.find(m => m.id === 'm_kebocoran').title === 'Alur Panen ke Muat Tidak Tercatat', 'judul bagian & lampiran memakai istilah baru');

console.log(process.exitCode ? '\nADA YANG GAGAL' : '\nSEMUA UJI LOLOS');
