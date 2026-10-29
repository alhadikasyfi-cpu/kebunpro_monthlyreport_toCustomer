/**
 * File 1: ConfigAndStyle.gs
 * Konfigurasi deck KebunPRO bergaya SawitPRO CBR (Customer Business Report): token warna, tipografi, tata letak (pt),
 * header data di sheet, aset gambar, dan helper styling yang dipakai TemplateBuilder & Mapper.
 *
 * Semua ukuran dalam point (pt) pada slide 16:9 Google Slides = 720 x 405 pt.
 * (Design system SawitPRO CBR: nilai px pada kanvas 1280 x 720; pt = px x 0,5625.)
 */

const DECK_CONFIG = {
  // Template WAJIB diisi dengan ID file (script tidak lagi mencari file berdasarkan nama di seluruh Drive).
  TEMPLATE_ID: '16Hib9X3FkvTGbeVWyUnT0-iUFzr0N_GCNvgkZjA0KT4',
  TEMPLATE_NAME: 'Deck Template',   // hanya untuk pesan

  // ---------------- KEAMANAN ----------------
  SECURITY: {
    // Samarkan nama orang & lokasi di PAKET DATA yang Anda tempel ke chat Claude (nama pemilik, mandor, lokasi,
    // nama blok berupa nama orang). Nama asli dikembalikan script saat jawaban dibaca dari sel, jadi deck tetap
    // menampilkan nama asli dan nama asli tidak pernah masuk ke chat.
    ANONYMIZE_FOR_AI: true,
    // Catat ringkasan jawaban Claude ke Execution log (berisi data kebun). Biarkan false di produksi.
    LOG_AI_OUTPUT: false,
    // Email yang boleh menjalankan "Siapkan Template SawitPRO" (mengubah template untuk semua orang).
    // Kosong = siapa pun editor boleh (tidak disarankan).
    ADMIN_EMAILS: []
  },

  // Folder tujuan deck hasil generate (isi ID folder bersama tim; semua user yang generate perlu akses EDITOR).
  // Kosong = folder yang sama dengan template.
  OUTPUT_FOLDER_ID: '',
  // Bagikan deck hasil generate otomatis ke semua editor/viewer spreadsheet ini.
  SHARE_WITH_SHEET_USERS: true,

  // ---------------- JAWABAN CLAUDE (pengganti API AI) ----------------
  // Script TIDAK memanggil API AI apa pun. Teks deck ditulis Claude di chat, lalu ditempel ke sel jawaban
  // pada sheet customer, berurutan sesuai CELLS: sel pertama = blok utama, berikutnya = blok slide lampiran.
  // Menu "1. Salin Paket Data untuk Claude" menampilkan sel mana saja yang harus diisi.
  CLAUDE_INPUT: {
    // Sel jawaban berurutan. Harus sel KOSONG di luar tabel data: baris 4 adalah header tabel (D4 = luas panen),
    // jadi dipakai D1–D3 (di samping Title/Period/Lokasi), lalu F1. Bila slide lebih banyak, F2 lalu F3 ikut dipakai
    // (hanya sel yang dibutuhkan yang diisi). Tambah sel kosong lain di sini bila butuh lebih banyak blok.
    CELLS: ['D1', 'D2', 'D3', 'F1', 'F2', 'F3'],
    SLIDES_PER_BLOCK: 12   // maksimal slide lampiran per sel (menjaga tiap sel jauh di bawah batas 50.000 karakter Sheets)
  },

  // Produk SawitPRO yang boleh DISARANKAN kepada owner di rekomendasi dan temuan (dipilih Claude hanya bila relevan;
  // bila tanpa jawaban Claude, dicocokkan otomatis dengan kode rekomendasi di `codes`, maks. 2 produk per rekomendasi).
  // KebunPRO TIDAK dimasukkan: deck ini sendiri adalah layanan KebunPRO yang sedang dipakai owner.
  //   name  = nama produk; short = keterangan pendek di kartu rekomendasi (maks. ±22 karakter, satu baris);
  //   benefit = penjelasan untuk Claude; codes = kode rekomendasi (file 7) yang cocok.
  // Nama dan kalimat manfaat perlu dikonfirmasi tim SawitPRO sebelum dipakai ke customer.
  SAWITPRO_PRODUCTS: [
    { name: 'Dokter Sawit', short: 'konsultasi agronomis',
      benefit: 'konsultasi agronomis berpengalaman: rekomendasi pemupukan, pengendalian hama, diagnosis penyakit, dan peningkatan produktivitas',
      codes: ['R02', 'R03', 'R05', 'R06', 'R08', 'R16', 'R24'] },
    { name: 'Uji Tanah Dokter Sawit', short: 'analisis hara tanah',
      benefit: 'pengambilan contoh dan analisis tanah per blok/jenis tanah (pH, C-organik, N, P, K, Mg, KTK) sebagai dasar dosis pupuk; wajib bila jenis tanah belum tercatat',
      codes: ['R04', 'R22', 'R23'] },
    { name: 'Uji Daun Dokter Sawit', short: 'analisis hara daun',
      benefit: 'analisis contoh daun (pelepah ke-17) untuk melihat status hara tanaman yang sebenarnya; cocok bila BJR atau produktivitas jauh di bawah standar',
      codes: ['R04', 'R23'] },
    { name: 'Pupuk SawitPRO', short: 'pupuk sesuai rekomendasi',
      benefit: 'penyediaan pupuk sesuai jenis tanah dan umur tanaman, dengan volume mengikuti kebutuhan pupuk indikatif kebun (dikonfirmasi uji tanah/daun)',
      codes: ['R24'] }
  ],
  // Periode tabel "Upkeep Cost" per activity_group di sheet (ditulis di slide & dipakai Claude).
  // Saran: isi tabel itu dengan total 12 bulan penuh yang sama dengan periode laporan, lalu ubah teks ini.
  UPKEEP_ACTIVITY_PERIOD: 'bulan berjalan',

  // Bulan berjalan (belum genap sebulan) tidak dimasukkan ke grafik & statistik,
  // KECUALI hari ini sudah lewat tanggal PARTIAL_MONTH_MIN_DAY (mis. 28 Oktober > 25): bulan itu ikut dianalisis.
  EXCLUDE_CURRENT_MONTH: true,
  PARTIAL_MONTH_MIN_DAY: 25,
  TODAY: null,   // hanya untuk uji: tanggal acuan 'YYYY-MM-DD' (null = hari ini)

  // Urutan tanggal untuk teks seperti 1/10/2025: 'DMY' (Indonesia) atau 'MDY'
  DATE_ORDER: 'DMY',

  // Periode di cover: 'data' = dihitung dari bulan yang benar-benar dianalisis; 'sheet' = isi sel Period
  COVER_PERIOD_SOURCE: 'data',

  // Asal kolom total_tonasehasil: 'panen' = berat janjang yang DIPANEN; 'terjual' = berat janjang yang DIJUAL/ditimbang.
  // Menentukan BJR (tonase ÷ janjang dipanen atau ÷ janjang terjual), nilai janjang yang belum tercatat, dan estimasi penjualan.
  TONASE_BASIS: 'terjual',

  // Ringkasan Kinerja: tampilkan bulan sebelumnya sebagai pembanding bulan terakhir (true/false)
  SCORECARD_SHOW_PREV: true,

  // Minimal bulan lengkap agar tren dianalisis; di bawah ini deck memakai mode ringkasan (snapshot)
  MIN_MONTHS_FOR_TREND: 4,

  // Kartu KPI cadangan (template lama & paket); slide Kinerja Bulan Ini memakai EMPAT PILAR (PILLARS di file 5). 3–6 kartu.
  // Setiap kartu menampilkan realisasi BERDAMPINGAN dengan pembandingnya (baris di bawah angka):
  //   produksi_total            TBS terjual bulan laporan  vs target owner, bila kosong vs bulan sebelumnya
  //   yield_rata2               yield bulan laporan        vs target owner, bila kosong vs rata-rata periode
  //   bjr_rata2                 BJR bulan laporan          vs target owner, bila kosong vs rata-rata periode
  //   pendapatan_bulan_terakhir pendapatan bulan laporan   vs target owner, bila kosong vs bulan sebelumnya
  //   pencapaian_marihat        % dari potensi Marihat     (realisasi vs potensi ton/ha/tahun)
  //   kebocoran_janjang         alur panen belum tercatat / nilainya  vs batas wajar (THRESHOLDS.FLOW_LOSS_PCT)
  //   pilihan lain: laba_bulan_terakhir, tanpa_berat, biaya_per_kg, pendapatan_total, margin_rata2
  // KPI yang datanya tidak ada di sheet otomatis diganti KPI lain yang datanya tersedia.
  KPIS: ['produksi_total', 'yield_rata2', 'bjr_rata2', 'pendapatan_bulan_terakhir', 'pencapaian_marihat', 'kebocoran_janjang'],

  // Ambang analisis (berlaku sama untuk semua kebun; ubah di sini, bukan di kode analisis)
  THRESHOLDS: {
    TREND_PCT_PER_MONTH: 2,     // |kemiringan tren| ≥ 2% dari rata-rata per bulan -> "naik"/"turun"
    CV_HIGH: 25,                // koefisien variasi ≥ 25% -> volatilitas "tinggi" (fluktuatif)
    CV_LOW: 10,                 // < 10% -> "rendah"
    VS_AVG_PCT: 10,             // bulan terakhir > ±10% dari rata-rata -> di atas/di bawah rata-rata
    OUTLIER_Z: 1.8,             // |z-score| > 1.8 -> nilai menyimpang (PERLU DICEK)
    CORR_STRONG: 0.7,
    CORR_MEDIUM: 0.4,
    CONSISTENCY_PCT: { JJG: 2, YIELD: 2, BJR: 5, REVENUE: 3 },  // toleransi cek rumus antar-kolom
    BLOCK_HA_MISMATCH: 0.10,    // total ha daftar blok vs luas panen
    NEW_BLOCK_SHARE: 0.15,      // blok baru > 15% luas daftar blok bulan itu -> "lonjakan blok baru"
    MUAT_VS_PANEN: 0.7,         // JJG dimuat < 70% JJG dipanen -> risiko restan (dari tabel mandor)
    FLOW_LOSS_PCT: 5,           // janjang belum tercatat antar-tahap > 5% -> alur panen ke muat tidak tercatat
    RKH_MIN_DONE: 0.8,          // RKH selesai < 80% dari yang dibuat (bulan laporan) -> temuan + R26
    FLOW_EXCESS_PCT: 2,         // tahap berikut > tahap sebelumnya lebih dari 2% (kumulatif) -> pencatatan tidak konsisten
    REPLANT_AGE: 25,            // umur > 25 tahun -> kandidat peremajaan
    NOWEIGHT_PCT: 5,            // data penjualan (berat) belum diinput untuk > 5% janjang yang keluar kebun -> PERLU DICEK
    UNSALE_MONTHS: 3,           // blok tanpa penjualan ≥ 3 bulan -> blok perlu ditelusuri
    BJR_BELOW_ACUAN: 0.10,      // BJR < 90% batas bawah acuan umur -> PERLU DICEK
    FIRST_MONTH_RAMP: 0.5,      // bulan pertama luas panen < 50% median -> kemungkinan bulan awal belum penuh
    REPEAT_SAME_MIN: 3,         // nilai persis sama ≥ 3 bulan berturut-turut -> kemungkinan isian tetap
    BLOCK_LOW_ACH: 0.6,         // janjang/pokok/tahun blok < 60% standar Marihat umurnya -> blok berproduktivitas rendah
    BLOCK_REGULAR: 0.7,         // blok dipanen ≥ 70% bulan periode = panen teratur (rendahnya bukan karena rotasi)
    BLOCK_VERY_LOW_ACH: 0.1,    // janjang/ha < 10% standar -> selain penyebab di lapangan, luas blok juga perlu dicek
    COST_MAX_RP_HA_MONTH: 5000000, // biaya pekerja > Rp5 juta/ha dalam sebulan tidak wajar -> salah input, tidak dipakai (laba, biaya/kg)
    UPKEEP_SPIKE_X: 5,          // biaya satu pekerjaan / total bulan > 5× median bulan lain -> lonjakan, cek input
    UPKEEP_SPIKE_MIN_RP: 5000000, //   ...dan selisihnya > Rp5 juta (lonjakan kecil diabaikan)
    UPKEEP_MAX_RP_JJG: 100000,  // tanpa luas: upkeep > Rp100 ribu per janjang dipanen dalam sebulan tidak wajar
    UPKEEP_MAX_RP_HA_MONTH: 3000000, // upkeep > Rp3 juta/ha dalam satu bulan tidak wajar -> kemungkinan salah input
    BJR_MAX_KG: 35,             // BJR > 35 kg tidak wajar (standar Marihat tertinggi ±35 kg) -> salah catat/sampel timbang terlalu kecil
    KPI_NOWEIGHT_PCT: 20,       // > 20% janjang bulan itu belum diinput penjualannya -> KPI tonase/yield tidak dibandingkan naik/turun (tonase kurang tercatat)
    BJR_MAX_NOWEIGHT_PCT: 50,   // > 50% janjang belum diinput penjualannya -> BJR dari sampel terlalu kecil, tidak jadi dasar status pupuk
    MIN_MONTHS_ANNUAL: 6,       // < 6 bulan data: angka per tahun hanya indikatif (musim panen: Jun–Sep ±38–40% panen setahun), penyebab blok rendah belum disimpulkan
    BLOCK_SUSPECT_ACH: 2.0,     // janjang/ha > 200% standar -> kemungkinan salah luas/nama blok, dikeluarkan dari analisis blok
    BLOCK_LOW_AREA: 0.3         // ≥ 30% luas blok berproduktivitas rendah -> ikut menjadi bukti indikasi kurang pupuk
  },

  // Kelas umur untuk pengelompokan blok. Acuan BJR & produktivitas per umur memakai Standar Marihat (file 8).
  AGE_CLASSES: [
    { name: 'TBM (<4 th)', min: 0, max: 3 },
    { name: 'TM muda (4–8 th)', min: 4, max: 8 },
    { name: 'TM puncak (9–18 th)', min: 9, max: 18 },
    { name: 'TM tua (19–25 th)', min: 19, max: 25 },
    { name: 'Lewat umur ekonomis (>25 th)', min: 26, max: 200 }
  ],

  // Standar Marihat: kelas kesesuaian lahan bila sheet tidak punya label "Kelas Lahan" (S1 / S2 / S3).
  // S3 dipakai sebagai default karena paling konservatif (potensi terendah).
  DEFAULT_LAND_CLASS: 'S3',
  // Kerapatan tanam (pokok/ha) bila sheet tidak punya label "SPH": 143 = jarak tanam standar 9 m segitiga sama sisi
  // (10.000 ÷ (0,866 × 9²)). Hanya dipakai untuk total kebutuhan pupuk dan hara per pokok; produktivitas dibandingkan per ha.
  SPH_DEFAULT: 143,

  // Aset gambar design system SawitPRO CBR (dipakai saat "Siapkan Template").
  // Isi ID file Drive di ASSET_FILE_IDS; bila kosong, file dicari BERDASARKAN NAMA hanya di dalam ASSET_FOLDER_ID
  // (tidak pernah di seluruh Drive). Upload file cbr-*.jpg/png ke folder aset tersebut.
  ASSET_FILE_IDS: {
    LOGO: '1mIJOrq7vpAx9LUBuHjY2nVs-TckQMb1_',   // sawitpro-logo.png (sama dengan sawitpro-badge-small.png)
    COVER_BG: '',                                 // cbr-cover.jpg
    SECTION_BG: '',                               // cbr-section-fruit.jpg
    CLOSING_BG: ''                                // cbr-closing.jpg
  },
  ASSET_FOLDER_ID: '15ApW71dc-Ab8JwRWcZPjEjNN-D4Cgvs1',
  ASSETS: {
    LOGO: 'sawitpro-badge-small.png',
    COVER_BG: 'cbr-cover.jpg',
    SECTION_BG: 'cbr-section-fruit.jpg',
    CLOSING_BG: 'cbr-closing.jpg'
  },

  // Token warna SawitPRO CBR (tokens.json)
  COLOR: {
    GREEN: '#007200',        // green: header tabel, angka KPI, eyebrow, CTA, "selesai/baik", seri aktual
    GREEN_LOGO: '#426636',   // hanya untuk logo
    YELLOW: '#fcd102',       // sorotan & pill (bukan teks isi): label "Bagian I", pill rentang slide
    YELLOW_TINT: '#fff8d6',  // isi kartu "Hasil yang dituju" di slide Agenda (garis kartu = YELLOW)
    INK: '#141414',          // judul, judul kartu, sel kunci tabel
    MUTED: '#595959',        // teks isi, deskripsi, keterangan
    SURFACE: '#ffffff',
    TINT: '#f4f9f6',         // isi kartu & baris ganjil tabel
    BORDER: '#b9d6c2',       // garis kartu 1px, garis tabel, garis header
    ON_GREEN: '#ffffff',
    WARNING: '#e08e00',      // perlu perhatian / sorotan puncak di grafik (selalu disertai kata)
    DANGER: '#c0392b',       // belum / prioritas tinggi / nilai negatif (selalu disertai kata)
    NEUTRAL: '#bfbfbf',      // menunggu / bulan berjalan
    DIVIDER: '#dfdfdf',      // garis kisi grafik
    CHART_MID: '#4c9a4c',    // seri kedua
    CHART_LIGHT: '#8fc28f',  // acuan / benchmark / target (mis. standar Marihat)
    // alias lama agar kode lama tetap jalan
    SURFACE_SUBTLE: '#f4f9f6', INK_SLATE: '#141414', INK_TEAL: '#007200', NAVY: '#007200', GRID: '#dfdfdf',
    LOGO_GREEN: '#426636', COVER_FALLBACK: '#007200'
  },

  // Satu keluarga huruf: Plus Jakarta Sans (isi Medium 500, kuat 600, judul 700, angka/label 800), cadangan Arial
  FONT: { DISPLAY: 'Plus Jakarta Sans', BODY: 'Plus Jakarta Sans' },
  WEIGHT: { BODY: 500, STRONG: 600, TITLE: 700, HEAVY: 800 },

  // Skala tipe (pt) = px tokens.json × 0,5625 (kanvas design system 1280px = slide Google 720pt).
  // Ukuran minimum CBR: 18px (10,1pt) untuk kalimat, 15px (8,4pt) untuk label/legenda, 14px (7,9pt) footer.
  // Jangan mengecilkan huruf agar muat: persingkat teks atau pecah slide.
  TYPE: {
    SECTION_TITLE: 36,    // section-title 64px ExtraBold (slide pembatas)
    SLIDE_TITLE: 22.5,    // slide-title 40px Bold
    KPI_VALUE: 31.5,      // kpi-value 56px ExtraBold green
    KPI_COMPACT: 25.9,    // sp-kpi--compact 46px (nilai ≥ 8 karakter)
    KPI_UNIT: 11.25,      // kpi unit 20px SemiBold
    KPI_LABEL: 8.4,       // kpi label 15px Bold uppercase
    METRIC: 15.75,        // metric 28px
    SECTION_LABEL: 12.4,  // section-label 22px
    CARD_TITLE: 12.4,     // card-title 22px ExtraBold
    TOC_TITLE: 11.8,      // judul agenda di daftar isi 21px
    TOC_DESC: 9.6,        // deskripsi agenda di daftar isi 17px
    AGENDA_NUM: 12.4,     // angka di lingkaran 22px
    EYEBROW: 8.4,         // eyebrow / label INSIGHT 15px
    TABLE_HEADER: 10.1,   // table-head 18px
    TABLE_SMALL: 7.9,     // keterangan kecil di header tabel 14px
    TABLE_CELL: 10.1,     // body 18px
    TABLE_CELL_MIN: 8,       // tabel padat (mis. temuan) boleh diperkecil sampai ukuran ini agar tidak melewati footer
    META: 12.4,           // meta 22px (cover)
    LEAD: 11.25,          // body-lg / sp-lead 20px
    BODY: 10.1,           // body 18px (isi kartu, insight)
    CAPTION: 8.4,         // caption / legenda 15px
    PILL: 8.4,            // pill 15px ExtraBold
    COVER_NAME: 36,
    COVER_NAME_MIN: 20,      // nama kebun panjang diperkecil sampai ukuran ini agar tetap satu baris
    FOOTER: 7.9           // footer 14px
  },
  // Jarak dalam bawaan kotak teks Google Slides; dikompensasi agar teks tepat di posisi rancangan
  TEXT_INSET: { X: 7.2, Y: 3.6 },
  // Perkiraan lebar karakter Plus Jakarta Sans (× ukuran huruf) untuk menghitung muat/tidaknya teks
  CHAR_W: { BODY: 0.53, HEAVY: 0.6 },

  // Bingkai slide isi (komponen Slide CBR), pt: margin 72px kiri-kanan, 40px atas, 24px bawah;
  // judul 40px + jarak 16px + garis border; jarak 28px ke isi; footer 14px dengan jarak 16px.
  LAYOUT: {
    MARGIN: 40.5,
    RIGHT: 679.5,
    TITLE: { left: 40.5, top: 22.5, width: 639, height: 27 },
    HAIRLINE_Y: 58.5,
    BODY_TOP: 74.25,       // isi dimulai space-section-gap di bawah garis
    BOTTOM: 373,           // isi berakhir 16px di atas teks footer
    FOOTER_TOP: 382,
    // sp-split: tabel/grafik 2/3 kiri, InsightCard 1/3 kanan, jarak 28px
    CONTENT: { left: 40.5, top: 74.25, width: 415.5, height: 298.75 },
    INSIGHT: { left: 471.75, top: 74.25, width: 207.75, height: 298.75, padX: 15.75, padTop: 15.75, padBottom: 20.25 },
    CARD_PAD: 13.5,        // space-card-padding 24px
    CARD_GAP: 10.7,        // space-card-gap 19px
    ROW_GAP: 9,            // space-row-gap 16px
    TOC_ROW_GAP: 7.9,      // jarak baris daftar isi 14px
    SECTION_GAP: 15.75,    // space-section-gap 28px
    // Cover (latar cbr-cover.jpg: logo + garis di atas, foto kebun mulai y≈247pt)
    COVER_TEXT: { left: 40.5, top: 78, width: 600 },
    // Pembatas bagian (latar cbr-section-fruit.jpg: panel foto mulai x≈422pt, pita hijau di bawah)
    SECTION_TEXT: { left: 40.5, top: 112, width: 360 },
    // Penutup (latar cbr-closing.jpg: foto sampai y≈191pt, badge kanan)
    CLOSING_TEXT: { left: 40.5, top: 222, width: 420 }
  },

  // Batas maksimal baris tabel per slide
  MAX_TABLE_ROWS: 11,

  // Teks header/label di sheet (dicari otomatis; boleh beberapa alias, huruf besar/kecil diabaikan)
  HEADERS: {
    TITLE_LABEL: ['Title'],
    PERIOD_LABEL: ['Period'],
    LOCATION_LABEL: ['Lokasi', 'Location'],
    LAND_CLASS_LABEL: ['Kelas Lahan', 'Kelas Kesesuaian Lahan', 'Land Class'],
    SPH_LABEL: ['SPH', 'Pokok/ha', 'Kerapatan Tanam'],
    MONTH: ['year_month', 'month', 'bulan'],
    // Format sheet terbaru (kolom pertama tiap alias) + nama lama sebagai cadangan
    YIELD: ['total_ton_per_ha', 'ton/ha'],
    JJG_HA: ['yield_jjg_per_ha', 'jjg/ha'],
    LUAS_PANEN: ['total_harvested_area_ha', 'luas panen', 'luas panen (ha)', 'area'],
    HARGA_JUAL: ['avg_monthly_ffb_price_idr', 'hargajual/kg', 'harga jual/kg', 'price/kg', 'harga jual (avg monthly) (rp)'],
    TOTAL_JJG: ['total_harvest_jjg', 'total_janjang', 'total janjang'],
    SALE_JJG: ['total_sale_jjg'],                          // janjang terjual yang ada beratnya
    NOWEIGHT_JJG: ['janjang_terjual_tanpa_berat'],         // janjang terjual TANPA catatan berat
    TONASE: ['total_supply_ton', 'total_tonasehasil', 'total_tonase', 'tonase', 'total tonase hasil'],
    // Isi sel blok: "nama, luas ha, tahun tanam, jenis tanah, janjang dipanen; ..." (jenis tanah boleh "-";
    // janjang = janjang DIPANEN di blok itu pada bulan itu, boleh kosong). Header berketerangan dalam kurung,
    // mis. "block sale (name, luas, tahun tanam, soil type, total janjang)", juga dikenali.
    BLOCKS: ['block_sale', 'block sale', 'block (name, hectarage, planted year)', 'block', 'blok'],
    BLOCKS_UNSALE: ['block_unsale', 'block unsale'],        // blok tanpa penjualan bulan itu
    BJR: ['avg_bjr_kg'],
    FLOW_PANEN: ['jjg dipanen', 'janjang dipanen'],
    FLOW_MUAT: ['jjg dimuat', 'janjang dimuat'],
    FLOW_TRIP: ['jjg masuk trip', 'janjang masuk trip', 'jjg delivery'],
    FLOW_SOLD: ['jjg terjual', 'janjang terjual'],                       // terjual DENGAN berat (= total_sale_jjg)
    FLOW_SOLD_NOWEIGHT: ['jjg terjual tanpa berat', 'janjang terjual tanpa berat'],   // = data penjualan (berat) belum diinput
    // Opsional, kolom di tabel bulanan utama: RKH (Rencana Kerja Harian) per bulan, isi "dibuat; selesai", mis. "45; 30".
    // Header "RKH count (Created; completed)". Kolom tidak ada / kosong / 0 = RKH belum diisi.
    RKH: ['rkh count (created; completed)', 'rkh count', 'rkh_count', 'jumlah rkh', 'rkh'],
    // Opsional: tanggal admin terakhir input data mandor (acuan "Bulan Ini"); bila tidak ada, dipakai tanggal script dijalankan
    INPUT_DATE_LABEL: ['Tanggal Input', 'Tanggal Update', 'Update'],
    // Tabel "Biaya Pekerja per Kg atau Ha TBS"
    COST_UPKEEP: ['upkeep_cost_idr'],
    COST_HARVEST: ['harvest_cost_idr'],
    COST_LOAD: ['load_cost_idr'],
    COST_TOTAL: ['total_cost_idr'],
    REVENUE_IDR: ['revenue_idr'],
    REV_KG: ['revenue_per_kg', 'revenue_per_kg_idr'],
    UPAH_KG: ['total_cost_per_kg', 'upah_per_kg_idr'],     // biaya pekerja per kg (dulu: upah per kg)
    REV_HA: ['revenue_per_ha', 'revenue_per_ha_idr'],
    COST_HA: ['total_cost_per_ha', 'cost_per_ha_idr'],
    UPKEEP_LABEL: ['Upkeep Cost', 'Upkeep Cost 12 bulan juga'],
    UPKEEP_HEADER: ['activity_group', 'activity_group (name; cost)', 'activity_group (name; cost; block_name)'],
    RAWAT_LABEL: ['Top Mandor Rawat'],
    PANEN_LABEL: ['Top Mandor Panen'],
    MUAT_LABEL: ['Top Mandor Muat'],
    // Opsional: TARGET OWNER. Tulis label di satu sel dan nilainya tepat di sel kanannya (mis. "Target TBS" | 1200).
    // Bila diisi, target menjadi pembanding utama di kartu KPI dan dikirim ke Claude; bila kosong, pembanding memakai
    // bulan sebelumnya atau rata-rata periode.
    TARGET_TBS: ['Target TBS', 'Target TBS (ton/bulan)', 'Target Produksi'],          // ton per bulan
    TARGET_YIELD: ['Target Yield', 'Target Yield (ton/ha/bulan)'],                     // ton/ha per bulan
    TARGET_BJR: ['Target BJR', 'Target BJR (kg)'],                                     // kg per janjang
    TARGET_REVENUE: ['Target Pendapatan', 'Target Pendapatan (Rp/bulan)', 'Target Penjualan'],  // rupiah per bulan
    // Opsional: PEMUPUKAN. Label di satu sel, nilai tepat di kanannya. Bila dosis aktual diisi, tiap kelompok blok
    // (umur × jenis tanah) dinilai kurang / sesuai / berlebih terhadap acuan NPK (file 9); harga dipakai merupiahkan selisihnya.
    NPK_ACTUAL: ['Dosis NPK Aktual', 'Dosis NPK Aktual (kg/pohon/tahun)', 'Dosis NPK'],   // kg NPK per pohon per tahun
    NPK_PRICE: ['Harga Pupuk NPK', 'Harga NPK', 'Harga NPK (Rp/kg)']                        // rupiah per kg
  },

  FOOTER_LEFT: 'MATERI MILIK\nSAWITPRO',
  FOOTER_RIGHT: 'Dilarang mempergunakan dan menyebarkan isi materi ini tanpa izin dari pihak SawitPRO'
};

