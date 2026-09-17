# Rencana implementasi Team Invitation

Status: **implementasi kode selesai pada 18 September 2026**. Gate otomatis memakai PocketBase 0.40.2 mencakup 101 assertion invitation/API/SMTP/scale, browser flow mobile 360 px, migrasi up/down/up, serta regresi multi-company, invoice, tax, unit, typecheck, lint, dan build. Smoke Google/Mailgun nyata dan rollout P8 tetap langkah operator karena memerlukan akun serta deployment produksi; prosedurnya tersedia di `TEAM_INVITATION_RUNBOOK.md`.

## 1. Hasil dan keputusan produk

Pengguna yang sudah dapat mengelola sebuah company dapat mengundang orang melalui email akun Google. Penerima login dengan akun Google yang sesuai dan langsung melihat company beserta data yang sudah ada. Penerima tidak perlu membuat company atau mengulang onboarding.

Keputusan versi pertama:

1. **Satu jenis anggota, tanpa role/RBAC.** Kata admin berarti anggota company yang sedang mengelola tim. Tidak ada field role, pilihan role, permission matrix, admin khusus, atau viewer. Anggota undangan dapat melakukan semua operasi company yang tersedia bagi pengundang, termasuk mengundang anggota lain, mengubah pengaturan, transaksi, invoice, backup/restore, archive/restore, dan reset dengan konfirmasi yang sudah berlaku.
2. Akses diberikan **per company**. Diundang ke A tidak memberi akses ke B/C milik pengundang. Anggota dapat bergabung dengan company dari beberapa pemilik dan tetap mempunyai company pribadi.
3. Email Gmail dan Google Workspace didukung; tidak membatasi input pada `@gmail.com`. Identitas penerimaan berasal dari hasil Google OAuth yang diverifikasi backend, bukan email kiriman client. Email dinormalisasi `trim + lowercase`; jangan menghapus titik, suffix `+`, atau menyamakan domain alias.
4. Undangan aktif otomatis diterima saat bootstrap setelah autentikasi Google dengan email yang cocok. Berlaku untuk akun baru, akun Jornal lama, serta login langsung tanpa klik email. Jangan membuat user PocketBase sebelum penerima login.
5. Email berisi tautan `/invitations/<publicId>`. Tautan hanya membawa konteks; bukan kredensial pemberi akses. Tidak memerlukan bearer invitation token karena penerimaan tetap harus membuktikan identitas Google yang diundang. ID acak tidak menggantikan pemeriksaan email/membership.
6. Undangan berlaku **7 × 24 jam** dalam UTC. Resend memakai undangan yang sama, menaikkan generation pengiriman, dan memperpanjang kedaluwarsa 7 hari. Undangan yang sudah diterima tidak dapat dikirim ulang.
7. Sertakan daftar anggota, undangan pending, resend, pembatalan undangan, keluar company, dan penghapusan anggota. Semua anggota mempunyai kemampuan yang sama. Anggota aktif terakhir tidak boleh keluar/dihapus; ini menjaga company tetap bisa diakses, bukan role khusus.
8. Onboarding pertama hanya dimulai dari tindakan eksplisit **“Buat company baru”** saat tidak ada undangan aktif/company yang dapat diakses. Undangan kedaluwarsa, akses dicabut, email salah, dan kegagalan jaringan tidak memicu onboarding otomatis. Anggota yang sengaja memilih tambah company tetap memakai wizard pembuatan company baru.
9. Company baru yang dibuat anggota menjadi ruang baru milik pembuatnya; anggota company asal tidak otomatis ikut. Tidak ada sharing seluruh tenant, transfer kepemilikan, SSO lain, bulk invite, atau pengaturan hak akses dalam versi ini.
10. Invite/join membutuhkan koneksi. Pembukuan company yang telah di-cache tetap offline sesuai batas pada bagian 8.

Contoh penerimaan: A mempunyai Dropify dan Toko B. A mengundang B ke Dropify. B masuk dengan email yang diundang, langsung membuka Dropify dengan saldo dan transaksi yang sama; Toko B tidak muncul. Jika B sudah mempunyai Studio B, switcher menampilkan Dropify dan Studio B tanpa menggandakan data mana pun.

## 2. Temuan repository dan email yang sudah tersedia

| Area | Bukti kode saat penyusunan | Konsekuensi implementasi |
| --- | --- | --- |
| Login | `src/lib/pb.ts`, `src/pages/login-page.tsx`: Google OAuth membuat user pada login pertama | Pertahankan OAuth; tambahkan bootstrap undangan sebelum guard onboarding |
| Router | `src/router.tsx`: daftar company kosong langsung diarahkan ke onboarding | Ganti keputusan kosong dengan hasil bootstrap/intent yang eksplisit |
| Katalog company | `src/lib/companies.ts`: native `companies.getFullList()` dan katalog memakai auth user | Katalog baru harus mencakup semua membership aktif, lintas pemilik data |
| Owner company | `20260916_0006_multi_company.js`: `companies.tenant_id` relation ke `users` | Pertahankan ID pemilik data lama; jangan menyalin company ke penerima |
| Otorisasi | Rules ledger dan helper company/invoice/document/tax menyamakan `tenant_id/business_id` dengan `event.auth.id` | Refactor seluruh titik akses, bukan hanya endpoint invite |
| Local store | `store.ts`, `pocketbase-sync.ts`: scope tenant sekaligus identitas login, payload, dan namespace cache | Pisahkan actor, pemilik data, company, epoch, serta versi membership |
| Audit | `company_helpers.js` dan `tax_helpers.js` mengisi `actor_id = tenantId` | Catat user yang melakukan aksi, bukan selalu pemilik asal |
| Pajak | `tax_*` dapat mencakup beberapa company melalui `tax_company_memberships` | Wajib aturan cakupan sumber data; jangan membocorkan company lain lewat subjek pajak |
| Push | `push.pb.js`, `notification_jobs.js`: subscriber disamakan dengan pemilik data | Bedakan penerima notifikasi dari pemilik resource |
| SMTP | `runtime_config.pb.js` sudah mengisi PocketBase SMTP dari environment | Gunakan transport yang ada |
| Pengiriman email | `tax_jobs.js` memanggil `$app.newMailClient().send(new MailerMessage(...))` | Tidak perlu integrasi Mailgun HTTP/API key baru; tambah template dan antrean khusus undangan |
| Deployment email | Manifest lokal cockpit memuat `SMTP_HOST=smtp.mailgun.org`, `SMTP_PORT=1025`, `SMTP_USERNAME=info@mg.dropify.id` | Pakai konfigurasi runtime tersebut; jangan salin password ke rencana/test/source |
| Versi | Dockerfile dan test runner mem-pin PocketBase `0.40.2` | Validasi hooks, rules, SQL, dan OAuth pada binary ini |

