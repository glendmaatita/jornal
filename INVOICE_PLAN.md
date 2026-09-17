# Executable Plan: Invoice dan Pelanggan

Tanggal: 17 September 2026. Status: **diimplementasikan; bukti dan runbook ada di `INVOICE_EVIDENCE.md` dan `INVOICE_RUNBOOK.md`**.

Rencana ini dibuat dari kode Jornal dan Dropify yang tersedia di workspace, bukan dari asumsi struktur aplikasi. Baseline HEAD Jornal `89e60ca`, Dropify `3ef1f0d`; Jornal memiliki perubahan lokal, termasuk modul tax compliance, yang harus dipertahankan. Sebelum implementasi, periksa ulang diff dan nomor migrasi terakhir.

## 1. Hasil yang harus tersedia

- Pengguna dapat memasukkan dan mengelola data pelanggan seperti di Dropify.
- Pengguna dapat mengunggah, melihat preview, mengganti, dan menghapus logo company melalui profil company; logo otomatis dipakai pada invoice.
- Pengguna dapat membuat draft, menerbitkan invoice, melihat preview, dan memilih pelanggan.
- Pengguna dapat melihat nominal dan jumlah invoice belum dibayar, termasuk bagian yang sudah jatuh tempo.
- Menandai invoice lunas langsung mencatat pemasukan pada ledger/cashflow company yang sama, tepat satu kali.
- Invoice lewat jatuh tempo menghasilkan reminder di dalam aplikasi dan berhenti menjadi reminder aktif setelah lunas atau dibatalkan.
- Dokumen invoice mengikuti desain Dropify secara presisi: layout, font, ukuran, warna, label, dan posisi komponen.
- Invoice dapat diunduh dan dibagikan sebagai file PNG atau PDF.
- Tersedia Pengaturan Invoice, termasuk satuan default `pcs`, `Lusin`, `Kodi`, dan satuan custom.
- Semua data, total, file, reminder, dan pembayaran terisolasi per tenant dan company.

### Keputusan ruang lingkup versi pertama

| Topik                 | Keputusan implementasi                                                                                                                                                                                                |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Acuan dokumen         | Invoice order Dropify: `app/templates/dashboard/invoice.html`. Ini keputusan default rencana karena template tersebut menyediakan aksi paid, PNG, dan PDF.                                                            |
| Acuan pelanggan       | `app/templates/dashboard/customers/{list,form,detail}.html`; field dan pengelompokan form mengikuti Dropify.                                                                                                          |
| Template Dropify lain | `manual_invoices/print.html` memakai desain berbeda. Jangan mencampurkan kedua desain. Jika yang dimaksud ternyata invoice manual, ganti baseline desain sebelum implementasi renderer; domain pembayaran tetap sama. |
| UI aplikasi           | Navigasi dan kontrol memakai komponen Jornal; isi dokumen yang dilihat pelanggan mengikuti Dropify. Form pelanggan memakai urutan dan kelompok field Dropify.                                                         |
| Mata uang             | IDR, konsisten dengan domain Jornal saat ini.                                                                                                                                                                         |
| Pembayaran            | Pelunasan penuh. Cicilan, uang muka, kelebihan bayar, credit note, dan refund nyata ditunda.                                                                                                                          |
| Reminder              | In-app untuk pemilik company, tanpa memerlukan browser terbuka saat penjadwalan. Email/WhatsApp otomatis ke pelanggan bukan bagian versi pertama.                                                                     |
| Offline               | Membaca cache dan menyimpan pekerjaan form sebagai draft lokal. Penerbitan, pembayaran, perubahan master, dan ekspor resmi memerlukan server.                                                                         |
| Share                 | Membagikan file melalui share sheet perangkat atau mengunduhnya; tidak membuat tautan invoice publik.                                                                                                                 |
| Pengiriman            | Teks metode pengiriman dan nominal ongkir opsional untuk kesamaan dokumen. Tidak membuat modul fulfillment.                                                                                                           |
| Pengaturan            | Per company, bukan satu default untuk seluruh tenant.                                                                                                                                                                 |
| Logo company          | Aset profil company yang dapat dikelola tanpa membuka atau mengaktifkan modul invoice. Invoice memakai snapshot logo tersebut.                                                                                        |

Keputusan di atas adalah spesifikasi kerja yang dapat ditinjau, bukan klaim bahwa fitur tersebut sudah ada. Tidak memerlukan perubahan stack backend Jornal menjadi Python.

## 2. Temuan kode yang memengaruhi implementasi

### Jornal

| Lokasi                                                                                | Kondisi sekarang dan implikasinya                                                                                                                                              |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `package.json`                                                                        | Bun, React 19, TanStack Router/Query, PocketBase SDK; Playwright sudah tersedia untuk pengujian. Belum ada renderer invoice runtime.                                           |
| `src/lib/types.ts`                                                                    | `Transaction` sudah memiliki direction, classification, account, customer berupa string, serta link tax/receivable. Belum ada entitas pelanggan atau invoice.                  |
| `src/lib/store.ts`                                                                    | Mutasi ledger lokal, riwayat versi, financial events, backup/restore, dan jadwal sync. Integrasi invoice harus mempertahankan kontrak ini.                                     |
| `src/lib/pocketbase-sync.ts`                                                          | Sync ledger memakai revision, outbox, company scope, dan data epoch. Jangan memasukkan domain invoice ke sync generik tanpa protokol domain.                                   |
| `src/lib/receivables.ts`                                                              | Piutang diturunkan dari `RECEIVABLE_CREATED` dan `RECEIVABLE_PAYMENT`, yaitu alur uang dipinjamkan dan dilunasi. Invoice penjualan tidak menggunakan pasangan klasifikasi ini. |
| `src/lib/account-balance.ts`                                                          | Saldo rekening dihitung dari transaksi dan tanggal penerimaan. Invoice belum lunas tidak boleh memengaruhinya.                                                                 |
| `src/lib/queries.ts`                                                                  | Invalidation mengikuti financial events. Cache invoice perlu key tenant/company/epoch dan integrasi invalidation ledger.                                                       |
| `src/lib/tax.ts`, `src/lib/trends.ts`, Home, Insights                                 | Beberapa agregasi omzet menjumlahkan `Transaction.amount` langsung. Perlu membedakan kas bruto dan komponen omzet jika invoice memuat pajak tambahan.                          |
| `backend/pocketbase/pb_hooks/tax.pb.js`                                               | Ada contoh command server, idempotency, transaksi DB, dan pencatatan ledger pada settlement. Ambil polanya, bukan copy semua implementasi.                                     |
| `backend/pocketbase/pb_hooks/tax_jobs.pb.js`                                          | Ada scheduler PocketBase setiap lima menit. Reminder invoice dapat memakai pola serupa, dengan koleksi/domain terpisah.                                                        |
| `backend/pocketbase/pb_hooks/jornal_helpers.js`                                       | Validasi link ledger dan proteksi transaksi pajak sudah ada. Tambahkan perlindungan invoice pada create, update, delete, dan restore.                                          |
| `backend/pocketbase/pb_hooks/companies.pb.js`                                         | Archive/reset company memengaruhi ledger. Invoice dan pembayaran harus masuk lifecycle tersebut.                                                                               |
| `src/lib/companies.ts`, `src/pages/settings-page.tsx`, `src/pages/companies-page.tsx` | Company saat ini dapat dibuat, diganti nama, dan diarsipkan; parser/model company belum memuat logo. Tambahkan pengelolaan logo ke profil yang sudah ada.                      |
| `Dockerfile`, `server.ts`                                                             | Runtime Alpine untuk Bun + PocketBase, multi-architecture; server Bun melayani SPA dan proxy. Runtime Chromium belum tersedia.                                                 |

### Dropify

| Sumber relatif terhadap `/Users/glend/Project/dropify-engine`                         | Yang dipakai                                                                                                                     |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `app/models/customer.py`, `app/schemas/customer.py`                                   | Nama, kontak, alamat terstruktur; email opsional.                                                                                |
| `app/templates/dashboard/customers/form.html`                                         | Kelompok Informasi Kontak dan Alamat, urutan field, tambah/edit.                                                                 |
| `app/templates/dashboard/customers/list.html`, `detail.html`                          | Daftar, pencarian, aksi, dan detail pelanggan.                                                                                   |
| `app/templates/dashboard/invoice.html`                                                | Sumber utama desain dokumen A4, Poppins, tabel, ringkasan, footer, dan mode compact.                                             |
| `app/services/invoice_png.py`                                                         | Acuan keluaran PNG 1240 × 1754; renderer terpisah memakai Pillow dan font fallback, sehingga tidak otomatis identik dengan HTML. |
| `app/services/invoice.py`                                                             | Penomoran dan snapshot invoice. Jornal harus memakai counter transaksional sendiri.                                              |
| `app/templates/dashboard/manual_invoices/form.html`, `app/services/manual_invoice.py` | Referensi pengisian line items dan default satuan; bukan baseline visual dokumen yang dipilih.                                   |
| `app/templates/dashboard/settings/index.html`, `app/models/tenant.py`                 | Default satuan berupa string dengan maksimum 20 karakter, default `pcs`.                                                         |

Tidak mengambil password pelanggan, login storefront, data pelanggan nyata, atau kredensial Dropify. Tidak memodifikasi repository Dropify.

## 3. Alur produk dan halaman

### 3.1 Pelanggan

Routes: `/customers`, `/customers/new`, `/customers/$customerId`, `/customers/$customerId/edit`.

Field mengikuti Dropify:

| Kelompok         | Field                               | Aturan                                                                                 |
| ---------------- | ----------------------------------- | -------------------------------------------------------------------------------------- |
| Informasi Kontak | Nama                                | Wajib, trim, 1–255 karakter.                                                           |
| Informasi Kontak | Email                               | Opsional, validasi format; lower-case untuk pencarian dan uniqueness.                  |
| Informasi Kontak | Telepon/WhatsApp                    | Opsional, maksimal 50 karakter; simpan tampilan asli dan bentuk normalisasi pencarian. |
| Alamat           | Alamat baris 1                      | Opsional, maksimal 255 karakter.                                                       |
| Alamat           | Alamat baris 2                      | Opsional, maksimal 255 karakter.                                                       |
| Alamat           | Kecamatan, kota/kabupaten, provinsi | Opsional, masing-masing maksimal 255 karakter.                                         |
| Alamat           | Kode pos                            | Opsional, string maksimal 30 karakter; jangan konversi menjadi angka.                  |

