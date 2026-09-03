# Product Roadmap
## Simple Business Cashflow & Tax Planning App (Mobile Web / PWA)

**Status**: Draft
**Author**: Alex (Product Management)
**Last Updated**: 2026-09-03
**Version**: 1.0
**Source Document**: `prd.md` (v1.0, 67 sections)
**Stakeholders**: Engineering Lead, Design Lead, Tax/Compliance SME, Founder(s)

---

## 1. Executive Summary

Roadmap ini menerjemahkan 67 section PRD — yang saat ini hanya punya breakdown P0/P1/P2 eksplisit untuk satu fitur (Safe To Spend, section 64) — menjadi sequencing lengkap untuk **seluruh produk**.

Strategi roadmap mengikuti satu logika inti yang sudah tersirat di PRD sendiri: **produk ini punya satu loop nilai inti (record → classify → understand cashflow/tax/Safe To Spend), dan setiap fase berikutnya membuat loop itu makin pintar tanpa menambah pekerjaan manual user** (North Star, section 67). Karena itu roadmap dibagi menjadi tiga fase besar, bukan berdasarkan kalender, tapi berdasarkan **kematangan data yang dibutuhkan setiap kelompok fitur**:

- **Phase 1 — MVP: Core Recording, Classification, Tax & Safe To Spend Foundation.** Semua yang dibutuhkan agar loop inti berfungsi end-to-end dari hari pertama: input transaksi, auto-classification, tax engine, dan Safe To Spend versi P0. Ini secara sengaja **besar untuk ukuran "MVP"** karena PRD sendiri (section 40, 46, 66) memposisikan Tax Center dan Safe To Spend sebagai diferensiator utama, bukan fitur tambahan — tanpa keduanya, produk ini hanya jadi expense tracker biasa. Trade-off ini didokumentasikan eksplisit di §10.
- **Phase 2 — Financial Intelligence & Trend Layer.** Fitur yang **baru bernilai setelah ada histori data** dari Phase 1 berjalan: learning loop dari koreksi user, trend chart, automated insight, Safe To Spend history/trend, dan Safe To Spend P1 (section 64). Ini adalah fase di mana sistem mulai "memahami pola bisnis" sesuai North Star.
- **Phase 3 — Advanced Automation & Forecasting.** Fitur predictive/proaktif berisiko tinggi dan butuh bukti dari Phase 1–2 sebelum dibangun: Safe To Spend forecast (section 61, secara eksplisit ditandai "Future Phase" di PRD), automatic recurring transaction creation (section 30), dan Safe To Spend P2 (AI reserve recommendation, bank balance integration, scenario simulation).

Pemetaan ini **secara langsung mencerminkan struktur P0/P1/P2 yang sudah ada di section 64 untuk Safe To Spend**, lalu diperluas secara konsisten ke seluruh fitur lain di PRD. Traceability penuh section 1–67 → fase ada di §12 (Appendix).

---

## 2. How to Read This Roadmap

- **Fase, bukan tanggal.** Tidak ada estimasi kalender karena PRD tidak memberi informasi ukuran tim atau velocity. Urutan fase mencerminkan **dependency**, bukan durasi.
- **Sizing** menggunakan T-shirt size (S/M/L/XL) relatif antar kelompok fitur dalam roadmap ini, bukan estimasi effort absolut — perlu divalidasi dengan t-shirt sizing dari engineering sebelum commit (lihat §9–§10).
- **Owner** di setiap tabel adalah placeholder (`TBD`) karena PRD tidak mencantumkan struktur tim. Sebelum fase manapun masuk sprint planning, setiap item **wajib** punya owner konkret — sesuai prinsip "no roadmap item without an owner."
- Setiap section PRD dikutip dengan nomor (`§X`) agar setiap keputusan sequencing bisa ditelusuri balik ke sumbernya.

---

## 3. Roadmap at a Glance

