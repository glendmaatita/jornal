# Tax compliance rule registry

Last legal-source review: 17 September 2026. This document records product behavior, not tax advice. The canonical runtime registry is `backend/pocketbase/pb_hooks/tax_rules.js`; PocketBase snapshots the selected rule ID/version and statutory/effective dates into every obligation. `src/lib/tax-compliance-rules.ts` is a typed, tested client reference only and never calculates persisted obligations.

## Automatic templates

| Template | Payment baseline | Filing baseline | Nil/deemed-filing behavior | Sources |
| --- | --- | --- | --- | --- |
| PPh Final UMKM | Day 15 next month | Day 20 next month; validated self-payment may fulfil filing when all legal conditions apply | Rule-specific; zero does not mean filed | PMK 81/2024 arts. 94, 171–173; PP 20/2026 |
| PPh 21/26 payroll | Day 15 next month | Day 20 next month | Rule-specific | PMK 81/2024 arts. 94, 171–173 |
| PPh Unification components (4(2), 15, 22, 23/26) | Day 15 next month for the general template | Day 20 next month | Rule/object-specific | PMK 81/2024 arts. 94, 171–173 |
| PPh 25 | Day 15 next month | Validated payment may fulfil filing when legal conditions apply | Rule-specific | PMK 81/2024 arts. 94, 171 |
| General PPN/PPnBM | End of next month and before filing | End of next month | A PKP may still have a nil return | PMK 81/2024; DJP deadline overview |
| SPT Annual individual | PPh 29, if any, before filing | Three months after fiscal-year end | Annual filing remains separate from monthly final-tax settlement | PMK 81/2024; DJP deadline overview |
| SPT Annual entity | PPh 29, if any, before filing | Four months after fiscal-year end | Annual filing remains required according to registration/status | PMK 81/2024; DJP deadline overview |

The registry stores the statutory date. An official extension, penalty-relief date, and user snooze are separate fields. `tax_calendar.js` contains reviewed national-holiday and nationally declared collective-leave fixtures for 2025, 2026, and 2027. PMK 81/2024 article 100 is applied to the general payment templates: Saturday, Sunday, national holiday, national election holiday, and nationally declared collective leave move payment to the next working day. A year without an installed calendar is explicitly `PROVISIONAL`; only its weekend shift is applied. Document/local templates remain `USER_CONFIRMED` and are not silently changed.

The UMKM registry has two effective snapshots: `PPH_FINAL_UMKM_PP55_2022` through 21 April 2026 and `PPH_FINAL_UMKM_PP20_2026` from 22 April 2026. Eligibility is always confirmed by the user; the engine does not infer entitlement from projected turnover.

## Manual/document templates

PPN special cases, PBB, local taxes, stamp duty, assessments/installments, and other sector-specific obligations require a date and amount from the governing document or a separately reviewed rule. They never inherit the PPh 15/20 defaults. PBB-P2 and local-tax rules depend on the local authority.

## Amount policy

Only eligible PPh Final UMKM uses an automatic amount in the first release. It uses actual reconciled revenue for the whole tax subject. The Rp500 million individual allowance is cumulative across all companies and external business revenue belonging to that subject; it is not repeated per company. Missing eligibility or revenue produces `UNKNOWN`/`NEEDS_REVIEW`, never a fabricated zero.

Other templates accept a confirmed amount and provenance from payroll, Coretax, a return, an invoice reconciliation, a withholding slip, or an assessment. “Confirmed” means confirmed by the user/document, not independently verified by DJP.

## Primary references

- PMK 81/2024 consolidated page and amendment history: https://jdih.kemenkeu.go.id/dok/pmk-81-tahun-2024
- DJP full text for PMK 81/2024: https://stats.pajak.go.id/en/node/113110
- PP 20/2026: https://jdih.kemenkeu.go.id/dok/pp-20-tahun-2026
- DJP deadline overview: https://www.pajak.go.id/en/node/35019
- DJP payment-deadline update: https://www.pajak.go.id/id/berita/pemerintah-sederhanakan-jatuh-tempo-pembayaran-pajak-lewat-peraturan-menkeu
- DJP PBB administration overview: https://www.pajak.go.id/id/artikel/pajak-bumi-dan-bangunan-siapakah-yang-mengelola
- PMK 81/2024 full text, article 100 holiday shift: https://jdih.kemenkeu.go.id/download/637047be-3dba-4347-aba1-98fa7fd5ab3f/2024pmkeuangan081.pdf
- Official 2025 holiday/collective-leave list and amendment: https://kemenkopmk.go.id/pemerintah-tetapkan-hari-libur-nasional-dan-cuti-bersama-tahun-2025 and https://www.kemenkopmk.go.id/pemerintah-tetapkan-cuti-bersama-18-agustus-2025-untuk-peringatan-hut-ke-80-ri
- Official 2026 holiday/collective-leave list: https://kemenkopmk.go.id/pemerintah-tetapkan-17-hari-libur-nasional-dan-8-hari-cuti-bersama-tahun-2026
- Official 2027 holiday/collective-leave list: https://www.kemenkopmk.go.id/node/6444