Perilaku:

1. Daftar menampilkan nama, email, telepon, kota, jumlah invoice aktif, dan total belum dibayar. Desktop memakai tabel; layar kecil memakai kartu yang tetap menyediakan semua informasi.
2. Pencarian berdasarkan nama, email, telepon, atau kota; pagination server, default 25 dan maksimum 100 record per halaman.
3. Detail menampilkan data kontak/alamat, ringkasan total invoice, total lunas, total unpaid, dan riwayat invoice dengan filter status.
4. Tombol **Buat Invoice** dari detail pelanggan membuka form dengan pelanggan terpilih.
5. Dropdown pelanggan di form invoice menyediakan **Tambah Pelanggan**. Form tambah memakai field yang sama dan mempertahankan line items saat ditutup.
6. Pelanggan dengan email sama dalam company/epoch yang sama ditolak dengan pesan yang jelas; email kosong boleh berulang. Nama/telepon sama memunculkan peringatan duplikat, bukan otomatis digabung.
7. Arsip menyembunyikan pelanggan dari pemilihan baru, tetapi mempertahankan history. Unarchive tersedia. Pengguna tidak perlu menghapus pelanggan untuk membersihkan daftar.
8. Edit pelanggan tidak mengubah snapshot invoice yang sudah diterbitkan. Draft hanya memakai alamat terbaru saat pengguna memilih **Perbarui dari data pelanggan**.

Import CSV pelanggan dan penggabungan duplikat bukan syarat peluncuran. “Memasukkan data pelanggan” tersedia melalui form lengkap, termasuk dari proses pembuatan invoice.

### 3.2 Invoice

Routes: `/invoices`, `/invoices/new`, `/invoices/$invoiceId`, `/invoices/$invoiceId/edit`, `/invoices/$invoiceId/preview`.

Daftar invoice:

- Kartu **Belum Dibayar**: nominal dan jumlah semua invoice `UNPAID`, tanpa dibatasi halaman pagination.
- Kartu **Lewat Jatuh Tempo**: nominal dan jumlah subset `UNPAID` yang due date-nya telah lewat.
- Filter Draft, Belum Dibayar, Lewat Jatuh Tempo, Lunas, Dibatalkan; pencarian nomor atau pelanggan; sortir tanggal terbit/due date.
- Ringkasan global company tetap diberi label jelas; total hasil filter ditampilkan terpisah bila ada filter pelanggan/periode.
- Empty state, loading, error/retry, cache offline, dan company arsip harus mempunyai tampilan eksplisit.

Form invoice:

1. Pilih atau buat pelanggan.
2. Isi tanggal invoice dan jatuh tempo; default jatuh tempo = tanggal invoice + default termin.
3. Preview nomor otomatis sebagai estimasi; nomor resmi baru dialokasikan server saat terbit.
4. Isi baris deskripsi, kuantitas, satuan, harga per satuan; baris bisa ditambah, dihapus, dan diurutkan.
5. Isi diskon nominal, ongkir, metode pengiriman, dan pajak tambahan opsional. Default pajak 0; tidak menebak tarif atau kewajiban pajak.
6. Pilih instruksi pembayaran yang akan tampil pada dokumen; rekening yang ditampilkan bukan otomatis rekening penerima pelunasan.
7. Lihat subtotal dan total yang dihitung otomatis, kemudian **Simpan Draft** atau **Terbitkan Invoice**.
8. Setelah terbit, tersedia preview, unduh/bagikan PNG/PDF, **Tandai Lunas**, dan **Batalkan Invoice** dengan alasan.

Aturan perubahan:

- `DRAFT` dapat diedit dan dihapus lunak; belum masuk unpaid, cashflow, atau reminder.
- `UNPAID` adalah dokumen terbit dan snapshot-nya dikunci. Koreksi isi/nominal/due date dilakukan dengan batalkan lalu duplikasi sebagai draft baru; hubungan pengganti disimpan.
- `PAID` terkunci. Koreksi salah pencatatan pelunasan tersedia melalui aksi khusus dengan alasan, bukan edit transaksi biasa.
- `VOID` tidak masuk unpaid/reminder, tetap dapat dibaca sebagai arsip dan jelas ditandai batal pada UI serta hasil ekspor.
- Duplikasi membuat draft tanpa nomor, payment link, atau status lunas.

### 3.3 Pengaturan Invoice

Route `/settings/invoice`, ditautkan dari Pengaturan dan halaman Invoice.

| Pengaturan                  | Default dan perilaku                                                                                                                                                                               |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identitas pengirim          | Nama company, nomor konfirmasi pembayaran, email. Logo dibaca dari profil company; tampilkan preview dan tautan **Kelola Logo Company**, tanpa upload/default logo kedua. Di-snapshot saat terbit. |
| Satuan default              | `pcs`; pilihan awal `pcs`, `Lusin`, `Kodi`, `box`, `pak`, `set`, `kg`, `meter`, `jam`, `unit`.                                                                                                     |
| Satuan custom               | Tambah/rename/arsip label, 1–20 karakter; hindari duplikat setelah trim/case folding.                                                                                                              |
| Termin pembayaran           | Default 7 hari kalender; dapat diubah, 0–365 hari.                                                                                                                                                 |
| Nomor invoice               | Default angka berurutan, minimum 3 digit: `001`, `002`, sesuai tampilan Dropify; prefix opsional, tidak reset otomatis per tahun.                                                                  |
| Nomor awal                  | Default 1; boleh dinaikkan melalui setting teraudit, tidak boleh diputar mundur atau dipakai ulang.                                                                                                |
| Instruksi pembayaran        | Maksimum 3 entri bank/e-wallet: nama, nomor, nama pemilik; fallback teks untuk pembayaran tunai.                                                                                                   |
| Rekening penerimaan default | Relasi ke account Jornal yang aktif pada company yang sama; dikonfirmasi saat lunas.                                                                                                               |
| Reminder                    | Aktif in-app, jam 09:00, timezone `Asia/Jakarta`, pertama D+1 lalu setiap 7 hari; boleh dimatikan.                                                                                                 |

Satuan adalah label komersial, bukan konversi stok. `2 Lusin × Rp100.000` menghasilkan Rp200.000; tidak dikalikan 12. Mengubah default hanya memengaruhi baris baru, bukan baris atau dokumen lama.

Format dan lifecycle logo mengikuti fitur Company Logo pada §3.5. Pengaturan Invoice tidak menyimpan salinan mutable logo sendiri.

### 3.4 Navigasi

Tambahkan akses Invoice yang terlihat pada Home dan menu aplikasi; halaman Invoice memiliki akses Pelanggan serta Pengaturan Invoice. Tambahkan Pelanggan pada menu aplikasi juga agar master data dapat diisi sebelum membuat invoice. Pertahankan navigasi mobile yang terbaca; jangan menambahkan tab kecil tanpa menguji layout 360 px. Preview dokumen memakai area khusus tanpa app chrome di dalam kertas.

### 3.5 Company Logo — fitur profil company

Lokasi utama: **Pengaturan → Profil Company**, pada halaman Pengaturan yang sudah ada. Berikan akses **Kelola Logo** dari daftar company dan Pengaturan Invoice ke section yang sama, dengan company target eksplisit. Logo merupakan identitas company, bukan avatar pengguna atau pengganti logo merek Jornal.

Alur pengguna:

1. Company tanpa logo menampilkan placeholder inisial/nama dan tombol **Unggah Logo**. Logo opsional agar onboarding dan penerbitan invoice tetap dapat dilakukan tanpa gambar.
2. Pengguna memilih file dari perangkat, melihat preview penuh dengan rasio asli, lalu memilih **Simpan Logo** atau **Batal**. Jangan memaksa crop persegi; logo horizontal harus tetap utuh seperti pada invoice Dropify.
3. Setelah tersimpan, logo tampil pada profil, daftar company, company switcher, serta preview invoice baru. Gunakan `object-fit: contain` dan ukuran container yang sesuai pada setiap tempat.
4. Tombol **Ganti Logo** menampilkan preview pengganti sebelum commit. Jika upload gagal, logo lama tetap aktif dan tersedia retry.
5. Tombol **Hapus Logo** menjelaskan bahwa penghapusan hanya menghilangkan logo dari profil dan invoice berikutnya. Invoice yang sudah terbit tetap menggunakan logo lamanya. Setelah berhasil, tampilkan fallback nama company.
6. Saat membuat company, tampilkan langkah unggah logo opsional setelah company berhasil dibuat. Gagal upload tidak membatalkan pembuatan company dan dapat dilanjutkan dari Pengaturan.
7. Company arsip hanya dapat menampilkan logo. Unggah/ganti/hapus memerlukan company ACTIVE serta koneksi server; UI memperlihatkan status uploading, success, dan error yang jelas.

Aturan file: PNG/JPEG/WebP, maksimum 2 MB, maksimum sisi 4096 px dan total 16 megapixel. Verifikasi MIME dari isi file dan decode di server, bukan hanya ekstensi; tolak file rusak/animasi/SVG dan URL arbitrary. Normalisasi orientasi, buang metadata yang tidak diperlukan, dan re-encode secara aman sambil mempertahankan transparansi PNG/WebP. Batas berlaku juga sebelum decode penuh agar file kecil dengan dimensi ekstrem tidak membebani server. Dependency pengolah gambar dan dukungan runtime diuji pada P0; upload logo tidak boleh bergantung pada worker ekspor invoice yang sedang aktif.

Setiap unggahan membuat aset immutable baru. `Company.logoAssetId` menunjuk logo aktif. Mengganti atau menghapus logo hanya mengganti/melepas pointer tersebut, tidak menimpa bytes file lama. Aset yang masih direferensikan draft tersimpan atau invoice terbit dipertahankan; pembersihan aset tak terpakai memakai pemeriksaan referensi dan grace period minimal 24 jam, termasuk untuk upload yang batal.

