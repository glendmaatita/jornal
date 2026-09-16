# Rencana fitur multi-company Jornal

Status: diimplementasikan dan diverifikasi pada 16 September 2026. Dokumen ini tetap menjadi kontrak produk/teknis; bukti implementasi dan prosedur rilis tercantum pada bagian 14 dan `MULTI_COMPANY_RUNBOOK.md`.

## 1. Hasil yang dituju

Satu tenant dapat memiliki beberapa company. Pengguna baru tetap mengisi satu company melalui onboarding. Setelah selesai, pengguna dapat membuat company tambahan, memilih company aktif, dan mengelola pembukuan masing-masing secara terpisah dengan login yang sama.

Asumsi produk versi pertama: tenant tetap satu akun PocketBase `users`, sesuai implementasi sekarang. Company adalah ruang pembukuan di bawah akun tersebut. Belum ada undangan anggota atau pembagian role. Jika kelak tenant perlu berisi beberapa user, diperlukan entitas tenant dan membership tersendiri; desain ini tidak menganggap user dan tenant akan selalu identik.

Contoh: satu akun mengelola “Kedai Senja” dan “Studio Senja”. Transaksi, rekening, piutang, saldo awal, profil pajak, dan laporan kedua company terpisah. Mengganti company mengubah ruang data yang sedang dilihat dan diedit.

## 2. Temuan kode dan konsekuensinya

| Area sekarang | Kondisi | Perubahan yang diperlukan |
| --- | --- | --- |
| `src/lib/store.ts` | `activeScope` memakai user ID; `currentBusinessId()` mengembalikan scope | Pisahkan identitas tenant dan company; semua operasi menerima scope yang stabil |
| `src/lib/types.ts` | `BusinessProfile.businessId` dan `Transaction.businessId` mengikuti tenant | Tambahkan identitas company yang eksplisit dan adapter data lama |
| `src/lib/pocketbase-sync.ts` | `businessId()` membaca user ID; filter remote hanya `business_id` | Semua pull, push, delete, retry, dan konflik harus membawa company |
| Migrasi backend 0001–0005 | `business_id` adalah text pemilik tenant; unique index `(business_id, entity, app_id)` | Tambahkan company relation dan perluas index |
| `backend/pocketbase/pb_hooks/jornal_sync.js` | Ownership serta identitas record tidak dapat diubah; revision diperiksa | Tambahkan company ke aturan ownership, scope request, dan immutability |
| `src/lib/queries.ts` | Query key dipisahkan per tenant | Tambahkan company untuk query finansial dan turunannya |
| `src/lib/local-db.ts` | Mirror dan outbox menyimpan snapshot berdasarkan key | Namespace company serta acknowledge berdasarkan versi snapshot |
| `src/router.tsx` | Satu guard auth sekaligus hydration/onboarding | Pisahkan bootstrap tenant, pemilihan company, hydration, dan onboarding company |
| `src/pages/onboarding-page.tsx` | Langsung menyimpan profil dan rekening pada scope aktif | Gunakan proses pembuatan company yang idempotent dan atomik |
| Settings/reset/backup | Beroperasi pada scope tenant aktif | Jadikan company sebagai batas operasi; format backup baru |
| Piutang | Pembayaran menunjuk transaksi asal melalui ID | Validasi kedua transaksi berada dalam company yang sama |

Dropdown saja tidak cukup: scope saat ini juga menentukan tempat menulis draft, hasil request asynchronous, konflik, dan reset remote.

## 3. Cakupan produk

Termasuk dalam versi pertama:

- Onboarding company pertama; pembuatan company berikutnya menggunakan form yang sama.
- Daftar company, pencarian nama, company switcher, dan pengaturan company.
- Mengubah nama company, mengarsipkan, serta memulihkan arsip.
- Data finansial dan preferensi pembukuan terpisah per company.
- Migrasi company lama tanpa mengubah nominal atau menggandakan transaksi.
- Dukungan offline untuk company yang sudah tersimpan di perangkat.
- Backup, restore, reset, piutang, recurring rules, lampiran, dan deep link yang sadar company.

Ditunda ke fitur terpisah: multi-user/role, transfer kepemilikan tenant, laporan gabungan, perpindahan transaksi antar-company, transaksi antar-company otomatis, piutang antar-company otomatis, hard delete company, serta pembuatan company baru saat offline.