| Phase | Tema | Ukuran Relatif | Prasyarat Utama | Output Inti |
|---|---|---|---|---|
| **Phase 1** | MVP: Core Recording, Classification, Tax & Safe To Spend Foundation | **XL** | Tidak ada (starting point) | User bisa mencatat uang masuk/keluar <10 detik, sistem auto-classify, dan user tahu cashflow, estimasi pajak, dan Safe To Spend hari itu juga |
| **Phase 2** | Financial Intelligence & Trend Layer | **L** | Phase 1 live ≥2–3 bulan dengan volume transaksi & koreksi yang cukup | Sistem makin akurat (learning loop), user melihat tren & insight otomatis, Safe To Spend jadi metrik yang dipantau dari waktu ke waktu |
| **Phase 3** | Advanced Automation & Forecasting | **L–XL** (tergantung scope bank integration) | Phase 2 live, akurasi classification & data historis terbukti stabil | Sistem mulai memprediksi, bukan hanya melaporkan; automasi lanjutan mengurangi effort manual lebih jauh |

---

## 4. Phase 1 — MVP: Core Recording, Classification, Tax & Safe To Spend Foundation

**Sizing**: XL · **Sequencing**: Phase 1 (foundational, tidak bisa diparalelkan dengan fase lain)

### Scope

**A. Onboarding & Foundational Data**
- Authentication & onboarding flow (§66 item 1) — *catatan: PRD tidak mendetailkan metode auth (OTP/email/dsb.), lihat §9 Open Questions*
- Business/tax profile capture: business type, tax status, PKP status, business start date, fiscal year, tax scheme (§41, §66 item 2)
- Opening balance / saldo awal, dengan classification `OPENING_BALANCE` yang eksplisit tidak dihitung sebagai revenue (§46.4, §66 item 3)
- Accounts (Cash, BCA, Mandiri, GoPay, Other) — optional field, tapi penting untuk akurasi Current Cash Position (§31)

**B. Core Recording Loop**
- Information architecture: Home, Transactions, Tax, Insights, Settings + global `(+)` action (§9)
- Add Transaction: transaction type (Money In/Money Out), form input (Amount/Description/Date), optional fields via "More Options" (§11–13, §15)
- Smart/NLP transaction input ("bayar iklan meta 3jt" → parsed transaction) (§14) — *stretch item, lihat §10 Judgment Calls*
- Transaction data model, direction (`MONEY_IN`/`MONEY_OUT`), internal classification enum (`REVENUE`, `OPERATING_EXPENSE`, `CAPITAL_INJECTION`, dst.) (§16–19)
- Internal transfer handling — memastikan transfer antar akun tidak dihitung sebagai revenue/expense (§32)

**C. Classification Engine**
- Categories (income & expense) (§20)
- Automatic categorization engine berbasis description, merchant, keyword, amount, history (§21)
- Confidence scoring dengan threshold configurable (≥0.90 auto-accept, 0.70–0.89 accept+suggest, <0.70 needs review) (§22)
- Classification source tracking (`USER`/`RULE`/`AI`/`HISTORICAL_PATTERN`/`SYSTEM`) untuk auditability (§23)
- Review Queue ("Butuh Konfirmasi") untuk exception-based bookkeeping (§24, §66 item 8)
- Data capture untuk user corrections (mekanisme penyimpanan pattern) — *fondasi untuk learning loop Phase 2* (§25, bagian storage saja)

**D. Transaction Browsing & Management**
- Transactions screen dengan grouping harian (§26)
- Search by description/nominal (§27)
- Filters (Money In/Out, Category, Classification, Date, Amount, Needs Review) (§28)
- Transaction detail + Edit/Delete/Duplicate (§29)

**E. Home Dashboard & Basic Insights**
- Period selector (Today/This Week/This Month/Last Month/This Year/Custom) (§10.1)
- Cash Summary (Uang Masuk, Uang Keluar, Net Cash Flow) (§10.2)
- Revenue Summary & Expense Summary, secara eksplisit dipisahkan dari Money In/Out (§10.3–10.4)
- Tax Reserve widget di Home (§10.5)
- Recent Transactions (§10.6) & Needs Attention banner (§10.7)
- Monthly Overview (Revenue, Business Expense, Cash Surplus) (§34)
- Expense Breakdown dengan persentase (§35)

