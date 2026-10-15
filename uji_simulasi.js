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
const grid = disp => { const g = []; for (let r = 0; r < 5; r++) g.push(r === 4 ? ['Target TBS', disp ? '1.200' : 1200, '', cells['D5'] || ''] : ['Title', 'x', '', cells['D' + (r + 1)] || '']); return g; };
const sheet = {
  getName: () => 'Sheet Budi', getDataRange: () => ({ getValues: () => grid(false), getDisplayValues: () => grid(true) }),
  getRange: a1 => ({ getValue: () => cells[a1] || '' })
};
ctx.sheet = sheet;
const run = code => vm.runInContext(code, ctx);
const ok = (c, m) => { console.log((c ? 'OK   ' : 'GAGAL'), m); if (!c) process.exitCode = 1; };

// 1. Rencana + paket
const data = run('loadSheetData(sheet)');
const plan = run('planDeck(loadSheetData(sheet))');
ctx.plan = plan; ctx.data = data;
ok(plan.mains.length === 5 && plan.appendix.length === 24 && plan.appendix[0].id === 'scorecard', `rencana: ${plan.mains.length} slide ringkasan, ${plan.appendix.length} lampiran`);
ok(data.targets.tbs === 1200, 'target owner terbaca dari sheet (Target TBS = 1.200)');
ok(plan.mains[0].page === 4 && plan.anomTopic.page === 9 && plan.conclTopic.page === 10 && plan.appendix[0].page === 14, `halaman: ringkasan ${plan.mains.map(m => m.page)}, temuan ${plan.anomTopic.page}, rekomendasi ${plan.conclTopic.page}, A1 hlm ${plan.appendix[0].page}`);
const packet = run('buildClaudePacket(data, plan)');
ctx.packet = packet;
ok(/^[0-9a-f]{8}$/.test(packet.id), 'ID paket 8 hex: ' + packet.id);
ok(packet.blocks.length === 3 && packet.cells.join() === 'D1,D2,D3', 'blok jawaban: ' + packet.cells.join(','));
ok(!/Pak Budi|Dumai/.test(packet.text) && /KEBUN_X/.test(packet.text) && /LOKASI_X/.test(packet.text), 'nama disamarkan di paket (KEBUN_X, LOKASI_X)');
ok(/TARGET OWNER .*TBS 1\.200 ton\/bulan/.test(packet.text) && /PRODUK SAWITPRO/.test(packet.text) && /Dokter Sawit/.test(packet.text) && /agenda, agenda_notes/.test(packet.text), 'paket memuat target owner, produk SawitPRO, dan agenda');
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
ok(kp[5].name === 'Kerugian janjang Sep 26' && kp[5].value === '60,0' && /20% hilang · ▲ 50% vs Agu 26/.test(kp[5].note) && kp[5].tone === 'bad', 'kebocoran BULAN LAPORAN (bukan kumulatif) vs bulan lalu');
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
ok(agf.items.length === 6 && agf.items[5].pages[0] === 9 && agf.outcomes.length === 3, 'agenda cadangan: 5 sesi + sesi keputusan');
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

// 8. Isi D4 non-JSON tidak ikut terbaca
cells.D1 = 'Catatan biasa'; res = run('readAnswerBlocks(sheet)');
ok(res.blocks.length === 0, 'sel D berisi teks biasa tidak dianggap jawaban');
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
                 '7_RecommendationCatalog.gs', '8_StandarMarihat.gs', '9_TanahPupuk.gs']) vm.runInContext(fs.readFileSync(OUT + f, 'utf8'), ctx2, { filename: f });
const W = 20, blank = () => Array(W).fill('');
const G = []; for (let i = 0; i < 60; i++) G.push(blank());
const put = (r, c, v) => { G[r][c] = v; };
put(0, 0, 'Title'); put(0, 1, 'Kebun Uji'); put(0, 2, 'Dosis NPK Aktual'); put(0, 3, 1.2); put(1, 2, 'Harga Pupuk NPK'); put(1, 3, 12000); put(1, 0, 'Period'); put(1, 1, 'Mar 2026 - Sep 2026'); put(2, 0, 'Lokasi'); put(2, 1, 'Dumai');
['year_month', 'ton/ha', 'jjg/ha', 'luas panen', 'hargajual/kg', 'total_janjang', 'total_sale_jjg', 'janjang_terjual_tanpa_berat', 'total_tonasehasil', 'avg_bjr_kg',
 'block sale (name, luas, tahun tanam, soil type)', 'block unsale (name, luas, tahun tanam, soil type)'].forEach((h, c) => put(3, c, h));
['Month', 'jjg Dipanen', 'jjg Dimuat', 'jjg Masuk trip', 'jjg Terjual', 'jjg Terjual tanpa berat'].forEach((h, i) => put(3, 14 + i, h));
const sale = 'A1, 20 ha, 2007, Gambut; A2, 15 ha, 1998, Podsolik Merah Kuning; B1, 10 ha, 2015, -; Robert C, 8 ha, 2010, -';
const unsale = 'B2, 12 ha, 2016, Gambut; C1, 5 ha, 0, -';
const M = [ // bulan, panen, terjual berberat, tanpa berat, ton, harga
  [2, 6000, 5600, 100, 110, 2900], [3, 6200, 5900, 50, 118, 2950], [4, 5800, 5500, 0, 112, 2800], [5, 6500, 6000, 200, 121, 2750],
  [6, 6400, 6100, 100, 125, 2960], [7, 6100, 5300, 300, 108, 2890], [8, 6600, 4800, 400, 96, 2910]];