Tidak ada batas jumlah company yang dibuat sebagai aturan bisnis pada versi ini. Daftar tetap dipaginasi; endpoint pembuatan diberi rate limit dan diuji pada banyak company.

## 4. Alur pengguna

### Login dan onboarding pertama

1. Login Google dan ambil daftar company milik tenant.
2. Daftar berhasil dimuat dan kosong: tampilkan onboarding. Error jaringan tidak boleh dianggap sebagai daftar kosong.
3. Isi nama, jenis usaha, pengaturan pajak, tanggal mulai, rekening, dan saldo awal seperti sekarang.
4. Tombol “Buat company” membuat company, profil awal, rekening, dan penanda onboarding selesai secara atomik di backend menggunakan satu idempotency key. Setup pertama per tenant juga memakai guard unik agar dua wizard independen yang terbuka bersamaan tidak membuat dua company pertama.
5. Tunggu hasil tersebut tersimpan secara durable di perangkat, aktifkan company, lalu buka beranda atau intent sebelumnya.

Jika proses timeout setelah server menyimpan, retry dengan key yang sama mengembalikan company yang sudah dibuat. Tidak membuat company/rekening duplikat. Jika penyimpanan lokal gagal setelah server berhasil, tampilkan opsi muat ulang company yang sama.

### Menambahkan company setelah onboarding

- Header menampilkan nama company aktif dan tombol pemilih company.
- Pemilih berisi company aktif, daftar company, “Tambah company”, dan “Kelola company”.
- Halaman Settings juga memiliki pintasan “Kelola company”.
- “Tambah company” membuka wizard baru dengan company asal tetap tercatat untuk kembali jika dibatalkan.
- Data company baru kosong; rekening default boleh menggunakan template tetapi ID dan saldo dimulai baru.
- Nama wajib, dipangkas, maksimal 100 karakter; nama sama menampilkan peringatan tetapi diperbolehkan karena ID menjadi identitas.
- Draft wizard bersifat tenant-scoped, dipisahkan dari draft company yang sedang aktif. Pembuatan final membutuhkan koneksi.

### Mengganti company

- Tampilkan nama company pada header dan form transaksi, termasuk form pembayaran piutang.
- Draft disimpan ke company asal sebelum berpindah; jika penyimpanan gagal, perpindahan berhenti dengan pesan retry.
- Jangan menunggu semua upload selesai. Pending perubahan tetap berada di antrean company asal.
- Jika sedang pada halaman umum seperti transaksi/insights, pertahankan jenis halaman dengan data company tujuan. Jika pada detail/edit record, arahkan ke daftar yang sesuai agar ID record lama tidak dipakai di company baru.
- Saat loading, jangan render angka atau data company sebelumnya di bawah nama company tujuan.
- Company yang sudah di-cache dapat dibuka offline dengan indikator data offline. Company tanpa cache menampilkan “Hubungkan internet untuk memuat company ini”.

### Company arsip

- Arsip tetap dapat dilihat dan diekspor, tetapi tidak menerima perubahan finansial atau recurring baru.
- Arsip membutuhkan koneksi, konfirmasi nama, dan antrean lokal yang sudah selesai. Backend tetap memeriksa race dengan device lain.
- Jika device lain mengirim perubahan lama setelah company diarsipkan, server menolak; outbox tetap disimpan untuk pemulihan setelah company dipulihkan.
- Mengarsipkan company aktif memindahkan pengguna ke company aktif lain atau ke halaman Kelola company. Jika semua company diarsipkan, tampilkan pilihan pulihkan/buat baru, bukan onboarding akun baru.

## 5. Model data dan kontrak ownership

Tambahkan collection `companies`:

| Field | Isi dan aturan |
| --- | --- |
| `id` | ID company stabil dari server |
| `tenant_id` | Relation ke `users` untuk versi pertama; diisi dari auth server, immutable |
| `name` | Nama tampilan, sumber utama nama company |
| `status` | `ACTIVE` atau `ARCHIVED` |
| `onboarding_completed_at` | Selesai jika profil dan rekening awal berhasil dibuat |
| `creation_key` | Key idempotency untuk membuat company |
| `legacy_default` | Penanda company penampung data tenant lama; hanya server/migrasi yang dapat mengubah |
| `data_epoch` | Generasi data untuk menolak mutation sebelum reset; hanya server yang menaikkan |
| `revision`, `created`, `updated`, `archived_at` | Kontrol konkurensi dan metadata lifecycle |