const BULAN_PENDEK = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const BULAN_PANJANG = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus',
  'September', 'Oktober', 'November', 'Desember'];

/* ------------------------------------------------------------------------- */
/* Helper styling Slides                                                     */
/* ------------------------------------------------------------------------- */

/** Kotak tanpa border; opts.round = sudut membulat (kartu), opts.border = warna garis 0,75pt. */
function addRect(slide, left, top, width, height, color, opts) {
  const o = opts || {};
  const shape = slide.insertShape(o.round ? SlidesApp.ShapeType.ROUND_RECTANGLE : SlidesApp.ShapeType.RECTANGLE, left, top, width, height);
  shape.getFill().setSolidFill(color);
  if (o.border) { shape.getBorder().getLineFill().setSolidFill(o.border); shape.getBorder().setWeight(0.75); }
  else shape.getBorder().setTransparent();
  return shape;
}

/** Lingkaran tanpa border. */
function addEllipse(slide, left, top, size, color) {
  const shape = slide.insertShape(SlidesApp.ShapeType.ELLIPSE, left, top, size, size);
  shape.getFill().setSolidFill(color);
  shape.getBorder().setTransparent();
  return shape;
}

/**
 * Kotak teks bergaya. opts: font, size, color, bold, weight, align ('LEFT'|'CENTER'|'RIGHT'),
 * valign ('TOP'|'MIDDLE'|'BOTTOM'), lineSpacing (persen, mis. 150).
 */