**F. Tax Center (P0)**
- Tax Rule Engine — **wajib versioned dan decoupled dari transaction service** (`tax_rule_version`, `effective_from`, `effective_until`) (§42)
- Tax Overview: Revenue YTD, Projected Annual Revenue, Estimated Tax, Tax Paid, Remaining Estimated Tax (§43)
- Tax Reserve calculation & recommendation, dengan "Already Reserved" vs "Additional Reserve Needed" (§44)
- UX/copy principle: tax reserve adalah virtual allocation, bukan transfer uang nyata (§45)

**G. Safe To Spend — P0 (per §64 eksplisit)**
- Current Cash Position (dari account balances atau opening balance) (§46.3)
- Recommended Tax Reserve (dari Tax Engine) (§46.5)
- Manual Other Reserve (Payroll, Rent, Supplier Payment, dst.) (§47)
- Safe To Spend calculation: Cash Position − Tax Reserve − Other Reserved Funds (§46.2)
- Safe To Spend Dashboard di Home + Detail breakdown yang fully explainable (§48–49)
- Data confidence indicator (High/Medium/Low) + kondisi yang menurunkan confidence (§50–52)
- Low confidence UX (jangan tampilkan angka seolah pasti) (§53)
- Negative Safe To Spend handling — jangan di-floor ke Rp0 (§54)
- Automatic recalculation via event architecture (`TRANSACTION_CREATED`, `TAX_RULE_UPDATED`, `RESERVE_UPDATED`, dst.) (§56–58)
- Guardrail wording ("estimasi", bukan "pasti aman") (§62–63) — berlaku sebagai prinsip desain permanen, bukan fitur satu kali

**H. Platform Infrastructure**
- PWA installation (§66 item 16)
- Basic offline resilience (§66 item 17) — *scope offline conflict-resolution belum didetailkan PRD, lihat §9*

### Rationale

Phase 1 mem-bundle seluruh recording loop **dan** tax + Safe To Spend dalam satu fase karena PRD sendiri memposisikan keduanya sebagai satu paket MVP (§66 items 1–17) dan secara eksplisit menyebut Tax Center (§40) dan Safe To Spend (§46, §65) sebagai *differentiator utama*, bukan enhancement. Safe To Spend juga secara struktural **bergantung** pada Tax Reserve, yang bergantung pada Tax Rule Engine (§42 flow: Transactions → Financial Classification → Tax Classification → Tax Rule Engine → Tax Calculation → Tax Projection) — jadi memisahkan Tax Center ke fase terpisah setelah recording loop akan membuat Safe To Spend tidak bisa dikirim sama sekali di fase pertama, padahal itu justru elemen yang menjawab North Star ("dari uang yang saya punya sekarang, berapa yang aman digunakan").

Search, filter, dan transaction detail (edit/delete/duplicate) dimasukkan ke Phase 1 meskipun tidak eksplisit tercantum di 17-item list section 66 — tanpa kemampuan mengoreksi transaksi yang salah dicatat/diklasifikasi, review queue dan Safe To Spend confidence tidak bisa berfungsi dengan benar (lihat §10 Judgment Calls).

### Risks, Open Questions & Dependencies

| Risiko / Pertanyaan | Dampak | Mitigasi |
|---|---|---|
| Tax Rule Engine harus versioned & decoupled sejak awal (§42) — retrofit setelah Tax Reserve/Safe To Spend live akan sangat mahal | Tinggi | Desain skema `tax_rule_version` sebagai first-class citizen sebelum coding transaction service dimulai |
| Confidence threshold (0.90/0.70) adalah nilai contoh di PRD, bukan hasil kalibrasi (§22) | Sedang | Threshold harus configurable dari hari 1; rencanakan siklus tuning di awal Phase 2 begitu ada data transaksi nyata |
| Account tracking bersifat optional (§31) — user yang tidak mengisi account tracking akan punya Current Cash Position yang kurang akurat, sehingga Safe To Spend confidence otomatis turun (§51) | Sedang | Onboarding copy harus menjelaskan trade-off ini secara eksplisit agar user paham kenapa confidence-nya Low |
| Auth mechanism tidak didetailkan di PRD (metode login, OTP/email/dsb.) | Sedang | Perlu spec terpisah sebelum dev-ready; blocker untuk PRD teknis, bukan untuk roadmap sequencing |
| Offline resilience (§66 item 17) — strategi conflict resolution untuk transaksi yang dibuat offline lalu sync tidak didetailkan | Tinggi | Perlu technical spike di awal Phase 1 untuk menentukan scope realistis ("basic" resilience apa artinya) |
| Smart/NLP input (§14) punya risiko akurasi parsing yang mirip risiko classification confidence | Sedang | Perlakukan sebagai stretch goal dalam Phase 1 — boleh slip ke Phase 2 tanpa memblokir exit criteria Phase 1 selama form input manual tetap <10 detik |
| Phase 1 secara scope sangat besar untuk sebuah "MVP" | Tinggi | Jika kapasitas tim terbatas, pertimbangkan sub-fase internal 1A (recording+classification loop) → 1B (tax+Safe To Spend), tapi **jangan** rilis 1A ke publik tanpa 1B — produk tanpa tax/Safe To Spend kehilangan diferensiasinya |