Index: unique `(tenant_id, creation_key)`, index daftar `(tenant_id, status, created)`, serta unique parsial satu `legacy_default` per tenant. Company default legacy tidak mengikuti pilihan company aktif.

Pada `jornal_records`:

- Pertahankan `business_id` dengan arti **tenant owner** selama masa kompatibilitas. Jangan mengubah maknanya diam-diam menjadi company ID.
- Tambahkan `company_id` relation ke `companies`; wajib setelah seluruh record selesai dipetakan.
- Unique index baru `(business_id, company_id, entity, app_id)` menggantikan index lama sebelum company kedua dapat dibuat. Record singleton `profile` dan `settings` boleh memakai `app_id` yang sama pada company berbeda.
- Semua entity yang sekarang disinkronkan termasuk history, corrections, dan recurring rules menjadi company-scoped.
- Pertahankan record ID, attachment, revision, timestamp historis, dan hubungan antarrecord saat migrasi.
- JSON payload tidak menjadi sumber authority. Server menggunakan pemilik record, relation company, dan auth.

Pada TypeScript, gunakan `Company`, `TenantContext`, dan `CompanyScope { tenantId, companyId }`. Repository selalu terikat scope. Tambahkan `companyId` pada profil/transaksi; entity anak lain mendapat company dari repository/envelope yang wajib. Selama transisi, `businessId` lama dibaca melalui adapter dan tidak dipakai sebagai identitas company oleh kode baru.

Nama company berasal dari `companies.name`. `BusinessProfile.businessName` menjadi field kompatibilitas yang diturunkan oleh adapter. Edit nama melalui service company; hindari dua sumber nama yang dapat berbeda. Profil finansial/pajak tetap berada pada entity `profile` per company untuk membatasi refactor engine yang tidak perlu.

## 6. Backend dan keamanan

Prinsip wajib untuk list/view/create/update/delete dan file: user terautentikasi, company dimiliki tenant tersebut, dan record berada di company yang diizinkan. Pada versi pertama pemilik tenant berhak mengakses semua company miliknya, tetapi setiap operasi pembukuan harus menyebutkan company secara eksplisit.

Gunakan native collection `jornal_records` untuk sync yang sudah ada dengan rule dan request hook tambahan. Klien baru menyertakan protocol version dan company scope; header/parameter ini adalah konteks request, bukan bukti ownership. Hook memvalidasi ownership dan membatasi query di server; tidak cukup hanya memasang filter di frontend.

Kontrak yang harus diwujudkan:

- List baru tanpa company scope ditolak. Filter kosong, filter alternatif, pagination, dan expand tidak dapat melewati batas yang dipasang server.
- Create: company owner harus cocok dengan auth dan `business_id`; company harus aktif. Server memvalidasi atau mengisi owner dari auth.
- Update/delete: company, owner, `entity`, dan `app_id` immutable; company aktif dan revision sah. Perpindahan record ke company lain ditolak.
- Field lifecycle company hanya diubah melalui service company yang tervalidasi; public create/update mentah dibatasi agar tidak melewati inisialisasi atomik dan idempotency.
- Protected attachments memakai izin record/company yang sama. Uji akses langsung URL file dan token kedaluwarsa; jangan menganggap company switch otomatis mencabut hak user atas file company lain miliknya.
- Foreign reference untuk rekening, transfer rekening, recurring rule, dan pembayaran piutang harus resolve dalam company yang sama. Rule pada JSON memerlukan validasi hook, bukan mengandalkan relation database saja.
- Preserve revision/conflict behavior dan uji update paralel benar-benar menolak stale writes; jangan menurunkan revision untuk melewati konflik.
- Buat audit event company-created/renamed/archived/restored dengan tenant, company, actor, waktu, request ID. Hindari menyimpan token dan payload finansial penuh pada log.

Operasi company yang direncanakan: list/view milik tenant, create-with-setup, rename, archive, restore. Buat endpoint aplikasi khusus untuk operasi lifecycle yang perlu transaksi atomik. Sintaks hook/rule/index dan urutan eksekusinya harus diverifikasi terhadap versi PocketBase yang dipin di Dockerfile saat implementasi; dokumen ini menetapkan kontrak, bukan patch rule siap pakai.