Draft baru mengambil logo aktif. Draft tersimpan mempertahankan preview snapshot-nya; jika logo company berubah, tampilkan **Gunakan Logo Company Terbaru** untuk memperbarui draft secara eksplisit. Saat issue, bekukan `sender_snapshot.logoAssetId` dan checksum bersama snapshot pengirim. Preview, PNG, dan PDF dokumen terbit selalu memakai aset yang sama. Jika aset snapshot tidak dapat dimuat, tampilkan kegagalan/retry, jangan diam-diam memakai logo company terbaru.

Logo company tetap tersimpan ketika hanya data pembukuan di-reset. Backup/restore mencakup logo aktif dan semua versi yang masih dibutuhkan invoice. Seluruh akses aset memeriksa tenant/company; pergantian company atau logout tidak boleh menampilkan logo cached milik scope sebelumnya.

## 4. State, nominal, dan invariant

### 4.1 Lifecycle

| Dari             | Command         | Ke         | Efek ledger                                                     |
| ---------------- | --------------- | ---------- | --------------------------------------------------------------- |
| Belum ada        | Create draft    | DRAFT      | Tidak ada.                                                      |
| DRAFT            | Issue           | UNPAID     | Tidak ada; alokasikan nomor dan kunci snapshot.                 |
| UNPAID           | Mark paid       | PAID       | Buat satu pemasukan atau kaitkan satu pemasukan yang sudah ada. |
| UNPAID           | Void            | VOID       | Tidak ada.                                                      |
| PAID             | Correct payment | UNPAID     | Batalkan pencatatan keliru secara atomik sesuai asal transaksi. |
| UNPAID/VOID/PAID | Duplicate       | Draft baru | Tidak ada.                                                      |

`OVERDUE` bukan status permanen; dihitung dari `status === UNPAID && dueDate < todayInInvoiceTimezone`. Due date hari ini belum overdue. Pelunasan bersifat penuh, sehingga outstanding `UNPAID = grandTotal`, sedangkan DRAFT/PAID/VOID = 0.

### 4.2 Perhitungan

Nominal disimpan sebagai integer rupiah. Quantity disimpan sebagai integer skala 1000, harga per satuan integer rupiah, tarif persen sebagai basis points (misalnya 2,5% = 250). Hitung dengan integer/decimal yang teruji; pembulatan half-up pada nominal baris dan pajak, bukan floating point bebas.

```text
lineTotal       = roundHalfUp(quantityScaled × unitPrice / 1000)
subtotal        = sum(lineTotal)
baseAmount      = subtotal - discountAmount + shippingAmount
taxAmount       = roundHalfUp(baseAmount × taxRateBps / 10000)
grandTotal      = baseAmount + taxAmount
unpaidTotal     = sum(grandTotal untuk semua UNPAID dalam scope)
overdueTotal    = sum(grandTotal untuk UNPAID dengan dueDate < hari ini)
```

Rumus pajak adalah rumus kalkulasi invoice versi pertama, bukan aturan kepatuhan pajak. Tarif dan penggunaan fitur ditentukan pengguna; tidak otomatis membuat faktur pajak atau kewajiban pada tax compliance.

Batas awal: 1–100 item saat terbit; quantity positif sampai 1.000.000 dengan maksimal 3 desimal; harga 0–Rp1 miliar; total invoice > 0 dan maksimum Rp1 triliun; diskon 0–subtotal; ongkir nonnegatif; tarif 0–100%. Cek setiap perkalian/penjumlahan agar tetap safe integer, atau gunakan aritmetika desimal yang tersedia pada runtime backend. Tolak overflow sebelum menyimpan. Deskripsi maksimal 500 karakter dan semua teks di-escape.

### 4.3 Invariant yang wajib diuji

1. Satu invoice hanya memiliki satu payment aktif dan satu ledger transaction aktif yang terkait.
2. Penerbitan invoice, pembuatan pelanggan, dan export tidak menciptakan transaksi kas.
3. `PAID` hanya mungkin jika payment aktif dan ledger yang cocok sudah tersimpan dalam commit yang sama.
4. Status, nilai pembayaran, company, epoch, dan link ledger tidak dapat ditentukan bebas oleh client.
5. `mark-paid` dari retry atau dua perangkat tidak menggandakan kas.
6. Semua referensi customer, invoice, account, dan transaction berada pada tenant/company/epoch yang benar. Logo berada pada tenant/company yang sama, dengan versi aset immutable yang dapat dipakai lintas epoch pembukuan.
7. Data master yang berubah tidak mengubah dokumen terbit.
8. Total unpaid berasal dari seluruh data server dalam scope, bukan penjumlahan halaman UI atau salinan cache parsial.
9. Transaksi invoice tidak boleh diedit, dihapus, diduplikasi, atau direklasifikasi lewat flow transaksi umum.
10. Reminder dan response request yang terlambat tidak bocor ke company atau sesi lain.

## 5. Data model dan migrasi

Gunakan koleksi khusus dengan raw API create/update/delete/list/view terkunci; akses domain melalui endpoint terautentikasi. Ledger yang dihasilkan tetap berada di `jornal_records` supaya mesin cashflow Jornal tetap bekerja.

Semua koleksi domain invoice memakai `tenant_id`, `company_id`, `data_epoch`, `created`, `updated`. Entitas yang dapat berubah memakai `revision`. `tenant_id` diambil dari auth; company diverifikasi server. Nomor invoice dan counter mengikuti identitas company lintas epoch agar nomor lama tidak dipakai ulang setelah reset. Aset logo dan command logo adalah domain company, tidak mengikuti reset epoch pembukuan.

Perluas koleksi `companies` dengan nullable relation `logo_asset_id` dan DTO `Company` dengan `logoAssetId: string | null`; company lama default null. Perubahan logo menaikkan revision company serta dicatat di `company_audit`. Jangan menyimpan base64 logo di `BusinessProfile`, payload ledger, atau katalog company localStorage.

| Koleksi baru             | Field khusus utama                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `invoice_customers`      | name, email, normalized_email, phone, normalized_phone, address_line1/2, district, city, province, postal_code, status ACTIVE/ARCHIVED, revision.                                                                                                                                                                                                                                                                     |
| `invoice_settings`       | sender fields selain logo, default_unit_id, default_due_days, numbering_prefix/padding, payment_instructions JSON, default_account_id, reminder_enabled/timezone/hour/repeat_days, schedule_version, revision.                                                                                                                                                                                                        |
| `invoice_units`          | label, normalized_label, status, sort_order, revision.                                                                                                                                                                                                                                                                                                                                                                |
| `invoice_sequences`      | tenant/company, next_value; counter tidak direset oleh reset data company.                                                                                                                                                                                                                                                                                                                                            |
| `invoices`               | customer_id, status, sequence, invoice_number, issue_date, due_date, timezone, customer_snapshot JSON, sender_snapshot JSON, payment_instructions_snapshot JSON, items JSON, shipping_method, subtotal, discount_amount, shipping_amount, tax_rate_bps, tax_amount, grand_total, currency, template_version, content_hash, issued_at, paid_at, payment_cycle, void_reason, replaced_invoice_id, revision, deleted_at. |
| `invoice_payments`       | invoice_id, amount, paid_on, account_id, ledger_transaction_id, origin CREATED/LINKED, original_ledger_snapshot untuk LINKED, status ACTIVE/REVERSED, lifecycle CURRENT/ARCHIVED_EPOCH, reference, reversal_reason, reversed_at, revision.                                                                                                                                                                            |
| `company_assets`         | tenant_id, company_id, kind COMPANY_LOGO, protected file, MIME, byte_size, width, height, checksum, created/updated; immutable, tanpa data_epoch, dipakai profil company dan snapshot invoice. Raw API terkunci.                                                                                                                                                                                                      |
| `company_asset_commands` | tenant_id, company_id, request_id, action, request_hash, response; unique request ID per company untuk retry upload/ganti/hapus yang deterministik, tanpa ketergantungan flag invoice.                                                                                                                                                                                                                                |
| `invoice_reminders`      | invoice_id, payment_cycle, schedule_version, scheduled_local_date, status UNREAD/READ/RESOLVED, read_at, resolved_at, dedupe_key.                                                                                                                                                                                                                                                                                     |
| `invoice_commands`       | command_key, action, request_hash, response_status, response_body; untuk replay yang deterministik.                                                                                                                                                                                                                                                                                                                   |
| `invoice_audit`          | actor_id, action, entity_type/id, command_key, reason, before/after snapshot atau diff yang diperlukan. Tidak dapat diedit client.                                                                                                                                                                                                                                                                                    |

Items berupa ordered JSON di invoice untuk atomic edit, tanpa kebutuhan inventori/query lintas baris. Setiap item memuat `id`, `description`, `quantityScaled`, `unitId`, `unitLabelSnapshot`, `unitPrice`, `lineTotal`, `sortOrder`. Server menghitung ulang semua total. Tetapkan batas body JSON, misalnya 256 KB, terpisah dari upload logo.

`payment_cycle` dimulai dari 1 dan bertambah pada koreksi pembayaran; `schedule_version` dimulai dari 1 dan bertambah saat kebijakan reminder berubah. Lifecycle epoch terpisah dari status pembayaran agar reset tidak menulis ulang sejarah pembayaran menjadi reversal yang tidak pernah terjadi.

Index minimum:

- Unique settings `(tenant_id, company_id, data_epoch)` dan sequence `(tenant_id, company_id)`.
- Unique nomor invoice terbit `(tenant_id, company_id, invoice_number)` dengan partial index untuk nomor tidak kosong.
- Unique email terisi `(tenant_id, company_id, data_epoch, normalized_email)`; email kosong tidak menjadi nilai unique yang sama.
- Unique unit aktif `(tenant_id, company_id, data_epoch, normalized_label)` sesuai aturan arsip yang dipilih; restore unit lama tidak menghasilkan dua unit aktif bernama sama.
- Unique payment ACTIVE per `(company_id, data_epoch, invoice_id)` dan ledger transaction ACTIVE per scope.
- Unique command `(tenant_id, company_id, data_epoch, command_key)`.
- Unique `dedupe_key` reminder; index status/due date dan customer/issue date untuk invoice; index company/status untuk pelanggan.

Tambahan pada `Transaction`:

```ts
invoiceId?: string | null
invoicePaymentId?: string | null
invoiceNumber?: string | null
customerId?: string | null
invoiceRevenueAmount?: number | null
invoiceTaxAmount?: number | null
```

Metadata tersebut hanya dapat diisi oleh command invoice. Tetap isi `supplierCustomer` dari snapshot untuk kompatibilitas UI lama. ID ledger menggunakan kontrak `app_id` yang sudah digunakan Jornal, bukan menyamakan ID record PocketBase dengan ID domain.

Migrasi usulan dipisah agar logo dapat dipakai mandiri: `20260917_0008_company_logo.js`, lalu `20260917_0009_invoices.js`; gunakan nomor berikutnya yang belum terpakai saat eksekusi. Migrasi membuat koleksi, relations, rules, index, serta seed default idempotent. Company baru mendapat settings/unit saat onboarding atau lazy initialization transaksional. Company lama tidak otomatis mendapat pelanggan/invoice fiktif dan logo awalnya null.

## 6. Kontrak API dan concurrency

Base domain: `/api/jornal/invoicing`, dengan company scope eksplisit pada query/body. Header protokol ledger yang sudah ada tetap dipakai ketika mengakses ledger. Semua write membawa `commandKey`, `companyId`, `dataEpoch`, dan `expectedRevision` pada update. List memakai pagination dengan total; filter/sort di-whitelist.

| Method/path relatif                            | Fungsi                                                                           |
| ---------------------------------------------- | -------------------------------------------------------------------------------- |
| `GET/POST /customers`                          | Cari/daftar dan create pelanggan.                                                |
| `GET/PATCH /customers/{id}`                    | Detail dengan summary/history dan edit.                                          |
| `POST /customers/{id}/archive` atau `/restore` | Lifecycle pelanggan.                                                             |
| `GET/PUT /settings`                            | Baca/update pengaturan.                                                          |
| `GET/POST /units`, `PATCH /units/{id}`         | Daftar/tambah/edit/arsip satuan; default diubah melalui settings.                |
| `GET/POST /invoices`                           | Daftar dan buat draft.                                                           |
| `GET/PATCH /invoices/{id}`                     | Detail dan edit draft.                                                           |
| `POST /invoices/{id}/delete-draft`             | Hapus lunak draft.                                                               |
| `POST /invoices/{id}/issue`                    | Validasi, alokasi nomor, snapshot, status UNPAID.                                |
| `POST /invoices/{id}/duplicate`                | Buat draft baru dari dokumen.                                                    |
| `POST /invoices/{id}/void`                     | Batalkan invoice UNPAID, alasan wajib.                                           |
| `POST /invoices/{id}/mark-paid`                | Pelunasan penuh dan ledger atomik.                                               |
| `POST /payments/{id}/correct`                  | Koreksi salah pencatatan, alasan wajib.                                          |
| `GET /summary`                                 | Total/count unpaid, overdue, paid; serverDate, timezone dan computedAt.          |
| `GET /reminders`, `POST /reminders/read`       | Reminder pengguna dan tanda sudah dibaca.                                        |
| `GET /invoices/{id}/document`                  | View model dokumen tervalidasi untuk preview/render; tidak menerima HTML mentah. |

API logo berada pada domain company dan tetap tersedia ketika modul invoice dinonaktifkan:

| Method/path                                       | Fungsi                                                                                                                                            |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PUT /api/jornal/companies/{id}/logo`             | Multipart file + `revision` company + `requestId`; validasi/normalisasi gambar, buat aset baru, lalu update pointer logo dan audit secara atomik. |
| `DELETE /api/jornal/companies/{id}/logo`          | `revision` + `requestId`; lepas pointer aktif, simpan audit, pertahankan aset yang masih direferensikan invoice.                                  |
| `GET /api/jornal/companies/{id}/assets/{assetId}` | Baca aset versi tertentu setelah auth/ownership; mendukung logo aktif dan snapshot historis.                                                      |

Normalisasi gambar berlangsung sebelum transaksi DB melalui handler media server yang terautentikasi; pemeriksaan ownership/status/revision diulang ketika commit. PocketBase tidak menerima metadata file yang hanya dipercaya dari client. Upload gagal/konflik membersihkan staging asset tanpa mengubah logo aktif. Key retry dan hash file/payload diperiksa agar retry tidak menggandakan aset/perubahan revision. Respons mutation mengembalikan DTO company terbaru dan metadata aset; hash/revision menjadi cache key tanpa token permanen dalam URL. Untuk tampilan client, ambil file melalui authenticated request lalu object URL yang dibersihkan setelah tidak dipakai.

Ekspor melewati server Bun di `/api/invoice-files/{id}?company=...&epoch=...&revision=...&format=pdf|png`. Server meneruskan autentikasi pengguna ke endpoint document PocketBase, bukan memakai akses superuser umum. Tidak menaruh bearer token dalam URL.

Kontrak error: 400 data invalid, 401 sesi tidak valid, 404 resource tidak berada dalam scope, 409 revision/epoch/state/command conflict, 413 batas data, 429 rate limit. Response memuat kode terstruktur dan field errors. Error tidak mengungkap tenant/company lain.

Contoh command pembayaran:

```json
{
  "commandKey": "<uuid-stabil-per-aksi>",
  "companyId": "<company-id>",
  "dataEpoch": 1,
  "expectedRevision": 3,
  "paidOn": "2026-09-17",
  "accountId": "<account-app-id>",
  "paymentMethod": "BANK_TRANSFER",
  "reference": "TRX-123",
  "mode": "CREATE"
}
```

Mode `LINK_EXISTING` menambahkan `transactionId` dan `expectedTransactionRevision`; paidOn/account diturunkan dari transaksi tersimpan. Jangan menerima nominal pembayaran bebas: server mengambil grand total invoice.

Aturan idempotency:

- Hash mencakup action, resource ID, scope, revision yang diminta, dan payload bisnis ter-normalisasi.
- Key yang sama dan hash sama mengembalikan hasil awal setelah auth/scope diperiksa.
- Key sama dengan payload/action/resource berbeda menghasilkan 409.
- Replay diperiksa ulang di dalam transaksi, bukan hanya sebelum transaksi. Unique index menjadi pelindung terakhir.
- Key berbeda pada invoice yang telah lunas menghasilkan 409 `ALREADY_PAID` beserta cara memuat kondisi terbaru, tanpa ledger baru.
- Command pembayaran tidak otomatis dipangkas saat masih menjadi acuan payment/audit. Client menyimpan key selama retry, termasuk setelah timeout/reload.

## 7. Mark paid → cashflow

### 7.1 Write server dalam satu transaksi

1. Autentikasi, cek feature flag, validasi bentuk command; masuk transaksi DB.
2. Validasi tenant/company ACTIVE/data epoch; cek replay command di dalam transaksi.
3. Muat invoice, bandingkan revision, pastikan UNPAID dan belum ada payment aktif.
4. Validasi tanggal pembayaran nyata (`issueDate <= paidOn <= today` untuk flow biasa), rekening company, dan payment method. Backdate sebelum issue date hanya melalui flow impor/koreksi yang belum tersedia; jangan diam-diam diterima.
5. Jika account tracking aktif, accountId wajib. Jika nonaktif, accountId boleh null dan penerimaan tetap masuk cash position global. Account yang hanya lokal dan belum tersinkron harus disinkronkan terlebih dahulu.
6. Mode CREATE: simpan transaksi `MONEY_IN`, amount = grandTotal, classification = `REVENUE`, classificationSource = `SYSTEM`, businessRelevance = `BUSINESS`, reviewStatus = `ACCEPTED`; isi seluruh metadata invoice dan histori ledger yang diperlukan.
7. Mode LINK_EXISTING: hanya terima transaksi `MONEY_IN/REVENUE`, IDR, amount sama persis, epoch/company sama, tanggal valid, tidak terhubung invoice/tax/receivable/transfer, dan revision cocok. Tambahkan link tanpa menambah kas atau mengganti tanggal. Simpan snapshot sebelum link.
8. Simpan payment ACTIVE, status invoice PAID, paid_at dan revision baru; resolve seluruh reminder aktif invoice tersebut.
9. Simpan audit dan response command termasuk invoice, payment, ledger envelope/revision dan history. Commit seluruh perubahan bersama.
10. Setelah commit, refresh query/cache dan ringkasan. Tidak ada HTTP rendering, email, atau pekerjaan lama di dalam transaksi DB.

PocketBase mendokumentasikan `runInTransaction` untuk commit/rollback beberapa operasi; seluruh akses DB di callback harus memakai instance `tx`, bukan `$app` global. [Dokumentasi transaksi PocketBase](https://pocketbase.io/docs/js-database/).

### 7.2 Pembaruan client segera setelah respons

- Client menunggu commit server sebelum menampilkan PAID atau kas bertambah.
- Terapkan ledger envelope hasil server lewat fungsi khusus, misalnya `applyInvoiceLedgerCommit`; jangan memanggil `createTransaction()` lagi karena akan membuat ID/outbox baru.
- Fungsi itu menyimpan transaction/history/revision hasil server ke scope yang ditangkap saat command dimulai; tidak mengganti seluruh array transaksi dan tidak menghapus edit lokal lain.
- Setelah merge, emit financial event yang sesuai dan invalidate invoice/customer/summary/Home/account/Insights/forecast/tax sesuai dampaknya.
- Untuk tab/perangkat lain, refetch saat focus dan polling interval terbatas; gunakan notifikasi internal lintas tab untuk mempercepat pembaruan. Query key wajib tenant + company + epoch.
- Jika respons hilang sesudah commit, retry key yang sama mengambil hasil awal. Tampilkan “Memeriksa hasil pembayaran” selama status belum pasti.
- Jika pembayaran sukses tetapi penyimpanan cache gagal, tampilkan status server, tandai cache perlu refresh, dan muat ulang ledger; jangan mencoba pembayaran baru.

### 7.3 Kas bruto, omzet, dan pajak invoice

Kas dan saldo rekening bertambah sebesar grandTotal. Untuk invoice dengan pajak tambahan, simpan `invoiceRevenueAmount = subtotal - discount + shipping` dan `invoiceTaxAmount = taxAmount`. Ini pemisahan komponen dokumen, bukan keputusan otomatis tentang kewajiban pajak pengguna.

Buat satu helper agregasi omzet untuk transaksi; transaksi lama tanpa metadata memakai amount seperti sebelumnya. Migrasikan pembacaan omzet langsung di `tax.ts`, `trends.ts`, Home, Insights, dan `tax-compliance-panel.tsx` ke helper yang sama. Agregasi kas tetap memakai amount bruto. Telusuri query backend/input period pajak agar tidak ada komponen omzet yang dihitung dengan aturan berbeda. Perubahan metadata pada LINK_EXISTING harus terlihat pada preview pengguna karena dapat mengubah agregasi omzet walau saldo kas tetap sama.

Invoice unpaid tidak menambah Safe to Spend. Jika dimasukkan ke forecast, tampilkan sebagai estimasi penerimaan yang terpisah dan opsional; jangan menghitungnya dua kali setelah ada payment. Integrasi forecast invoice belum menjadi syarat versi pertama.

### 7.4 Koreksi salah pencatatan lunas

Aksi **Koreksi Pembayaran** meminta alasan dan preview dampak, lalu command transaksional:

- Jika origin CREATED: payment menjadi REVERSED, ledger dibuat tombstone dengan protokol sync/history yang berlaku, invoice kembali UNPAID. Snapshot/audit transaksi tetap tersedia. Ini menghapus pencatatan yang keliru dari kas aktual, bukan mencatat refund nyata.
- Jika origin LINKED: lepaskan link dan pulihkan metadata transaksi sebelum linking setelah revision diperiksa; transaksi pemasukan asli tetap ada sehingga kas tidak berkurang. UI menyatakan bahwa pembayaran dilepas dari invoice, uang masuk tetap tercatat.
- Nomor dan snapshot invoice tidak berubah. Naikkan payment cycle untuk dedupe reminder berikutnya.
- Payment baru setelah koreksi memakai ID/command baru dan tidak menghidupkan ledger lama dari outbox.
- Tolak pengubahan/deletion langsung melalui raw ledger API, import backup lokal, edit massal, classify/review, duplicate transaction, dan client lama. Proteksi harus melihat record lama dan link server, bukan hanya field kiriman yang bisa dihapus client.

## 8. Desain invoice: kesamaan dengan Dropify

### 8.1 Kontrak visual

Port markup/CSS template order ke komponen `InvoiceDocument` dengan CSS khusus yang terisolasi dari Tailwind/global stylesheet. Struktur visual berikut wajib dipertahankan:

| Elemen         | Nilai dari template Dropify                                                               |
| -------------- | ----------------------------------------------------------------------------------------- |
| Kertas         | A4 portrait 210 × 297 mm, putih; padding 8 mm 21 mm 16 mm.                                |
| Font           | Poppins, bobot 400–900; sediakan font lokal yang sama untuk client dan renderer.          |
| Teks dan aksen | Teks `#111111`, hitam `#000000`, bidang abu-abu `#d9d9d9`, aksen `#1d73e8`.               |
| Header         | Logo kiri maksimal 82 × 24 mm; judul INVOICE kanan, 60 px, bobot 900.                     |
| Informasi      | Penerima kiri; dua kotak tanggal kanan selebar 48 mm, label No/Tgl/Jatuh Tempo.           |
| Pelanggan      | Label Kepada, nama 23 px bobot 900, telepon, alamat berurutan seperti Dropify.            |
| Tabel          | NO, DESKRIPSI, JUMLAH, HARGA, TOTAL; harga rata kanan, jumlah beserta satuan rata tengah. |
| Kolom          | Nomor 14 mm, jumlah 37 mm, harga/total masing-masing 36 mm; deskripsi mengisi sisanya.    |
| Baris          | Minimum 3 baris tampak; isi baris kosong untuk 1–2 item seperti referensi.                |
| Compact        | Berlaku mulai 4 item; salin ukuran compact dari template.                                 |
| Ringkasan      | Pembayaran/pengiriman di kiri; total, diskon, pengiriman opsional, pajak di kanan.        |
| Grand total    | Bar abu-abu dengan label Total Keseluruhan.                                               |
| Footer         | Konfirmasi Pembayaran + telepon kiri, email biru kanan.                                   |

