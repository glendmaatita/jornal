# Remediation evidence

This index records evidence from the current `develop` branch. A local pass does not close checks that require a real device, configured OAuth client, push runtime, or production deployment.

## Local verification

| Evidence | Command / scenario | Result |
| --- | --- | --- |
| Regression suite | `bun test` | 216 tests passed, 0 failed |
| Type safety | `bun run typecheck` | Passed |
| Static checks | `bun run lint` | Passed |
| Production bundle | `bun run build` | Passed; 48 precache entries, editor remains lazy |
| Preview compression and headers | Built Jornal preview on isolated port 4174; `GET`/`HEAD` probes against a hashed JS asset | Health `200` with `{"status":"ok"}`; `GET`: `200`, gzip + `Vary: Accept-Encoding`, immutable cache; `HEAD`: `200`, no body, explicit `content-length`, security headers |
| Fresh PocketBase schema | `pocketbase migrate up --dir <disposable-dir> --migrationsDir backend/pocketbase/pb_migrations` | Migrations 0001–0005 applied |
| Sync transport | `bun test src/lib/pocketbase-sync.test.ts` | 19 tests passed, including multipart attachments, pagination, conflicts, and empty responses |

## Implemented and locally evidenced

- Account-scoped local storage and query keys, auth partition switching, durable IndexedDB mirror, drafts, backup/restore validation, and reset outbox clearing (F01, F04, F12, W01, W05).
- Auth storage changes from another tab now reset the sync generation, switch the tenant partition, and clear React Query caches before the next render (F01, F09).
- Business mutations now persist their IndexedDB mirror and sync outbox in one read/write transaction; a failed transaction raises the existing storage recovery notice instead of silently acknowledging durability (F04, W01).
- Transaction drafts are mirrored to IndexedDB and restored when localStorage is empty, so a refresh or service-worker restart can recover an unfinished entry (F12, W01, W05).
- Successful transaction saves now remove both the localStorage draft and its durable mirror, preventing stale drafts from resurfacing after recovery (F12).
- Explicit data reset now removes all active-tenant draft keys from localStorage and the durable mirror before clearing the outbox (F13, W05).
- Reset now acknowledges only the active tenant's outbox keys, so one account cannot discard another account's pending operations (F01, F13).
- Reset navigation now waits for scoped IndexedDB mirrors and outbox cleanup to complete before opening onboarding (F13).
- Backup import rejects files larger than 10 MB before reading them, keeping recovery responsive under oversized input (F04, W05).
- Transaction search now has an explicit associated label for assistive technology (U07).
- The static server now sends clickjacking, referrer, permissions, and opener isolation headers while retaining OAuth popup compatibility (F06, U07).
- Hydrated receipt records now persist a stable file endpoint without a signed token; detail view requests a fresh token only when opening the file (F05).
- Static asset `HEAD` requests now return headers only with an explicit content length, while `GET` retains negotiated gzip delivery (P05).
- Login now provides iOS Safari installation guidance when the native install prompt API is unavailable (W03).
- The `/pb` reverse proxy now bounds upstream requests to 30 seconds and returns a localized `504` JSON error on an unavailable PocketBase (F09, P05).
- Calendar day controls now announce full dates and expose selected state to assistive technology (U07).
- Health and PocketBase proxy error responses now send `Cache-Control: no-store`, preventing stale operational status from being cached (F09, P05).
- Financial explanation copy now states loan, opening-balance, and forecast treatment directly without repeated contrast phrasing (U08).
- Transaction form submission now ignores Enter/button re-submits while a save mutation is pending (U03).
- Editing a transaction preserves its stable receipt reference, while the form now offers an explicit Hapus action that removes the attachment on save (F05, U04).
- Local-only startup restores the IndexedDB mirror even when PocketBase is disabled; storage and IndexedDB failures raise a visible recovery notice (F04, W01, W05).
- Revision/tombstone metadata, tenant PocketBase rules, server 409 conflict persistence, bounded retries, caller-aware request timeouts, and merge-preserving hydration (F02, F03, F09, W04).
- Transient sync retries now use capped exponential backoff with bounded jitter to avoid synchronized retry storms (F09, W04).
- Choosing the local side of a sync conflict now reads the current tenant-scoped record, preserving a pending local receipt even though conflict logs omit attachment data (F02, F05).
- Lazy onboarding/editor routes, explicit icon imports, bounded transaction rendering, solid surfaces, Indonesian document language, and mobile camera activation (P02–P07, U04, U06–U09, W02–W03).
- Install prompt handling on login and authenticated routes, offline status/retry UI, persistent storage request, and pending-review app badge (W02–W05, W08). Shortcut/share intent now survives login and onboarding; device acceptance remains pending (W06–W07).

## Still requires external evidence

- Interactive Google OAuth cold/warm callback behavior with the configured client (F06, W04).
- Real iPhone/Android install, camera, keyboard, offline restart, share, and accessibility checks (F12, U01–U07, W03, W06–W07).
- Protected receipt access across tenants, expiry renewal, resumable upload, and blob retention against a deployed PocketBase (F05, Phase 4).
- Closed-app push delivery, scheduler retries, unsubscribe cleanup, and badge behavior (W08).
- Production rollout, populated-database upgrade/rollback, old service-worker compatibility, and post-deploy health/sync checks (Phase 9).