Kontrak respons: validasi input 400, auth tidak valid 401, company/record yang tidak dapat diakses 404 tanpa membocorkan metadata, revision/data epoch/arsip yang bertentangan 409 dengan kode aplikasi berbeda, protocol tidak didukung 426, rate limit 429. Retry otomatis dibatasi pada kegagalan transient; 409 membutuhkan refresh atau resolusi yang sesuai. Request berulang dengan creation key sama tetapi payload berbeda menghasilkan conflict, bukan perubahan diam-diam pada company yang sudah dibuat.

## 7. Scope lokal, routing, dan perpindahan yang aman

| Data | Scope |
| --- | --- |
| Login/token, daftar company | Tenant |
| Pilihan company untuk tab yang terbuka | Tenant + tab, pada sessionStorage |
| Company terakhir sebagai fallback tab baru | Tenant + device, bukan setting global server |
| Profil, rekening, transaksi, piutang, cadangan dana, history | Tenant + company |
| Settings klasifikasi, pola koreksi, recurring | Tenant + company |
| Draft transaksi, filter, preferensi rekening/pembayaran, konflik, reset marker | Tenant + company |
| Preferensi instalasi PWA | Device/origin |

Contoh key baru: `jornal.v2.<tenantId>.<companyId>.transactions`. Query key finansial: `[jornal, tenantId, companyId, entity, ...parameters]`. Daftar company mempunyai key tenant sendiri. Derived queries juga memuat dependency/version data; jumlah rekening saja tidak cukup untuk mendeteksi perubahan saldo.

Hapus ketergantungan operasi asynchronous pada global `activeScope` yang dapat berubah. Bentuk `createCompanyRepository(scope)` dan `syncCompany(scope)`; setiap operasi menangkap scope, session generation, dan versi snapshot sebelum memulai. Scope dipakai untuk semua local write, request, conflict, retry, dan outbox ack hingga selesai.

Urutan switch:

1. Persist draft dan perubahan lokal company A sampai transaksi IndexedDB selesai.
2. Naikkan generation tampilan, hentikan subscription tampilan A, dan cancel request yang sudah tidak diperlukan.
3. Validasi company B dari daftar milik tenant. Request A yang telanjur selesai hanya boleh menulis ke repository A, bukan B.
4. Tetapkan scope B dan remount subtree halaman dengan key tenant/company agar state form A tidak tertinggal.
5. Restore cache B lalu hydrate jika online; tampilkan loading/empty/error yang tepat.
6. Aktifkan event/subscription B dan simpan pilihan tab setelah switch berhasil. Jika gagal, tampilkan error B atau kembali secara konsisten ke A.

Routing versi pertama mempertahankan pathname sekarang dengan query `company=<id>` untuk deep link yang sadar company. Guard menormalisasi link dan memvalidasi company sebelum hydration. `/companies` dan `/companies/new` berada pada layout tenant tanpa memerlukan company aktif; halaman finansial memakai layout company. `/onboarding` hanya untuk tenant yang sudah dipastikan belum mempunyai company.

Company hasil migrasi atau reset yang setup-nya belum lengkap diarahkan ke `/companies/<id>/setup`, menggunakan wizard bersama yang melengkapi company existing. Guard setup tidak boleh membuat company baru atau memasukkan rekening default kedua kali.

Prioritas company awal: explicit company pada link yang valid → pilihan tab → company terakhir device → company aktif pertama. Company eksplisit yang tidak sah menampilkan error akses/tidak tersedia, bukan diam-diam membuka record di company lain. Legacy link tanpa company ID diselesaikan ke legacy default saat ambigu; setelah itu URL dibuat eksplisit.

Pending route setelah login serta PWA shortcut/share harus membawa company jika tersedia. Share/shortcut tanpa konteks menggunakan company tab/default yang tervalidasi dan menampilkan namanya sebelum penyimpanan. Dua tab boleh membuka company berbeda; storage event tidak mengganti company aktif tab lain. Logout menggugurkan seluruh scope autentikasi dan pekerjaan session lama. Refresh token untuk user yang sama tidak boleh otomatis kembali ke company pertama.

## 8. Sinkronisasi, offline, dan pekerjaan berulang