function addText(slide, text, left, top, width, height, opts) {
  const o = opts || {};
  // Kotak diperbesar sebesar jarak dalamnya: area teks = (left, top, width, height) rancangan
  const I = DECK_CONFIG.TEXT_INSET;
  const box = slide.insertTextBox(text, left - I.X, top - I.Y, width + 2 * I.X, height + 2 * I.Y);
  box.getBorder().setTransparent();
  box.getFill().setTransparent();
  styleTextRange(box.getText(), o);
  try {
    box.setContentAlignment(SlidesApp.ContentAlignment[o.valign || 'TOP']);
  } catch (e) { /* abaikan */ }
  return box;
}

function styleTextRange(range, o) {
  const st = range.getTextStyle();
  const font = o.font || DECK_CONFIG.FONT.BODY;
  // CBR: semua teks Plus Jakarta Sans; isi Medium 500, tebal 700 bila bold
  st.setFontFamilyAndWeight(font, o.weight || (o.bold ? DECK_CONFIG.WEIGHT.TITLE : DECK_CONFIG.WEIGHT.BODY));
  if (o.size) st.setFontSize(o.size);
  st.setForegroundColor(o.color || DECK_CONFIG.COLOR.INK);
  range.getParagraphs().forEach(p => {
    const ps = p.getRange().getParagraphStyle();
    ps.setParagraphAlignment(SlidesApp.ParagraphAlignment[o.align || 'START']);
    if (o.lineSpacing) ps.setLineSpacing(o.lineSpacing);
    ps.setSpaceAbove(0);
    ps.setSpaceBelow(0);
  });
}

