# Rencana implementasi: agenda pajak bulanan dan tahunan

Status: **diimplementasikan dan diverifikasi** pada 17 September 2026 terhadap baseline `89e60ca`.

## 1. Tujuan dan batas hasil

Jornal mengingatkan pengguna untuk menyiapkan data, menyetor, dan melaporkan seluruh kewajiban pajak yang relevan dengan usahanya, beserta nominal, masa/tahun pajak, tenggat, dan bukti penyelesaiannya. Berlaku untuk satu tenant dengan banyak company dan kemungkinan beberapa company memakai wajib pajak yang sama.

Permintaan terakhir menggantikan pembatasan sebelumnya ke PPh Final UMKM 0,5%. Cakupan sekarang mencakup pajak bulanan, tahunan, serta kewajiban insidental yang diperlukan. **Semua jenis dapat dikelola sebagai kewajiban; tidak semua nominal dapat dihitung otomatis dari pembukuan Jornal saat ini.**

Kontrak rilis pertama:

- Katalog dan reminder seluruh kategori pada bagian 3; hanya kewajiban yang relevan dan diaktifkan pengguna yang muncul.
- Nominal otomatis untuk PPh Final UMKM yang lolos pemeriksaan kelayakan dan kelengkapan data. Nominal jenis lain berasal dari input terkonfirmasi atau hasil perhitungan/dokumen eksternal, dengan sumber yang jelas.
- Agenda di aplikasi, ringkasan dashboard, histori pembayaran/pelaporan, dan email opsional agar reminder tetap dapat dikirim saat aplikasi ditutup.
- Asumsi kanal: in-app aktif setelah setup; email **opt-in**, hanya ke alamat terverifikasi. Pilihan kanal belum dikonfirmasi pengguna. Push PWA dan WhatsApp bukan prasyarat rilis ini.
- Tidak mengirim SPT, membuat kode billing, membayar pajak, atau menyimpan kredensial Coretax. Tautan ke layanan resmi hanya membantu pengguna menyelesaikan tindakan di luar Jornal.
- Tidak mengklaim bahwa checklist merupakan penetapan kewajiban oleh DJP. Kasus khusus diarahkan ke pemeriksaan pengguna/konsultan, bukan diputuskan diam-diam oleh aplikasi.

## 2. Temuan kode dan keputusan arsitektur

| Komponen saat ini | Temuan | Keputusan implementasi |
| --- | --- | --- |
| `src/lib/tax.ts` | Mengannualisasi omzet/laba; aturan UMKM berlabel 2022; pemilihan skema dapat berubah berdasarkan proyeksi omzet | Pisahkan proyeksi dari kewajiban aktual; jangan memakai `estimatedTax` sebagai nominal setor bulanan atau kurang bayar tahunan |
| `src/pages/tax-page.tsx` | Halaman proyeksi dan cadangan pajak | Tambah tab Agenda, Rekap, Pengaturan; proyeksi diberi label tersendiri |
| `src/lib/types.ts` | Profil company belum memiliki identitas wajib pajak, registrasi kewajiban, atau tahun buku lengkap | Tambah domain pajak terpisah, terhubung ke company melalui membership efektif |
| `TAX_PAYMENT`, `taxPaidYTD` | Pembayaran generik, dihitung menurut tahun tanggal transaksi | Tambah alokasi menurut jenis dan masa pajak; pembayaran tahun lalu tidak mengurangi kewajiban tahun berjalan |
| `src/lib/queries.ts`, `local-db.ts` | Cache/outbox mengikuti tenant, company, dan epoch | Pisahkan cache subject pajak dari cache ledger; cegah respons lama tampil setelah pergantian akun/company |
| `src/components/deferred-effects.tsx` | Pekerjaan bergantung aplikasi aktif | Reminder terjadwal wajib berjalan di backend |
| PocketBase hooks/migrations | Sudah ada kontrol ownership, revision, epoch, dan lifecycle company | Pakai pola custom endpoint yang sama; jangan membuka raw writes untuk data pajak |
| `safe-to-spend.ts`, `forecast.ts` | Cadangan pajak sudah mengurangi dana tersedia | Reminder tidak otomatis menjadi transaksi atau cadangan tambahan |

Backend menjadi sumber kebenaran kewajiban, tenggat, kalkulasi aktual, dan delivery. Frontend menampilkan hasil server beserta timestamp; data offline hanya cache dan draft, bukan bukti pelunasan yang telah tersimpan.

## 3. Katalog kewajiban dan cara menentukan relevansi

### 3.1 Matriks cakupan produk

Tabel ini menentukan template dan alur produk, bukan menetapkan bahwa seluruh pengguna wajib membayar seluruh pajak ini. Detail pengecualian dan tanggal efektif harus menjadi fixture aturan T01 sebelum template otomatis diaktifkan.