- Registry sync/hydration/status/retry per scope menggantikan flag global. Status UI menampilkan company aktif; Kelola company dapat menunjukkan jumlah perubahan tertunda per company.
- Scheduler memproses scope dengan outbox milik tenant login, termasuk company tidak aktif di tampilan. Gunakan satu run per scope dan concurrency terbatas antar-scope agar company besar tidak memblokir lainnya.
- Outbox membawa scope dan versi monoton/id operasi. Setelah server berhasil, acknowledge hanya snapshot versi yang benar-benar dikirim. Perubahan lebih baru pada key yang sama tidak boleh terhapus oleh ack lama.
- List outbox difilter tenant/company sebelum menentukan apa yang perlu disinkronkan. Outbox company B tidak boleh membuat upload company A terlewati.
- Hydration dengan scope eksplisit dapat menyimpan hasil ke scope asal; sebelum mengubah UI, cek generation. Tidak boleh mengisi company baru dari hasil request company lama.
- Satu batch restore/mirror harus menunggu transaction completion, bukan hanya keberhasilan request put. Kegagalan durable storage disampaikan sebelum menyatakan perubahan tersimpan.
- Katalog company di-cache per tenant. Empty hanya sah setelah respons server sukses; offline tanpa cache tidak memulai onboarding baru. Cache company yang telah terarsip belum tentu mutakhir; mutasi offline disimpan sebagai pending, lalu server memutuskan saat reconnect.
- Recurring rules diproses secara eksplisit per company aktif/nonarsip saat aplikasi online dan scope sudah siap. Scheduled occurrence memakai identitas idempotent company + rule + tanggal agar dua tab/device tidak menggandakan transaksi.
- Tidak menjanjikan recurring berjalan ketika semua aplikasi ditutup. Aktivasi scheduler server dapat menjadi pengembangan lanjutan.
- File upload, reset marker, conflict resolution, dan retry tetap menarget company asal meski pengguna berpindah.

## 9. Dampak finansial dan piutang

Seluruh engine cash position, cashflow, omzet, biaya, Safe To Spend, tax overview, insights, dan forecast menerima data **satu company** dari repository yang sudah tersaring. Identitas company ditambahkan pada konteks perhitungan supaya input campuran dapat dideteksi.

Kas company A Rp10 juta dan company B Rp3 juta akan tampil sebagai saldo terpisah sesuai company aktif. Pembuatan company B dengan saldo awal nol tidak mengubah kas A. Company switch sendiri tidak menciptakan transaksi.

Piutang milik A hanya dapat dibayar melalui transaksi A, menggunakan rekening A. Dua company dapat memiliki peminjam bernama sama tanpa menggabungkan saldonya. Account ID dan receivable transaction ID harus divalidasi pada scope company, termasuk edit/import/restore, bukan hanya form pembuatan.

Pengaturan dan estimasi pajak mengikuti profil tiap company dalam aplikasi. Company adalah batas pembukuan aplikasi; fitur ini tidak menetapkan bahwa setiap company otomatis merupakan wajib pajak terpisah. Perhitungan pajak lintas usaha milik identitas pajak yang sama memerlukan rancangan tersendiri sebelum ada klaim atau fitur konsolidasi pajak.

Rekening yang mewakili rekening bank nyata yang sama tidak otomatis berbagi saldo antardua company. UI saldo awal menjelaskan bahwa pengguna memasukkan saldo yang dialokasikan untuk company tersebut agar tidak terhitung ganda. Transfer antar-rekening yang sekarang tersedia dibatasi pada satu company; alur uang antar-company belum otomatis.

## 10. Migrasi data dan dukungan klien lama

### Persiapan dan pemetaan server

1. Ambil backup database dan berkas lampiran; uji restore ke lingkungan terpisah. Inventaris jumlah tenant, record/entity, data orphan, dan volume history sebelum menentukan ukuran batch migrasi.
2. Deploy backend yang memahami schema baru dalam mode kompatibilitas, tetapi fitur membuat company kedua masih mati.
3. Tambahkan collection companies, company relation nullable, index baru, dan marker versi migrasi per tenant. Perluas index unik sebelum mengizinkan beberapa singleton company.
4. Untuk setiap tenant yang memiliki data lama, buat tepat satu company default legacy. Nama dan completion berasal dari profil lama. Jika ada record tetapi tidak ada profil, gunakan nama fallback dan tandai setup belum lengkap; jangan membuang transaksi.
5. Tenant tanpa data dan tanpa company tetap masuk onboarding normal. Tenant local-only yang belum pernah sync dibuatkan mapping default saat klien baru terhubung melalui operasi idempotent.
6. Backfill `company_id` untuk semua entity tenant tersebut, termasuk history dan record tombstone. Record ID, `app_id` history, attachment, nilai uang, serta timestamp historis dipertahankan. Transformasi payload lama berada pada adapter berversi; jangan mengganti identifier history sambil meninggalkan record remote lama.
7. Gunakan lock/status migrasi per tenant untuk menangani writes yang datang saat backfill. Klien lama selama masa transisi selalu dipetakan ke default legacy tetap, tidak ke pilihan company aktif.
8. Audit coverage pemetaan, orphan, uniqueness, total transaksi, saldo, piutang, dan hash payload/lampiran yang relevan. Buat company relation required setelah seluruh pemetaan valid.