M.forEach(([m, pn, sold, nw, ton, h], i) => {
  const r = 4 + i, date = `1/${m + 1}/2026`, lp = 53;
  [date, ton / lp, sold / lp, lp, h, pn, sold, nw, ton, (ton * 1000) / sold, sale, i % 2 ? unsale : ''].forEach((v, c) => put(r, c, v));
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
ok(D2.soil && D2.soil.groups.map(g => g.name).join() === 'Gambut,Podsolik Merah Kuning,Belum tercatat' && Math.round(D2.soil.unknownHa) === 23,
  `jenis tanah: ${D2.soil && D2.soil.groups.map(g => `${g.name} ${g.ha} ha`).join(', ')}`);
ok(D2.fertilizer && D2.fertilizer.totalTon > 0 && D2.fertilizer.haNoAge === 5, `kebutuhan pupuk indikatif ${D2.fertilizer && D2.fertilizer.totalTon.toFixed(1)} ton/tahun (blok tanpa tahun tanam tidak dihitung)`);
const c2 = D2.flow.cur, p2 = D2.flow.prev;
ok(c2 && c2.p.m === 8 && c2.lossJjg === 6600 - 5200 && p2.p.m === 7 && p2.lossJjg === 6100 - 5600 && c2.lossRp < D2.flow.lossRp,
  `kebocoran per bulan: Sep 26 ${c2 && c2.lossJjg} jjg vs Agu 26 ${p2 && p2.lossJjg} jjg (bukan kumulatif ${D2.flow.lossJjg} jjg)`);
const k2 = run2('computeOwnerKpis(D2)').find(k => /janjang/i.test(k.name));
ok(k2 && /Sep 26/.test(k2.name) && /vs Agu 26/.test(k2.note), `KPI kebocoran: ${k2 && `${k2.name} ${k2.value} ${k2.unit} | ${k2.note}`}`);
ok(P2.mains.every(m => m.summary && m.summary.rows.some(r => r.cur !== null)), `semua slide utama punya grafik kesimpulan: ${P2.mains.map(m => m.id + '=' + (m.summary ? m.summary.rows.length : 0)).join(', ')}`);
ok(P2.appendix.some(t => t.id === 'tanah') && P2.appendix.some(t => t.id === 'pupuk') && P2.appendix.find(t => t.id === 'tanah').mainOf.id === 'm_penyebab', 'lampiran Jenis Tanah & Kebutuhan Pupuk masuk tema Penyebab');
const pk2 = run2('buildClaudePacket(D2, P2)');
ok(/KEBOCORAN BULAN LAPORAN/.test(pk2.text) && /JENIS TANAH BLOK/.test(pk2.text) && /KEBUTUHAN PUPUK INDIKATIF/.test(pk2.text) && /grafik kesimpulan/.test(pk2.text) && /Uji Tanah Dokter Sawit/.test(pk2.text) && !/Robert C/.test(pk2.text),
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
ok(/Gambut/.test(tbl2) && /NPK\\nkg\/pohon\/th/.test(tbl2) && /"text":"6.600"/.test(tbl2), 'lampiran rekomendasi NPK tergambar; corong alur janjang memakai bulan laporan (6.600 dipanen)');
const N2 = D2.npk, rowOf = (age, soil) => N2.rows.find(r => r.age.indexOf(age) === 0 && r.soil === soil);
ok(N2 && N2.actual === 1.2 && N2.price === 12000, 'dosis NPK aktual 1,2 kg & harga Rp12.000/kg terbaca dari nilai asli sel (bukan tampilan "12.000")');
ok(rowOf('TM tua', 'Gambut') && rowOf('TM tua', 'Gambut').lo === 1.125 && rowOf('TM tua', 'Gambut').hi === 2.5 && rowOf('TM tua', 'Gambut').status === 'sesuai' &&
   rowOf('TM puncak', 'Gambut').status === 'kurang' && rowOf('TM puncak', 'Belum tercatat').lo === 2,
  'rekomendasi NPK per umur × tanah: TM tua gambut 1,1–2,5 kg (sesuai), TM puncak gambut kurang, tanah belum tercatat = acuan mineral');
console.log(N2.rows.map(r => `   ${r.ageShort} | ${r.soil} | ${r.ha} ha | NPK ${r.lo.toFixed(2)}–${r.hi.toFixed(2)} kg/pohon/th | ${r.tonLo.toFixed(1)}–${r.tonHi.toFixed(1)} ton | ${r.status}${r.gapRp ? ' Rp' + Math.round(r.gapRp) : ''}`).join('\n'));
const np2 = run2(`(function(){ const t = P2.appendix.find(x => x.id === 'pupuk'); const b = new SlideBatch('pg','npk'); t.draw(b); return JSON.stringify(b.req) + t.facts; })()`);
ok(/Dosis aktual/.test(np2) && /"text":"kurang"/.test(np2) && /BUKAN tabel Standar Marihat/.test(np2) && /PERLU DICEK: dosis NPK aktual 1,2/.test(np2) && /6–24 bulan/.test(np2),
  'lampiran NPK: tabel per kelompok + kolom status, fakta memuat risiko kurang/berlebih dan temuan PERLU DICEK');
ok(rc2.indexOf('R24') >= 0 && /di bawah acuan/.test(run2('detectRecommendations(D2, P2.topics, detectAnomalies(P2.topics, D2))').find(r => r.code === 'R24').evidence), 'R24: bukti memakai status dosis NPK (di bawah acuan)');
ok(run2('dataHeadline("m_kebocoran", D2)') && /Sep|September/.test(run2('dataHeadline("m_kebocoran", D2)')), `judul otomatis kebocoran: "${run2('dataHeadline("m_kebocoran", D2)')}"`);

console.log(process.exitCode ? '\nADA YANG GAGAL' : '\nSEMUA UJI LOLOS');
