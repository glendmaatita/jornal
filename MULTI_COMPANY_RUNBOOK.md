# Runbook rilis multi-company

Dokumen ini adalah prosedur operasional untuk migrasi `20260916_0006_multi_company.js`. Migrasi mempertahankan `business_id` sebagai tenant owner, membuat satu legacy-default company per tenant yang sudah memiliki data, lalu mengisi `company_id` dan `data_epoch` pada seluruh `jornal_records`.

## 1. Gate sebelum rilis

Rilis hanya boleh dilanjutkan jika seluruh perintah berikut hijau pada commit yang akan dipasang:

```bash
bun run typecheck
bun run lint
bun test
bun run build
POCKETBASE_BIN=/path/to/pocketbase bun test backend/pocketbase/tests/multi_company_api.integration.test.ts
JORNAL_MULTI_COMPANY_ENABLED=false POCKETBASE_BIN=/path/to/pocketbase bun test backend/pocketbase/tests/multi_company_api.integration.test.ts
POCKETBASE_BIN=/path/to/pocketbase bun test backend/pocketbase/tests/multi_company_migration.integration.test.ts
```

Integration test wajib memakai PocketBase `0.40.2`, sama dengan `Dockerfile`. Test API mencakup isolasi tenant/company, lifecycle, file, multipart, batch, revision, reset epoch, rate limit, 50-company paging, dan 120 transaksi dalam satu company. Test migrasi membandingkan ID serta payload ledger sebelum/sesudah backfill.

## 2. Backup dan dry-run

1. Hentikan write produksi atau buat snapshot volume yang konsisten.
2. Backup seluruh volume `/pb/pb_data`, bukan hanya `data.db`, agar auxiliary SQLite files tidak tertinggal. Backup `/pb/pb_data/storage` jika file disimpan di lokasi terpisah pada deployment.
3. Catat waktu snapshot, image digest, PocketBase version, ukuran database, jumlah user, dan jumlah `jornal_records` per entity.
4. Pulihkan salinan tersebut ke environment terisolasi tanpa traffic pengguna.
5. Jalankan image kandidat dengan `JORNAL_MULTI_COMPANY_ENABLED=false` dan frontend yang dibangun memakai `VITE_MULTI_COMPANY_ENABLED=false`.
6. Pastikan migrasi selesai dan health check `/healthz` hijau.
7. Audit database hasil dry-run:
   - setiap `jornal_records` memiliki `company_id` dan `data_epoch = 1`;
   - tidak ada `company_id` yang tenant-nya berbeda dari `business_id`;
   - setiap tenant lama memiliki tepat satu `legacy_default`;
   - jumlah record per entity, total nominal transaksi, jumlah history/tombstone, dan file attachment sama dengan snapshot;
   - tidak ada duplicate `(business_id, company_id, entity, app_id)`.
8. Jalankan smoke test login, legacy company, attachment, backup, dan restore terhadap hasil dry-run.

Migrasi sengaja gagal bila menemukan record dengan tenant orphan. Perbaiki ownership pada salinan terlebih dahulu; jangan menghapus record agar migrasi terlihat hijau.

## 3. Urutan deploy

1. Deploy backend/schema kandidat dengan kedua flag pembuatan company `false`.
2. Pastikan klien lama tidak memperoleh ledger tanpa scope: list lama kosong dan mutation/view lama mendapat update-required.
3. Deploy frontend protocol 2 dengan flag UI `false`. Periksa company hasil migrasi, sinkronisasi, file, offline cache, serta tidak ada lonjakan 409/426.
4. Aktifkan canary backend (`JORNAL_MULTI_COMPANY_ENABLED=true`) hanya pada instance/tenant uji yang terisolasi. Bangun frontend canary dengan `VITE_MULTI_COMPANY_ENABLED=true`.
5. Buat company kedua, isi transaksi dan piutang, berpindah company di dua tab, lakukan offline edit/reconnect, archive/restore, export, lalu reset company uji.
6. Jika gate canary sehat, aktifkan backend secara umum dan rilis frontend berflag `true` bertahap.

Backend harus dipasang sebelum frontend baru. Jangan pernah rollback ke backend yang tidak memahami `company_id` setelah company kedua dibuat.

