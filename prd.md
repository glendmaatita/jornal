# Product Requirements Document (PRD)
# Simple Business Cashflow & Tax Planning App

**Version:** 1.0  
**Status:** Draft  
**Platform:** Mobile Web / Progressive Web App (PWA)  
**Primary Market:** Indonesia  
**Primary Users:** Pemilik usaha kecil dan menengah  
**Product Type:** Business Cashflow Recording & Tax Planning  
**Document Language:** Bahasa Indonesia

---

# 1. Executive Summary

Produk ini adalah aplikasi pencatatan keuangan bisnis sederhana berbasis mobile web/PWA yang berfokus pada dua aktivitas utama:

1. **Uang Masuk**
2. **Uang Keluar**

Aplikasi tidak dirancang sebagai software accounting tradisional yang mengharuskan pengguna memahami jurnal, debit/kredit, chart of accounts, ledger, neraca, dan konsep akuntansi lainnya.

Sebaliknya, aplikasi menggunakan prinsip:

> **User records money. The system handles the bookkeeping intelligence.**

Pengguna hanya perlu mencatat transaksi bisnis sehari-hari. Sistem kemudian secara otomatis melakukan:

- klasifikasi transaksi;
- kategorisasi;
- identifikasi revenue;
- identifikasi business expense;
- identifikasi transaksi non-operasional;
- perhitungan cashflow;
- perhitungan omzet;
- agregasi bulanan dan tahunan;
- analisis pola pengeluaran;
- estimasi pajak;
- tax reserve;
- proyeksi omzet;
- proyeksi kewajiban pajak;
- tax planning;
- financial insights;
- deteksi transaksi yang membutuhkan konfirmasi.

Tujuan akhirnya adalah memberikan pemilik usaha gambaran sederhana:

> **Berapa uang yang masuk, berapa yang keluar, bagaimana kondisi bisnis saya, dan berapa uang yang sebaiknya saya siapkan untuk pajak?**

---

# 2. Product Vision

Membuat financial assistant sederhana bagi pemilik usaha yang tidak ingin menggunakan software accounting kompleks tetapi membutuhkan data keuangan bisnis yang terstruktur dan dapat digunakan untuk mengambil keputusan, terutama dalam melakukan tax planning.

Aplikasi harus terasa seperti **cashbook modern dengan financial intelligence**, bukan software accounting.

---

# 3. Product Philosophy

## 3.1 Simplicity First

Aktivitas utama pengguna harus tetap:

- mencatat uang masuk;
- mencatat uang keluar;
- melihat kondisi bisnis.

Setiap fitur baru harus dievaluasi dengan pertanyaan:

> Apakah fitur ini mengurangi pekerjaan pengguna atau justru menambah pekerjaan?

Jika sebuah informasi dapat dihitung atau disimpulkan oleh sistem, pengguna tidak seharusnya diminta menginputnya secara manual.

## 3.2 Automation First

Sistem harus mengotomatisasi sebanyak mungkin aktivitas administratif.

Contoh:

Pengguna mencatat:

> Bayar iklan Meta 3 juta

Sistem dapat menginterpretasikan:

- Transaction Type: Money Out
- Amount: Rp3.000.000
- Category: Marketing & Advertising
- Business Expense: Yes
- Operational Transaction: Yes
- Date: Today
- Tax Classification: berdasarkan tax rules yang berlaku

Pengguna hanya melakukan konfirmasi jika sistem tidak yakin.

## 3.3 Exception-Based Bookkeeping

Sistem tidak meminta pengguna melakukan klasifikasi terhadap setiap transaksi.

Sebaliknya:

1. sistem melakukan klasifikasi;
2. transaksi dengan confidence tinggi langsung diproses;
3. transaksi ambigu masuk ke daftar **Butuh Konfirmasi**;
4. pengguna hanya memperbaiki exception.

Target jangka panjang:

> Lebih dari 90% transaksi dapat diproses tanpa intervensi tambahan pengguna.

## 3.4 Hide Accounting Complexity