**Kesimpulan email:** fasilitas pengiriman sudah ada di kode dan konfigurasi manifest. Pemeriksaan ini tidak membuktikan keterkiriman SMTP produksi. Uji koneksi, autentikasi, sender, dan satu email ke mailbox uji tetap merupakan release gate. Dukungan custom email melalui mail client ini juga dijelaskan dalam [dokumentasi PocketBase](https://pocketbase.io/docs/js-sending-emails/).

Dokumen ini memperluas asumsi user=tenant pada `MULTI_COMPANY_PLAN.md`. Sampai fitur dirilis, perilaku produksi tetap mengikuti implementasi yang ada.

## 3. Identitas dan model akses

Pisahkan empat nilai berikut secara eksplisit:

| Nama | Arti | Sumber authority |
| --- | --- | --- |
| `actorUserId` | User yang login dan melakukan aksi | `event.auth.id` |
| `ownerTenantId` | Pemilik namespace data lama | `companies.tenant_id` dari server |
| `companyId` | Company yang sedang diakses | ID yang kemudian diverifikasi dengan membership |
| `dataEpoch` | Generasi data sesudah reset | `companies.data_epoch` |

`CompanyScope` baru: `{ actorUserId, ownerTenantId, companyId, dataEpoch, membershipRevision }`. Sesudah refactor tidak boleh ada penggunaan `tenantId` yang ambigu di kode baru.

Ketentuan kompatibilitas:

- `companies.tenant_id`, `jornal_records.business_id`, seluruh resource `tenant_id`, dan `payload.businessId` tetap berarti pemilik namespace lama. Untuk company undangan, nilainya **bukan** user yang sedang login.
- ID tersebut bukan hak istimewa. Seluruh user, termasuk pembuat company, membutuhkan membership aktif. Tidak ada fallback `owner == actor` yang melewati pencabutan membership.
- Pembuatan company memberi pembuatnya membership aktif dalam transaksi setup yang sama. Migrasi memberi setiap pemilik lama membership aktif untuk semua company miliknya, termasuk arsip/belum selesai setup.
- `actor_id`, `invited_by`, `accepted_by`, `revoked_by` menunjukkan aktor sesungguhnya. Worker memakai identitas sistem yang eksplisit; jangan memalsukan audit sebagai pemilik.
- Membership melekat pada user ID yang terhubung ke Google identity. Email digunakan untuk pencocokan undangan saja; setelah diterima, perubahan email tidak memindahkan membership ke akun lain. Google merekomendasikan identitas `sub` yang stabil dibanding email sebagai identitas akun: [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect).
- User yang menjadi anchor `tenant_id` tidak boleh di-hard-delete selama masih direferensikan company/data. Fitur ini tidak mengaktifkan penghapusan akun atau mengubah cascade lama. Keluar membership tetap diperbolehkan selama ada anggota lain; anchor tidak memberi akses setelah keluar.

## 4. Skema dan invariants

Tambahkan migrasi berikutnya, usulan `20260918_0011_team_invitation.js` (gunakan nomor berikutnya yang belum dipakai saat implementasi). Semua collection baru bersifat private pada API native kecuali akses yang dinyatakan di bawah. Tidak ada kolom role/permission.

### 4.1 `company_memberships`

Fields: `company_id` relation, `user_id` relation, `status` (`ACTIVE`, `REVOKED`), `joined_at`, `invited_by` nullable, `source_invitation_id` nullable, `revoked_at`, `revoked_by` nullable, `revision`, `created`, `updated`.

- Unique `(company_id, user_id)`; row yang dicabut direaktivasi hanya melalui undangan baru yang sah.
- Index lookup `(user_id, status, company_id)` dan `(company_id, status, created, id)`.
- Membership tidak terikat `data_epoch`: reset data company tidak mengeluarkan tim.
- Update/revoke memeriksa expected revision. Guard jumlah anggota aktif dan perubahan membership dijalankan atomik; dua anggota tidak dapat saling menghapus hingga tidak ada anggota tersisa.
- Keanggotaan tidak dapat diubah lewat JSON backup, generic sync, native API, atau edit user.

### 4.2 `company_invitations`

Fields: `company_id`, `email_normalized`, `public_id` acak minimal 128 bit, `status` (`PENDING`, `ACCEPTED`, `REVOKED`, `EXPIRED`), `invited_by`, `accepted_by` nullable, `accepted_at`, `expires_at`, `revoked_at`, `revoked_by` nullable, `send_generation` mulai 1, `last_requested_at`, `revision`, `created`, `updated`.

- Unique `public_id`; unique parsial `(company_id, email_normalized) WHERE status = 'PENDING'`.
- Index `(email_normalized, status, expires_at, id)` untuk bootstrap dan `(company_id, status, created, id)` untuk daftar.
- Expiry selalu diperiksa menggunakan waktu server saat menerima/mengirim; kebenaran tidak bergantung pada cron sempat mengubah status ke EXPIRED.
- Invite ulang sesudah revoke/expire membuat row baru setelah menutup pending lama; resend hanya untuk pending yang belum kedaluwarsa. UI untuk expired memakai “Undang lagi”.
- Duplikat request untuk pending mengembalikan row yang sama dan tidak mengirim email baru; pengiriman ulang harus explicit resend.
- Target yang sudah aktif di company menghasilkan `ALREADY_MEMBER`, tanpa job email. Jangan mengungkap apakah email memiliki akun Jornal di luar company ini.
- Company harus ACTIVE dan telah selesai setup untuk membuat/resend/menerima undangan. Company arsip/belum setup memberi hasil tertunda yang jelas, bukan onboarding penerima.

### 4.3 `team_invitation_deliveries`

Fields: `invitation_id`, `generation`, `requested_by`, `recipient_email`, `status` (`QUEUED`, `LEASED`, `SENT`, `RETRYABLE_FAILED`, `PERMANENTLY_FAILED`, `CANCELLED`), `attempt_count`, `next_attempt_at`, `lease_until`, `lease_id`, `message_id`, `sent_at`, `last_error_code`, `created`, `updated`.

- Unique `(invitation_id, generation)`; index `(status, next_attempt_at, id)`.
- `SENT` berarti server SMTP menerima pesan, bukan bukti email sudah masuk inbox. UI tidak menyatakan “dibaca” atau “diterima penerima”.
- Jangan gabungkan job ini ke `tax_notifications`: opt-in pajak, batching nominal, dan kill switch pajak tidak berlaku untuk undangan transaksional.
- Error tersanitasi; jangan menyimpan credential, auth token, raw SMTP transcript, atau payload keuangan.

### 4.4 `team_commands`, audit, dan bukti identitas

- `team_commands`: `actor_user_id`, `company_id`, `command_key`, `action`, `request_hash`, `response_status`, `response_body`, timestamp. Unique `(actor_user_id, company_id, command_key)`.
- Hash mencakup action dan target, termasuk revision. Key sama/payload berbeda -> 409. Otorisasi diperiksa **sebelum** replay sehingga command lama tidak membuka akses sesudah membership dicabut.
- Extend `company_audit` dengan metadata target minimal; simpan aksi `team-invited`, `team-resent`, `team-invitation-revoked`, `team-joined`, `team-member-removed`, `team-left`, serta actor yang benar. Tidak perlu activity feed baru.
- Simpan bukti hasil Google OAuth pada collection private `user_google_identities`: `user_id`, `provider_subject`, `email_normalized`, `email_verified`, `verified_at`. Unique user/provider subject. Tidak menyimpan access/refresh token.
- Bukti diisi dari provider response server dan record external-auth PocketBase yang cocok, bukan `createData`/request body. Request edit user tidak dapat mengubah bukti ini. Pencocokan invite tidak hanya mengandalkan boolean `users.verified`.
- User lama yang belum punya bukti ini tetap dapat membuka company existing, tetapi harus login Google lagi sebelum menerima undangan baru. Hook memperbarui bukti sesudah provider tervalidasi dan user tersimpan; bootstrap melakukan join sesudah login selesai. Uji urutan hook pada [source PocketBase 0.40.2](https://github.com/pocketbase/pocketbase/blob/v0.40.2/apis/record_auth_with_oauth2.go), jangan mengasumsikan kode sesudah `e.next()` selalu terjadi sebelum respons auth.

## 5. Alur pengguna dan kontrak routing

### 5.1 Mengundang

1. Pengaturan company -> **Tim** (`/companies/<id>/team`), terlihat untuk setiap anggota.
2. Form “Email akun Google”, tombol “Kirim undangan”, dan penjelasan “Anggota dapat mengelola seluruh data company dan mengundang anggota lain.”
3. Server memvalidasi company/membership, email, quota, dan duplikat. Dalam satu transaksi: simpan invitation, delivery, command, audit. Tidak melakukan SMTP di transaksi database.
4. UI menampilkan “Undangan dibuat, email dalam antrean”, email target, batas berlaku, status pengiriman. Resend/revoke memperbarui row yang sama di UI tanpa perlu reload penuh.
5. Kesalahan SMTP tidak menghapus invitation. Penerima tetap bisa masuk langsung memakai Google; anggota melihat status gagal dan dapat retry/resend sesuai cooldown.

### 5.2 Email dan login

Email berbahasa Indonesia, subject “Anda diundang ke {companyName} di Jornal”, nama pengundang, nama company, email tujuan, waktu kedaluwarsa yang jelas, akses penuh yang akan diberikan, CTA “Buka Jornal”, serta tautan teks cadangan. HTML escape seluruh teks dinamis; tidak menyertakan saldo/NPWP/data pelanggan. Origin berasal dari konfigurasi server `JORNAL_PUBLIC_URL`, bukan Host/header request.

`/invitations/<publicId>` adalah route di luar layout yang mensyaratkan company. Sebelum autentikasi hanya tampil instruksi masuk dengan akun Google penerima, tanpa metadata undangan. GET tidak menerima undangan agar email link scanner tidak dapat melakukan join.

Setelah Google login:

1. POST bootstrap (bagian 6) memverifikasi bukti identitas dan menerima semua pending invitations yang cocok, per undangan secara atomik dan idempotent. Jangan hanya mencari email jika `isNew` user; pengguna lama juga dapat diundang.
2. Refresh katalog server, set actor/owner/company scope, hidrasi data existing, baru tampilkan halaman. Tidak membuat profile, rekening, saldo awal, atau company baru dari jalur join.
3. Urutan tujuan: company dari undangan yang dibuka dan sah -> company baru diterima pertama -> tujuan internal sebelumnya yang masih dapat diakses -> company terakhir yang sah -> company aktif pertama -> daftar arsip.
4. Banyak undangan diterima -> semua masuk katalog; toast “Bergabung ke N company”. Katalog tetap berhalaman; guard menunggu claim selesai sebelum memutuskan onboarding.
5. Akun salah -> tampil “Undangan tidak tersedia untuk akun Google ini” dan “Gunakan akun lain”. Jangan membocorkan email lengkap, nama company, atau daftar anggota kepada akun salah. Jangan memaksa logout jika pengguna memilih kembali ke company miliknya.
6. Expired/revoked untuk penerima yang cocok -> status jelas dan instruksi meminta undangan baru. Accepted oleh user yang sama -> buka company bila membership masih aktif; sesudah dikeluarkan, link lama tidak mengaktifkannya lagi.

Validasi pending redirect harus menggunakan parser URL + same-origin/path allowlist; `startsWith('/')` saja tidak cukup karena `//host` adalah URL eksternal. Simpan intent per tab dan actor; hapus setelah dipakai, logout, atau ganti akun. OAuth tetap menggunakan state/PKCE milik PocketBase SDK dan callback yang ada.

### 5.3 Bootstrap tanpa company

| Kondisi | Hasil |
| --- | --- |
| Undangan valid + email cocok | Join -> hidrasi -> company, tanpa onboarding |
| User existing punya membership aktif | Buka company; pending invitation juga diklaim |
| Company yang tersedia hanya arsip | Halaman company arsip/restore, bukan signup |
| Login umum tanpa company/undangan | Halaman “Belum ada company”, CTA “Buat company baru” |
| User memilih signup/create company tanpa invitation | Buka onboarding setelah bootstrap sukses |
| Invitation link expired/revoked/salah email | Halaman status undangan, bukan onboarding otomatis |
| Bootstrap/server gagal | Error + retry; tidak menyimpulkan company kosong |
| Akses terakhir dicabut | “Akses company sudah berakhir”; CTA membuat company sendiri harus dipilih secara sadar |
| Existing company di-reset | `/companies/<id>/setup` untuk setup ulang company existing; berlaku sama bagi setiap anggota, bukan signup ulang |

Guard GET `/onboarding` menjalankan bootstrap terlebih dahulu. POST setup `initialSetup` juga memeriksa invitation/membership dalam transaksi final: jika invitation valid baru diterima sejak form dibuka, respons mengarahkan ke company tersebut. Pembuatan company tambahan dari anggota memakai intent eksplisit `CREATE_ADDITIONAL_COMPANY`. Tidak mengandalkan tombol UI untuk mencegah company duplikat saat dua tab berlomba.

## 6. API aplikasi

Semua endpoint mutasi membutuhkan bearer auth user, JSON, command key kecuali bootstrap, dan cek membership server. Endpoint team tidak membutuhkan data epoch karena tim bertahan melewati reset. Response error mempunyai `code` stabil + pesan Indonesia.

| Method/path | Input pokok | Hasil |
| --- | --- | --- |
| `POST /api/jornal/session/bootstrap` | `invitationPublicId?`, intent navigasi; identitas bukan input | Claim invitation, hasil status invitation, `requiresGoogleLogin`, `nextAction`, `acceptedCompanyIds`, halaman awal katalog + cursor |
| `GET /api/jornal/companies` | `cursor?`, `limit` default 50/max 100 | Company milik semua membership aktif actor, owner ID dari server, membership revision; tanpa duplikasi |
| `GET /api/jornal/companies/{id}/team` | Cursor anggota dan undangan terpisah | Nama/email anggota company ini dan status pending delivery; tanpa password/token/profil tenant lain |
| `POST /api/jornal/companies/{id}/invitations` | `email`, `commandKey` | 201 invitation + `QUEUED`; 200 replay/pending existing; 409 `ALREADY_MEMBER` |
| `POST /api/jornal/companies/{id}/invitations/{id}/resend` | `expectedRevision`, `commandKey` | Revision/generation baru, expiry, satu delivery baru |
| `POST /api/jornal/companies/{id}/invitations/{id}/revoke` | `expectedRevision`, `commandKey` | Invitation REVOKED dan job belum dikirim dibatalkan |
| `POST /api/jornal/companies/{id}/members/{userId}/remove` | `expectedRevision`, `commandKey` | Membership REVOKED; guard last member |
| `POST /api/jornal/companies/{id}/leave` | `expectedRevision`, `commandKey` | Revokasi membership actor; guard last member |

Bootstrap memproses candidate dengan keyset cursor dan batch 100. Jika lebih banyak, respons `claimCursor`/`claimComplete=false`; client melanjutkan sampai selesai sebelum routing. Cursor terikat actor/filter server, tidak dipercaya sebagai akses. Jangan memotong hasil pada fixed 500 atau membiarkan offset melewati row yang statusnya baru berubah. Katalog subsequent memakai GET berhalaman.

Penerimaan per invitation menggunakan transaksi: reload pending + expiry + company ACTIVE/setup + kecocokan Google email; pastikan anggota pengundang masih aktif; insert/reactivate membership; ubah invitation ACCEPTED; cancel delivery tertunda; audit. Unique index menyelesaikan balapan dua tab. Jika member sudah aktif, tandai invite selesai tanpa mengubah `joined_at` atau menduplikasi membership.

Pencabutan anggota membatalkan semua undangan PENDING yang dibuat anggota tersebut agar orang yang sudah tidak punya akses tidak tetap memberi akses baru. Race accept vs revoke: hasil serial transaksi menentukan menang; anggota yang sudah sah bergabung tidak otomatis ikut terhapus. Company archive membatalkan pending invitation/delivery; setelah restore harus diundang ulang. Reset company mempertahankan anggota tetapi membatalkan pending invitation untuk mencegah join ke company yang sedang setup ulang.

Error: 400 input invalid; 401 sesi invalid; 403 `GOOGLE_IDENTITY_REQUIRED`; 404 resource tidak dapat diakses; 409 revision/last-member/archived/setup/invite terminal; 426 protocol lama; 429 quota dengan `Retry-After`; 503 feature/mail unavailable. Hasil ID undangan yang salah untuk actor harus generik. Semua path nested memvalidasi parent company terhadap child resource.

## 7. Otorisasi seluruh fitur yang sudah ada

Tambahkan `company_access.js` dengan helper `requireCompanyAccess(app, actorUserId, companyId, { writable, dataEpoch })` yang mengembalikan `{ company, membership, actorUserId, ownerTenantId, companyId, dataEpoch }`. Owner berasal dari company. Untuk mutasi, cek lagi di dalam transaksi yang menulis, termasuk membership revision jika dibutuhkan; cek sebelum transaksi saja menyisakan race revoke.

Seluruh pengguna memakai membership yang sama. Pembatasan di bagian ini adalah batas data company, bukan role pengguna.

| Permukaan | Perubahan wajib dan bukti selesai |
| --- | --- |
| Native `companies` list/view/expand | Membership ACTIVE actor; hanya company yang dapat diakses. Fields internal creation keys tidak perlu dipublikasikan. Custom katalog memakai proyeksi aman |
| Native `jornal_records` CRUD/list/view | Membership + company header + owner record cocok dengan company + epoch. Payload owner harus tetap owner. Identity immutable. Native rules tetap menolak bypass lewat filter kosong/OR/expand |
| Protected file dan realtime | Rules file/token dan subscription harus mengecek membership terkini; URL yang didapat sebelumnya tidak melewati revoke. Token user bukan bukti membership permanen |
| Setup/lifecycle/logo/assets | `companies.pb.js` menggunakan helper yang sama; rename/archive/restore/reset/logo bisa dilakukan anggota. Idempotency dan audit dipisah actor/owner |
| Invoice/customer/unit/settings/PDF/payment | `invoice_helpers.js`, `invoices.pb.js`, semua read/mutation/render/source image memakai owner scope terverifikasi; creator invoice tidak membatasi anggota lain |
| Backup/restore | `invoice_backup.pb.js`, backup lokal, tax export/import; anggota dapat export/restore company accessible. Backup tidak membawa membership, invitation, Google identity, atau menambah hak akses |
| Dokumen & AI | `document_helpers.js`, `documents.pb.js`, upload/download/OCR/confirm/unlink termasuk resource terkait diperiksa; worker memakai company pemilik resource |
| Pajak | Terapkan cakupan pada configuration, agenda, inbox, subject, input periode, registrasi, payment, filing, evidence, report, export/import, command replay |
| Referensi lintas ledger | Guard invoice payment, tax settlement, piutang dan attachment mencari dengan owner company, bukan actor. Tidak boleh terlewati oleh anggota undangan |
| Audit/commands | Actor nyata untuk seluruh aksi anggota; kunci command tidak saling berbenturan antarpengguna, otorisasi mendahului replay hasil lama |
| Push & reminder | Penerima = user anggota yang opt-in; resource owner terpisah. Tidak otomatis subscribe anggota pada email/push karena menerima invitation |

Tulis rule membership sesuai sintaks PocketBase 0.40.2 dan buktikan dengan API test. Jangan mengandalkan dua kondisi back-relation yang bisa cocok dengan dua row membership berbeda; `company`, `user`, dan `ACTIVE` harus cocok pada **row yang sama**. Semantik rule berbeda untuk list dan view, dan superuser dapat melewati rules, sehingga acceptance test menggunakan token user biasa: [PocketBase API rules](https://pocketbase.io/docs/api-rules-and-filters/).

### 7.1 Batas pajak bersama

Subjek pajak dapat menyatukan A+B. Member A tidak otomatis mendapat data B melalui agenda/CSV/bukti atau pembayaran gabungan.

- Detail/aksi satu subjek hanya diizinkan jika actor aktif pada **semua company yang menyumbang data resource tersebut**. Untuk pengaturan umum subjek dan export seluruh histori, gunakan semua hubungan company historis yang relevan, termasuk yang sudah berakhir; hanya membership saat ini tidak cukup untuk menjaga data historis.
- Subjek tanpa company hanya dapat dikelola pemilik namespace sampai ditautkan; ia bukan bagian dari company invitation.
- Endpoint yang menerima banyak company/subject memvalidasi semua sebelum menulis; tidak menyimpan separuh request. Membuat hubungan subjek ke company tambahan membutuhkan akses ke kedua sisi.
- Sharing membership tidak menggabungkan namespace pemilik data. Company dan subjek pajak yang dihubungkan tetap wajib memiliki `ownerTenantId` yang sama, meskipun actor menjadi anggota semua company tersebut. Konsolidasi pajak lintas pemilik bukan bagian fitur ini.
- Member yang hanya memiliki A mendapat response context `taxCoverage: "RESTRICTED_SHARED_SUBJECT"` tanpa nama/company ID/nominal B. Panel menjelaskan agenda gabungan memerlukan akses ke semua company sumber. Jangan membuat subjek pajak kedua otomatis untuk anggota.
- Safe-to-Spend menerima status unknown/restricted tersebut secara eksplisit, menampilkan reserve belum lengkap dan menurunkan confidence; jangan menganggap agenda kosong = kewajiban nol. Proyeksi lokal boleh tetap ditampilkan sebagai estimasi, tidak disebut saldo aman yang sudah lengkap.
- Reset A tetap dapat dilakukan anggota A; backend internal menandai input/subjek terkait perlu rekonsiliasi tanpa mengirim data B ke actor. Jangan menjalankan re-kalkulasi gabungan memakai data A saja.
- Coverage yang sama berlaku untuk notifikasi, evidence, command replay, riwayat settlement, dan data cached. Uji inviter/invitee dengan cakupan company identik mendapat hasil pajak identik.

### 7.2 Notifikasi

- `push_subscriptions` bersifat milik pengguna/perangkat. Perjelas field actor (migrasi `user_id` dari `tenant_id` lama) dan jangan ubah subscription menjadi milik owner company.
- Generator memilih subscriber berdasarkan membership company + opt-in, bukan equality tenant ID. Revalidate sebelum claim dan sebelum network send worker; revoke membatalkan delivery tertunda untuk user/company itu saja.
- Pengaturan dan delivery email pajak perlu recipient user ID terpisah dari owner tax subject. Migrasikan penerima lama ke user owner; anggota baru default tidak opt-in. Indeks dedupe mencakup recipient, sehingga satu anggota menandai dibaca tidak memengaruhi anggota lain.
- Pisahkan read state notifikasi personal dari status bisnis bersama (invoice sudah lunas/filing selesai). Invitation tidak mengubah preferensi pajak/quiet hours pengguna.

## 8. Client, cache, sinkronisasi, dan offline

### 8.1 Scope dan migrasi cache

- Company catalog/pilihan tab keyed actor, termasuk company undangan; hapus filter `company.tenantId === authUser.id` dalam pemilihan pending sync.
- Namespace finansial baru: `jornal.v3.<actorUserId>.<ownerTenantId>.<companyId>.<dataEpoch>.<membershipRevision>.<key>`. Query key, runtime sync, outbox, conflict, attachment cache, draft, tax cache dan derived query memakai scope setara. Data yang sama boleh dicache terpisah untuk dua login; server tetap satu ledger.
- Jangan mengganti active tenant global ke owner saja: pengguna lain di browser yang sama bisa membaca cache/outbox pemilik terdahulu. Logout membatalkan request, workers/subscriptions, query cache dan generation UI; login berikutnya hanya membuka partisi actornya.
- V2 owner cache dimigrasikan saat `actor == owner` dan company terverifikasi. Preserve snapshot/outbox/draft, tunggu IndexedDB commit, pasang marker akhir. Jangan migrasi legacy data pemilik ke user undangan. Import backup company tidak mewajibkan actor sama dengan pemilik backup, tetapi company/owner tujuan harus cocok dan accessible; impor antar-company tetap memakai mapping resmi.
- Epoch baru saat reset tidak membuka cache epoch lama. Revision membership berubah saat rejoin: outbox lama harus dikarantina dan tidak otomatis diputar ulang.

### 8.2 Kolaborasi data dan konflik

Join tidak cukup jika pengguna hanya mendapat data sekali saat reload. Rilis wajib menyertakan refresh data dan perlindungan perubahan paralel:

1. Hidrasi snapshot company setelah bootstrap; lakukan refresh saat focus/reconnect dan setiap 30 detik selama company aktif/online. Dedupe satu refresh per scope; hentikan saat logout/company switch. Gunakan request berhalaman dan invalidation semua query turunan setelah merge.
2. Pertahankan dirty item/outbox lokal saat refresh. Data remote yang lebih baru menghasilkan conflict; jangan menimpa draft lokal diam-diam atau mengunggah seluruh array cached sebagai edit pengguna.
3. Setiap item outbox membawa **base revision yang dibaca saat mulai diedit**. Backend compare-and-swap dalam transaksi; client tidak boleh GET revisi terbaru lalu mengirim `found.revision + 1` untuk payload lokal stale. Tepat satu dari dua perubahan pada base revision sama berhasil; yang lain mendapat 409 dan pilihan review/resolve yang ada.
4. Delete ledger memakai tombstone yang bisa dibaca anggota lain, dengan actor/base revision/epoch. Client yang offline tidak boleh menghidupkan lagi record yang sudah dihapus; jangan mengandalkan missing row karena list parsial bukan bukti delete. Reuse `deleted_at` yang sudah ada; native DELETE protocol baru harus mengikuti kontrak ini.
5. History append-only dan saldo hasil engine berasal dari record yang sama. Idempotency recurring occurrence, invoice payment, tax settlement, OCR confirmation diuji dengan dua actor agar tidak tercatat dua kali.
6. Mutasi command server tetap reconcile hasil langsung ke store dan invalidasi queries. Perubahan tim sendiri tidak membuat transaksi atau mengubah kas, omzet, pajak, dan Safe-to-Spend.

### 8.3 Akses dicabut/offline

Server memeriksa membership setiap request. Setelah revoke, request baca/mutasi/file berikutnya ditolak; current page mengecek lagi saat focus/refresh. Hilangkan company dari katalog, batalkan request dan clear query cache/render, karantina outbox/draft company tersebut. Jangan fallback ke cached company karena 401/403/404 authoritative; fallback offline hanya untuk network/timeout/5xx yang sesuai.

Data yang telah didownload tidak dapat ditarik kembali dari perangkat offline. UI offline menampilkan status belum diverifikasi; perubahan offline tidak mencapai server sampai membership diverifikasi ulang. Pada reconnect revoke terdeteksi, hentikan upload sebelum mencoba replay. Browser yang sedang offline tidak dijanjikan pencabutan tampilan seketika. Arsip tetap read-only untuk setiap anggota, dan pending changes harus ditinjau sebelum reset/arsip sesuai workflow sekarang.

## 9. Email, queue, retry, dan pengendalian

Reuse konfigurasi runtime `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_AUTH_METHOD`, `SMTP_TLS`, `SMTP_FROM_ADDRESS`, `SMTP_FROM_NAME`. Jangan hard-code port lain; port/TLS efektif diuji menggunakan konfigurasi deployment yang dipasang. Credential berada di secret/env runtime dan tidak ditulis ke template atau dokumen.

Tambahkan flags backend (default false sampai rollout):

- `JORNAL_TEAM_INVITATIONS_ENABLED`: mengaktifkan create/resend/claim invitation. Jika dimatikan, membership existing tetap berfungsi; invite route menunjukkan fitur sementara tidak tersedia.
- `JORNAL_TEAM_INVITATION_EMAIL_ENABLED`: hanya pengiriman email. Saat false, jangan claim/send job; queue tetap tertunda dan tidak menghabiskan attempt. Create/resend publik mengembalikan 503 jika email dimatikan/tidak terkonfigurasi; pending undangan yang sudah dibuat masih dapat diklaim bila invitation flag aktif.
- `JORNAL_PUBLIC_URL`: wajib absolute HTTPS di production; base tautan email tetap allowlisted.

Worker `team_invitation_jobs.pb.js` dijadwalkan tiap menit:

1. Claim job jatuh tempo berurutan `(next_attempt_at,id)`, batch 50, lease 120 detik + random lease ID. Pulihkan lease expired secara berhalaman. Hanya pemegang lease boleh menyelesaikan attempt.
2. Revalidate invitation PENDING, belum expired, generation terbaru, membership requester/inviter masih aktif, company ACTIVE/setup, recipient masih cocok, dan kedua kill switch tepat sebelum send. Cancel job yang tidak relevan.
3. Kirim text+HTML melalui mail client PocketBase. SMTP dilakukan di luar transaksi dan timeout harus lebih pendek daripada lease.
4. Persist SENT setelah SMTP sukses. Error transient dijadwalkan ulang; total maksimum 5 attempts, jarak 1/5/15/60 menit + jitter, dibatasi expiry. SMTP auth/config invalid atau recipient invalid -> permanently failed, operator dapat memperbaiki lalu anggota resend.
5. Resend membatalkan generation lama yang belum dikirim. Undangan diterima/revoke/archive membatalkan semua pending jobs terkait.

SMTP tidak menawarkan transaksi atomik dengan database: crash sesudah SMTP menerima pesan sebelum SENT tersimpan dapat menghasilkan email duplikat. Gunakan `Message-ID` stabil per delivery untuk membantu diagnosis, tetapi jangan menjanjikan exactly-once. Penerimaan undangan/membership **harus** exactly-once secara logis. Email yang sudah diserahkan SMTP tidak bisa ditarik saat revoke; tautannya tetap gagal memberikan akses.

Default rate limit: create+resend maksimum 10 request/menit per actor dan 50 pengiriman/hari per company; satu recipient-company tidak lebih sering dari 60 detik dan maksimum 5/hari. Duplikat idempotency replay tidak menghitung kuota/mengirim ulang. Hitung quota secara atomik/durable, tidak hanya map memori. Semua anggota berbagi batas company yang sama; test jam/reset window dan 429 `Retry-After`.

Observability: counter queue, oldest queue age, SMTP attempt/success/error code, claim success/rejection reason, rate limit, membership revoke, bootstrap latency. Log internal invitation/company/request IDs tanpa token/password/email lengkap. Alert jika job lewat 10 menit atau kegagalan SMTP beruntun. Dashboard UI membedakan pending invitation dan status email.

## 10. Peta file implementasi

| Area | File baru/diubah |
| --- | --- |
| Skema + upgrade | `backend/pocketbase/pb_migrations/<next>_team_invitation.js`, upgrade rules dan recipient/command index terkait |
| Access | Baru `pb_hooks/company_access.js`; ubah `jornal_helpers.js`, `jornal_sync.pb.js`, `company_helpers.js`, `companies.pb.js` |
| Team/auth/bootstrap | Baru `pb_hooks/team_helpers.js`, `team.pb.js`, `session.pb.js`, `google_identity.pb.js` |
| Email | Baru `pb_hooks/team_invitation_jobs.js`, `team_invitation_jobs.pb.js`, template helper; reuse `runtime_config.pb.js` |
| Invoice/doc/tax/push | `invoice_helpers.js`, `invoices.pb.js`, `invoice_backup.pb.js`, `document_helpers.js`, `documents.pb.js`, `tax_helpers.js`, `tax.pb.js`, `tax_jobs.js`, `push.pb.js`, `notification_jobs.js`, worker push |
| Scope/cache/sync | `src/lib/types.ts`, `store.ts`, `companies.ts`, `local-db.ts`, `pocketbase-sync.ts`, `queries.ts`, client/query tax/invoice/document/push |
| Team client | Baru `src/lib/team-client.ts`, `team-queries.ts`, `team-types.ts` |
| UI/routes | Baru `company-team-page.tsx`, `invitation-page.tsx`, `no-company-page.tsx`; ubah `login-page.tsx`, `onboarding-page.tsx`, `companies-page.tsx`, `settings-page.tsx`, switcher/shell, `router.tsx` |
| Verification | Baru unit team + scope tests, backend team API/migration/SMTP tests, `e2e/team-invitation.e2e.ts`, runner isolated SMTP/OAuth fixture |
| Operasi | Baru `TEAM_INVITATION_RUNBOOK.md`; update README/multi-company/invoice/tax/push runbooks, `.env.example`, CI, manifest cockpit (flags/secrets saja) |

Nomor/file baru adalah target implementasi. Jangan mengedit migrasi lama yang sudah terpasang untuk membuat deployment baru bergantung pada migrate ulang.

## 11. Tahapan eksekusi dan kriteria keluar

Urutan dependensi: P0 -> P1 -> P2 -> P3 -> P4 -> P5 -> P6 -> P7 -> P8. Setiap fase menghasilkan commit yang dapat direview; feature flags tetap off sampai seluruh gate lulus. Tidak perlu membagi pengerjaan ke beberapa agent.

### P0 — Audit kontrak dan harness (1–2 hari)

- [x] T01 Inventaris semua penggunaan auth ID sebagai owner, native rule, custom route, file, worker, command replay, serta cache key. Klasifikasikan actor/owner/company/recipient; tidak ada `replace all` auth ID.
- [x] T02 Buktikan hook Google dan membership rules pada PocketBase 0.40.2. Tambahkan fixture A/B/C, dua company owner A, satu company pribadi B, subjek pajak tunggal dan gabungan.
- [x] T03 Siapkan SMTP capture lokal dan Google OAuth stub terisolasi di test harness; tidak memasang auth bypass di production. Tentukan schema/protocol fixtures sebelum ubah client.

Keluar: daftar permukaan lengkap, fixture reproducible, source provider/server terbukti memberi email verified/sub yang benar. Tidak ada keputusan identitas yang masih ambigu.

### P1 — Skema/migrasi membership (1–2 hari; setelah P0)

- [x] T04 Buat collection/index/private rules baru, identity proof, recipient identity, actor-scoped command indexes dan audit metadata; semua field/index creation idempotent.
- [x] T05 Backfill satu membership owner per company dalam batch berhalaman; hitung invariant company vs membership. Tidak mengubah jumlah/nominal/ID record finansial.
- [x] T06 Uji database fresh/populated, migrate up ulang, down non-destructive lalu up, anchor owner keluar dan guard last member paralel.

Keluar: tidak ada orphan company/member dan checksum data finansial sama sebelum/sesudah.

### P2 — Akses shared company menyeluruh (3–5 hari; setelah P1)

- [x] T07 Implementasikan helper dan rules ledger/company/files; actor vs owner tervalidasi dalam transaksi dan replay.
- [x] T08 Migrasikan company lifecycle, setup, logo, invoice/customer/settings/payment/render/backup, dokumen/AI dan semua references.
- [x] T09 Migrasikan tax subject coverage, evidence/export/import, unknown reserve, personal notification/read state dan recipient routing.
- [x] T10 Migrasikan push generator/delivery untuk anggota opt-in dan revalidate revoke sebelum send; audit mencatat aktor benar.

Keluar: token user B dapat melakukan setiap operasi company A yang menjadi anggotanya; semua akses B ke company A-lain ditolak, termasuk list/filter/expand/file/command replay. Same membership set menghasilkan kemampuan identik bagi A/B.

### P3 — Scope dan kolaborasi client (3–5 hari; setelah P2)

- [x] T11 Tambah scope actor-owner, katalog shared, namespace v3, migrasi owner cache, outbox/draft/epoch/membership quarantine; update switcher dan guard semua client.
- [x] T12 Simpan base revisions, lakukan merge dirty vs clean yang benar, tombstone deletion, conflict review, dan refresh focus/reconnect/30 detik dengan invalidation queries finansial.
- [x] T13 Uji dua user/browser, dua tab, switch lintas owner, logout/login akun berbeda, offline/rejoin, recurring dan command pembayaran simultan.

Keluar: kedua anggota melihat ledger yang sama; tidak ada overwrite diam-diam, data dobel, data lintas akun, atau stale saldo setelah refresh. Test stale base revision menolak tepat satu penulis kedua.

### P4 — Invitation API dan antrean email (2–3 hari; setelah P3)

- [x] T14 Implementasikan create/list/resend/revoke/remove/leave, normalization, pagination, quota, replay, transaksi accept/revoke dan invalidation pending invitations.
- [x] T15 Implementasikan SMTP queue/template/lease/retry/revalidation/kill switches; status delivery aman untuk UI.
- [x] T16 Uji duplicate invite, acceptance race, expiration, resurrect guard, out-of-order workers, SMTP retry/crash, flags berubah sesudah queue, dan lebih dari 500 row.

Keluar: undangan terbentuk atomik dengan job, SMTP gagal tidak membatalkan data, penerima baru dapat menerima tanpa akun awal, dan semua mutation idempotent.

### P5 — Bootstrap Google dan onboarding (2 hari; setelah P4)

- [x] T17 Tangkap identitas Google server, buat bootstrap POST berhalaman dan catalog GET, claim pending untuk akun baru/lama, lindungi edit identitas.
- [x] T18 Route invitation, login intent, safe redirect, route tanpa company, explicit signup dan final setup race guard.
- [x] T19 Uji login dari email/direct/login session lama, multi invitations, email salah, Google cancel, expired/revoked, bootstrap timeout, dan company reset.

Keluar: invited login tidak pernah menciptakan company/profil/rekening default kedua. Onboarding hanya terjadi lewat intent create yang sah.

### P6 — UI tim dan regresi pengalaman (1–2 hari; setelah P5)

- [x] T20 Halaman tim dengan anggota/pending invites, form email, full-access copy, status SMTP/expiry, resend/revoke/remove/leave dan konfirmasi yang sesuai.
- [x] T21 Link Tim dari Pengaturan/company; company switcher memuat shared companies, loading/error/retry/no-company states, success toast langsung sesudah join.
- [x] T22 Periksa mobile 360px/desktop, label keyboard/screen reader, field kosong terlihat, tidak ada role selector atau halaman blank; preserve pending intent saat PWA update.

Keluar: alur undang sampai penerima melihat data dapat diselesaikan dari UI tanpa admin database.

### P7 — Release gates dan runbook (2–3 hari; setelah P6)

- [x] T23 Jalankan seluruh matrix bagian 12 memakai server nyata dan dua auth user biasa, semua integration gates wajib aktif (skip dihitung gagal untuk release).
- [ ] T24 Jalankan email capture otomatis + satu smoke Google/Mailgun sungguhan pada mailbox/company uji; catat SMTP accepted dan penerimaan inbox terpisah.
- [x] T25 Selesaikan runbook backup/upgrade/protocol/quarantine/mail retry/revoke/rollback, serta verifikasi restore database terisolasi.

Keluar: bukti test, screenshot alur utama, checksum migrasi, hasil smoke dan prosedur rollback tersedia.

### P8 — Rollout dan pemeriksaan produksi (1 hari + observasi; setelah P7)

- [ ] T26 Rilis skema/backend kompatibel dan membership backfill, flags invitation/mail off. Verifikasi user lama tetap dapat masuk dan bekerja.
- [ ] T27 Rilis client protocol 3; drain pending write lama sebelum update bila memungkinkan. Setelah protocol enforcement, client lama menerima 426/loading-update, tanpa mengakui outbox yang belum dikirim.
- [ ] T28 Aktifkan invitation + email untuk pilot company uji server-side; bila perlu allowlist company eksplisit sebelum general rollout, bukan role baru.
- [ ] T29 Smoke undang -> SMTP -> Google -> shared company -> edit -> user awal melihat perubahan; uji revoke; pantau queue/auth/409. Baru aktifkan umum dan tandai checklist selesai.

Estimasi awal: **16–25 hari kerja engineer**, bukan janji tanggal. Bagian dominan adalah refactor ownership, local cache, dan kolaborasi pada fitur existing; membuat form invite sendiri jauh lebih kecil. Estimasi ditinjau setelah P0 tanpa memotong release gates.

## 12. Matriks pengujian wajib

| Kelompok | Skenario dan assertion |
| --- | --- |
| Happy path baru | Invite email baru; login Google; tepat satu user/membership; company ID/saldo sama; tidak ada setup request/default account tambahan |
| Happy path existing | Penerima punya company sendiri; shared company ditambahkan; company asal dan pilihannya tidak rusak |
| Login langsung | Tidak klik email; bootstrap tetap menerima undangan email yang cocok |
| Multiplicity | Satu email beberapa company/pemilik; semua claim dipaginasi; duplicate invite/dua tab menghasilkan satu membership |
| Identity | Email whitespace/case cocok; Gmail dot/plus tidak diubah; Workspace diterima; wrong email, spoofed `verified`, non-Google login, forged createData ditolak |
| Lifecycle invitation | Expiry tepat waktu server, resend generation, revoke-before-claim, claim-vs-revoke, inviter removed, archived/reset company, accepted link reused |
| Equal access | Anggota B edit settings, transaksi, delete, invoice/payment, evidence, import/export, archive/restore/reset dan invite C; audit actor B, owner tetap A |
| Isolation | B hanya member A1: list/view/filter kosong/OR/pagination/expand/deep link/file/PDF/attachment/command replay ke A2 ditolak; C tanpa membership semuanya ditolak |
| Team integrity | Semua anggota bisa remove/leave dengan aturan yang sama; remove creator menghilangkan aksesnya; race last-two-members tidak membuat nol anggota; native membership edit ditolak |
| Shared tax | A1+A2 pada satu subjek; B hanya A1 tidak mendapat data A2 lewat konfigurasi/evidence/CSV/inbox/replay; STS unknown, bukan reserve nol; B dengan keduanya setara owner |
| Offline/cache | V2 owner migrate; user lain pada browser sama tidak membaca cache; pending edit disimpan; revoked reconnect tidak upload; rejoin tidak replay outbox membership lama |
| Collaboration | Dua edit base revision sama -> satu 409; clean refresh update data/STS; dirty refresh conflict; delete offline tidak resurrect; recurring/payment tidak double |
| Onboarding | Explicit signup saja; pending invitation menang terhadap initialSetup race; expired/wrong/no access/network error tidak membuat company; reset memakai setup existing |
| Email | SMTP capture memuat recipient/CTA/escaped name/plain text/expiry; 4xx retry, 5xx permanent, cooldown, latest generation, flag off, lease recovery; tanpa data finansial |
| Notifications | Anggota opt-in menerima resource company-nya saja; read state antaractor terpisah; revoked delivery dibatalkan; prefs reminder pajak tidak ikut berubah saat invite |
| Scale | Lebih dari 500 company/membership/invitation/jobs; semua kandidat diproses, cursor tidak skip row saat status berubah; ukuran page/claim dibatasi |
| Migration/rollback | Fresh + populated + up/down/up; checksum saldo/history/invoice/settlement sama; existing members tidak kehilangan data saat fitur invitation dimatikan |
| UI/PWA | Mobile/desktop, keyboard focus/error/loading, popup Google, email link new tab, service-worker update/protocol lama, pending redirect external ditolak |

Commands baseline yang sudah tersedia:

```bash
bun install --frozen-lockfile
bun run typecheck
bun run lint
bun test
bun run build
```

P0/P7 harus menambah runner dan scripts berikut; **belum tersedia sekarang**:

```bash
export POCKETBASE_BIN=/absolute/path/to/pocketbase-0.40.2
bun run test:team:integration
bun run test:team:email
bun run test:team:e2e
```

Kontrak runner: fail fast jika binary bukan 0.40.2; database/temp port isolated; SMTP fake menangkap pesan dan dapat inject timeout/4xx/5xx; Google fixture terisolasi; cleanup proses/temp directory; integration suite tidak silently skip. CI mengunduh binary versi pinned dan Chromium, lalu menjalankan baseline, semua integration multi-company/invoice/tax, serta gates team. Live Google/Mailgun smoke adalah langkah terpisah pada akun uji, tidak mengirim email ke user produksi sewaktu test otomatis.

## 13. Migrasi, deployment, dan rollback

1. Ambil backup SQLite yang konsisten menggunakan fasilitas backup PocketBase beserta private files, lalu tes restore pada database terpisah. Catat jumlah company, saldo akun, total transaksi, histori dan invoice/tax settlements.
2. Migrasi additive: tambah membership/backfill owner, proof collection kosong, recipient fields, indexes. Kolom lama owner tidak diubah maknanya. Verifikasi migrasi schema/field/index re-runnable; no duplicate memberships dan no finance mutation.
3. Backend terlebih dahulu: membership helper mendukung akses legacy owner, **tetap melalui membership backfill**, selama transisi protocol2. Sharing belum aktif. Native rule/files/access coverage harus selesai sebelum menerima anggota pertama.
4. Client baru: migrasi namespace/base revisions. Dirty row v2 yang tidak menyimpan base revision tidak boleh dianggap memiliki revision terbaru; buat review/quarantine atau reconcile dengan bukti baseline sebelum upload. Tidak ada auto force overwrite untuk migrasi.
5. Enforce protocol3 pada semua endpoint mutasi finansial dan access bootstrap yang membutuhkan client baru, termasuk custom invoice/tax/document routes. GET/file yang kompatibel tetap dilindungi membership. Jangan hanya menaikkan versi pada ledger lalu membiarkan custom route lama lolos.
6. Aktifkan flags undangan/mail setelah SMTP dan Google smoke berhasil. Settings dapat menampilkan status fitur dari server supaya deployment flag tidak mensyaratkan rebuild frontend.
7. Rollback operasional utama: matikan pembuatan/penerimaan undangan baru dan mail worker. Membership existing tetap aktif. Perbaiki image dengan model akses yang sama. Jangan mengembalikan aplikasi ke build owner-only setelah anggota shared sudah ada; itu membuat penerima kehilangan akses.
8. `migrate down` adalah no-op non-destructive yang terdokumentasi: mempertahankan collection, field, index, rules membership, dan data hasil backfill; tidak mengembalikan rules owner-only atau menghapus akses existing. `up` berikutnya harus memeriksa keberadaan schema dan membership sebelum menambahkan, sehingga up/down/up lulus tanpa duplikasi atau mengaktifkan kembali membership yang sudah dicabut. Perubahan schema sesudah rilis memakai migrasi forward-fix. Restore backup sebelum fitur hanya untuk pemulihan bencana dengan analisis data baru yang akan hilang, bukan rollback harian.

## 14. Definition of done

- [ ] T01–T29 selesai dengan bukti, bukan hanya UI invite yang muncul.
- [ ] User undangan baru/lama masuk langsung ke company yang benar tanpa membuat data finansial kedua.
- [ ] Semua anggota company setara, tanpa role/permission selector atau privilege pemilik tersembunyi.
- [ ] Boundary company, cross-company tax, files, backup, audit, push, cache, outbox dan concurrent writes lulus test token user biasa.
- [ ] Email memakai SMTP yang sudah ada, antrean/retry/resend terverifikasi, credentials tidak tersimpan dalam repository baru.
- [ ] Intent onboarding, wrong account, expired/revoked, network failure, archived/reset, dan update versi mempunyai tampilan yang jelas.
- [ ] Migrasi/restore/rollback non-destructive terbukti; data sebelum rilis tidak berubah nilainya.
- [ ] CI mandatory gates tanpa skipped team integration dan smoke produksi pilot berhasil; runbook diserahkan.

Sesudah implementation gate ini selesai, status dokumen boleh diubah menjadi implemented beserta commit, tanggal, dan bukti release. Rencana ini sendiri tidak menjalankan migrasi, mengundang pengguna, atau mengubah deployment.