/** Mengambil blob aset dari Drive berdasarkan nama file. Mengembalikan null bila tidak ada. */
const _assetCache = {};
function getAssetBlob(key) {
  if (key in _assetCache) return _assetCache[key];
  const name = DECK_CONFIG.ASSETS[key];
  let blob = null;
  try {
    const id = (DECK_CONFIG.ASSET_FILE_IDS || {})[key];
    if (id) blob = DriveApp.getFileById(id).getBlob();
    else if (DECK_CONFIG.ASSET_FOLDER_ID) {
      const files = DriveApp.getFolderById(DECK_CONFIG.ASSET_FOLDER_ID).getFilesByName(name);
      if (files.hasNext()) blob = files.next().getBlob();
    }
  } catch (e) {
    Logger.log(`Aset '${name}' tidak bisa dibaca: ${e.message}`);
  }
  if (!blob) Logger.log(`Aset '${name}' tidak tersedia (isi ASSET_FILE_IDS atau ASSET_FOLDER_ID), dilewati.`);
  _assetCache[key] = blob;
  return blob;
}

function addAssetImage(slide, key, left, top, width, height) {
  const blob = getAssetBlob(key);
  if (!blob) return null;
  const img = slide.insertImage(blob);
  img.setLeft(left).setTop(top).setWidth(width).setHeight(height);
  return img;
}