Istilah berikut tidak perlu muncul dalam interface utama:

- Debit
- Credit
- Journal
- General Ledger
- Chart of Accounts
- Trial Balance

Jika konsep tersebut nantinya diperlukan secara internal, pengguna tetap berinteraksi menggunakan bahasa sederhana.

Contoh:

**Uang Masuk**

bukan:

**Credit Revenue Account**

---

# 4. Problem Statement

Pemilik bisnis kecil sering menghadapi beberapa masalah.

## 4.1 Tidak mencatat transaksi secara konsisten

Software accounting terlalu kompleks sehingga pencatatan akhirnya tidak dilakukan.

## 4.2 Tidak mengetahui cashflow aktual

Pemilik bisnis mengetahui saldo rekening tetapi tidak mengetahui:

- total pemasukan;
- total pengeluaran;
- net cashflow;
- pola pengeluaran.

## 4.3 Mencampur uang dengan pendapatan

Tidak semua uang masuk merupakan omzet.

Contoh:

- modal pemilik;
- pinjaman;
- transfer antar rekening.

## 4.4 Mencampur pengeluaran dengan biaya bisnis

Tidak semua uang keluar merupakan expense.

Contoh:

- transfer rekening;
- penarikan pemilik;
- pembelian aset;
- pembayaran utang.

## 4.5 Pajak diketahui terlalu terlambat

Pemilik usaha sering baru memikirkan pajak ketika kewajiban pajak sudah muncul.

Aplikasi harus mengubah pendekatan tersebut dari:

> tax reporting

menjadi:

> **continuous tax planning**

---

# 5. Goals

## 5.1 Primary Goals

Produk harus memungkinkan pengguna:

1. mencatat uang masuk dalam <10 detik;
2. mencatat uang keluar dalam <10 detik;
3. mengetahui cashflow bisnis;
4. mengetahui omzet bisnis;
5. mengetahui pola pengeluaran;
6. mengetahui estimasi kewajiban pajak;
7. mengetahui dana yang sebaiknya disisihkan untuk pajak;
8. mengetahui proyeksi omzet akhir tahun;
9. mendapatkan peringatan terhadap kondisi pajak tertentu;
10. melakukan semua hal tersebut tanpa memahami accounting.

---

# 6. Non-Goals

Versi awal tidak bertujuan menjadi:

- full accounting system;
- ERP;
- inventory management;
- invoicing system;
- payroll;
- CRM;
- procurement system;
- POS;
- bank reconciliation platform;
- tax filing software;
- tax reporting/submission system.

MVP juga tidak membutuhkan:

- jurnal manual;
- double-entry UI;
- neraca;
- general ledger;
- purchase order;
- sales order;
- inventory valuation;
- depreciation management kompleks;
- accounts receivable;
- accounts payable.

---

# 7. Target Users

## Primary Persona

### Owner-Operator

Pemilik usaha yang secara langsung mengawasi keuangan.

Karakteristik:

- transaksi puluhan sampai ratusan per bulan;
- menggunakan rekening bank/e-wallet/cash;
- tidak memiliki tim accounting besar;
- ingin mengetahui kondisi bisnis;
- ingin mengantisipasi pajak;
- tidak ingin belajar software accounting.

---

# 8. Core User Journey

Journey utama:

```text
Open App
    ↓
Home
    ↓
Tap "+"
    ↓
Money In / Money Out
    ↓
Enter Amount
    ↓
Enter Description
    ↓
Save
    ↓
System Classifies Transaction
    ↓
Cashflow Updated
    ↓
Revenue/Expense Updated
    ↓
Tax Projection Updated
    ↓
Financial Insights Updated
```

User effort berhenti hampir sepenuhnya pada:

```text
Amount
Description
Save
```

---

# 9. Information Architecture

Primary navigation:

```text
Home
Transactions
Tax
Insights
Settings
```

Global action:

```text
            (+)
       Add Transaction
```

---

# 10. Home Dashboard

Home merupakan halaman pertama setelah login.