## 4. Observability dan batas sehat

Pantau per versi aplikasi dan per endpoint:

- status `400` untuk referensi silang/payload scope;
- `404` untuk ownership/scope mismatch;
- `409` dipisahkan untuk revision, archive, dan data epoch;
- `426` untuk bundle lama;
- `429` untuk pembuatan lebih dari 10 company per tenant per menit;
- latensi dan error `/api/jornal/companies/setup`, list company, serta list `jornal_records`;
- jumlah dan umur outbox per company dari halaman Kelola company;
- event `company-created`, `company-renamed`, `company-archived`, `company-restored`, dan `company-reset` pada `company_audit`.

Baseline harus direkam sebelum canary. Hentikan perluasan bila ada data lintas-company, record count/hash berubah, error migration, atau peningkatan error sync yang persisten. Target UX cache hangat tetap sekitar 500 ms pada perangkat acuan; cold/offline state harus menampilkan loading atau unavailable, bukan onboarding kosong.

Audit log tidak boleh diekspor ke pengguna dan tidak boleh ditambah token atau payload finansial penuh. Retensi mengikuti kebijakan log produksi.

## 5. Pause dan rollback

Untuk menghentikan pembuatan company baru:

1. Set runtime `JORNAL_MULTI_COMPANY_ENABLED=false` dan restart PocketBase.
2. Rilis frontend yang dibangun dengan `VITE_MULTI_COMPANY_ENABLED=false`.
3. Biarkan schema, index, company catalog, dan `company_id` tetap ada. Company yang sudah dibuat tetap dapat dipilih, disinkronkan, dan diekspor.

Rollback aplikasi hanya boleh menuju versi frontend/backend protocol 2. Jangan menjalankan down migration 0006, mengembalikan unique index lama, atau menggabungkan ledger berdasarkan `business_id`. Jika diperlukan koreksi, buat forward migration setelah backup baru.

Full snapshot restore adalah tindakan pemulihan terkoordinasi: hentikan write, dokumentasikan recovery point objective, pulihkan volume lengkap, lalu rekonsiliasi write setelah waktu snapshot sebelum traffic dibuka.

## 6. Penanganan insiden

### Client mendapat 426

Minta pengguna reload/update PWA. Draft dan outbox tidak dihapus. Pastikan service worker baru aktif sebelum retry.

### Revision conflict 409

Jangan menaikkan revision secara paksa. Muat record remote, tampilkan konflik lokal/remote, lalu biarkan pengguna memilih versi. Retry hanya setelah snapshot baru dibentuk.

### Data epoch 409 sesudah reset

Mutation berasal dari state sebelum reset. Data outbox lama berada pada namespace karantina IndexedDB `jornal.quarantine.reset-epoch-*`; jangan memberi ulang epoch baru secara otomatis. Pulihkan hanya setelah verifikasi support dan persetujuan pengguna.

### Company diarsipkan dengan device offline

Server menolak write terlambat. Pulihkan company melalui lifecycle endpoint jika perubahan memang harus disinkronkan; setelah sync selesai, arsipkan ulang. Jangan mengubah payload atau company ID untuk melewati penolakan.

### Dugaan kebocoran lintas-company

Segera matikan flag pembuatan, pertahankan database, simpan request ID/log, tenant ID, company ID, app ID, dan timestamp tanpa token. Reproduksi pada snapshot terisolasi dengan API protocol 2. Jangan memperbaiki dengan menghapus atau memindahkan record secara manual sebelum scope dan audit selesai.

## 7. Pemulihan data lokal

- Backup v2 hanya dapat direstore ke tenant/company/epoch yang cocok.
- Backup v1 hanya dapat masuk ke company `legacy_default`.
- Sumber namespace legacy dipertahankan; marker migrasi lokal membuat copy idempotent.
- Outbox pre-reset dikarantina, bukan dihapus permanen.
- Untuk support, ekspor company aktif sebelum perubahan lifecycle besar dan catat company ID serta data epoch.

Selesai rilis bila canary dan general rollout stabil, tidak ada mismatch audit, semua tenant lama terpetakan, dan prosedur pause/restore telah diuji pada snapshot nonproduksi.