/**
 * Chrome slide isi (CBR): TANPA logo. Garis border 1px di bawah judul, keterangan kepemilikan kecil
 * di kiri bawah dan nomor halaman ({{page}}) di kanan bawah.
 */
function addContentChrome(slide) {
  const L = DECK_CONFIG.LAYOUT, C = DECK_CONFIG.COLOR, T = DECK_CONFIG.TYPE;
  const line = slide.insertLine(SlidesApp.LineCategory.STRAIGHT, L.MARGIN, L.HAIRLINE_Y, L.RIGHT, L.HAIRLINE_Y);
  line.getLineFill().setSolidFill(C.BORDER);
  line.setWeight(0.75);
  addText(slide, 'Materi Milik SawitPRO · Dilarang menyebarkan tanpa izin', L.MARGIN, L.FOOTER_TOP, 360, 14,
    { size: T.FOOTER, color: C.MUTED, valign: 'MIDDLE' });
  addText(slide, '{{page}}', L.RIGHT - 60, L.FOOTER_TOP, 60, 14,
    { size: T.FOOTER, color: C.MUTED, align: 'END', valign: 'MIDDLE', weight: DECK_CONFIG.WEIGHT.STRONG });
}

/** Judul slide isi: slide-title Bold ink di margin kiri (tanpa logo). */
function addSlideTitle(slide, text) {
  const L = DECK_CONFIG.LAYOUT;
  return addText(slide, text, L.TITLE.left, L.TITLE.top, L.TITLE.width, L.TITLE.height,
    { weight: DECK_CONFIG.WEIGHT.TITLE, size: DECK_CONFIG.TYPE.SLIDE_TITLE, color: DECK_CONFIG.COLOR.INK, valign: 'MIDDLE' });
}