### Migrasi perangkat

- Migrasi namespace tenant lama ke company default yang diberikan server; jangan membuat ID company sendiri pada setiap device.
- Copy data dari localStorage, IndexedDB, outbox, draft, preferensi, history, conflict, dan reset marker. Migrasi dapat diulang dan dilanjutkan setelah crash menggunakan marker per tenant.
- LocalStorage dan IndexedDB tidak dapat dianggap satu transaksi atomik; gunakan tahap copy → verify → commit marker. Sumber lama dipertahankan sampai verifikasi selesai.
- Data pending tidak boleh ditimpa hasil hydration. Konflik lokal/remote mengikuti revision dan kebijakan konflik, bukan menganggap server selalu lebih baru.
- Data legacy tanpa auth owner jelas tidak otomatis dipindahkan ke akun yang kebetulan login; sediakan pemulihan/import eksplisit setelah pemilik dipastikan.
- Tentukan satu pemimpin migrasi lintas-tab dengan mekanisme lock/fallback yang diuji; tab lain menunggu atau melanjutkan sesudah marker selesai.
- Simpan sumber legacy setidaknya 30 hari setelah migrasi perangkat terverifikasi; sebelum cleanup, pastikan tidak ada outbox/draft lama tersisa dan ada backup yang dapat dipulihkan.

### Klien PWA lama

Ini merupakan gate rilis: klien lama memfilter hanya `business_id`, sehingga dapat mencampur beberapa company jika backend dibiarkan mengembalikan semua record tenant.

- Selama kompatibilitas, request tanpa protocol/company scope dibatasi server ke legacy default untuk list, view, create, update, delete, dan batch. Pemalsuan header tetap harus lolos ownership/scope validation.
- Jika sebuah jalur native API tidak dapat dibatasi dengan benar, blokir akses legacy pada jalur itu dan wajibkan pembaruan sebelum multi-company tenant diaktifkan. Jangan melonggarkan rule untuk mempertahankan kompatibilitas.
- Aktifkan company kedua hanya setelah tes terhadap bundle PWA lama dan versi baru membuktikan tidak ada pembacaan/penulisan gabungan.
- Versi baru membaca capability/minimum protocol backend dan menampilkan prompt update yang dapat mempertahankan draft/outbox. Klien lama yang tidak mengenali prompt tetap tidak mendapat data company tambahan.

### Rollback

Matikan pembuatan company baru melalui feature flag jika terjadi masalah, tetapi pertahankan backend yang memahami company dan data yang sudah tercipta. Jangan mengembalikan index lama atau membuang company relation setelah company kedua digunakan. Rollback frontend hanya ke versi yang sudah memahami scope company; perbaikan data setelah cutover menggunakan forward migration. Restore snapshot penuh hanya prosedur pemulihan terkoordinasi karena dapat kehilangan write setelah snapshot.

## 11. Backup, restore, dan reset

- Backup versi 2 mencantumkan tenant ID, company ID/nama, schema version, waktu export, dan entity data beserta history. Nama file memuat nama/ID company.
- Export standar hanya company aktif. Kredensial dan signed file token tidak disertakan; tampilkan dengan jelas apakah lampiran berupa bytes yang tersedia atau referensi remote.
- Restore memvalidasi envelope dan seluruh foreign reference sebelum menulis. Default hanya ke tenant/company yang cocok; tidak otomatis mengganti ownership berdasarkan company aktif.
- Backup versi 1 hanya dapat dipulihkan ke company default hasil mapping legacy tenant tersebut. Import lintas-company ditunda karena memerlukan remap ID dan hubungan piutang/rekening.
- Label reset menjadi “Reset data company [nama]”; tidak menghapus katalog company atau company lain. Reset marker dan remote deletion menggunakan scope yang ditangkap saat konfirmasi.
- Setelah reset, company yang sama masuk setup ulang. Backend menaikkan `data_epoch` secara atomik; outbox dan request membawa epoch saat perubahan dibuat sehingga write lama dari device lain tidak menghidupkan data sebelum reset. Klien mengambil epoch baru dan menahan perubahan epoch lama untuk pemulihan, tidak otomatis memberi ulang label epoch baru. Legacy writes tanpa epoch hanya diterima pada epoch awal; setelah reset, klien legacy wajib update.
- Company archive berbeda dari reset. Hard delete company dan hapus seluruh tenant tidak ditambahkan pada versi ini.