Tujuannya menjawab:

> Bagaimana kondisi uang bisnis saya sekarang?

## 10.1 Period Selector

Default:

**This Month**

Pilihan:

- Today
- This Week
- This Month
- Last Month
- This Year
- Custom

## 10.2 Cash Summary

Display:

```text
September 2026

Uang Masuk
Rp150.000.000

Uang Keluar
Rp110.000.000

Net Cash Flow
+Rp40.000.000
```

Formula:

```text
Net Cash Flow =
Total Money In - Total Money Out
```

## 10.3 Revenue Summary

Display:

```text
Omzet
Rp142.000.000
```

Revenue tidak sama dengan Money In.

Contoh:

```text
Money In
Rp150.000.000

Revenue
Rp142.000.000

Modal Masuk
Rp8.000.000
```

## 10.4 Expense Summary

Display:

```text
Pengeluaran Bisnis
Rp92.000.000
```

Money Out dapat berbeda dari expense.

## 10.5 Tax Reserve

Display:

```text
Estimasi Dana Pajak

Rp8.500.000

Disarankan untuk disisihkan
```

## 10.6 Recent Transactions

Tampilkan 5–10 transaksi terbaru.

Contoh:

```text
+ Rp12.500.000
Penjualan
Today

- Rp3.000.000
Meta Ads
Today

- Rp500.000
Bensin
Yesterday
```

## 10.7 Needs Attention

Jika ada exception:

```text
3 transaksi membutuhkan konfirmasi
```

Tap membuka Review Queue.

---

# 11. Add Transaction

Ini merupakan flow terpenting dalam seluruh produk.

UX harus dioptimalkan secara ekstrem.

---

# 12. Transaction Type

Saat menekan `+`:

```text
Uang Masuk

Uang Keluar
```

Dapat menggunakan segmented control atau dua tombol besar.

---

# 13. Transaction Input

Minimum fields:

```text
Amount *

Description

Date
```

Default date:

```text
Today
```

Primary CTA:

```text
Simpan
```

---

# 14. Smart Transaction Input

Selain form, aplikasi dapat menyediakan natural-language input.

Contoh:

```text
bayar iklan meta 3jt
```

Parser menghasilkan:

```text
Money Out

Rp3.000.000

Marketing & Advertising

Today
```

Contoh:

```text
penjualan hari ini 12.5jt
```

menjadi:

```text
Money In

Rp12.500.000

Sales Revenue

Today
```

---

# 15. Optional Transaction Fields

Optional:

- category;
- payment method;
- account;
- notes;
- attachment;
- supplier/customer;
- tags.

Field tersebut tidak boleh mengganggu quick entry.

Gunakan:

```text
More Options
```

---

# 16. Transaction Data Model

Core transaction:

```text
Transaction

id
business_id

direction
amount
currency

transaction_date

description
notes

category_id

payment_method
account_id

attachment

classification

business_relevance

tax_classification

classification_source
classification_confidence

review_status

created_at
updated_at
```

---

# 17. Transaction Direction

User-facing:

```text
MONEY_IN
MONEY_OUT
```

Ini hanya menggambarkan pergerakan uang.

Bukan accounting classification.

---

# 18. Internal Transaction Classification

Backend memiliki klasifikasi lebih detail.

Contoh:

```text
REVENUE

OPERATING_EXPENSE

CAPITAL_INJECTION

OWNER_WITHDRAWAL

ASSET_PURCHASE

LOAN_RECEIVED

LOAN_PAYMENT

TAX_PAYMENT

INTERNAL_TRANSFER

REFUND

OTHER_INCOME

OTHER_OUTFLOW

UNKNOWN
```

User tidak harus melihat seluruh istilah tersebut.

---

# 19. Example Classification

### Penjualan

```text
Money In
Rp10.000.000

Classification:
REVENUE
```

### Tambahan modal

```text
Money In
Rp50.000.000

Classification:
CAPITAL_INJECTION
```

### Bensin

```text
Money Out
Rp500.000

Classification:
OPERATING_EXPENSE
```