Default dokumen tidak memakai watermark Jornal, font Mulish aplikasi, aksen violet form manual, atau desain kartu baru. Konten brand tetap identitas company pengguna, bukan merek Dropify. Invoice lunas mempertahankan desain dokumen; badge status lunas berada di toolbar aplikasi. Draft dan dokumen batal diberi penanda agar tidak keliru dianggap invoice aktif.

### 8.2 Renderer bersama

Keputusan: satu view model dan satu komponen HTML/CSS untuk preview, PNG, dan PDF. Renderer server berbasis Chromium menghasilkan file dari HTML yang sama. Tidak membuat ulang dokumen memakai koordinat Canvas/Pillow karena font dan wrapping dapat berbeda dari template.

- Shared component menerima snapshot data terverifikasi; tidak mengakses auth/store/client hooks.
- Worker render memakai `renderToStaticMarkup`, stylesheet yang sama, dan aset/font lokal. Pin versi template, font, browser, dan dependency.
- PDF: A4, printBackground aktif, ukuran CSS diutamakan, margin browser nol, tanpa header/footer browser.
- PNG satu halaman: target 1240 × 1754 untuk menyamai dimensi Dropify; bila rasterisasi awal berbeda, resize secara deterministik dengan rasio yang benar.
- Tunggu fonts ready dan seluruh gambar selesai decode sebelum render.
- Preview mobile menskalakan kertas, bukan mengubah susunan kolom dokumen; sediakan zoom.
- Tombol dan app shell tidak masuk file; MIME, nama file aman, dan Content-Disposition benar.