/** Tanggal acuan "hari ini" (DECK_CONFIG.TODAY dipakai saat uji). */
function refToday() {
  return DECK_CONFIG.TODAY ? new Date(`${DECK_CONFIG.TODAY}T12:00:00`) : new Date();
}

/** Bulan p = bulan berjalan yang BELUM lengkap (hari ini ≤ PARTIAL_MONTH_MIN_DAY) -> dikeluarkan dari analisis. */
function isPartialMonth(p) {
  if (!p || !DECK_CONFIG.EXCLUDE_CURRENT_MONTH) return false;
  const t = refToday();
  return p.y === t.getFullYear() && p.m === t.getMonth() && t.getDate() <= DECK_CONFIG.PARTIAL_MONTH_MIN_DAY;
}

/** Perkiraan jumlah baris teks dalam lebar tertentu (pt). */
function estLines(text, size, width, heavy) {
  const cw = size * (heavy ? DECK_CONFIG.CHAR_W.HEAVY : DECK_CONFIG.CHAR_W.BODY);
  const perLine = Math.max(1, Math.floor(width / cw));
  // Simulasi pemotongan per kata (bukan per huruf): kata yang tidak muat pindah utuh ke baris berikutnya
  return String(text || '').split('\n').reduce((n, para) => {
    let lines = 1, cur = 0;
    para.split(/\s+/).filter(Boolean).forEach(w => {
      const len = w.length;
      if (cur && cur + 1 + len > perLine) { lines++; cur = 0; }
      if (len > perLine) { lines += Math.ceil(len / perLine) - 1; cur = len % perLine; } else cur += (cur ? 1 : 0) + len;
    });
    return n + lines;
  }, 0);
}
/** Perkiraan lebar teks satu baris (pt). */
function estWidth(text, size, heavy) {
  return String(text || '').length * size * (heavy ? DECK_CONFIG.CHAR_W.HEAVY : DECK_CONFIG.CHAR_W.BODY);
}