### Transfer rekening

```text
Money Out
Rp20.000.000

Classification:
INTERNAL_TRANSFER
```

---

# 20. Categories

Kategori merupakan layer berbeda dari classification.

Contoh expense categories:

```text
Pembelian Barang

Gaji & Upah

Marketing

Transportasi

Sewa

Utilitas

Software & Subscription

Professional Services

Bank & Payment Fees

Maintenance

Office Expenses

Entertainment

Tax

Other
```

Income:

```text
Sales

Services

Commission

Other Revenue

Other Income
```

---

# 21. Automatic Categorization

Categorization engine menggunakan:

- transaction description;
- previous transactions;
- merchant/supplier;
- keywords;
- user corrections;
- transaction amount;
- contextual history.

Contoh:

```text
"meta ads"
```

→ Marketing

```text
"google workspace"
```

→ Software & Subscription

```text
"bensin sales"
```

→ Transportation.

---

# 22. Confidence Score

Setiap automated classification memiliki confidence.

Contoh:

```text
0.96
```

Rule:

```text
>= 0.90
Auto accept

0.70–0.89
Accept + subtle suggestion

< 0.70
Needs Review
```

Threshold harus configurable.

---

# 23. Classification Source

Simpan asal classification:

```text
USER

RULE

AI

HISTORICAL_PATTERN

SYSTEM
```

Berguna untuk auditability.

---

# 24. Review Queue

Menu:

**Butuh Konfirmasi**

Contoh:

```text
Rp50.000.000

Transfer BCA

Ini transaksi apa?

[Transfer Antar Rekening]

[Pengeluaran Bisnis]

[Penarikan Pemilik]

[Lainnya]
```

---

# 25. Learning From Corrections

Jika user mengoreksi:

```text
"Facebook Ads"
```

dari:

```text
Other Expense
```

menjadi:

```text
Marketing
```

sistem menyimpan pattern.

Transaksi berikutnya dengan description serupa harus meningkatkan probability kategori Marketing.

---

# 26. Transactions Screen

Menampilkan seluruh transaksi.

Format:

```text
Today

+ Rp10.000.000
Penjualan
Sales

- Rp3.000.000
Meta Ads
Marketing
```

---

# 27. Search

User dapat mencari:

```text
meta
```

atau:

```text
bensin
```

atau nominal.

---

# 28. Filters

Filter:

```text
Money In

Money Out

Category

Classification

Date

Amount

Needs Review
```

---

# 29. Transaction Detail

Menampilkan:

```text
Rp3.000.000

Money Out

Meta Ads

2 September 2026

Category
Marketing

Classification
Business Expense

Tax Treatment
[system generated]

Attachment
receipt.jpg
```

User dapat:

- Edit
- Delete
- Duplicate

---

# 30. Recurring Transactions

Sistem dapat mendeteksi pola.

Contoh:

```text
Google Workspace

Rp1.500.000

setiap bulan
```

Sistem dapat menyarankan:

> Transaksi ini terlihat berulang setiap bulan.

MVP awal cukup mendeteksi pola; automatic creation dapat menjadi fitur lanjutan.

---

# 31. Accounts

Walaupun aplikasi bukan accounting system, konsep lokasi uang tetap berguna.

Contoh:

```text
Cash

BCA

Mandiri

GoPay

Other
```

User dapat memilih account secara optional.

---

# 32. Internal Transfer

Jika:

```text
BCA → Cash
```

sistem harus memahami bahwa:

```text
Business Expense = 0
Revenue = 0
```

walaupun terdapat perpindahan uang.

---

# 33. Overview / Insights

Halaman Insights menjawab:

> Apa yang sedang terjadi dengan bisnis saya?

---

# 34. Monthly Overview

Display:

```text
September 2026

Revenue
Rp142M

Business Expense
Rp92M

Cash Surplus
Rp40M
```

---

# 35. Expense Breakdown

Contoh:

```text
Inventory       Rp45M
Payroll         Rp20M
Marketing       Rp12M
Transportation  Rp5M
Others          Rp10M
```

Tampilkan persentase.

---

# 36. Revenue Trend

Chart:

```text
Jan
Feb
Mar
...
Sep
```

Metric:

```text
Monthly Revenue
```

---

# 37. Expense Trend

Chart pengeluaran bulanan.

---

# 38. Cashflow Trend

Chart:

```text
Money In
Money Out
Net Cashflow
```

---

# 39. Automated Financial Insights

Sistem menghasilkan insight otomatis.

Contoh:

> Pengeluaran marketing bulan ini naik 32% dibanding bulan lalu.

> Revenue September naik 18%.

> Pengeluaran transportasi berada 45% di atas rata-rata 6 bulan terakhir.

> Net cashflow positif selama tiga bulan berturut-turut.

---

# 40. Tax Center

Tax Center adalah differentiator utama produk.

Tujuan:

> Memberikan tax awareness dan tax planning tanpa meminta pengguna memahami perhitungan pajak secara mendalam.

---

# 41. Tax Profile

Saat onboarding, user mengisi profil pajak.

Contoh data:

```text
Business Type

Individual
PT Perorangan
PT
CV
Other
```

Data tambahan dapat mencakup:

```text
Tax status

PKP status

Business start date

Fiscal year

Applicable tax scheme

Tax settings
```

Field aktual harus mengikuti peraturan perpajakan yang berlaku.

---

# 42. Tax Rule Engine

Perhitungan pajak tidak boleh hard-coded ke transaction service.

Architecture:

```text
Transactions
      ↓
Financial Classification
      ↓
Tax Classification
      ↓
Tax Rule Engine
      ↓
Tax Calculation
      ↓
Tax Projection
```

Tax rules harus versioned.

Contoh:

```text
tax_rule_version
effective_from
effective_until
```

Tujuannya agar perubahan regulasi tidak mengubah historical calculation secara sembarangan.

---

# 43. Tax Overview

Contoh:

```text
Tax Overview
2026

Revenue YTD
Rp846.500.000

Projected Annual Revenue
Rp1.270.000.000

Estimated Tax
RpXX.XXX.XXX

Tax Paid
RpX.XXX.XXX

Remaining Estimated Tax
RpXX.XXX.XXX
```

---

# 44. Tax Reserve

Sistem menghitung rekomendasi dana pajak.

Contoh:

```text
Recommended Tax Reserve

Rp18.500.000
```

User dapat menandai:

```text
Rp10.000.000 already reserved
```

Maka:

```text
Additional Reserve Needed

Rp8.500.000
```

---

# 45. Tax Reserve Is Not Cash Transfer

Reserve merupakan virtual allocation.

Tidak harus memindahkan uang secara nyata.

Data:

```text
recommended_tax_reserve

reserved_amount
```

---

# 46. Safe To Spend

## 46.1 Overview

**Safe To Spend** adalah estimasi jumlah uang bisnis yang relatif tersedia untuk digunakan setelah memperhitungkan kewajiban dan dana yang sebaiknya tidak dibelanjakan.

Tujuan fitur ini adalah menjawab pertanyaan sederhana yang sering dimiliki pemilik bisnis:

> **"Dari uang yang saya punya sekarang, sebenarnya berapa yang relatif aman untuk saya gunakan?"**

Safe To Spend bukan saldo rekening dan bukan laba bisnis.

Safe To Spend merupakan **derived financial metric** yang dihitung sistem berdasarkan data transaksi, cash position, tax reserve, dan reserved funds lainnya.

## 46.2 Basic Formula

Pada versi awal:

```text
Safe To Spend =
Current Cash Position
- Recommended Tax Reserve
- Other Reserved Funds
```

Contoh:

```text
Current Cash Position
Rp100.000.000

Recommended Tax Reserve
Rp8.000.000

Other Reserved Funds
Rp12.000.000

Safe To Spend
Rp80.000.000
```

## 46.3 Current Cash Position