### Success Metrics (Phase 1)

| Metrik | Target (sumber PRD) | Cara Ukur |
|---|---|---|
| Waktu input Uang Masuk | < 10 detik | §5.1 #1 — instrumentasi dari tap `+` sampai konfirmasi Simpan |
| Waktu input Uang Keluar | < 10 detik | §5.1 #2 — sama seperti di atas |
| Pemahaman Safe To Spend (3 pertanyaan: berapa uang saya, berapa yang tidak boleh dipakai, berapa yang aman) | < 5 detik | §65 — usability testing terarah pada Home/Safe To Spend detail screen |
| Auto-classification rate | Baseline diukur, **bukan** target 90% (itu target jangka panjang §3.3) | Log `classification_confidence` per transaksi; laporkan mingguan sebagai input tuning Phase 2 |
| Review Queue volume | Tidak ada target eksplisit di PRD | *(PM-recommended, bukan dari PRD)*: pantau % transaksi yang masuk Review Queue sebagai proxy kualitas classification awal |

---

## 5. Phase 2 — Financial Intelligence & Trend Layer

**Sizing**: L · **Sequencing**: Phase 2, dimulai setelah Phase 1 live cukup lama untuk mengumpulkan histori transaksi dan koreksi user yang bermakna (indikasi realistis: minimal beberapa bulan data, bukan angka pasti karena PRD tidak menspesifikasikan)

### Scope

**A. Classification Maturity**
- Learning from corrections — aktivasi pattern learning dari data koreksi yang mulai dikumpulkan sejak Phase 1 ("Facebook Ads" dikoreksi dari Other Expense → Marketing akan menaikkan probability kategori Marketing untuk transaksi serupa berikutnya) (§25)
- Recurring transaction **detection** (bukan auto-creation) (§30) — di Phase 2, meskipun teks PRD di §30 sendiri menyebut "MVP awal cukup mendeteksi pola." **Dikonfirmasi oleh stakeholder (2026-09-03)**: canonical MVP list §66 (yang tidak menyertakan item ini) dijadikan sumber kebenaran scope, bukan kalimat naratif §30.

**B. Trend & Narrative Insight**
- Revenue Trend chart (bulanan) (§36)
- Expense Trend chart (bulanan) (§37)
- Cashflow Trend chart (Money In/Out/Net) (§38)
- Automated Financial Insights — narasi otomatis seperti "Pengeluaran marketing naik 32% dibanding bulan lalu" (§39)

**C. Safe To Spend — P1 (per §64 eksplisit)**
- Reserve due dates (§64 P1)
- Safe To Spend History — daily snapshot (§59)
- Safe To Spend Trend di Insights screen (§60)
- Safe To Spend contextual insight — "Safe To Spend turun Rp12 juta dibanding minggu lalu," lengkap dengan reason breakdown (§55) — *bergantung pada §59 History, karena itu ditempatkan di Phase 2, bukan Phase 1*
- Automatic recurring reserve suggestions (§64 P1)
- Reserve reminders (§64 P1)
- Improved confidence scoring (§64 P1)

**D. Proactive Tax Awareness**
- Peringatan kondisi pajak tertentu (mis. mendekati threshold PKP), sebagai perluasan dari Tax Rule Engine yang sudah ada di Phase 1 — memenuhi goal §5.1 #9 yang belum punya section detail tersendiri di PRD. *(Scope pasti perlu didefinisikan lewat review scope terpisah karena PRD tidak merinci mekanismenya.)*