## 12. Tahapan implementasi dan deliverable

| Tahap | Pekerjaan dan file utama | Bukti selesai |
| --- | --- | --- |
| 1. Kontrak dan fixture | Types, ownership contract, payload adapter, scope matrix; fixture satu tenant dua company serta dua tenant | Identitas legacy/company tidak ambigu; fixture mencakup piutang pending dan history |
| 2. Backend dan migrasi | Migrasi baru setelah 0005; company lifecycle hook/service; perubahan `jornal_sync.js`; tes di `backend/pocketbase/tests` | Fresh/populated migration, aturan akses, idempotency, dan legacy isolation lulus pada PocketBase nyata |
| 3. Repository dan migrasi lokal | Modul company scope/repository, `store.ts`, `local-db.ts`, export/import/reset | Dua scope beroperasi independen; migrasi crash/retry/lintas-tab tidak hilang atau menggandakan data |
| 4. Sync per company | `pocketbase-sync.ts`, query keys, conflict/outbox, generation, `deferred-effects.tsx` | Delayed responses, retry, outbox ack, logout dan switch race teruji |
| 5. Alur company | `router.tsx`, login, onboarding reusable, company switcher, daftar dan settings company, app shell | Onboarding pertama dan tambah company atomik; draft serta offline/error states berfungsi |
| 6. Integrasi fitur | Seluruh halaman finansial, piutang, rekening, recurring, PWA/share/deep link, backup/reset | Tidak ada fitur yang masih memilih scope hanya dengan user ID |
| 7. QA dan rollout | Unit/integration/browser, dry-run migration, canary, observability, dokumentasi | Semua acceptance criteria lulus; flag multi-company baru diaktifkan setelah gate |

Urutan dependensi: 1 → 2 → 3 → 4 → 5 → 6 → 7. UI statis dapat disiapkan setelah kontrak tahap 1, tetapi tidak diaktifkan sebelum isolasi backend dan repository selesai. Estimasi durasi dibuat setelah fixture migrasi dan spike hook legacy selesai; keduanya menentukan kompleksitas utama.

## 13. Acceptance criteria dan verifikasi

1. Akun baru membuat satu company lewat onboarding; retry/double-click/two-tab creation dengan key yang sama menghasilkan satu company dan satu set rekening awal.
2. Akun existing mendapatkan satu company default dengan jumlah record, nominal, cashflow, piutang, lampiran, serta riwayat yang sama.
3. Company kedua dimulai kosong dengan profil dan rekening tersendiri; tidak mewarisi draft, koreksi klasifikasi, atau piutang company pertama.
4. Mengubah, menghapus, atau membayar piutang A tidak memengaruhi company B. ID rekening/piutang silang ditolak oleh server dan import validator.
5. Request tenant lain tidak dapat list/view/mutate/download record atau file company tersebut. Uji API langsung, multipart, batch, dan filter yang diubah.
6. Request legacy tanpa company tidak dapat melihat/mengubah company tambahan, bahkan ketika user yang sama menjadi pemiliknya.
7. Switch A → B ketika ada hydrate/upload/delete/retry aktif tidak menampilkan atau menulis data A ke B. Uji dengan response yang sengaja ditunda, bukan hanya mock sync selesai instan.
8. Dua tab pada company berbeda tetap independen. Logout menghalangi session lama melanjutkan write; refresh token user yang sama mempertahankan company.
9. Draft biasa dan draft repayment tersimpan pada company asal. Deep link/login redirect/PWA share berakhir pada company yang benar dan tidak meminjam rekening dari company lain.
10. Offline cached-company tetap dapat dipakai; company belum cached tidak tampil kosong palsu. Outbox company tidak aktif akhirnya tersinkron saat aplikasi online.
11. Acknowledge snapshot lama tidak menghapus edit baru; reset epoch menolak write pre-reset dari device offline.
12. Archive/restore bekerja saat semua atau company aktif diarsipkan; request yang terlambat tidak dapat mengubah company arsip.
13. Recurring satu occurrence tidak duplikat di dua tab/device dan tidak berjalan pada company arsip.
14. Backup/restore/reset hanya memengaruhi company yang disebutkan; backup v1 menuju mapping legacy yang benar.
15. Uji cash position, cashflow, Safe To Spend, insights, forecast dan tax overview memakai input company yang sama, termasuk fixture piutang serta saldo awal.
16. Query, paging, dan tampilan switcher diuji pada 50 company dengan dataset besar pada satu company; startup tidak mengunduh semua transaksi seluruh company.