Current Cash Position merupakan estimasi uang bisnis yang tersedia berdasarkan transaksi yang tercatat.

Jika user menggunakan account tracking:

```text
Current Cash Position =
Cash
+ Bank Accounts
+ E-Wallets
+ Other Liquid Accounts
```

Contoh:

```text
BCA
Rp70.000.000

Cash
Rp10.000.000

GoPay
Rp2.000.000

Total Cash Position
Rp82.000.000
```

Internal transfer antar account tidak memengaruhi total cash position.

## 46.4 Opening Balance

Karena aplikasi hanya mengetahui transaksi sejak user mulai menggunakan aplikasi, sistem membutuhkan starting point.

Pada onboarding, user dapat memasukkan:

```text
Saldo bisnis saat ini
Rp__________
```

atau jika account tracking digunakan:

```text
BCA
Rp__________

Cash
Rp__________

Mandiri
Rp__________
```

Opening balance bukan:

```text
Revenue
```

dan tidak dihitung sebagai omzet.

Classification:

```text
OPENING_BALANCE
```

## 46.5 Recommended Tax Reserve

Tax Reserve berasal dari Tax Engine.

Contoh:

```text
Estimated Tax Liability YTD
Rp15.000.000

Tax Already Paid
Rp5.000.000

Recommended Tax Reserve
Rp10.000.000
```

Tax reserve kemudian dikurangi dari Safe To Spend.

## 46.6 Reserved Tax Amount

User dapat menandai bahwa sebagian dana secara mental atau aktual sudah dialokasikan untuk pajak.

Contoh:

```text
Recommended Tax Reserve
Rp10.000.000

Already Reserved
Rp7.000.000

Still Need To Reserve
Rp3.000.000
```

Sistem harus membedakan:

```text
Recommended Reserve

vs.

User Confirmed Reserve
```

agar user tidak mengira sistem benar-benar memindahkan uang.

---

# 47. Other Reserved Funds

Selain pajak, user dapat membuat reserve sederhana.

Contoh:

```text
Payroll
Rp20.000.000

Rent
Rp8.000.000

Supplier Payment
Rp15.000.000
```

MVP tidak perlu menjadi budgeting system.

Reserved funds hanya berfungsi sebagai:

> **uang yang sudah diketahui akan dibutuhkan dan sebaiknya tidak dianggap tersedia untuk dibelanjakan.**

Data model:

```text
Reserve

id
business_id

name
amount

due_date
status

created_at
updated_at
```

Status:

```text
ACTIVE
USED
CANCELLED
```

---

# 48. Safe To Spend Dashboard

Pada Home:

```text
Cash Available

Rp100.000.000


Safe To Spend

Rp72.000.000


Reserved

Tax                 Rp8.000.000
Payroll             Rp15.000.000
Supplier             Rp5.000.000
                    ────────────
Total Reserved      Rp28.000.000
```

User dapat tap Safe To Spend untuk melihat breakdown.

---

# 49. Safe To Spend Detail

Detail screen:

```text
Safe To Spend

Rp72.000.000
```

Breakdown:

```text
Cash Position

Rp100.000.000

────────────────────

Tax Reserve
- Rp8.000.000

Payroll Reserve
- Rp15.000.000

Supplier Reserve
- Rp5.000.000

────────────────────

Safe To Spend

Rp72.000.000
```

Tujuannya agar angka selalu explainable.

User harus dapat memahami:

> Dari mana angka Rp72 juta berasal?

---

# 50. Safe To Spend Confidence

Safe To Spend hanya seakurat data yang dicatat.

Karena itu sistem harus memiliki **data confidence indicator**.

Contoh:

```text
Safe To Spend

Rp72.000.000

Data confidence: High
```

atau:

```text
Safe To Spend

~Rp72.000.000

Data mungkin belum lengkap
```

---

# 51. Conditions Affecting Confidence

Confidence dapat turun jika:

```text
Unreviewed transactions > threshold
```

atau:

```text
Account balance has not been reconciled recently
```

atau:

```text
Tax profile incomplete
```