### Rationale

Semua item di fase ini punya kesamaan: **nilainya nol tanpa histori data**, dan histori itu hanya bisa didapat setelah Phase 1 berjalan. Trend chart butuh beberapa titik data bulanan; learning loop butuh volume koreksi; Safe To Spend trend butuh snapshot historis (§59) sebelum insight perbandingan (§55) bisa dihitung. Ini persis logika yang sudah dipakai PRD sendiri untuk menandai fitur-fitur ini sebagai P1 di §64 — roadmap ini memperluas logika yang sama ke seluruh produk, bukan cuma Safe To Spend.

Fase ini juga adalah realisasi paling langsung dari North Star (§67): "Semakin lama aplikasi digunakan, sistem seharusnya semakin memahami pola bisnis sehingga jumlah aktivitas manual pengguna semakin berkurang." Learning from corrections dan improved confidence scoring secara langsung mengurangi ukuran Review Queue dari Phase 1.

### Risks, Open Questions & Dependencies

| Risiko / Pertanyaan | Dampak | Mitigasi |
|---|---|---|
| Trend/insight yang ditampilkan terlalu dini (data historis tipis) bisa menyesatkan — misalnya "naik 32%" dari 2 titik data | Sedang | Tetapkan minimum data threshold (mis. minimal 3 bulan histori) sebelum trend/insight ditampilkan ke user |
| Jika akurasi classification Phase 1 rendah, learning loop bisa memperkuat pola yang salah ("garbage in, garbage reinforced") | Tinggi | Audit sample koreksi user secara berkala sebelum mengaktifkan auto-reinforcement penuh |
| ~~§30 punya kontradiksi internal PRD (teks bilang MVP, list §66 tidak menyertakan)~~ | ~~Rendah–Sedang~~ | **Resolved (2026-09-03)** — stakeholder mengonfirmasi penempatan di Phase 2 |
| Tax alert (§5.1 #9) tidak punya section PRD yang detail | Sedang | Butuh review scope tersendiri sebelum masuk PRD teknis — jangan mulai desain tanpa evidence dari user (support tickets, interview) |

### Success Metrics (Phase 2)

| Metrik | Target (sumber PRD) | Cara Ukur |
|---|---|---|
| Auto-classification tanpa intervensi user | > 90% (target jangka panjang, §3.3) | Fase ini adalah fase pertama di mana target ini aktif dikejar; ukur tren mingguan/bulanan menuju 90%, bukan gate biner |
| Distribusi Safe To Spend confidence | Tidak dikuantifikasi PRD | *(PM-recommended)*: pantau pergeseran user dari MEDIUM/LOW ke HIGH_CONFIDENCE (§52) seiring reserve due dates & improved confidence scoring dirilis |
| Repeat correction rate | Tidak dikuantifikasi PRD | *(PM-recommended)*: % transaksi dengan description serupa yang masih butuh koreksi ulang setelah pattern dipelajari — harus turun dari waktu ke waktu |

---

## 6. Phase 3 — Advanced Automation & Forecasting

**Sizing**: L–XL (bank balance integration berpotensi membengkakkan scope signifikan) · **Sequencing**: Phase 3, digerbangi oleh evidence dari Phase 1–2

### Scope

- Safe To Spend Forecast / Projected Safe To Spend — memperhitungkan expected cash in/out ke depan, bukan hanya cash position saat ini (§61, secara eksplisit ditandai **"Future Phase"** di PRD)
- Automatic recurring transaction creation — kelanjutan dari deteksi pola di Phase 2, sekarang sistem bisa membuat transaksi otomatis untuk pola berulang (§30, bagian yang eksplisit ditunda PRD: "automatic creation dapat menjadi fitur lanjutan")
- Safe To Spend P2 (§64 eksplisit):
  - Expected cashflow modeling
  - AI reserve recommendations
  - Automatic upcoming obligation detection
  - Bank balance integration
  - Scenario simulation

### Rationale

Semua item di fase ini eksplisit ditandai PRD sendiri sebagai "bukan prioritas MVP" (§61) atau P2 (§64) karena membutuhkan **data future cashflow yang reliable** — sesuatu yang secara struktural tidak bisa ada sampai Phase 1–2 sudah menghasilkan histori transaksi yang cukup panjang dan classification yang cukup akurat untuk dipercaya sebagai basis prediksi. Membangun forecasting di atas data yang belum matang berisiko langsung melanggar prinsip Safe To Spend sendiri (§63: Simple, Explainable, **Conservative**, Transparent, Actionable) — proyeksi yang salah lebih berbahaya daripada tidak ada proyeksi sama sekali, karena bisa mendorong user mengambil keputusan finansial berdasarkan angka yang secara diam-diam tidak reliable (bertentangan dengan guardrail §62).

### Risks, Open Questions & Dependencies

| Risiko / Pertanyaan | Dampak | Mitigasi |
|---|---|---|
| Bank balance integration secara konsep sangat dekat dengan non-goal eksplisit "bank reconciliation platform" (§6) | Tinggi | Batasi scope ketat: read-only balance check-in untuk akurasi Cash Position, **bukan** transaction-matching/reconciliation engine penuh. Ini harus jadi keputusan tertulis, bukan asumsi implisit |
| Forecast accuracy tidak dikuantifikasi PRD sama sekali | Tinggi | Tidak boleh mulai desain Phase 3 tanpa review scope baru yang mendefinisikan target akurasi minimum berdasarkan data aktual dari Phase 1–2 |
| Automatic recurring transaction creation berisiko salah membuat transaksi tanpa konfirmasi user, bertentangan dengan prinsip exception-based bookkeeping (§3.3) | Tinggi | Wajib ada user confirmation step untuk transaksi pertama dari setiap pola sebelum sistem membuatnya otomatis secara penuh |
| AI reserve recommendations & scenario simulation adalah fitur paling belum tervalidasi di seluruh PRD | Tinggi | Perlakukan sebagai hipotesis terpisah — jangan digabung jadi satu rilis besar; validasi tiap sub-fitur secara independen sebelum build |

### Success Metrics (Phase 3)

Tidak ada target kuantitatif dari PRD untuk fase ini — PRD secara eksplisit menyebut fitur-fitur ini membutuhkan "data future cashflow yang lebih reliable" tanpa memberi angka. **Rekomendasi**: setiap item Phase 3 wajib melalui review scope tersendiri yang mendefinisikan success metric spesifik menggunakan baseline yang sudah terbukti dari Phase 1–2, sebelum dev dimulai. Jangan menaruh angka target di sini hanya demi kelengkapan dokumen — itu bertentangan dengan prinsip "jangan berikan false precision" yang justru menjadi core value produk ini (§63).

---

## 7. What We're Deliberately Not Building (Permanent Non-Goals)

Ini bukan item yang "ditunda ke fase berikutnya" — ini eksplisit di luar scope produk versi apa pun dalam roadmap ini, per §6 PRD:

| Excluded | Alasan |
|---|---|
| Full accounting system / double-entry UI / general ledger / trial balance / neraca | Bertentangan langsung dengan core philosophy §3.4 — user tidak boleh perlu memahami akuntansi |
| ERP | Di luar problem statement (§4) — produk ini fokus cashflow & tax, bukan operasional bisnis menyeluruh |
| Inventory management / inventory valuation | Non-goal eksplisit §6 |
| Invoicing system / sales order / purchase order | Non-goal eksplisit §6 |
| Payroll system | Non-goal eksplisit §6 |
| CRM | Non-goal eksplisit §6 |
| Procurement system | Non-goal eksplisit §6 |
| POS | Non-goal eksplisit §6 |
| Bank reconciliation platform | Non-goal eksplisit §6 — *catatan: bank balance integration di Phase 3 harus dijaga ketat agar tidak diam-diam berubah jadi ini* |
| Tax filing / tax reporting & submission software | Non-goal eksplisit §6 — produk ini planning, bukan compliance filing |
| Accounts receivable / accounts payable | Non-goal eksplisit §6 |
| Complex depreciation management | Non-goal eksplisit §6 |

Jika salah satu dari ini pernah diusulkan ulang oleh stakeholder (sales, customer, atau leadership), perlakukan sebagai request baru yang butuh review scope dari nol — bukan sebagai "kita lupa masukin ke roadmap."

---

## 8. What's Deferred, Not Excluded (Recap)

Berbeda dari §7, item berikut **ada di roadmap ini** tapi sengaja diletakkan di fase belakang karena bergantung pada data/evidence yang belum ada:

| Item | Sumber PRD | Ditempatkan di |
|---|---|---|
| Safe To Spend Forecast / Projected Safe To Spend | §61 — eksplisit "Future Phase" | Phase 3 |
| Automatic recurring transaction creation | §30 — eksplisit "fitur lanjutan" | Phase 3 |
| Safe To Spend P2 (AI recommendation, bank integration, scenario simulation, automatic obligation detection) | §64 P2 | Phase 3 |
| Safe To Spend P1 (reserve due dates, trend, recurring reserve suggestion, reminders, improved confidence) | §64 P1 | Phase 2 |
| Recurring transaction detection (bukan auto-creation) | §30 | Phase 2 *(dikonfirmasi stakeholder 2026-09-03, lihat §10)* |

---

## 9. Cross-Cutting Risks & Open Questions

Risiko berikut berlaku lintas fase dan sebaiknya diselesaikan lebih awal daripada menunggu fase yang relevan tiba:

1. **Tax Rule Engine harus jadi service yang benar-benar independen sejak Phase 1**, karena Tax Reserve (Phase 1), Safe To Spend (Phase 1), Tax Overview (Phase 1), tax alert (Phase 2), dan forecast pajak (Phase 3) semuanya bergantung padanya. Retrofit di tengah jalan akan mengorbankan historical calculation integrity yang justru jadi alasan §42 meminta versioning sejak awal.
2. **Confidence threshold classification (§22) adalah nilai contoh, bukan hasil kalibrasi** — perlu rencana tuning eksplisit begitu ada data transaksi nyata dari Phase 1, bukan diasumsikan benar selamanya.
3. **Account tracking optional (§31) menciptakan trade-off akurasi yang harus dikomunikasikan ke user**, bukan disembunyikan — ini langsung memengaruhi Safe To Spend confidence (§50–52).
4. **Auth mechanism dan isi Settings screen tidak didetailkan PRD** — bukan blocker untuk roadmap ini, tapi blocker untuk PRD teknis Phase 1 yang dev-ready.
5. **Offline resilience scope (§66 item 17) terlalu umum** ("basic") untuk langsung masuk sprint — butuh spike teknis untuk mendefinisikan strategi conflict resolution sebelum estimasi Phase 1 final.

---

## 10. Judgment Calls Made (Explicit Trade-offs)

Sesuai prinsip "protecting focus requires explicit trade-offs," berikut keputusan yang saya buat di luar teks literal PRD, dan alasannya:

1. **Recurring transaction detection (§30) dipindah ke Phase 2**, meskipun kalimat di §30 sendiri berbunyi "MVP awal cukup mendeteksi pola" (menyiratkan ini MVP). Canonical MVP list di §66 (17 item, tidak menyertakan ini) diprioritaskan di atas kalimat naratif di §30. **Dikonfirmasi oleh stakeholder pada 2026-09-03.**
2. **Search, filter, dan transaction detail (edit/delete/duplicate) (§26–29) dimasukkan ke Phase 1** meskipun tidak eksplisit disebut di 17-item list §66. Tanpa kemampuan dasar ini, user tidak bisa memperbaiki kesalahan input atau mengelola Review Queue secara realistis — produk tidak fungsional tanpanya, sehingga saya menilainya sebagai bagian implisit dari "Transaction history" (item 7 di §66).
3. **Smart/NLP transaction input (§14) tetap di Phase 1 tapi berstatus stretch**, boleh slip ke Phase 2 tanpa memblokir exit criteria Phase 1, karena risikonya (akurasi parsing) mirip risiko classification confidence yang juga baru bisa dituning dengan data nyata.
4. **Bank balance integration (§64 P2) diberi batasan scope tambahan** (read-only balance check, bukan reconciliation) yang tidak eksplisit ditulis di PRD, semata untuk menjaga produk tidak diam-diam melanggar non-goal §6 ("bank reconciliation platform").
5. **Target >90% auto-classification (§3.3) diperlakukan sebagai target Phase 2, bukan gate kelulusan Phase 1**, karena PRD sendiri menyebutnya "target jangka panjang" — memaksakannya sebagai syarat lulus Phase 1 akan menciptakan tekanan yang tidak sesuai dengan realita bahwa model classification butuh data produksi untuk matang.

---

## 11. Success Metrics Summary (All Phases)

| Metrik | Sumber | Phase | Target |
|---|---|---|---|
| Waktu input Uang Masuk / Uang Keluar | §5.1 #1–2 | 1 | < 10 detik |
| Pemahaman Safe To Spend (3 pertanyaan inti) | §65 | 1 | < 5 detik |
| Auto-classification tanpa intervensi user | §3.3 | 1 (baseline) → 2 (target aktif) | > 90% (jangka panjang) |
| Review queue volume | *(PM-recommended)* | 1 | Trend turun dari waktu ke waktu |
| Distribusi Safe To Spend confidence (HIGH vs MEDIUM/LOW) | *(PM-recommended, berbasis §52)* | 2 | Pergeseran ke HIGH_CONFIDENCE seiring fitur P1 dirilis |
| Repeat correction rate pada pattern serupa | *(PM-recommended)* | 2 | Turun dari waktu ke waktu |
| Forecast accuracy, bank integration adoption | Tidak ada di PRD | 3 | TBD — didefinisikan via review scope terpisah per item |

---

## 12. Appendix — Full PRD Section Traceability Matrix

| Section | Judul | Penempatan |
|---|---|---|
| 1–5 | Executive Summary, Vision, Philosophy, Problem Statement, Goals | Context (dasar rationale seluruh fase) |
| 6 | Non-Goals | Excluded permanen (§7 roadmap ini) |
| 7 | Target Users | Context |
| 8 | Core User Journey | Phase 1 |
| 9 | Information Architecture | Phase 1 |
| 10 | Home Dashboard | Phase 1 |
| 11–13 | Add Transaction, Transaction Type, Transaction Input | Phase 1 |
| 14 | Smart Transaction Input | Phase 1 (stretch) |
| 15 | Optional Transaction Fields | Phase 1 |
| 16–19 | Data Model, Direction, Internal Classification, Examples | Phase 1 |
| 20–23 | Categories, Auto Categorization, Confidence Score, Classification Source | Phase 1 |
| 24 | Review Queue | Phase 1 |
| 25 | Learning From Corrections | Phase 2 (data capture dimulai Phase 1) |
| 26–29 | Transactions Screen, Search, Filters, Detail | Phase 1 |
| 30 | Recurring Transactions | Detection → Phase 2 (dikonfirmasi stakeholder) · Auto-creation → Phase 3 |
| 31 | Accounts | Phase 1 |
| 32 | Internal Transfer | Phase 1 |
| 33 | Overview/Insights (intro) | Phase 1 (basic) / Phase 2 (rich) |
| 34 | Monthly Overview | Phase 1 |
| 35 | Expense Breakdown | Phase 1 |
| 36–38 | Revenue/Expense/Cashflow Trend | Phase 2 |
| 39 | Automated Financial Insights | Phase 2 |
| 40–45 | Tax Center, Tax Profile, Tax Rule Engine, Tax Overview, Tax Reserve | Phase 1 |
| 46–54 | Safe To Spend core, formula, cash position, opening balance, other reserves, dashboard, detail, confidence, negative STS | Phase 1 (= §64 P0) |
| 55 | Safe To Spend Insight | Phase 2 (bergantung §59) |
| 56–58 | Tax Reserve Changes, Event Architecture, Automatic Recalculation | Phase 1 |
| 59–60 | Safe To Spend History & Trend | Phase 2 (= §64 P1) |
| 61 | Safe To Spend Forecast | Phase 3 (= §64 P2, eksplisit "Future Phase") |
| 62–63 | Safe To Spend Guardrails & Product Principle | Context/principle — berlaku di semua fase |
| 64 | Safe To Spend MVP Scope (P0/P1/P2) | Sumber utama struktur Phase 1/2/3 roadmap ini |
| 65 | Safe To Spend Success Criteria | Metrik Phase 1 |
| 66 | MVP Product Scope (17 item) | Sumber utama scope Phase 1 |
| 67 | Product North Star | Context — prinsip pemandu seluruh fase |