Playwright menyediakan `page.pdf()` berbasis print CSS dan screenshot untuk raster. Pengaturan media dan warna harus eksplisit supaya PDF/PNG tidak berbeda hanya karena default print. [Dokumentasi Page Playwright](https://playwright.dev/docs/api/class-page).

### 8.3 Banyak item dan teks panjang

Template asli menghindari pemisahan seluruh tabel saat print, sedangkan renderer PNG Dropify memiliki canvas tetap dan membatasi teks. Jangan membawa pemotongan data tersebut ke Jornal.

- Fixture 1–3 dan 4–6 item harus cocok dengan dokumen asli dalam area dan ukuran yang sama.
- Jika melebihi satu halaman, paginasi eksplisit ke beberapa A4 dengan header tabel diulang; baris tidak terpotong kecuali satu baris sendiri melebihi tinggi area halaman, yang harus ditangani sebagai blok lanjutan.
- Grand total dan footer ditempatkan di halaman terakhir; jangan menumpuk di atas item. Breakpoint halaman dihitung setelah font dan gambar siap.
- PDF mengandung seluruh halaman. PNG multipage menghasilkan satu file per halaman, misalnya `invoice-001-01.png`; UI menyebut jumlah file. Unduh Semua boleh berupa ZIP; jangan hanya mengekspor halaman pertama.
- Untuk file share terlalu besar, tawarkan PDF atau PNG per halaman; tidak memotong isi atau menurunkan kualitas diam-diam.
- Tentukan maksimum 20 halaman/file dalam spike; input yang melampaui kapasitas dokumen ditolak sebelum terbit dengan pesan perbaikan, agar invoice terbit selalu dapat diekspor.

Preflight pagination dilakukan sebelum transaksi issue, dengan snapshot dan content hash draft. Saat commit, server memeriksa revision/hash tersebut masih sama; jika draft berubah selama preflight, tolak dengan conflict dan ulangi validasi. Jangan menjalankan Chromium saat memegang transaksi database.

### 8.4 Verifikasi visual wajib

Tahap pertama membuat fixture sintetis yang sama pada Dropify dan Jornal: tanpa logo, logo, 1/3/4/6 item, 30/100 item, alamat/deskripsi panjang, satuan campuran, diskon/ongkir/pajak, dan beberapa rekening pembayaran.

Simpan baseline render HTML/PDF dari template order Dropify dan versi commit/font/browser dalam `docs/invoice/reference/`. Render PNG Pillow Dropify dicatat sebagai referensi sekunder; HTML invoice order menjadi sumber visual utama jika keduanya berbeda. Tidak menggunakan data pelanggan asli.

Gate visual: ukuran kertas, teks, warna dan urutan sama; landmark layout berbeda maksimal 1 CSS px pada lingkungan render yang dipin; screenshot diff fixture normal target <= 0,5% setelah menormalisasi data dinamis. Perbedaan anti-alias kecil dapat dicatat, tetapi bukan alasan menerima font, wrapping, atau spacing salah. Periksa semua halaman PDF dan PNG secara visual dan dengan text/total assertions. Multipage adalah perluasan yang harus didokumentasikan karena referensi asli tidak mendefinisikannya dengan aman.

## 9. Deployment renderer dan berbagi file

### 9.1 Runtime

Tambahkan worker renderer terpisah berbasis image Debian/Ubuntu yang didukung Chromium. Runtime Jornal/PocketBase tetap mengikuti Dockerfile sekarang. Jangan memasukkan dependency browser langsung ke PocketBase JSVM atau mengasumsikan image Alpine saat ini sudah dapat menjalankan Chromium.

Deliverable: `services/invoice-renderer/` dengan package/lock, renderer, health endpoint, Dockerfile, serta `docker-compose.invoice.yml` sebagai contoh deployment Jornal + renderer. Versi dependency disamakan/pin dengan harness visual. Komponen dokumen shared dibundel saat build worker; frontend tidak mengimpor kode server.

- Renderer hanya dapat dijangkau jaringan internal dengan shared secret dari server Bun; port tidak dipublikasikan.
- Bun memverifikasi invoice melalui PocketBase menggunakan sesi pengguna, lalu mengirim snapshot + asset bytes tervalidasi ke renderer. Worker tidak menerima arbitrary URL/HTML dari browser.
- Batasi network egress browser render; blok semua request eksternal, gunakan aset lokal/inline. Jalankan browser tanpa akses volume PocketBase atau secret aplikasi.
- Gunakan browser context baru per job, concurrency awal 2, antrean terbatas, timeout awal 30 detik; tutup context setelah sukses maupun gagal.
- Rate limit per pengguna/company dan batas ukuran output awal 20 MB; nilai disesuaikan dari fixture maksimal pada spike, sebelum release.
- `Cache-Control: private, no-store` untuk response file; PWA tidak memasukkannya ke cache bersama. Jika ada cache server, key wajib scope + revision/content hash + template/font version dan file tetap diperiksa kepemilikannya.
- Jangan mencatat nama/alamat/file contents/token di log; cukup request ID, scope opaque, duration, format, dan error code.
- Uji build serta smoke render pada linux/amd64 dan linux/arm64. Ini gate eksplisit karena deployment Jornal saat ini multi-architecture; jangan menganggap tersedianya image untuk kedua arsitektur tanpa membuktikan.
- Bila renderer gagal, invoice/payment tetap bisa dipakai. UI menampilkan ekspor gagal dan tombol coba lagi; print browser tersedia sebagai fallback sekunder, bukan pengganti file PDF yang dijanjikan.

### 9.2 Share UX

1. Pengguna memilih PNG/PDF; client meminta file dan memperlihatkan progres.
2. Setelah file siap, sediakan tombol **Bagikan File** dan **Unduh**. Ini menjaga aksi native share terjadi langsung dari klik pengguna, bukan setelah proses jaringan lama menghabiskan user activation.
3. Cek `navigator.canShare({ files })`; panggil `navigator.share({ files, title })` bila tersedia. Pembatalan oleh pengguna bukan error aplikasi.
4. Jika tidak didukung, unduh file dan jelaskan bahwa file dapat dilampirkan melalui WhatsApp/email secara manual.
5. Untuk PNG multipage, periksa dukungan kumpulan file; jika tidak bisa, tampilkan unduh semua/halaman tertentu atau PDF.
6. Buang object URLs dan buffers setelah selesai/logout/pergantian scope; jangan melaporkan “terkirim ke pelanggan” hanya karena share sheet dibuka.

Web Share membutuhkan dukungan browser, secure context, dan user activation; `canShare` mengecek dukungan file. [Dokumentasi Web Share](https://developer.mozilla.org/en-US/docs/Web/API/Web_Share_API).

## 10. Reminder invoice overdue

Definisi: reminder internal untuk pengguna Jornal. Tidak mengirim pesan ke pelanggan tanpa fitur opt-in terpisah.

- Scheduler PocketBase `jornal-invoice-reminders` berjalan setiap 5 menit. Job menghitung kalender lokal sesuai timezone snapshot invoice, bukan tanggal UTC yang dipotong begitu saja.
- Eligible: company ACTIVE, epoch aktif, invoice UNPAID, dueDate < localToday, setting reminder aktif.
- Default pertama D+1 pukul 09:00; berikutnya D+8, D+15, dan seterusnya selama belum lunas. Hari jatuh tempo sendiri bukan overdue.
- Dedupe key memuat scope/invoice/paymentCycle/scheduleVersion/tanggal jadwal. Unique index mencegah duplikasi akibat job bersamaan atau restart.
- Maksimum satu reminder aktif belum dibaca per invoice. Jika ada reminder aktif, cadence berikutnya memperbarui informasi terakhir; tidak menumpuk badge. Saat sudah dibaca, jadwal berikutnya boleh menghasilkan reminder baru.
- Jika server mati beberapa hari, hasilkan satu catch-up untuk slot terbaru, bukan semua slot yang terlewat. Perhitungan unpaid/overdue tetap benar meskipun scheduler sedang tidak berjalan.
- Tepat sebelum menulis reminder, baca ulang status invoice di transaksi yang sama. Jika pembayaran menang race, jangan membuat reminder baru. Mark paid/void me-resolve reminder dalam transaksi pembayaran/pembatalan.
- Invoice yang kembali UNPAID setelah koreksi mendapat paymentCycle baru; jika overdue, dapat diingatkan lagi pada jadwal berikutnya.
- Mematikan reminder menghentikan jadwal dan menyembunyikan reminder aktif; mengaktifkan kembali menghasilkan paling banyak satu catch-up. Perubahan jam/cadence menaikkan scheduleVersion.
- Archive company menghentikan reminder; restore company menjadwalkan catch-up satu kali bila masih overdue. Logout dan pergantian tenant membersihkan tampilan/cache reminder sebelumnya.

UI: kartu di Home, badge pada menu Invoice, daftar pada halaman Invoice, jumlah hari terlambat, nominal, nama pelanggan, dan aksi buka invoice/mark paid. “Sudah dibaca” hanya memengaruhi notifikasi, bukan status invoice.

Tambahkan admin-only health/run-jobs endpoint dengan lastRunAt, lastSuccessAt, eligible count, failed count, dan lag. Gunakan clock yang dapat diinjeksi untuk tests. Tidak menggunakan browser timer sebagai satu-satunya scheduler.

## 11. Offline, keamanan, dan lifecycle data

### Offline dan cache

- Cache berdasarkan tenant/company/dataEpoch/resource/filter; beri label waktu sinkronisasi terakhir pada summary offline.
- Simpan form belum selesai di IndexedDB sebagai local working draft, dengan ID lokal dan revision dasar. Draft lokal belum memiliki nomor resmi atau status UNPAID.
- Saat online, pengguna menyimpan draft ke server dengan command key stabil. Konflik revision ditampilkan untuk ditinjau; tidak melakukan last-write-wins terhadap dokumen keuangan.
- Mark paid tidak menggunakan optimistic ledger atau antrean offline pada versi pertama. Pesan UI: “Hubungkan internet untuk memastikan pelunasan tercatat satu kali.”
- Cache fallback hanya untuk network failure; jangan fallback ke cache pada 401/403/404, company yang sudah tidak dapat diakses, atau epoch berubah.
- Client menangkap scope di awal request dan memeriksanya saat respons selesai. Respons company A yang selesai setelah pindah ke B hanya boleh memperbarui cache A, tanpa mengubah layar/saldo B.

### Proteksi lintas domain

- Validasi references juga ketika command internal membuat record; request hooks tidak selalu berjalan untuk penyimpanan internal. Helper server menerima transaction app sebagai parameter.
- Guard ledger menolak pemalsuan/pelepasan metadata invoice, perubahan nominal/tanggal/account/classification, dan penghapusan linked transaction dari flow umum.
- Account yang direferensikan setting/invoice payment tidak boleh dihapus tanpa mengganti default atau menyelesaikan relasi. Jangan menganggap `Account` sudah mempunyai status arsip; gunakan lifecycle account yang nyata di repo.
- Field teks selalu plain text yang di-escape; tidak ada `dangerouslySetInnerHTML` untuk data pelanggan. Logo dan export endpoints memeriksa owner setiap akses.
- Endpoint customer, summary, file, dan reminder harus diuji terhadap ID tenant/company lain, termasuk company yang dimiliki pengguna sama.

### Archive, reset, backup

- Company ARCHIVED tetap dapat membaca dan mengunduh invoice; tidak dapat membuat pelanggan, menerbitkan, membayar, atau menjalankan reminder.
- Identitas company dan pointer logo aktif tetap ada setelah reset pembukuan. Aset logo historis dipertahankan selama ada referensi snapshot, termasuk invoice epoch yang diarsipkan.
- Reset company mengikuti konfirmasi existing dan preview jumlah data yang terdampak. Naikkan epoch serta nonaktifkan data invoice/customer/settings/unit/reminder epoch lama dari operasional; retain snapshot/audit/command lama sebagai arsip internal, bukan ikut daftar aktif. Ledger lama mengikuti reset existing. Payment historis diberi lifecycle archived yang tidak lagi ditafsirkan sebagai ledger aktif.
- Counter dan nomor terbit tidak digunakan ulang setelah reset. Seed settings/unit baru untuk epoch baru. Pending draft/request epoch lama dikarantina, tidak disinkronkan ke epoch baru.
- Tambahkan paket backup domain terversi yang memuat customer, invoice, settings, units, identitas/pointer logo company, company assets yang direferensikan, payment, audit, dan ledger/history yang terkait. Restore memetakan ulang ID aset dan memverifikasi checksum; preview restore memperlihatkan apakah logo aktif company akan diganti. Hasil ekspor PNG/PDF dapat dibuat ulang dan bukan data utama backup.
- Restore melewati server: dry-run mapping scope/ID, validasi referensi dan checksum aset, dedupe nomor/ID/payment, kemudian commit atomik. Nomor konflik tidak diganti diam-diam pada invoice terbit. Jangan membuat payment aktif tanpa ledger pasangan.
- Backup gabungan disarankan untuk company yang memiliki invoice. Import JSON ledger lama harus menolak orphan metadata invoice dan tidak menimpa transaksi invoice yang dikunci. Backup lama tanpa entitas invoice tetap dapat dipulihkan untuk data biasa.
- Counter setelah restore minimal `max(counterSaatIni, nomorTerbesarDipulihkan + 1)`; reminder yang dipulihkan tidak mengirim backlog ulang. Restore tidak boleh melewati protections hanya karena data berasal dari backup.
- Dokumenkan backup PocketBase volume sebagai recovery operasional penuh; bundle aplikasi dan asset harus diverifikasi sebelum ada destructive reset.

## 12. Peta file implementasi

Nama berikut adalah file yang akan dibuat/diubah, bukan file yang sudah tersedia seluruhnya.

| Area                 | File                                                                                                                                                                                                                                                               |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Domain frontend      | Baru `src/lib/invoice-types.ts`, `invoice-math.ts`, `invoice-client.ts`, `invoice-queries.ts`, `invoice-local-drafts.ts`, `invoice-ledger.ts`, `transaction-revenue.ts`.                                                                                           |
| Company logo         | Ubah `src/lib/types.ts`, `src/lib/companies.ts`, `src/pages/settings-page.tsx`, `companies-page.tsx`, `onboarding-page.tsx`, `src/components/company-switcher.tsx`; baru `src/components/company-logo.tsx`, `company-logo-field.tsx`, `src/lib/company-assets.ts`. |
| Ledger               | Ubah `types.ts`, `store.ts`, `pocketbase-sync.ts`, `queries.ts`, `tax.ts`, `trends.ts`; account/safe-to-spend hanya jika perlu integrasi, jangan ganti formula kas tanpa alasan.                                                                                   |
| Halaman              | Baru `customers-page.tsx`, `customer-form-page.tsx`, `customer-detail-page.tsx`, `invoices-page.tsx`, `invoice-form-page.tsx`, `invoice-detail-page.tsx`, `invoice-preview-page.tsx`, `invoice-settings-page.tsx`.                                                 |
| Komponen             | Baru `src/components/invoices/{customer-picker,line-items-editor,mark-paid-dialog,invoice-summary,invoice-reminders,invoice-share-dialog}.tsx`.                                                                                                                    |
| Shared document      | Baru `shared/invoice-document/{invoice-document.tsx,invoice-document.css,view-model.ts,pagination.ts}`; tsconfig/bundler disesuaikan untuk shared import.                                                                                                          |
| Font                 | Baru `public/fonts/poppins/` dengan font/license yang tervalidasi; worker menggunakan aset yang sama.                                                                                                                                                              |
| Navigasi/UI existing | Ubah `router.tsx`, `app-shell.tsx`, Home, Settings, transaction detail/form/list, Insights, `tax-compliance-panel.tsx`.                                                                                                                                            |
| Backend              | Baru `pb_hooks/invoices.pb.js`, `invoice_helpers.js`, `invoice_math.js`, `invoice_jobs.js`, `invoice_jobs.pb.js`, `company_assets.pb.js`; migrasi company logo dan invoice, serta handler normalisasi gambar server pada `server.ts`/modul media terpisah.         |
| Guard/lifecycle      | Ubah `jornal_helpers.js`, `jornal_sync.pb.js`, `companies.pb.js`, `company_helpers.js` (DTO/audit logo) dan helper lifecycle terkait seperlunya.                                                                                                                   |
| Renderer             | Baru `services/invoice-renderer/*`, `docker-compose.invoice.yml`; ubah `server.ts` untuk proxy ekspor terautentikasi.                                                                                                                                              |
| Build/config         | `package.json`, lockfile, `Dockerfile` build args UI, `.env.example`, `vite.config.ts`, konfigurasi CI dan Playwright.                                                                                                                                             |
| Bukti dan operasi    | Baru `docs/invoice/reference/`, `INVOICE_RUNBOOK.md`, `INVOICE_EVIDENCE.md`.                                                                                                                                                                                       |

## 13. Tahapan eksekusi dan exit criteria

Kerjakan berurutan sesuai dependensi. Task belum boleh ditandai selesai hanya karena UI tampil; exit criteria mencakup perilaku data yang bersangkutan. Estimasi kasar satu engineer: 20–30 hari kerja, terutama tergantung renderer lintas arsitektur dan integrasi sync/backup; bukan komitmen jadwal.

### P0 — Kunci referensi dan uji kelayakan renderer (2–3 hari)

- [x] Audit diff/worktree, simpan daftar baseline dan jalankan checks existing untuk membedakan kegagalan lama.
- [x] Dokumentasikan template/CSS dan buat fixture sintetis renderer.
- [x] Buat shared document + PNG/PDF dari satu HTML pada runtime production candidate.
- [x] Verifikasi font, fixture normal/panjang, ukuran file, dan latency pada runtime lokal yang dipin.
- [x] Verifikasi decoding/normalisasi logo, format palsu/rusak, dimensi, dan ownership.
- [x] Tetapkan fixture, ukuran PNG 1240×1754, batas payload, concurrency, dan timeout berdasarkan bukti.
- Release gate eksternal (bukan gap implementasi): smoke image yang sama pada amd64 dan arm64 target deployment.

Exit: contoh visual cocok baseline dan seluruh teks/angka fixture panjang terbaca; keputusan packaging renderer terdokumentasi. Jika renderer tidak berjalan pada target deployment, selesaikan packaging di fase ini sebelum menjanjikan flow export.

### P1 — Domain, skema, dan kontrak (2–3 hari; setelah P0)

- [x] Definisikan types, state transitions, validasi field, math dan revenue helper.
- [x] Tambah migrasi koleksi/index/rules/counter; uji fresh install dan database existing.
- [x] Tambah migrasi company logo/asset, DTO/parser nullable, kontrak upload/hapus/baca, revision dan retry protection.
- [x] Implementasikan ownership/scope/revision/epoch/idempotency/audit helpers.
- [x] Tetapkan JSON request/response dan error codes; seed company lama/baru idempotent.

Exit: migrasi bisa diterapkan ulang tanpa duplikasi; collection API raw tertutup; test perhitungan dan invariant state lulus.

### P2 — Company Logo, Pelanggan dan Pengaturan Invoice (3–4 hari; setelah P1)

- [x] Customer API: create/list/search/detail/edit/archive/restore, email uniqueness.
- [x] Form/list/detail pelanggan serta integrasi tambah dari picker dengan draft tetap tersimpan.
- [x] Settings/unit API dan UI; default satuan, termin, instruksi pembayaran, nomor awal.
- [x] Implementasi unggah/preview/ganti/hapus logo pada Profil Company serta tampilan daftar/switcher.
- [x] Implementasi asset protected/immutable, retry/failure handling, audit dan lifecycle snapshot.
- [x] Company scoping, offline read state, archived/read-only state.

Exit: logo company bisa diunggah/diganti/dihapus dengan preview dan fallback yang benar; pelanggan dapat diinput lengkap, diedit, dicari, dan dipilih; setting/logo company A tidak memengaruhi B; default Lusin diterapkan pada baris baru tanpa mengubah data lama.

### P3 — Draft, terbit, detail, dan total unpaid (2–3 hari; setelah P2)

- [x] Implementasi draft CRUD, local working draft, issue/duplicate/void.
- [x] Counter server atomik dan snapshot pelanggan/pengirim/satuan/payment instructions.
- [x] Invoice list/detail/form dan summary server across pagination.
- [x] Preview menggunakan shared document dan batas dokumen.
- [x] Sambungkan customer history serta unpaid totals per pelanggan.

Exit: dua penerbitan bersamaan mendapat nomor berbeda; invoice terbit tetap sama setelah master berubah; draft/void tidak masuk unpaid; invoice unpaid tidak menambah kas.

### P4 — Pelunasan, ledger, dan koreksi (3–4 hari; setelah P3)

- [x] Implementasi mark-paid CREATE dan LINK_EXISTING dalam satu DB transaction.
- [x] Simpan revision dan merge server result ke cache ledger tanpa outbox baru.
- [x] Implementasi guard semua jalur mutasi ledger dan koreksi pembayaran dengan audit.
- [x] Update agregasi omzet bruto/net komponen invoice tanpa mengubah kas bruto.
- [x] Integrasi UI rekening, tanggal, link invoice↔transaksi, dan invalidation angka terkait.

Exit: double-click, retry timeout, dua perangkat, konflik revision, kegagalan di tengah transaksi, dan koreksi tidak menggandakan/menghilangkan kas; test integration memakai PocketBase nyata.

### P5 — Ekspor dan share production (2–3 hari; setelah P3 dan renderer P0)

- [x] Finalisasi shared template, pagination, asset loading dan document version/hash.
- [x] Deployable worker, Bun auth proxy, batas resource/rate limit dan no external fetch.
- [x] Export PDF/PNG, nama file, error/retry, native share dan download fallback.
- [x] Renderer smoke normal/panjang pada lingkungan pin; cek signature, dimensi, dan tidak terpotong.
- Release gate eksternal (bukan gap implementasi): uji native file share pada iOS/Android browser target.

Exit: dokumen mengikuti Dropify dan tidak terpotong; file dapat dibuka/diunduh/dibagikan; export resource company lain ditolak; aplikasi keuangan tetap hidup ketika renderer mati.

### P6 — Reminder overdue (1–2 hari; setelah P4)

- [x] Job scheduler, timezone math, cadence/catch-up/dedupe, dan health endpoint.
- [x] Transaksi resolve pada paid/void serta handling race job/payment.
- [x] Home/menu badge/inbox invoice, mark read dan setting reminder.
- [x] Test restart/catch-up, archive/reset, dan koreksi pembayaran.

Exit: due hari ini tidak overdue; D+1 membuat satu reminder; lunas menghapus reminder aktif; restart tidak menghasilkan spam.

### P7 — Backup, lifecycle, kompatibilitas (2–3 hari; setelah P4/P6)

- [x] Backup bundle, dry-run restore, asset checksums, ID/account mapping dan counter preservation.
- [x] Company reset/archive, epoch quarantine, migration seed, dan cache cleanup.
- [x] Proteksi client lama, ledger import, duplicate/classification dan stale outbox replay.
- [x] Logout mencabut push dan hasil command/render tetap terikat scope server.

Exit: restore mempertahankan invoice-payment-ledger link tanpa kas ganda; reset tidak menghidupkan invoice epoch lama; flow tax/receivable lama tetap lulus regression.

### P8 — Release verification dan runbook (2–3 hari; setelah semua fase)

- [x] Jalankan test suite existing + baru, E2E, visual QA dan renderer smoke.
- [x] Uji dataset 10.000 invoice untuk summary/pagination dan reminder pagination; catat durasi.
- [x] Tambahkan dokumentasi fitur, feature flags, deployment renderer, backup/recovery, koreksi pembayaran dan reminder health.
- [x] Simpan evidence per gate dan batasan browser di `INVOICE_EVIDENCE.md`.
- Release gate operator (bukan gap implementasi): aktifkan pada company uji dan rollout manual sesuai prosedur deployment.

Exit: seluruh acceptance criteria berikut terpenuhi, tidak ada invariant finansial/isolasi yang gagal, dan bukti render serta test tersedia.

## 14. Test matrix dan acceptance criteria

| ID  | Skenario                                                                    | Hasil wajib                                                                                              |
| --- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| G01 | Upload PNG/JPEG/WebP valid dari profil company                              | Preview rasio asli, simpan, lalu logo tampil pada profil/daftar/switcher dan invoice baru.               |
| G02 | File >2 MB, format palsu/rusak, SVG, animasi, dimensi ekstrem               | Ditolak server dengan pesan yang jelas; logo aktif tidak berubah.                                        |
| G03 | Ganti/hapus logo setelah invoice terbit                                     | Profil dan draft baru mengikuti perubahan; preview/PNG/PDF invoice lama tetap menggunakan snapshot lama. |
| G04 | Upload timeout, retry, konflik revision atau pengguna batal                 | Tidak ada duplikasi command/perubahan logo yang salah; logo lama tetap saat gagal, staging dibersihkan.  |
| G05 | Company A/B, archived company, logout saat upload                           | Tidak bocor/tertukar; arsip read-only; respons lama tidak mengubah scope aktif.                          |
| G06 | Invoice flag off atau worker export mati                                    | Company logo tetap dapat dikelola; logo bukan fitur yang hanya hidup di modul invoice.                   |
| G07 | Reset pembukuan dan backup/restore                                          | Logo aktif tetap setelah reset; aset aktif/historis dan checksum dipulihkan dengan referensi yang benar. |
| G08 | Company lama/tanpa logo, draft tersimpan ketika logo berubah                | Fallback nama company; draft tidak berubah diam-diam dan dapat memilih logo terbaru.                     |
| C01 | Tambah pelanggan semua field Dropify                                        | Persist dan tampil lengkap pada detail/picker.                                                           |
| C02 | Nama wajib, email kosong/duplikat, kode pos nol depan                       | Validasi benar, email opsional tidak bentrok, kode pos tetap string.                                     |
| C03 | Edit/arsip pelanggan setelah invoice terbit                                 | Dokumen/history tetap utuh; pelanggan arsip tidak bisa dipilih untuk invoice baru.                       |
| I01 | Terbit 2 Lusin × 100.000                                                    | Total 200.000; tidak ada konversi 12× dan tidak ada transaksi kas.                                       |
| I02 | Default satuan diubah pcs→Kodi                                              | Baris baru Kodi; baris lama dan invoice terbit tetap.                                                    |
| I03 | Dua client issue bersamaan/retry                                            | Nomor unique; satu command tidak membuat dua invoice/nomor.                                              |
| I04 | Diskon/ongkir/pajak/quantity pecahan                                        | Frontend dan backend sama hingga rupiah; nilai invalid/overflow ditolak.                                 |
| I05 | Invoice lebih dari satu halaman                                             | Semua item/angka masuk PDF dan PNG; tanpa overlap/footer terpotong.                                      |
| S01 | Dataset unpaid 1 juta + overdue 500 ribu + paid 200 ribu + draft 300 ribu   | Unpaid 1,5 juta/count 2; overdue 500 ribu/count 1; hasil tidak berubah karena pagination.                |
| P01 | Mark paid invoice 1 juta, saldo awal 2 juta                                 | Tepat satu MONEY_IN; saldo 3 juta; unpaid turun 1 juta tanpa reload manual.                              |
| P02 | Double-click, retry setelah commit-response hilang                          | Satu payment aktif dan satu ledger transaction.                                                          |
| P03 | Dua device mark paid dengan command berbeda                                 | Satu sukses, satu conflict; saldo naik sekali.                                                           |
| P04 | Failure setelah ledger save sebelum status update                           | Rollback seluruh write; tidak ada PAID tanpa ledger atau ledger tanpa payment.                           |
| P05 | Pelunasan backdate                                                          | Cashflow berada pada tanggal penerimaan, bukan issue date/createdAt; future date ditolak.                |
| P06 | Account belum sync/beda company                                             | Pembayaran ditolak tanpa side effect; user dapat sync lalu retry.                                        |
| P07 | LINK_EXISTING valid/amount beda/already linked                              | Yang valid melunasi tanpa kas baru; lainnya ditolak.                                                     |
| P08 | Correct CREATED dan LINKED                                                  | CREATED membatalkan ledger keliru; LINKED mempertahankan kas asli; audit terisi.                         |
| P09 | Edit/delete/duplicate/reclassify linked transaction via raw API/client lama | Ditolak server; metadata tidak dapat dibuang untuk bypass.                                               |
| P10 | Invoice bertotal 110 ribu dengan base 100 ribu + tax 10 ribu                | Kas +110 ribu; helper komponen omzet +100 ribu; transaksi lama tetap dihitung dengan aturan existing.    |
| R01 | Due hari ini vs kemarin pada timezone invoice                               | Hanya kemarin overdue, termasuk di sekitar pergantian tanggal UTC.                                       |
| R02 | Job diulang/restart/downtime 3 minggu                                       | Tidak menduplikasi slot, maksimum satu catch-up aktif per invoice.                                       |
| R03 | Pembayaran bersamaan dengan job                                             | Tidak tersisa reminder aktif untuk invoice PAID.                                                         |
| R04 | Reminder dimatikan/diaktifkan, archive/restore                              | Jadwal sesuai setting tanpa backlog spam.                                                                |
| V01 | Fixture normal/compact dibandingkan Dropify                                 | Layout/font/warna/label memenuhi gate visual, bukan sekadar “mirip”.                                     |
| V02 | Export PDF/PNG dan multipage                                                | MIME valid, filename aman, jumlah halaman dan total benar.                                               |
| V03 | Share unsupported/cancel/error                                              | Download tetap ada; cancel bukan error; tidak mengklaim pesan terkirim.                                  |
| A01 | Tenant/company ID lain pada seluruh API/file                                | Tidak ada kebocoran data atau agregat.                                                                   |
| A02 | Switch company/logout selama request                                        | Response lama tidak mengubah tampilan atau saldo scope baru.                                             |
| L01 | Reset company dan replay command/outbox epoch lama                          | Tidak menghidupkan data lama; nomor tidak diulang.                                                       |
| L02 | Backup/restore dua kali                                                     | Tidak menduplikasi invoice/payment/ledger; logo/snapshot tetap.                                          |
| L03 | Regression tax, receivable, saldo, sync, Safe to Spend                      | Perilaku existing tetap benar.                                                                           |

Lokasi test baru:

- `src/lib/invoice-math.test.ts`, `invoice-client.test.ts`, `invoice-ledger.test.ts`, `transaction-revenue.test.ts`.
- `backend/pocketbase/tests/company_assets.integration.test.ts`, `e2e/company-logo.e2e.ts` untuk ownership, validasi file, retry, snapshot retention, dan alur profil company.
- `backend/pocketbase/tests/invoice_invariants.test.ts`, `invoice_api.integration.test.ts`, `invoice_jobs.test.ts`, `invoice_migration.integration.test.ts`.
- `e2e/invoices.e2e.ts`, `e2e/customers.e2e.ts`, `e2e/invoice-visual.e2e.ts`.
- Fixture payment race/rollback harus memakai DB dan endpoint PocketBase nyata; mock-only tidak memenuhi gate finansial.

Commands existing untuk baseline/regression:

```bash
bun run lint
bun run test
bun run typecheck
bun run build
bun run test:tax:integration
bun run test:tax:e2e
```

Commands yang harus ditambahkan, lalu benar-benar dijalankan saat implementasi:

```bash
bun run test:invoice:integration
bun run test:invoice:e2e
bun run test:invoice:visual
bun run test:invoice:renderer
```

Harness integration memakai PocketBase versi yang dipin repo, database sementara, fixture tenant/company, clock deterministik, dan fault injection di batas transaksi. Harness renderer/visual menyimpan artifacts diff/PNG/PDF pada direktori test khusus; tidak menghubungkan tests ke database pengguna.

## 15. Rollout, operasi, dan kriteria selesai

Flags usulan:

- `VITE_INVOICES_ENABLED`: UI build-time.
- `JORNAL_INVOICES_ENABLED`: runtime untuk write domain; read/history tetap dapat diakses saat write dipause.
- `JORNAL_INVOICE_REMINDERS_ENABLED`: kill switch scheduler.
- `JORNAL_INVOICE_EXPORT_ENABLED`: kill switch renderer/proxy export.
- `INVOICE_RENDERER_URL`, `INVOICE_RENDERER_SECRET`: konfigurasi server, tidak memakai prefix `VITE_` dan tidak masuk client bundle.

Urutan rollout: backup volume → migrasi additive → backend/guards compatible → renderer → UI → company uji → reminder → perluas pemakaian. Backend lama yang belum memahami proteksi ledger invoice tidak boleh dipasang kembali di atas database yang sudah menerima pembayaran invoice; rollback UI/write flags lebih aman dan tetap membutuhkan backend/guards yang kompatibel.

Pantau command conflict/replay, failed payment commands, unpaid aggregate mismatch, orphan link count (harus 0), reminder lag/dedupe, renderer duration/failure/memory, dan hasil backup verification. Tambahkan pemeriksa invariant read-only untuk payment-ledger linkage; jangan memperbaiki nominal secara otomatis tanpa command koreksi yang dapat diaudit.

Fitur selesai ketika seluruh kebutuhan pengguna pada §1 tersedia, logo dapat dikelola dari profil company dan dipakai konsisten oleh invoice, input pelanggan mengikuti Dropify, dokumen lulus perbandingan visual, pembayaran terbukti atomik dan tidak ganda, reminder bekerja tanpa browser terbuka, file PNG/PDF dapat dibagikan/diunduh, serta backup/lifecycle dan regression existing lulus. Tunda fitur cicilan, email pelanggan, public invoice link, stok, dan faktur pajak ke rencana terpisah agar definisi selesai tetap jelas.

## 16. Rujukan

- Kode Jornal dalam workspace ini, khususnya file pada §2 dan §12.
- [Template invoice order Dropify](../../dropify-engine/app/templates/dashboard/invoice.html).
- [Renderer PNG Dropify](../../dropify-engine/app/services/invoice_png.py).
- [Form pelanggan Dropify](../../dropify-engine/app/templates/dashboard/customers/form.html).
- [Model pelanggan Dropify](../../dropify-engine/app/models/customer.py).
- [Pengaturan Dropify](../../dropify-engine/app/templates/dashboard/settings/index.html).
- [PocketBase: database transaction](https://pocketbase.io/docs/js-database/).
- [Playwright: PDF dan screenshot API](https://playwright.dev/docs/api/class-page).
- [MDN: Web Share API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Share_API).

Dokumentasi eksternal diperiksa 17 September 2026. Pada implementasi, cocokkan API dengan versi dependency yang dipin; jangan meng-upgrade runtime proyek hanya untuk mengikuti contoh dokumentasi terbaru.