atau:

```text
Large transactions remain UNKNOWN
```

atau:

```text
Opening balance not configured
```

---

# 52. Safe To Spend Status

Sistem dapat menggunakan tiga status sederhana:

```text
HIGH_CONFIDENCE
MEDIUM_CONFIDENCE
LOW_CONFIDENCE
```

Contoh rule:

```text
HIGH

No significant unresolved transaction
Tax profile complete
Cash position considered current
```

```text
MEDIUM

Some unresolved transactions
or
cash data may be stale
```

```text
LOW

Opening balance missing
or
large unresolved transactions
or
tax profile incomplete
```

---

# 53. Low Confidence UX

Jika confidence rendah, jangan menampilkan angka seolah-olah pasti.

Contoh:

```text
Estimated Safe To Spend

~Rp72.000.000

⚠️ Estimasi ini mungkin belum akurat.

3 transaksi perlu dikonfirmasi.
```

CTA:

```text
Review Transactions
```

---

# 54. Negative Safe To Spend

Safe To Spend dapat bernilai negatif.

Contoh:

```text
Cash Position
Rp20.000.000

Tax Reserve
Rp8.000.000

Payroll Reserve
Rp15.000.000

Safe To Spend
-Rp3.000.000
```

Jangan mengubah angka menjadi:

```text
Rp0
```

karena informasi negatif tersebut penting.

UX:

```text
Safe To Spend

-Rp3.000.000

Reserved obligations exceed your
current available cash by Rp3.000.000.
```

---

# 55. Safe To Spend Insight

Sistem dapat menghasilkan contextual insight.

Contoh:

```text
Safe To Spend turun Rp12 juta
dibanding minggu lalu.
```

Reason:

```text
Tax reserve increased
+Rp4M

New payroll reserve
+Rp8M
```

---

# 56. Tax Reserve Changes

Jika revenue bertambah, tax engine dapat menaikkan recommended reserve.

Contoh:

Sebelum transaksi:

```text
Tax Reserve
Rp8.000.000
```

User mencatat:

```text
+ Rp100.000.000
Penjualan
```

Setelah calculation:

```text
Tax Reserve
Rp10.500.000
```

Safe To Spend otomatis berubah.

Tidak diperlukan tindakan manual.

---

# 57. Safe To Spend Event Architecture

Setiap event yang memengaruhi financial state harus memicu recalculation.

Contoh events:

```text
TRANSACTION_CREATED

TRANSACTION_UPDATED

TRANSACTION_DELETED

TRANSACTION_RECLASSIFIED

TAX_RULE_UPDATED

TAX_PROFILE_UPDATED

RESERVE_CREATED

RESERVE_UPDATED

RESERVE_REMOVED

ACCOUNT_BALANCE_UPDATED
```

Flow:

```text
Financial Event
      ↓
Cash Position Recalculation
      ↓
Tax Calculation
      ↓
Reserve Calculation
      ↓
Safe To Spend Recalculation
```

---

# 58. Automatic Recalculation

Safe To Spend tidak boleh disimpan sebagai angka statis tanpa source information.

Sistem harus dapat menghitung ulang berdasarkan financial state terbaru.

Recommended architecture:

```text
Financial State

cash_position
tax_reserve
other_reserves

↓

Safe To Spend Engine

↓

safe_to_spend
```

Historical snapshots dapat disimpan untuk analytics.

---

# 59. Safe To Spend History

Sistem dapat menyimpan daily snapshot:

```text
Date
Cash Position
Tax Reserve
Other Reserve
Safe To Spend
```

Contoh:

```text
Aug 29    Rp85M
Aug 30    Rp81M
Aug 31    Rp79M
Sep 01    Rp76M
Sep 02    Rp72M
```

Data ini memungkinkan trend analysis.

---

# 60. Safe To Spend Trend

Insight screen dapat menampilkan:

```text
Safe To Spend

Rp72M

↓ Rp8M this month
```

Chart:

```text
Aug 1 ───────────── Sep 2
```

