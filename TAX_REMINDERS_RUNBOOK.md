# Tax compliance operations runbook

Last verified: 17 September 2026. The feature is an agenda and evidence system; it does not submit returns, create billing codes, pay tax, or verify data with DJP/Coretax.

## Release controls

The browser flag is compiled at build time:

```sh
VITE_TAX_COMPLIANCE_ENABLED=true
```

The backend agenda and email worker have independent runtime controls:

```sh
JORNAL_TAX_COMPLIANCE_ENABLED=true
JORNAL_TAX_EMAIL_ENABLED=false
```

Roll out schema and in-app reminders first. Configure SMTP and verify a test recipient before enabling `JORNAL_TAX_EMAIL_ENABLED`. Turning email off stops new email delivery without deleting agenda, inbox, audit, or evidence records. Turning the compliance flag off makes custom tax endpoints reject requests; it does not delete data.

## Deployment

1. Back up `/pb/pb_data` with the normal PocketBase backup procedure.
2. Deploy the image with PocketBase 0.40.2. Migration `20260916_0007_tax_compliance.js` is non-destructive on rollback and does not create subjects from existing companies.
3. Keep `JORNAL_TAX_EMAIL_ENABLED=false`; sign in with an internal tenant and explicitly configure its subject/company memberships and registrations.
4. Run the worker once through `POST /api/jornal/admin/tax/run-jobs` using superuser auth.
5. Inspect `GET /api/jornal/admin/tax/health`. Expected: no stuck leases and no unexplained permanent/unknown delivery failures.
6. Verify in-app agenda, a manual amount, partial/full payment, filing, protected evidence download, CSV, and backup preview/restore.
7. Configure PocketBase SMTP in the admin settings. Email is sent only when the runtime flag is true, the subject preference is opt-in, and the login email is verified.
8. Enable email for an internal tenant first. Confirm one digest and dedupe behavior before broad rollout.

Never put NPWP/NIK, document content, or monetary amounts in operational logs. Amounts appear in email only if the subject-level `include_amount_in_email` opt-in is enabled.

## Monitoring and recovery

`GET /api/jornal/admin/tax/health` reports the feature flags, SMTP configuration state, and counts for `PENDING`, `LEASED`, `RETRYABLE_FAILED`, `PERMANENTLY_FAILED`, `UNKNOWN`, and `SENT` deliveries.

- `LEASED` older than five minutes is recovered as `UNKNOWN`; do not blindly resend because SMTP outcome may be unknown.
- Retryable SMTP errors use exponential backoff and become permanent after repeated attempts.
- A changed deadline or preference creates a new schedule version and cancels obsolete pending jobs.
- Scheduler execution is backend-only (`*/5 * * * *`), so the browser may remain closed.
- In-app and email share a dedupe key but are separate channels. Re-running the worker must not duplicate either record.
- The best-effort custom-route limiter permits 180 standard or 12 evidence/import/export tax requests per identity per minute; PocketBase's deployment-wide limiter should remain enabled as the outer control.

If SMTP is failing, set `JORNAL_TAX_EMAIL_ENABLED=false`, restart PocketBase, preserve the queue, repair SMTP, then re-enable after reviewing `UNKNOWN` items. Do not mark unknown deliveries sent without external evidence.

## Rule and calendar maintenance

The canonical rules live in `backend/pocketbase/pb_hooks/tax_rules.js`; the official working-day fixtures live in `tax_calendar.js`. Every change requires:

1. a consolidated official source and effective interval;
2. a new rule ID/version rather than rewriting historical snapshots;
3. updated fixtures in `docs/tax/rules.md` and backend tests;
4. review of nil/deemed-filing behavior and whether the rule applies to payment, filing, or both.

Years without a reviewed official calendar are shown as `PROVISIONAL`. PPN special, PBB, local taxes, stamp duty, assessments, and other document-specific registrations remain manual and must retain their source/reference.

## Backup, restore, and evidence

The UI exports a checksum-protected JSON manifest and a UTF-8 CSV yearly recap. Restore always runs a preview, supports explicit company ID remapping, merges natural keys, is command-idempotent, and disables notification opt-ins. Ledger transaction links are intentionally not recreated during restore.

Evidence is tenant-private and downloaded only through the authenticated custom endpoint. Allowed formats are PDF, JPEG, and PNG, maximum 10 MB. Backup format v1 includes evidence metadata and checksums but not document bytes; retain the PocketBase data-volume backup for full document disaster recovery or upload files again after a JSON restore.

## Verification gates

Install the pinned runtime and browser once:

```sh
export POCKETBASE_BIN=/absolute/path/to/pocketbase-0.40.2
bun install
bunx playwright install chromium
```

Run all gates:

```sh
bun run typecheck
bun run lint
bun test
bun run build
bun run test:tax:integration
bun run test:tax:e2e
```

The integration harness exits with code 2 if PocketBase 0.40.2 is absent or mismatched; it never silently skips through the package script. It exercises fresh/upgrade migrations, tenant/company isolation, shared-subject cumulative UMKM, unknown/partial/paid/overpaid/reversed states, annual credits, ledger guards, protected evidence, scheduler dedupe, a real local SMTP sink, CSV, and idempotent restore. The Playwright gate uses a temporary database and auth fixture and covers setup → reconciliation → amount → payment → filing → CSV download.

Recorded result on 17 September 2026:

- typecheck: pass
- lint: pass
- unit/full suite: pass (257 tests, 694 assertions; 4 integration cases intentionally skipped only in the unprovisioned unit command)
- build: pass
- PocketBase integration: pass (4 tests, 311 assertions; no skip)
- Playwright Chromium: pass (1 end-to-end test)

Update this block with the final command counts before each production release.