Jalankan `bun run typecheck`, `bun run lint`, `bun test`, dan `bun run build`, kemudian integration test PocketBase disposable dan browser smoke test desktop/mobile/PWA. Assertion source-code saja tidak cukup untuk rules, migrasi, dan race asynchronous.

Rollout: staging dengan copy data yang aman → dry-run migrasi dan audit → canary tenant terpilih → flag create-company/switch → perluasan bertahap. Pantau durasi bootstrap/switch, error migrasi, scope mismatch yang ditolak, conflict rate, dan usia outbox per company. Target UX: cache hangat menampilkan company terpilih dalam sekitar 500 ms pada perangkat acuan; cold load memiliki indikator dan retry. Tetapkan baseline sebelum gate performa diberlakukan.

Definition of done: pengguna dapat login, membuat company pertama, menambah company kedua, berganti company, bekerja offline, dan sinkron kembali; seluruh data finansial tetap terpisah dan data single-company lama dapat dipulihkan. Implementasi, test evidence, panduan migrasi, serta runbook rollback disertakan sebelum rilis.

## 14. Status implementasi dan bukti

| Deliverable | Implementasi | Bukti otomatis/manual |
| --- | --- | --- |
| Schema dan migrasi legacy | `20260916_0006_multi_company.js` membuat company, audit, relation, epoch, index, backfill, dan menolak orphan | Integration test database terisi membandingkan ID/payload sebelum dan sesudah migrasi |
| Isolasi server | Rule dan hook protocol 2 membatasi tenant/company, file, revision, epoch, archive, serta foreign reference | API integration test nyata mencakup tenant asing, filter, batch, multipart, direct file URL, raw lifecycle bypass, stale revision/epoch, dan inbound reference |
| Lifecycle atomik | Endpoint setup idempotent, guard company pertama lintas-tab, rename, archive/restore, reset, audit, dan rate limit | API integration test menguji retry, dua creation key bersamaan, payload berbeda, lifecycle, 429, dan company lain tetap utuh saat reset |
| Scope lokal dan sync | Namespace v2, company scope eksplisit, catalog cache, outbox exact-snapshot ack, quarantine reset, runtime per scope, cancel session, maksimal dua background worker | Unit test menguji isolasi lokal, delayed hydration, logout cancellation, recurring deterministik, restore validator, dan archived mutation |
| UX company | Onboarding reusable, switcher, deep link `company`, halaman manage/search/rename/archive/restore, offline/unavailable, readonly archive | Browser smoke desktop/mobile menguji dua company dan dua tab independen |
| Engine finansial dan piutang | Boundary check company pada cash position, trend, tax; rekening, transfer, recurring, dan piutang divalidasi per company | Unit test multi-company dan receivable serta full regression suite |
| Backup/reset/rollout | Backup v2, v1 khusus legacy default, company reset dengan epoch, dua feature flag, dokumentasi dry-run/canary/rollback | `MULTI_COMPANY_RUNBOOK.md`, build produksi, dan API reset integration test |
| Skala | Katalog menggunakan paging penuh; ledger hydration dipaginasi per company dan tidak mengambil company lain | API integration test 50 company dan 120 transaksi pada satu company |

Verifikasi wajib sebelum setiap deployment tetap: `bun run typecheck`, `bun run lint`, `bun test`, `bun run build`, dua integration test PocketBase nyata, serta browser smoke desktop/mobile. Feature flag tidak menghapus atau menyatukan data: ketika dimatikan, hanya pembuatan company tambahan yang berhenti.