---

# 61. Safe To Spend Forecast — Future Phase

Pada fase lanjutan, sistem dapat memperhitungkan expected cashflow.

Formula menjadi:

```text
Projected Safe To Spend =
Current Cash
+ Expected Cash In
- Expected Cash Out
- Tax Reserve
- Reserved Obligations
```

Contoh:

```text
Current Cash
Rp100M

Expected Income
+Rp30M

Expected Payroll
-Rp20M

Tax Reserve
-Rp10M

Projected Safe To Spend
Rp100M
```

Fitur ini bukan prioritas MVP karena membutuhkan data future cashflow yang lebih reliable.

---

# 62. Safe To Spend Guardrails

Safe To Spend tidak boleh dikomunikasikan sebagai:

> "Uang yang pasti aman dibelanjakan."

Gunakan wording:

> "Estimasi dana yang tersedia setelah reserve yang diketahui."

Reason:

Sistem mungkin tidak mengetahui:

- invoice supplier yang belum dicatat;
- utang bisnis;
- pengeluaran mendatang;
- transaksi offline yang belum dimasukkan;
- kewajiban kontraktual;
- perubahan peraturan pajak;
- transaksi yang belum dikategorikan.

---

# 63. Safe To Spend Product Principle

Safe To Spend harus mengikuti prinsip:

```text
Simple
Explainable
Conservative
Transparent
Actionable
```

Jika sistem ragu, lebih baik:

```text
Rp72M estimated
```

daripada memberikan false precision.

---

# 64. Safe To Spend MVP Scope

### P0

MVP wajib mendukung:

- Current Cash Position
- Tax Reserve
- Manual Other Reserve
- Safe To Spend calculation
- Breakdown
- Automatic recalculation
- Negative Safe To Spend
- Basic confidence warning

### P1

Setelah MVP:

- reserve due dates;
- Safe To Spend trend;
- automatic recurring reserve suggestions;
- reserve reminders;
- improved confidence scoring.

### P2

Future:

- projected Safe To Spend;
- expected cashflow;
- AI reserve recommendations;
- automatic upcoming obligation detection;
- bank balance integration;
- scenario simulation.

---

# 65. Safe To Spend Success Criteria

Fitur dianggap berhasil jika user dapat menjawab tiga pertanyaan dalam <5 detik:

1. **Berapa uang bisnis saya sekarang?**
2. **Berapa yang sebaiknya tidak saya gunakan?**
3. **Berapa yang relatif tersedia untuk digunakan?**

Contoh final UX:

```text
Cash

Rp100.000.000


Reserved

Rp28.000.000


SAFE TO SPEND

Rp72.000.000


Tax Reserve          Rp8M
Payroll Reserve     Rp15M
Supplier Reserve     Rp5M
```

Dengan demikian Safe To Spend menjadi jembatan antara **pencatatan transaksi** dan **keputusan finansial sehari-hari**, tanpa mengharuskan pengguna memahami laporan akuntansi formal.

---

# 66. MVP Product Scope

MVP berfokus pada:

1. Authentication & onboarding
2. Business/tax profile
3. Opening balance
4. Money In
5. Money Out
6. Automatic transaction classification
7. Transaction history
8. Review queue
9. Cashflow dashboard
10. Revenue & expense summary
11. Basic Insights
12. Tax Engine
13. Tax Overview
14. Tax Reserve
15. Safe To Spend
16. PWA installation
17. Basic offline resilience

Fitur yang menambah aktivitas administratif user harus ditunda kecuali benar-benar diperlukan untuk menghasilkan tax/cashflow intelligence.

---

# 67. Product North Star

Prinsip utama produk:

> **User records money. The system handles the rest.**

Aktivitas rutin user harus tetap didominasi oleh:

```text
Money In
Money Out
Review Exception
```

Bukan:

```text
Accounting Administration
```

Semakin lama aplikasi digunakan, sistem seharusnya semakin memahami pola bisnis sehingga jumlah aktivitas manual pengguna semakin berkurang.