| Jenis/template | Pemicu pemeriksaan relevansi | Periode dan aksi | Sumber nominal rilis pertama |
| --- | --- | --- | --- |
| PPh Final UMKM 0,5% | Usaha dengan skema dan kelayakan yang dikonfirmasi | Bulanan: rekonsiliasi omzet, setor jika terutang, pemeriksaan pemenuhan pelaporan | Otomatis bersyarat; penyesuaian manual beralasan; bukti pemotongan/pemungutan pihak lain |
| PPh 21/26 terkait pekerjaan | Memiliki pegawai atau membayar orang pribadi yang relevan | SPT Masa, pembayaran, termasuk rekonsiliasi masa pajak terakhir bila berlaku | Hasil payroll/Coretax atau input terkonfirmasi; jangan menerapkan satu tarif pada seluruh gaji |
| PPh 23/26 selain payroll | Pembayaran jasa, sewa selain tanah/bangunan, royalti, atau pembayaran ke pihak luar negeri yang relevan | Komponen pembayaran dan pelaporan Unifikasi sesuai objek | Bukti potong/perhitungan eksternal; objek dan peran pemotong wajib jelas |
| PPh 4(2) selain UMKM | Sewa tanah/bangunan, konstruksi, dan objek final lain | Bulanan atau berdasarkan peristiwa/objek; terhubung ke pelaporan yang sesuai | Nominal terkonfirmasi per objek; tidak memakai tarif UMKM |
| PPh 15 | Bidang usaha/objek tertentu | Masa atau peristiwa sesuai registrasi | Perhitungan eksternal terkonfirmasi |
| PPh 22 | Impor atau penunjukan sebagai pemungut/objek terkait | Masa atau peristiwa; bedakan dipungut pihak lain dan kewajiban menyetor sendiri | Dokumen pemungutan/impor atau nominal terkonfirmasi |
| PPh 25 | Terdaftar sebagai pembayar angsuran PPh | Bulanan; jadwal angsuran memiliki masa berlaku | Besaran angsuran dari SPT/penetapan/persetujuan yang berlaku; bukan 1/12 proyeksi Jornal |
| SPT Masa PPN dan PPnBM | PKP dan aktivitas/objek terkait | Rekonsiliasi, pembayaran jika ada, pelaporan masa | Hasil rekonsiliasi faktur/Coretax; status kurang bayar, nihil, lebih bayar dan kompensasi |
| PPN khusus | Pemanfaatan dari luar daerah pabean, KMS, pemungut, atau objek khusus lain | Template terpisah sesuai peran/objek | Nominal dan tanggal terkonfirmasi; bukan deadline PPN umum secara otomatis |
| SPT Tahunan OP | Wajib pajak orang pribadi aktif dengan kewajiban tahunan | Tahunan; persiapan, pelaporan, bukti penerimaan | Rekap usaha Jornal ditambah data penghasilan/kredit di luar Jornal; total SPT dikonfirmasi pengguna |
| SPT Tahunan Badan | Wajib pajak badan aktif | Tahunan; rekonsiliasi fiskal dan pelaporan | Rekap Jornal serta hasil perhitungan fiskal eksternal terkonfirmasi |
| PPh 29 | Hasil SPT tahunan menunjukkan kurang bayar | Pembayaran terkait SPT, bukan SPT tahunan kedua | Saldo kurang bayar terkonfirmasi setelah kredit/angsuran; tidak termasuk pelunasan final sebagai kredit sembarang |
| PBB | Memiliki/memanfaatkan objek terkait | Tahunan/per dokumen, termasuk tugas pelaporan objek bila berlaku | SPPT/ketetapan; identitas objek, otoritas, dan deadline dokumen |
| Pajak daerah | Lokasi dan kegiatan usaha: PBJT, reklame, air tanah, kendaraan, dan jenis lain yang relevan | Bulanan, tahunan, atau insidental menurut daerah/dokumen | Input dari ketetapan/perhitungan lokal; yurisdiksi wajib diisi |
| Bea meterai dan kewajiban khusus | Status pemungut, dokumen, transaksi atau sektor tertentu | Periodik bila diwajibkan, selain itu insidental | Template manual dengan sumber aturan/dokumen |
| STP/SKP, angsuran resmi, kewajiban lain | Ada dokumen penagihan/penetapan atau kewajiban belum ada dalam katalog | Satu kali atau jadwal sesuai dokumen | Pokok, sanksi, dan tanggal dari dokumen; tidak menghitung sanksi otomatis |

Satu pelaporan Unifikasi dapat mencakup beberapa komponen pajak. Sistem membuat **satu tugas lapor per formulir/masa/registrasi**, bukan satu SPT untuk setiap komponen. Pembayaran tetap dapat memiliki banyak rincian. PPh 26 terkait payroll tidak disatukan dengan PPh 26 non-payroll secara sembarang.

### 3.2 Wizard aktivasi

1. Pilih/buat wajib pajak: orang pribadi atau badan beserta bentuk badan; nama tampilan, tahun buku, dan periode mulai dikelola.
2. Tentukan company mana saja yang termasuk wajib pajak tersebut. Pilihan eksplisit: identitas pajak sama atau berbeda. Jangan menyamakan tenant, company, dan wajib pajak.
3. Tanyakan status PKP, skema PPh, eligibility UMKM, pegawai, pembayaran jasa/sewa, transaksi luar negeri/impor, peran pemotong/pemungut, aset/objek pajak, lokasi usaha, dan kewajiban dari surat ketetapan.
4. Tampilkan rekomendasi template beserta alasan. Jawaban tidak tahu menghasilkan checklist “Perlu pemeriksaan”, bukan otomatis tidak wajib.
5. Pengguna mengonfirmasi kewajiban aktif, nominal/default angsuran bila ada, tanggal efektif, dan sumber informasi. Kewajiban baru dapat ditambahkan kapan saja.
6. Pilih kanal dan jadwal reminder. Preview daftar dan contoh nominal/status sebelum mengaktifkan.

Onboarding company pertama tetap ringan: tawarkan setup pajak setelah pembukuan selesai, tidak mewajibkan seluruh formulir pajak di onboarding. Pengaturan kewajiban ditinjau kembali ketika profil, status PKP, aktivitas, atau tahun pajak berubah.

## 4. Dasar aturan dan batas kepastian

Penelusuran sumber resmi dilakukan 16 September 2026. **T01 wajib meninjau pasal konsolidasi yang berlaku pada periode target**, bukan hanya artikel ringkasan. Berikut baseline desain:

- Tenggat PPh masa yang umum telah diseragamkan menjadi tanggal 15 bulan berikutnya untuk pembayaran; ini bukan aturan universal bagi semua pajak/objek. [DJP: perubahan jatuh tempo](https://www.pajak.go.id/id/berita/pemerintah-sederhanakan-jatuh-tempo-pembayaran-pajak-lewat-peraturan-menkeu).
- Pelaporan PPh masa umumnya tanggal 20 bulan berikutnya; PPN/PPnBM akhir bulan berikutnya. SPT Tahunan OP paling lama tiga bulan dan badan empat bulan setelah akhir tahun pajak. Untuk tahun kalender, baseline tahunan adalah 31 Maret dan 30 April. [DJP: batas waktu lapor](https://www.pajak.go.id/en/node/35019).
- Pembayaran UMKM yang memenuhi syarat dan memperoleh validasi dapat memenuhi kewajiban pelaporan; PPh 25 juga memiliki mekanisme pembayaran tervalidasi sebagai pelaporan. Aturan nihil, pengecualian, serta pergeseran hari libur harus dibedakan per jenis. [PMK 81/2024, antara lain Pasal 171–173](https://stats.pajak.go.id/en/node/113110). Baca bersama perubahan-perubahannya, termasuk PMK 1/2026 pada [riwayat resmi JDIH](https://jdih.kemenkeu.go.id/dok/pmk-81-tahun-2024).
- Tarif UMKM tetap 0,5%, tetapi eligibility dan ketentuan peralihan berubah melalui PP 20/2026. Jangan menganggap daftar bentuk badan dan batas waktu pemanfaatan dari engine 2022 masih cukup. [PP 20/2026](https://jdih.kemenkeu.go.id/dok/pp-20-tahun-2026), [penjelasan resmi DJP](https://pajak.go.id/id/siaran-pers/pph-final-umkm-tetap-05-persen-djp-perkuat-ketepatan-sasaran).
- Kekurangan pajak tahunan harus diselesaikan sebelum SPT disampaikan. Tugas bayar dan lapor perlu berelasi, bukan satu checkbox. Tabel lama pada sumber ini tidak boleh dipakai untuk menimpa jadwal masa terbaru. [DJP: pembayaran dan pelaporan](https://pajak.go.id/index.php/id/batas-waktu-pembayaran-penyetoran-dan-pelaporan-pajak).
- PBB-P2 dikelola pemerintah daerah; jangan mengasumsikan satu tanggal nasional bagi seluruh objek/daerah. [DJP: pengelolaan PBB](https://www.pajak.go.id/id/artikel/pajak-bumi-dan-bangunan-siapakah-yang-mengelola).

Rule registry menyimpan `ruleId`, versi, sumber/pasal, tanggal mulai/akhir berlaku, tanggal review, role wajib pajak, objek, periode, aturan nihil, metode pelaporan, dan penyesuaian hari libur. Aturan tanggal pembayaran dan pelaporan disimpan terpisah.

Output T01 harus berupa matriks machine-readable untuk setiap template: `paymentDueRule`, `filingDueRule`, `paymentBeforeFiling`, `filingMethod`, `nilPolicy`, `holidayPolicy`, dan `manualDateRequired`. PPN umum, PPN khusus, impor/pemungut, serta pajak daerah tidak boleh mewarisi default tanggal 15/20 hanya karena field belum diisi. Nominal dan tenggat manual wajib mempunyai provenance dan tidak boleh diganti pembaruan katalog tanpa review.

Bedakan `statutoryDueDate`, `effectiveDueDate`, `penaltyReliefUntil`, dan `snoozedUntil`. Relaksasi sanksi tidak otomatis berarti perubahan deadline; snooze hanya mengubah notifikasi. Perpanjangan individual memerlukan referensi dan tanggal efektif. Hari libur memakai kalender resmi per tahun, bukan hanya Sabtu/Minggu; jangan menerapkan pergeseran tahunan berdasarkan aturan SPT Masa.

Template yang aturan/pasokannya belum terverifikasi tetap dapat digunakan sebagai reminder manual dengan tanggal bersumber dokumen dan label “Dikonfirmasi pengguna”. Tidak boleh dipasarkan sebagai otomatis terverifikasi.

## 5. Identitas pajak dan multi-company

- `TaxSubject` adalah wajib pajak di dalam tenant; satu subject dapat memiliki beberapa company. Company dapat berganti subject secara efektif, tanpa menulis ulang sejarah.
- Membership efektif tidak boleh tumpang tindih untuk ruang kewajiban yang sama. Tempat usaha/objek lokal dapat memiliki registrasi tersendiri di bawah subject.
- Satu kewajiban tahunan canonical per subject, jenis formulir, dan tahun pajak. Company berbeda menampilkan referensi ke kewajiban yang sama, bukan membuat tagihan duplikat.
- Akumulasi omzet UMKM menggunakan seluruh kontribusi yang termasuk subject dan data usaha relevan di luar Jornal. Batas bebas pajak tidak diulang per company. Penggabungan yang diwajibkan aturan untuk kondisi khusus, termasuk hubungan keluarga/entitas, harus ditanyakan dalam eligibility; kepemilikan login saja tidak cukup untuk memutuskan agregasi.
- Ledger company tetap terisolasi. Agregasi pajak dilakukan pada layanan subject yang eksplisit, bukan melewati `assertSingleCompany` di engine finansial.
- Jangan meminta NPWP/NIK lengkap bila tidak dibutuhkan; label wajib pajak dan identitas internal cukup untuk reminder. Identitas resmi opsional, dimasking di tampilan, tidak dimasukkan ke URL/log/email default.
- Arsip company bukan penutupan wajib pajak. Kewajiban terbuka tetap ada; penghentian registrasi memerlukan tanggal efektif dan konfirmasi tersendiri.
- Reset ledger menaikkan epoch dan membuat kontribusi terdampak perlu direkonsiliasi. Bukti bayar/lapor dan histori kepatuhan tidak ikut hilang atau otomatis membuka ulang semua kewajiban lama.

## 6. Nominal, data sumber, dan status

### 6.1 Kontrak nominal

Setiap kewajiban menyimpan mata uang IDR, nominal rupiah dengan aritmetika desimal/integer aman, versi pembulatan, asal data, waktu sinkronisasi, periode tercakup, dan fingerprint input.

- `amountState`: `UNKNOWN`, `ESTIMATED`, `CONFIRMED`, `NEEDS_REVIEW`.
- `liabilityAmount`: pajak terutang untuk komponen/periode, bukan omzet atau jumlah seluruh uang masuk.
- `settledByThirdParty`: pemotongan/pemungutan yang dapat diperhitungkan untuk komponen tersebut, dengan bukti dan validasi kompatibilitas.
- `allocatedPayments`: pembayaran sendiri yang dialokasikan ke kewajiban tersebut.
- `remainingPayable = max(0, liabilityAmount - compatibleSettlements - allocatedPayments)` jika input lengkap. Jika belum lengkap, nominal sisa `null`, bukan Rp0.
- Selisih lebih bayar disimpan terpisah; tidak otomatis menjadi saldo kas atau refund. Kompensasi ke periode lain memerlukan tindakan eksplisit dan histori.
- Setoran ke deposit pajak yang belum digunakan tidak otomatis melunasi suatu kewajiban. Bedakan arus kas pengisian deposit dari penggunaan saldo deposit; penggunaan tersebut tidak membuat arus kas kedua.
- Nilai tahunan membedakan penghasilan final, pajak non-final terutang, kredit yang sah, angsuran, dan saldo kurang/lebih bayar. UI tidak menjumlahkan subtotal rekonsiliasi sebagai tagihan tambahan.

Nominal terkonfirmasi berarti dikonfirmasi pengguna/dokumen, **bukan diverifikasi DJP**. Keterangan ini berlaku pula untuk bukti pembayaran/pelaporan yang dimasukkan pengguna.

### 6.2 Kalkulasi otomatis UMKM

Gunakan omzet aktual yang memenuhi ketentuan, bukan proyeksi `revenueYTD / months * 12`. Pisahkan omzet untuk pengujian eligibility dari basis pengenaan final bila cakupan hukumnya berbeda.

Untuk kasus OP yang tervalidasi berhak atas fasilitas Rp500 juta dan data lengkap:

```text
basis bulan = max(0, omzet kumulatif sampai bulan ini - 500.000.000)
              - max(0, omzet kumulatif sebelum bulan ini - 500.000.000)
pajak bulan = 0,5% × basis bulan
```

Contoh fixture: kumulatif sebelumnya Rp490 juta dan omzet bulan ini Rp30 juta menghasilkan basis Rp20 juta dan pajak Rp100.000. Untuk badan yang tervalidasi memakai skema final tanpa fasilitas OP, omzet Rp80 juta menghasilkan Rp400.000 sebelum penyelesaian yang kompatibel. Dasar fasilitas OP diperiksa terhadap PP 55/2022 sebagaimana diubah PP 20/2026 pada T01; rumus tidak diterapkan pada jenis pajak lain.

Data yang wajib ditangani:

- Saldo awal omzet tahun berjalan saat pengguna mulai memakai Jornal di tengah tahun, dipisahkan dari saldo awal rekening.
- Company lain, usaha di luar Jornal, penghasilan yang dikecualikan, dan kategori yang masih belum ditinjau.
- Pendapatan bruto versus uang diterima bersih setelah potongan; retur/pembatalan dan penyesuaian beralasan.
- Setoran modal, pinjaman, transfer internal, penerimaan pokok piutang bukan otomatis omzet. Pembukuan kas tidak selalu sama dengan dasar pengenaan; pengguna mengonfirmasi rekonsiliasi masa.
- Bukti potong/pungut termasuk marketplace bila relevan. Bukti yang sama tidak boleh mengurangi dua kewajiban; status final/non-final tidak boleh tertukar.
- Masa transisi skema, jenis usaha yang tidak berhak, dan batas omzet berdasarkan aturan efektif; jangan beralih ke progresif/badan hanya karena proyeksi melewati batas.
- Perubahan omzet bulan lama menghitung ulang bulan berikutnya yang dipengaruhi batas kumulatif. Hasil terkonfirmasi tidak ditimpa diam-diam: buat revisi dan tugas rekonsiliasi.

Jika input atau eligibility tidak lengkap, reminder tetap berjalan dengan “Nominal belum tersedia—lengkapi data”, bukan angka pajak pasti.

### 6.3 Jenis selain UMKM

Form input mencatat nominal, sumber, tanggal, catatan, dan attachment opsional. Nilai angsuran PPh 25 dapat disalin ke masa berikutnya hanya selama interval persetujuannya berlaku; pengguna mendapat tugas review saat dasar angsuran berubah. Jangan menghitung ulang otomatis dari proyeksi tahunan.

PPN mencatat output, input yang dapat dikreditkan, kompensasi, serta kurang/lebih bayar berdasarkan hasil terkonfirmasi. Angka agregat ini membantu rekap; bukan pengganti validasi faktur. PPh 21/23/26 dan objek lainnya memakai hasil payroll/bukti potong yang telah direkonsiliasi. Otomatisasi kalkulator payroll, e-Faktur, treaty, koreksi fiskal penuh, dan tarif daerah merupakan pekerjaan lanjutan, bukan syarat agar reminder dan nominal manual jenis tersebut berfungsi.

### 6.4 Status independen

| Dimensi | Nilai/status |
| --- | --- |
| Pembayaran | `UNKNOWN`, `NOT_DUE`, `UNPAID`, `PARTIAL`, `PAID`, `OVERPAID`, `NOT_REQUIRED` |
| Pelaporan | `NEEDS_REVIEW`, `NOT_REQUIRED`, `PENDING`, `FILED`, `FULFILLED_BY_PAYMENT` |
| Waktu | Mendatang, segera jatuh tempo, jatuh tempo hari ini, terlambat; dihitung dari deadline aksi yang belum selesai |
| Data | Lengkap, belum lengkap, stale, perubahan perlu rekonsiliasi |

Rp0 tidak otomatis berarti tidak perlu lapor. Transaksi `TAX_PAYMENT` tidak otomatis berarti ada validasi pembayaran yang memenuhi pelaporan. Untuk kasus deemed filing, simpan bukti/referensi pembayaran dan pastikan syarat serta seluruh komponen yang relevan terpenuhi. Tugas SPT Tahunan tetap terbuka setelah seluruh pajak final bulanan dibayar.

## 7. Alur antarmuka

1. **Dashboard:** kartu “Pajak berikutnya” menampilkan aksi, subject/company, masa, tanggal, nominal atau alasan nominal belum tersedia. Bukan hanya label “SPT”.
2. **Agenda Pajak:** filter Bulanan/Tahunan/Lainnya, wajib pajak, company, status, dan tahun. Pengelompokan company tidak menduplikasi total subject. Tampilan lintas-company harus eksplisit.
3. **Detail:** tab rincian nominal, sumber/rekonsiliasi, pembayaran, pelaporan, histori. Aksi “Lengkapi nominal”, “Hubungkan pembayaran”, “Catat pembayaran”, “Catat bukti lapor”, “Tunda reminder”.
4. **Pembayaran:** pilih transaksi yang sudah ada atau buat satu transaksi kas baru. Tampilkan tanggal uang benar-benar keluar dan masa pajak sebagai dua field berbeda. Mendukung cicilan dan alokasi satu pembayaran ke beberapa komponen yang sah.
5. **Pelaporan:** catat tanggal, nomor referensi/BPE, status, attachment, dan pembetulan. Mengunggah file saja tidak mengubah status tanpa konfirmasi.
6. **Rekap tahunan:** omzet, komponen pajak, jumlah dibayar/dipotong, sisa per masa, dokumen hilang, dan tugas SPT tahunan. Unduh CSV rekap untuk persiapan; bukan file resmi siap submit Coretax. Lindungi ekspor dari formula injection.
7. **Pengaturan:** daftar kewajiban, effective dates, sumber tanggal, kanal, jadwal, identitas pajak, company/objek terkait, serta kelengkapan data.

Contoh copy: “Setor PPh Final UMKM — Agustus 2026 — Rp100.000 — nominal terkonfirmasi”, “Lapor SPT Tahunan OP 2026 — batas dasar 31 Maret 2027 — rekap final Rp2.400.000, bukan tagihan baru”, “PPh 21 September — nominal belum diisi”. Tanggal contoh bukan pengganti kalender efektif.

## 8. Model data dan API

Collection baru berikut adalah nama usulan implementasi. Semua memiliki `tenant_id` dari auth server, revision, dan timestamps sesuai kebutuhan; subject/registrasi menjadi relasi tervalidasi.

| Collection | Isi utama / invariant |
| --- | --- |
| `tax_subjects` | Jenis WP/bentuk badan, label, tahun buku, status, konfigurasi eligibility beserta masa berlaku |
| `tax_company_memberships` | Company, subject, effective interval; interval tidak overlap; scope tetap tenant yang sama |
| `tax_registrations` | Jenis pajak, peran, objek/yurisdiksi, formulir, periodicity, aturan/nominal default dan masa berlaku |
| `tax_period_inputs` | Kontribusi per company/masa, omzet eksternal/awal, penyesuaian, kelengkapan, ledger revision/epoch/fingerprint |
| `tax_obligations` | Subject, registration, masa, komponen nominal, status, due-date snapshot, rule version, revision, review state |
| `tax_filings` | Formulir/masa, obligation links, deadline, bukti lapor, histori pembetulan; unique satu filing group canonical |
| `tax_settlements` | Pembayaran sendiri, bukti pihak lain, kompensasi; jenis sumber, tanggal, nomor bukti, jumlah, histori koreksi |
| `tax_allocations` | Relasi settlement–obligation, nominal; total tidak melampaui sumber; relasi pajak/periode harus kompatibel |
| `tax_evidence` | Attachment terlindungi, metadata, parent record; izin mengikuti subject dan tenant |
| `tax_notification_preferences` | Opt-in kanal, jam/zona waktu, offset, subject yang diikuti |
| `tax_notifications` | Inbox/delivery, dedupe key, action, scheduled time, status, lease, retry, error, template version |
| `tax_audit` | Aktor, command, before/after/reason; server-owned, tidak bisa diubah client |

Natural key kewajiban: `(tenant, subject, registration, period, component)`. Natural key filing: `(tenant, subject, filingGroup, period)`, dengan objek/registrasi disertakan jika secara hukum pelaporannya terpisah. Revisi/pembetulan tidak membuat tagihan atau reminder dasar kedua.

Endpoint di bawah `/api/jornal/tax/`:

- Subject/membership/registration setup dan update.
- Agenda dan detail terpaginasikan dengan filter company atau subject yang tervalidasi.
- Simpan/konfirmasi input masa, kalkulasi ulang, dan review perubahan.
- Buat/hubungkan settlement, alokasikan, koreksi dengan histori.
- Catat filing/pembetulan, upload/download bukti, snooze, dan preferensi.
- Rekap/ekspor; endpoint diagnostik scheduler hanya untuk admin/operasi, bukan user umum.

Semua mutation memakai expected revision dan idempotency key plus request hash. Replay payload sama mengembalikan hasil sama; key sama dengan payload berbeda ditolak 409. Identitas tenant diturunkan dari auth, tidak dipercaya dari body. Periksa ownership seluruh relasi, ledger ID, epoch, status company, dan batas jumlah alokasi secara atomik. Buat transaksi kas + settlement + alokasi dalam satu command atomik; responsnya direkonsiliasi ke mirror lokal tanpa mendorong transaksi kedua lewat outbox.

Raw collection writes dinonaktifkan. File tidak public; tipe PDF/JPEG/PNG, batas ukuran dan jumlah, nama aman, download berautentikasi, tanpa rendering HTML/SVG aktif. Jangan mencatat isi bukti, alamat email lengkap, NPWP, atau token pada log. Rate limit mutation/upload dan validasi tanggal, nilai negatif, overflow, serta array size.

## 9. Sinkronisasi dan ketahanan

- Query subject memakai `(tenant, subject, revision)`; query company memakai `(tenant, company, epoch, membershipRevision)`. Logout membersihkan cache sensitif dan hasil asynchronous lama diabaikan.
- Saat offline, pengguna dapat membaca cache dan menyimpan draft input/bukti. Aktivasi kewajiban, konfirmasi bayar/lapor, perubahan mapping, dan upload final membutuhkan koneksi pada rilis pertama. UI tidak menampilkan “tersimpan di server” sebelum acknowledgment.
- Perubahan ledger yang sudah tersinkron memicu invalidasi input masa terdampak; worker melakukan recalculation terindeks. Fingerprint mencegah hasil lama menggantikan hasil baru.
- Manual confirmed amounts dan filing evidence tidak ditimpa oleh recalc. Buat change proposal/needs-review; reminder mencerminkan state terkini.
- Edit/hapus transaksi sumber pembayaran harus ditolak sampai alokasi dilepas melalui command koreksi, atau dilakukan sebagai koreksi atomik; tidak boleh meninggalkan status PAID palsu. Aturan ini berlaku pula terhadap sync dari client lama.
- Company arsip tidak menerima transaksi kas baru, tetapi bukti kepatuhan dan pembayaran eksternal tetap dapat dicatat pada subject. Tidak memulihkan company diam-diam.
- Backup company tidak boleh menggandakan kewajiban subject yang dipakai bersama. Tambah paket ekspor/restore pajak tenant dengan manifest, versi, mappings, checksums dan mode preview. Restore lintas identitas membutuhkan remap eksplisit dan review; tidak mengimpor opt-in maupun delivery sebagai pekerjaan siap kirim.
- Reset/restore menandai sumber ledger yang berubah perlu review dan tidak menyamakan file backup dengan bukti baru. Riwayat delivery harus direkonsiliasi sebelum scheduler diaktifkan kembali.

## 10. Scheduler dan pengiriman

Gunakan proses PocketBase yang terus berjalan, bukan timer tab. `cronAdd` dan mail client tersedia dalam dokumentasi resmi; implementasi harus diuji terhadap versi yang dipin repo, saat ini 0.40.2. [PocketBase scheduling](https://pocketbase.io/docs/js-jobs-scheduling/), [sending emails](https://pocketbase.io/docs/js-sending-emails/).

- Generator memastikan kewajiban periode aktif dan periode berikutnya tersedia; annual preparation dapat dimulai setelah akhir tahun buku. Aktivasi pertengahan tahun memerlukan konfirmasi periode historis, tanpa email tunggakan massal otomatis.
- Cron setiap lima menit memilih indeks `next_run_at`, memakai batch terbatas, claim lease, dan cursor durable. Setelah downtime, kirim satu ringkasan terkini, bukan semua reminder yang terlewat.
- Default reminder bulanan: H-7, H-3, H-1, dan hari H. Tahunan: H-30, H-14, H-7, H-3, H-1, hari H. Terlambat: mingguan maksimal empat kali, kemudian tetap di agenda tanpa spam. Bisa disesuaikan per user.
- Pisahkan tindakan persiapan nominal, bayar, dan lapor. Aksi yang selesai berhenti diingatkan; nominal belum ada tetap mendapatkan reminder persiapan.
- Zona jadwal pengguna default Asia/Jakarta; deadline hukum disimpan sebagai tanggal dan zona otoritas yang relevan. Timestamp UTC tidak boleh menggeser masa pajak.
- Satu email digest per penerima per hari; berisi kewajiban relevan yang belum selesai. In-app memiliki record per aksi dengan dedupe key stabil. Email default tidak memuat nominal/identitas sensitif; nominal lengkap tersedia setelah login, penyertaan nominal di email opsional.
- Recheck opt-in, email verified, status kewajiban, versi deadline, dan snooze tepat sebelum kirim. Jangan menahan transaksi DB selama SMTP/network call.
- Delivery state: pending, leased, sent, retryable-failed, permanently-failed, cancelled, unknown. Bounded retry dengan backoff dan admin diagnostics. SMTP tidak menjamin exactly-once bila server crash setelah pengiriman sebelum acknowledgment; simpan message ID dan jangan mengklaim jaminan tersebut.
- Delivery dedupe meliputi recipient, obligation/filing action, threshold, channel, dan schedule version. Update versi deadline membatalkan jobs lama, tidak mengulang seluruh notifikasi historis.
- Lencana aplikasi menggabungkan review transaksi dan agenda pajak melalui satu pengelola badge; jangan menambah writer kedua yang saling menimpa.
- SMTP tidak tersedia: in-app tetap aktif, status email belum siap terlihat; jangan mengaku email terkirim. Test memakai mail sink, tidak penerima nyata.

## 11. Dampak cashflow dan cadangan

1. Membuat reminder atau mengonfirmasi nominal **tidak mengubah kas, laba, atau ledger**.
2. Menandai SPT sudah dilaporkan tidak mengubah kas. Bukti pihak lain juga tidak otomatis membuat transaksi kas kedua.
3. Kas berkurang hanya melalui transaksi pembayaran aktual pada tanggal arus kasnya. Membayar pajak Desember pada Januari memengaruhi kas Januari, tetapi melunasi masa Desember.
4. Pilihan “Pembayaran di luar pembukuan Jornal” menyimpan settlement saja. UI menjelaskan bahwa kas Jornal tidak berubah; bila kemudian dihubungkan ke ledger, gunakan sumber yang sama agar tidak double count.
5. Reminder dan rekap tidak otomatis menambah reserve atau expected outflow pada forecast. Cadangan yang sudah ada tidak dikurangi lagi hanya karena tagihan ditampilkan.
6. Sebelum rilis, ganti penggunaan semua `TAX_PAYMENT` sebagai `taxPaidYTD` dengan alokasi yang sesuai jenis/tahun untuk subject yang mengaktifkan modul ini. Pembayaran legacy yang belum dipetakan ditandai belum teralokasi; tidak ditebak menurut tanggal kas.
7. Proyeksi UMKM yang bergantung batas subject tidak boleh dihitung seolah setiap company memiliki fasilitas sendiri. Untuk subject multi-company, proyeksi/cadangan otomatis per-company dinonaktifkan sampai atribusi cadangan dikonfirmasi. Pengguna memasukkan cadangan per-company; totalnya ditampilkan di subject untuk review. Nilai belum ditetapkan bukan Rp0 pasti: Safe-to-Spend diberi confidence rendah dan peringatan pajak belum tercakup.
8. Untuk single-company, proyeksi tetap terpisah dari kewajiban; adapter memakai rules/eligibility yang sama dan pembayaran teralokasi. Jenis pajak yang belum tercakup dalam model cadangan saat ini ditampilkan sebagai komitmen tambahan yang belum dicadangkan. Jangan melabeli Safe-to-Spend sebagai dana setelah seluruh pajak jika belum lengkap.

Integrasi otomatis seluruh kewajiban ke cadangan dan forecast adalah fase lanjutan setelah kebijakan atribusi disepakati. Rilis reminder ini tetap menyediakan total outstanding yang jelas, tetapi tidak mengubah model dana tersedia diam-diam.

## 12. Work breakdown yang dapat dieksekusi

Semua tiket di bawah **telah dikerjakan** sesuai urutan dependensi. Lokasi yang tercantum merupakan lokasi implementasi aktual; bukti gate dirangkum pada bagian 14 dan runbook.

| ID | Pekerjaan dan target file | Depends | Acceptance / bukti selesai |
| --- | --- | --- | --- |
| T01 | Audit katalog/aturan: tambah `docs/tax/rules.md`, fixture efektif 2025/2026 dan kalender; verifikasi sumber konsolidasi, pengecualian nihil/deemed filing, transisi UMKM, peran dan objek | — | Setiap template otomatis punya pasal, periode berlaku, reviewer, dan fixture; kasus belum terverifikasi eksplisit manual/needs-review, tidak diberi deadline otomatis |
| T02 | Types/schema: `src/lib/tax-compliance-types.ts`, migration berikutnya di `backend/pocketbase/pb_migrations/` (0007 jika masih tersedia) | T01 | Schema/index/unique/check constraints; migrasi fresh dan data lama tidak mengubah ledger atau membuat subscription palsu |
| T03 | Subject, membership, registration APIs: `pb_hooks/tax_helpers.js`, `tax.pb.js`, test backend | T02 | Ownership semua relasi, interval, revision, idempotency, archive/reset diuji; raw writes ditolak |
| T04 | Engine aturan/jadwal: `pb_hooks/tax_rules.js`, `tax_calendar.js`, unit fixtures | T01,T02 | Satu implementasi canonical backend; UMKM aktual, periode/tahun buku, exception dates, filing grouping dan source snapshots lulus |
| T05 | Input/reconciliation pipeline: `tax_compliance.js`, hooks sync ledger, subject queries | T03,T04 | Initial YTD, kontribusi company/eksternal, missing data, recalculation kumulatif, late edit dan revision review teruji |
| T06 | Settlement/filing/evidence commands dan guard transaksi: `tax.pb.js`, `jornal_sync.pb.js`, attachment handlers | T03,T05 | Atomik bayar+alokasi; partial/overpayment, bukti pihak lain, no duplicate cash, amendment/audit, protected files lulus |
| T07 | Client/cache: `src/lib/tax-compliance-client.ts`, `tax-compliance-queries.ts`, `local-db.ts`, `queries.ts` | T03,T05,T06 | Data company/subject terpisah, logout/switch/reset race aman, cache stale dan draft offline jelas |
| T08 | UI setup/agenda/detail: `tax-page.tsx`, `home-page.tsx`, `settings-page.tsx`, `router.tsx`, komponen `src/components/tax/` | T07 | Seluruh katalog dapat diaktifkan dan nominal diisi; alur mobile/desktop, keyboard, empty/error/loading, bayar/lapor terpisah berjalan |
| T09 | Scheduler/inbox/email: `pb_hooks/tax_jobs.pb.js`, delivery helpers, template, badge aggregation | T04,T06,T07 | Closed-browser delivery, leases/retry/dedupe/catch-up, unsubscribe dan perubahan deadline diuji dengan mail sink |
| T10 | Rekap, CSV, backup/restore dan lifecycle pajak | T06,T07,T08 | Rekap tidak menagih final dua kali; restore tidak menduplikasi subjek/job; manifest dan preview tersedia |
| T11 | Adapter cashflow/proyeksi: `tax.ts`, `safe-to-spend.ts`, `forecast.ts`, related tests/UI | T05,T06,T07 | Alokasi beda tahun/jenis benar; reminder tanpa kas; tidak double reserve; subject bersama tidak mendapat fasilitas ganda |
| T12 | QA end-to-end, dokumentasi, flags/metrics, runbook `TAX_REMINDERS_RUNBOOK.md` | T08,T09,T10,T11 | Seluruh matriks bagian 13 dijalankan; bukti gate rilis bagian 14 tersimpan |

Jalur kritis: T01 → T02 → T03/T04 → T05 → T06 → T07 → T08–T11 → T12. Implementasi tidak dimulai dengan UI-only reminder yang mengandalkan nominal proyeksi.

## 13. Verifikasi wajib

### Perhitungan dan kewajiban

- OP UMKM: di bawah, tepat, dan melewati Rp500 juta; contoh Rp490 juta + Rp30 juta = Rp100.000; dua company satu subject hanya satu fasilitas.
- Badan UMKM eligible: Rp80 juta × 0,5% = Rp400.000; status/periode tidak eligible tidak diam-diam mendapat angka otomatis.
- Saldo omzet awal, eksternal, transaksi belum tersinkron, refund/penyesuaian, perubahan bulan lama dan transisi aturan menghasilkan status/revisi yang benar.
- Terutang Rp100.000, pembayaran Rp40.000 → sisa Rp60.000; pembayaran/bukti pihak lain tidak teralokasi dua kali.
- Tahunan non-final: terutang terkonfirmasi Rp20 juta, kredit kompatibel Rp12 juta, angsuran Rp5 juta → kurang bayar Rp3 juta. Bukti yang sama dalam kredit dan angsuran harus ditolak.
- Rekap final bulanan seluruhnya lunas → tidak ada tagihan final tahunan baru; tugas SPT tahunan tetap terbuka.
- Nihil, tidak wajib, unknown dan lebih bayar berbeda; PPN lebih bayar bukan kas masuk otomatis; sanksi tidak dikarang.
- Multiple Unifikasi components → satu filing task; bayar belum lapor dan lapor belum bayar tetap terlihat independen.

### Kalender dan notifikasi

- Februari/tahun kabisat, Desember ke Januari, tahun buku non-kalender, masa awal/akhir parsial, WIB/WITA/WIT, deadline hari libur dan sumber kalender hilang.
- Tanggal hukum, perpanjangan, relaksasi sanksi, serta snooze diuji berbeda; aturan SPT Masa tidak otomatis diterapkan ke tahunan.
- Pergantian nominal/status sesaat sebelum kirim, email opt-out, email berubah/belum verified, SMTP gagal, server restart, dua worker, lease timeout, dan crash setelah SMTP.
- Aplikasi/browser ditutup sepanjang jadwal: backend membuat inbox dan email yang tepat. Downtime beberapa hari hanya satu digest pemulihan.

### Integritas, UI, dan cashflow

- Dua tenant tidak bisa membaca/mengubah record/file satu sama lain, termasuk forged subject/company/settlement IDs.
- Dua device mengalokasikan sumber pembayaran bersamaan; retry setelah timeout; idempotency payload mismatch; optimistic revision conflict.
- Pergantian company saat request berjalan; semua company arsip; perubahan membership efektif; reset epoch; backup/restore; client lama mencoba menghapus transaksi teralokasi.
- Tindakan reminder/lapor tidak mengubah cash. Buat pembayaran mengurangi kas tepat sekali; link pembayaran lama tidak mengurangi kas lagi.
- Pembayaran tahun lalu tidak mengurangi pajak tahun ini; proyeksi, saldo kurang bayar, pajak dipotong, dan cadangan tidak dijumlahkan dua kali.
- Mobile, desktop, navigasi keyboard, screen-reader labels, empty/loading/error/offline states dan angka rupiah panjang.

### Perintah gate

Perintah yang sudah tersedia:

```sh
bun run typecheck
bun run lint
bun test
bun run build
```

T12 menambah harness `scripts/verify-tax-reminders.ts` dan script `test:tax:integration` ke `package.json`. Harness wajib memerlukan binary PocketBase versi pin, database sementara, fixed clock/fixtures dan mail sink; gagal dengan pesan jelas bila dependency hilang, **tidak silently skip**. Jalankan:

```sh
bun run test:tax:integration
```

Harness mencakup migration upgrade/fresh, API/auth/lifecycle, scheduler dan cashflow regressions. Pada T12 tambahkan Playwright (`@playwright/test`), `playwright.config.ts`, `tests/e2e/tax-reminders.spec.ts`, dan script `test:tax:e2e` untuk wizard → agenda → bayar → lapor → pindah company. Test memakai server/database sementara dan auth fixture, bukan akun produksi. Instal browser runner di lingkungan test dan dokumentasikan setup pada runbook; jalankan `bun run test:tax:e2e`. Suite umum saja belum cukup karena integration tests repo saat ini dapat skip bila `POCKETBASE_BIN` tidak tersedia.

## 14. Migrasi, rollout, dan definisi selesai

1. Tambahkan schema dan rules dalam keadaan tidak menghasilkan email. Usulkan flags terpisah: `VITE_TAX_COMPLIANCE_ENABLED`, `JORNAL_TAX_COMPLIANCE_ENABLED`, `JORNAL_TAX_EMAIL_ENABLED`.
2. Jangan mengonversi setiap company otomatis menjadi wajib pajak terpisah. Migrasi hanya menawarkan kandidat profil; pengguna mengonfirmasi mapping dan kewajiban.
3. Pembayaran lama tetap utuh dan belum teralokasi. Wizard rekonsiliasi menampilkan kandidat tanpa menebak masa/jenis pajak. Tidak membuat kembali transaksi lama.
4. Dry-run generator pada fixture, kemudian akun internal opt-in. Aktifkan in-app lebih dulu; email setelah SMTP, identity, opt-in, preview dan dedupe terbukti.
5. Monitoring: lag scheduler, jumlah failed/unknown delivery, duplicate prevention, kewajiban tanpa nominal, sumber stale, dan konflik alokasi. Log hanya IDs operasional yang diperlukan.
6. Kill switch email menghentikan pengiriman tanpa menghapus agenda/histori. Rollback aplikasi tidak menurunkan schema secara destruktif; command endpoint menghormati flags dan compatibility. Pemulihan backup backend menjalankan reconciliation delivery sebelum mengaktifkan email kembali.

Fitur dinyatakan selesai hanya jika:

- [x] Semua baris katalog dapat dikelola end-to-end dengan relevansi, periode, nominal atau status belum diketahui, tanggal, pembayaran/pelaporan, dan reminder.
- [x] Template otomatis mempunyai review aturan dan fixture; yang manual diberi label jelas serta sumber tanggal/nominal.
- [x] UMKM otomatis tervalidasi; jenis lainnya tetap berguna dengan input terkonfirmasi, tanpa klaim kalkulasi otomatis yang belum tersedia.
- [x] Isolation multi-tenant/company/subject, shared taxpayer, lifecycle, offline/cache dan konkurensi terbukti melalui test.
- [x] Bukti bayar/lapor dan histori aman; tidak ada duplikasi tagihan, pembayaran kas, fasilitas omzet, atau cadangan.
- [x] Closed-app reminder dan recovery kegagalan teruji; email hanya opt-in; keterbatasan SMTP dijelaskan.
- [x] Gate typecheck/lint/unit/build/integration/browser lulus tanpa integration skip tersembunyi, dengan hasil dicatat di runbook.
- [x] Pengguna dapat memahami mana kewajiban pajak aktual, proyeksi, jumlah terkonfirmasi, dan data yang belum lengkap.

Tidak ada gap implementasi tersisa. Pengiriman email produksi tetap merupakan aktivasi operasional: operator harus memasang kredensial SMTP, menguji pengirim internal, lalu menyalakan kill switch email. Review aturan dan kalender resmi tetap pekerjaan pemeliharaan berkala ketika regulasi atau tahun kalender berubah, bukan kode fitur yang tertunda.
