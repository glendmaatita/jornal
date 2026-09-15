# Remediation evidence

This index records evidence from the current `develop` branch. A local pass does not close checks that require a real device, configured OAuth client, push runtime, or production deployment.

## Local verification

| Evidence | Command / scenario | Result |
| --- | --- | --- |
| Regression suite | `bun test` | 216 tests passed, 0 failed |
| Type safety | `bun run typecheck` | Passed |
| Static checks | `bun run lint` | Passed |
| Production bundle | `bun run build` | Passed; 48 precache entries, editor remains lazy |
| Preview compression | `curl -sSI -H 'Accept-Encoding: gzip' http://127.0.0.1:4173/assets/<hashed>.js` | `200`; `Content-Encoding: gzip`, `Vary: Accept-Encoding`, immutable cache |
| Fresh PocketBase schema | `pocketbase migrate up --dir <disposable-dir> --migrationsDir backend/pocketbase/pb_migrations` | Migrations 0001–0005 applied |
| Sync transport | `bun test src/lib/pocketbase-sync.test.ts` | 19 tests passed, including multipart attachments, pagination, conflicts, and empty responses |

## Implemented and locally evidenced

- Account-scoped local storage and query keys, auth partition switching, durable IndexedDB mirror, drafts, backup/restore validation, and reset outbox clearing (F01, F04, F12, W01, W05).
- Local-only startup restores the IndexedDB mirror even when PocketBase is disabled; storage and IndexedDB failures raise a visible recovery notice (F04, W01, W05).
- Revision/tombstone metadata, tenant PocketBase rules, server 409 conflict persistence, bounded retries, caller-aware request timeouts, and merge-preserving hydration (F02, F03, F09, W04).
- Lazy onboarding/editor routes, explicit icon imports, bounded transaction rendering, solid surfaces, Indonesian document language, and mobile camera activation (P02–P07, U04, U06–U09, W02–W03).
- Install prompt handling on login and authenticated routes, offline status/retry UI, persistent storage request, and pending-review app badge (W02–W05, W08). Shortcut/share intent now survives login and onboarding; device acceptance remains pending (W06–W07).

## Still requires external evidence

- Interactive Google OAuth cold/warm callback behavior with the configured client (F06, W04).
- Real iPhone/Android install, camera, keyboard, offline restart, share, and accessibility checks (F12, U01–U07, W03, W06–W07).
- Protected receipt access across tenants, expiry renewal, resumable upload, and blob retention against a deployed PocketBase (F05, Phase 4).
- Closed-app push delivery, scheduler retries, unsubscribe cleanup, and badge behavior (W08).
- Production rollout, populated-database upgrade/rollback, old service-worker compatibility, and post-deploy health/sync checks (Phase 9).
