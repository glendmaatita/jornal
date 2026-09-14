# Jornal remediation plan

Date: 14 September 2026

Code baseline: `769548e` on `develop`

Status: planned; this document does not mark implementation complete.

This plan covers every finding and improvement in the assessment of `b92dfda`, including the items only partly addressed by `ef9c5d8` and `769548e`. It supplements [ROADMAP.md](ROADMAP.md). The inventory below is self-contained; execution must not depend on the original audit files remaining in `/tmp/jornal-code-audit`.

## Completion rule

“Zero gaps” means every item in this inventory has an implemented outcome and passing acceptance evidence. Passing lint, unit tests, and a build alone does not close a browser, data migration, security, or device behavior finding. It does not mean a guarantee that no unknown bugs exist.

- **Open:** implementation remains.
- **Partial:** some changes exist, but the complete behavior is missing or unverified.
- **Verified:** acceptance checks pass, with the tested commit, environment, command/scenario, and evidence recorded.
- **Blocked:** a named prerequisite is missing. Blocked items remain open for completion counting.

No item is Verified at plan creation. Existing tests and earlier browser measurements are useful baselines, not evidence for every subsequent change. Unsupported platform APIs can close only with a tested, documented fallback that delivers the stated outcome. Missing credentials, device access, or production verification cannot be relabeled as completed work.

Execution uses local `bun run dev` and native PocketBase. Infrastructure application, cluster operations, external OAuth changes, and production activation are separate rollout steps; writing this plan does not perform them. Keep credentials out of source, logs, exports, and test artifacts.

## Complete inventory

Phase numbers refer to the execution packages below. Each row is a closure obligation, including items previously described as optional PWA enhancements.

### Reliability, correctness, and privacy

| ID | Finding and current state | Phase | Required outcome |
| --- | --- | --- | --- |
| F01 | Account isolation — Partial; storage prefixes exist, query keys and running jobs remain unsafe | 1–2 | Storage, drafts, blobs, caches, jobs, and events belong to a captured user; account changes cannot display or upload another user's data. |
| F02 | Destructive synchronization — Partial; absence-based deletes removed, hydration still replaces local arrays | 2 | Durable operations, server revisions, explicit tombstones, conflict recovery, and safe merges for every entity. |
| F03 | Schema/query mismatch — Partial; autodate migration tested on a fresh local database | 0, 2 | Fresh and populated upgrades work against real PocketBase APIs, including pagination, indexes, and new protocol metadata. |
| F04 | Silent storage failure and oversized data URLs — Open | 1, 4 | Atomic durable saves, visible failure, bounded blobs, and recoverable migration/export. |
| F05 | Receipt privacy and expiring URLs — Partial; protection migration exists, persisted token URLs remain | 4 | Tenant-protected access, stable file identities, renewable downloads, and safe local receipt storage. |
| F06 | Service-worker OAuth interception — Partial; backend exclusions added | 5, 9 | Cold and controlled-client OAuth callbacks reach PocketBase; backend and health paths never receive the app shell. |
| F07 | Balance changes on untouched blur — Partial; handler guards added | 3 | Untouched fields preserve values; invalid edits are explained; actual edits persist exactly once. |
| F08 | Offline status obstructs entry — Partial; banner moved, dismissal still incomplete | 5–6 | Status never blocks navigation/save; dismissal works independently of connectivity. |
| F09 | Hidden sync failures and missing retry — Partial; empty response and initialization handling improved | 2, 5 | Visible durable queue, bounded retries, auth recovery, reconnect/resume draining, and one coordinator. |
| F10 | Inconsistent classification — Partial; select and review fixes do not cover every write path | 3 | One normalization/validation contract for entry, edits, review, duplication, imports, parsing, and recurrence. |
| F11 | Inactive reserves in historical balances — Partial; one history path changed | 3 | Correct date-specific reserve status in persisted and legacy history paths. |
| F12 | Lost drafts, camera activation, and form friction — Partial; delayed picker click is insufficient | 1, 6 | Recoverable drafts, reliable capture, accessible submission, and manual choices preserved. |
| F13 | Duplicate recurrence and incomplete reset — Open | 2–3 | Idempotent occurrences, anchored schedules, explicit catch-up, and confirmed reset that cannot resurrect old state. |
| F14 | Onboarding before hydration — Open | 3 | Resolve existing/new/unknown account state before offering business creation. |

### Loading and latency

| ID | Finding — all Open | Phase | Required outcome |
| --- | --- | --- | --- |
| P01 | Full-entity reads and writes for every sync | 2, 7 | Incremental pull and dirty-operation upload; no repeated full listing per record. |
| P02 | Eager rich-text form bundle | 6–7 | Basic entry does not load the editor or optional attachment-processing code. |
| P03 | Large eager entry graph, onboarding, and icons | 7 | Lazy routes and explicit icon imports; measure actual transfer and execution cost. |
| P04 | All routes precached without a coverage strategy | 5, 7 | Defined offline core, bounded install transfer, recoverable optional routes. |
| P05 | Hashed asset cache mismatch and missing compression | 7 | Correct immutable asset caching, negotiated compression, and safe HTML/SW update headers. |
| P06 | Repeated history reads and duplicate series calculation | 3, 7 | One consistent snapshot and shared series, with bounded main-thread work. |
| P07 | Cached-array mutation, unbounded lists, repeated invalidation | 7 | Immutable filtering, bounded rendering, and one targeted invalidation per change. |

### Mobile UI and entry speed

| ID | Improvement — all Open unless noted | Phase | Required outcome |
| --- | --- | --- | --- |
| U01 | Compact mode choice, amount hierarchy, recent templates and defaults | 6 | Readable segmented modes; today and user-specific last-used defaults; one-tap template draft. |
| U02 | Immediate quick-text entry | 6 | Existing local parser produces an editable preview without a network dependency. |
| U03 | Reachable Save and batch entry | 6 | Keyboard/safe-area-aware Save and “save and add another”; no duplicate submissions. |
| U04 | Optional fields and receipt intake | 4, 6 | Progressive fields and direct camera/upload with clear processing and error states. |
| U05 | Safe duplication | 6 | Duplicate opens an editable draft dated today and saves only after review. |
| U06 | Mobile typography — Partial | 6 | Consistent readable text and touch targets; amount styling survives global field CSS. |
| U07 | Accessibility and language | 6, 9 | Labels, described errors, keyboard controls, focus management, and Indonesian document language. |
| U08 | Copy clarity and accuracy — Partial | 6, 9 | Concise Indonesian on all routes; clear financial meaning; no unexplained English, section markers, or internal configuration errors. |
| U09 | Visual hierarchy and meaningful icons — Partial | 6 | Solid surfaces, consistent icon treatment, compact summaries, and usable populated/empty/error states. |

### PWA capabilities

| ID | Improvement and current state | Phase | Required outcome |
| --- | --- | --- | --- |
| W01 | Reliable offline writes — Open | 1–2 | Restart-safe data and outbox with separate device-save and server-sync status. |
| W02 | Registration, routing, and safe updates — Partial | 5 | Single root registration, login coverage, backend exclusions, and draft-safe updates. |
| W03 | Installation lifecycle — Partial | 5 | Shared install state, correct consumed-event handling, installed detection, and iPhone/manual guidance. |
| W04 | Resume, reconnect, background sync, offline auth — Open | 2, 5 | Shared retry protocol, feature-detected background execution, reliable foreground fallback, and explicit expired-session behavior. |
| W05 | Storage protection, recovery, offline receipts — Open | 1, 4, 8 | Persistence request, usage visibility, validated export/import, and explicit receipt availability. |
| W06 | Dedicated shortcuts — Open | 6, 8 | Money in, money out, camera, and general entry shortcuts with validated route parameters. |
| W07 | Share receipt intake — Open | 4, 8 | Supported share targets create recoverable review drafts; normal upload remains available. |
| W08 | Opt-in reminders and badges — Open | 8 | Server-backed delivery, subscription lifecycle, pending-review badges, and useful unsupported/denied-permission states. |

## Execution packages

### Phase 0 — Establish trustworthy regression evidence

1. Move reusable audit reproductions into the repository's test structure. Update browser fixtures to the current account-scoped storage format; do not remove scenarios merely because old fixtures stopped loading.
2. Preserve the existing suite and record lint, typecheck, test, and build baselines using the scripts in `package.json`.
3. Start an isolated native PocketBase instance with disposable fixture data. Exercise actual status codes, rules, file requests, pagination beyond 200 records, and fresh/populated migrations. Mock network failures deliberately, without replacing all backend integration coverage.
4. Capture current mobile layouts and current performance measurements. Earlier numbers such as 209 requests per 100 transactions and the roughly 404 kB form chunk describe the audit baseline, not a new measurement.
5. Establish an evidence index containing item ID, tested commit, scenario, command, outcome, and artifact location. Store sanitized fixtures and reproducible commands in the repo.

**Exit:** each inventory item maps to an acceptance scenario; reproduced failures remain visible until the responsible phase fixes them.

### Phase 1 — Durable, account-scoped local data

Primary areas: `src/lib/store.ts`, `src/lib/queries.ts`, auth lifecycle, all store callers, and a new local repository layer.

1. Introduce versioned IndexedDB stores for records, history, draft state, attachment blobs, sync cursors, conflicts, and outbox operations. Scope every entry by authenticated identity; preserve the current single-business model without treating the literal `local` identifier as an ownership boundary.
2. Commit a business mutation, its history, and its outbox entry in one transaction. Resolve Save only after durable success. Surface quota, permission, database-open, migration, and transaction failures; retain entered data on failure.
3. Convert synchronous consumers and route assumptions deliberately to the repository's asynchronous loading/error model. A half-migrated localStorage/IndexedDB split must not become two competing sources of truth.
4. Migrate owned prefixed data and attachments resumably. Retain legacy source data until counts and integrity checks pass. Unscoped legacy records have ambiguous ownership: preserve them for recovery and explicit adoption; never automatically upload them under the next login.
5. Add user IDs to query keys and event payloads. On logout/account change, cancel queries and sync, clear active rendered caches, release blob URLs, and switch repositories before another account renders. Listen to authentication changes across tabs.
6. Keep drafts and pending records available to their owner after restart; clearly distinguish logout from an explicit “remove data from this device” action.

**Exit:** two accounts switching in one and two tabs cannot read or upload each other's data; offline records/drafts/blobs survive restart; an injected failed write produces no success message or half-written history; interrupted migration resumes without duplication or loss.

### Phase 2 — Versioned sync and backend integrity

Primary areas: `src/lib/pocketbase-sync.ts`, PocketBase migrations/hooks, repository outbox, sync status UI.

1. Define one protocol for all currently synchronized entities, including singletons, histories, corrections, and recurring rules. Use tenant ownership checks, stable record IDs, operation IDs, server revisions, and server-maintained ordering for incremental pulls.
2. Enforce idempotency and conditional writes on the server. A client-side revision check alone is insufficient. Add required uniqueness/index constraints and reject payload ownership spoofing.
3. Replace snapshot uploads/hydration with durable operation acknowledgements and merge-based pulls. Apply remote changes and advance the pull cursor atomically. Empty remote results must not erase pending work or preserve acknowledged remote deletions incorrectly.
4. Represent deletion explicitly with versioned tombstones, including singleton reset. Define edit/delete and restore/delete conflicts. Retain tombstones until a documented retention/resync policy protects long-offline devices.
5. Preserve both versions of conflicting financial edits and offer a clear resolution screen. Safe independent-field merges may be automatic; amounts, accounts, dates, and classification conflicts must not silently choose a winner.
6. Run one drain per user across tabs using a lock/lease with crash recovery. Freeze identity for each job and abort obsolete work on auth change. Serialize dependent operations, bound concurrency, set timeouts, and distinguish offline/transient/auth/validation/conflict failures.
7. Retry transient failures with bounded exponential backoff and jitter. Resume on startup, connectivity recovery, and focus; offer manual retry. Display saved on device, pending, syncing, synced, conflict, and action-required states accurately.
8. Handle 204/empty success responses. Refresh authentication online when supported by the configured flow; otherwise require reauthentication without losing queued data.
9. Plan protocol rollout so cached old clients cannot bypass revisions or upload old snapshots. Add a write-version gate and upgrade path before activating new writes. Back up and validate populated migrations; do not rely on timestamp sorting alone for a lossless delta cursor.

**Exit:** two isolated clients pass offline-create/edit/delete, concurrent-edit, delete-versus-edit, interrupted acknowledgement, duplicate retry, long-offline reconnect, account-switch-during-request, and multi-tab tests. More than 200 rows sync without omissions. Unchanged records produce no writes. Permission-denied and expired-session failures remain visible and recoverable.

### Phase 3 — Financial consistency and account lifecycle

Primary areas: domain normalization, `store.ts`, `history.ts`, settings, router/onboarding, recurring rules.

1. Centralize validation and derived classification fields across every write path. Validate effective transfer classification regardless of which control or parser produced it; require valid distinct source/destination accounts. Prevent mismatches between classification, tax treatment, relevance, category, and confidence.
2. Verify untouched, cleared, invalid, zero, and edited account/business balance fields. Preserve the stored value until a valid edit is intentionally saved.
3. Resolve historical reserve versions and their status at the requested date in both stored-history and legacy fallback paths. Share the same historical semantics between home and insights.
4. Use deterministic recurrence occurrence IDs and server uniqueness. Preserve the original day-of-month policy across short months, define timezone boundaries, display catch-up choices, and make schedule changes/deletion safe against queued generation on another device.
5. Model reset as an explicit durable operation with confirmation, visible pending/failure state, and a server generation/version barrier. Clear every selected entity, including profile/settings; stale devices and old outbox entries cannot restore pre-reset records.
6. Resolve account bootstrap as loading, existing business, new account, or unavailable offline. Existing users on a new device must hydrate before onboarding; an unavailable server must not be treated as an empty account.

**Exit:** domain fixtures cover transfer inference and overrides, review corrections, inactive reserves across dates, month-end/leap-year recurrence, two-device recurrence, reset interruption/reconnect, and first login on an empty local database. Aggregate/detail views agree on the same records.

### Phase 4 — Private and recoverable receipt handling

1. Store file identity and metadata rather than signed URLs. Obtain/refresh authorized URLs when viewing or downloading; retry token expiry without exposing tokens in persisted business records.
2. Verify file protection on fresh and populated databases. Test owner, another authenticated account, unauthenticated request, expired token, and deleted record/file access against actual PocketBase.
3. Keep blobs separately from records/history. Reference attachments by stable IDs and migrate legacy base64 copies without multiplying storage. Define attachment/history retention before garbage collection.
4. Validate file type, decoded image dimensions, and configurable size limits. Compress supported images while preserving receipt legibility; retain PDFs within defined limits. Make processing failures actionable and avoid blocking typing.
5. Upload through resumable/retriable outbox operations; never acknowledge a remote attachment before upload completes. Prevent duplicate retry uploads and clean up orphaned files only when safely unreferenced.
6. Offer explicit download/remove-offline-copy controls with availability status. Scope blob access and caches to the owner and include needed pending blobs in recovery exports.

**Exit:** expired links renew; other tenants cannot fetch protected files; offline receipt drafts survive restart; large/invalid files fail clearly; quota/upload failure cannot discard the transaction or report a completed upload.

### Phase 5 — Reliable PWA lifecycle

Primary areas: root providers, `pwa-status.tsx`, `use-install-prompt.ts`, Vite/PWA configuration, auth and sync integration.

1. Register the service worker once above login and authenticated routes. Exclude `/pb`, health endpoints, and other backend-only paths from navigation fallback. Test development and built-app behavior separately.
2. Keep install events/state in a shared provider. Clear consumed prompts after acceptance or dismissal, track installed/display-mode changes, and provide accurate manual installation guidance on platforms without the prompt API.
3. Separate dismissible connectivity notices from persistent compact sync status. Dismissal must change visibility even while still offline. Keep notices clear of bottom navigation, Save, safe areas, and keyboard controls.
4. Persist dirty drafts before an update reload; allow postponement and confirm persistence failure. Coordinate app/schema versions across open tabs and recover from missing old chunks without an endless reload loop.
5. Define and test the offline core: login/help shell, previously authorized app access under an explicit offline-session policy, transactions, drafts, and entry. Unknown users cannot authenticate offline. Expired online credentials cannot upload until renewed, while permitted existing local work remains recoverable.
6. Reuse the Phase 2 outbox protocol for feature-detected Background Sync. Define how the worker receives/validates auth and reacts to logout; never introduce an unauthenticated upload endpoint. Foreground startup/focus/reconnect draining is mandatory on all supported browsers.

**Exit:** direct login visits register correctly; cold and warm Google login work with the SW controlling the origin; installation accept/dismiss/navigation paths work; offline reload and pending uploads recover; updating a populated draft preserves every field and receipt; notices never intercept entry controls.

### Phase 6 — Fast, readable daily entry and page cleanup

Primary areas: transaction form/detail/list, shared fields/date picker/editor, all page states, CSS, icons, and HTML metadata.

1. Use a native form with associated labels, described errors, sensible focus, numeric keyboard hints, and next/done behavior. Make date and editor controls keyboard accessible. Submission is idempotent while a save is in progress.
2. Persist create/edit drafts per owner, including receipts and a schema version; restore deliberately, support discard, and clear only after durable save. Provide navigation/update protection when persistence is unavailable.
3. Put modes in a readable segmented row. Show amount, description, account, and Save prominently; remember owner-specific last-used account/payment method and default the date to today. Invalid/deleted saved defaults fall back safely.
4. Add recent templates, editable local quick-text parsing, and “save and add another.” Once direction is chosen manually, parser suggestions cannot overwrite it. Duplication creates a reviewable draft dated today.
5. Split notes/editor into a lazy component. Reveal optional fields individually. Use separate preconfigured camera and upload inputs invoked directly by the user's gesture, without delayed picker activation.
6. Keep Save reachable with an open mobile keyboard and device safe areas. Preserve scrolling and focus when errors appear; avoid covering content with a fixed action bar.
7. Establish typography tokens: 16 px body/input, 14 px supporting text, 12–13 px navigation labels, prominent amount display, and at least 44 px touch targets where applicable. Remove global font rules that defeat component sizing. Test enlarged text, not only viewport width.
8. Audit every route and empty/loading/error/success state. Use concise Indonesian, remove repeated contrast phrases such as “bukan,” explain financial terms when needed, and replace internal OAuth/configuration details with useful recovery actions. Keep technical diagnostics available to developers without exposing secrets.
9. Keep surfaces and buttons free of gradients, use meaningful consistent Font Awesome icons, and compact repeated financial summaries. Set document language to Indonesian and use text labels for actions that icons alone cannot explain.

**Exit:** a common transaction needs no advanced-panel expansion; repeat entry uses a template plus edits and Save. Amount-to-save interaction is measured before/after. All routes work at 320/390 px, with long Indonesian descriptions, large currency values, populated lists, validation errors, enlarged text, and the keyboard open. Financial/tax wording receives the domain check in Phase 9.

### Phase 7 — Measured loading and interaction performance

1. Lazy-load onboarding, editor, optional processing, and other noncritical modules. Inspect the actual dependency graph and used icon exports; evaluate inline CSS versus a cacheable asset using measured results.
2. Correct hashed asset matching in `server.ts`. Serve negotiated Brotli/gzip or verify the actual serving layer provides it, including `Vary`, content type, HEAD, and content length behavior. Keep HTML, manifest, SW, and version checks compatible with updates.
3. Precache the documented offline core and deliberately load/cache optional routes. An uncached offline route must show a recoverable state. Do not reduce bundle size by breaking required offline entry.
4. Compute history from one loaded snapshot and reuse the series. Memoize by data revision; use a worker if representative computation still blocks the UI. Preserve correctness while optimizing.
5. Sort copies of query data, bound long-list rendering, and consolidate invalidation by affected entity/revision. Keep list navigation and screen-reader access intact.
6. Record cold/warm transfer, route readiness, requests per mutation, main-thread tasks, and form completion effort under a fixed device/network/CPU profile.

**Acceptance budgets to establish in Phase 0 and enforce here:**

| Measure | Target and measurement boundary |
| --- | --- |
| Basic form dependencies | No editor/optional processor downloaded or executed before use; dedicated basic form chunk at most 50 KiB gzip, excluding shared app dependencies. |
| Initial critical JS | At most 180 KiB gzip total for the cold login/entry shell dependency graph; report CSS/fonts separately. |
| One changed record after initial sync | At most 5 application API requests in a settled no-conflict cycle, excluding initial auth, file upload, and an intentionally injected retry; no whole-entity scan. |
| Unchanged sync | Zero record writes; bounded delta/health traffic independent of record count. |
| Local save | p95 durable acknowledgement within 150 ms for a simple transaction on the documented test device; attachment processing measured separately. |
| History/list interaction | No attributable main-thread task above 50 ms on the selected mobile profile with 5,000 transactions; move heavier work off thread if needed. |
| Page responsiveness | Lab target LCP at most 2.5 s and interaction latency at most 200 ms on the agreed repeatable mobile profile; label lab results separately from real-user metrics. |
| Precache | Publish a before/after byte budget and route coverage matrix; optional editor code must not block core offline readiness. |

These are targets, not current results. If a target proves inappropriate, record the evidence and obtain agreement on a replacement; silently relaxing it does not close the item.

### Phase 8 — Complete the remaining PWA capabilities

1. Request persistent storage where supported at a sensible point after use; display usage/available estimates and denied/unsupported states. Warn before an observed failed save, and always provide recovery controls without claiming browsers can never evict data.
2. Implement versioned export/import covering records, histories, pending operations, drafts, and selected blobs. Exclude credentials and signed URLs. Validate schema, ownership, integrity, size, and conflicts; preview imports and apply atomically. Round-trip an offline dataset and reject malformed/foreign-owner input safely.
3. Add validated shortcut routes for money in, money out, and camera alongside general entry. Preserve intended action through login/bootstrap; never silently create a record from a URL. A camera shortcut opens the capture screen and requests a user tap if needed by the platform.
4. Add a supported share-target intake path with correct request/file handling. Persist a recoverable draft before navigating. If logged out, quarantine incoming content until the user selects an authenticated destination; do not attach it silently to a previous account. Reject unsupported/oversized input and prevent duplicate intake. Retain regular upload/camera as the fallback.
5. Add opt-in reserve/payment reminders with a backend scheduler, per-user preferences/timezone, push subscription ownership, delivery deduplication, retry/expiry, and unsubscribe cleanup. Notification bodies default to privacy-preserving text; taps navigate safely through login.
6. Add a pending-review app badge where supported. Keep an in-app count and due-reminder view when badges/push are unsupported or permission is denied. Reminder delivery must not depend on a running tab timer.

**Exit:** export/import round trips including pending receipts; denied persistence is usable; shortcuts preserve intent; shared receipt intake works installed/closed/logged-out; supported push delivery occurs with the app closed; opt-out stops delivery; denied/unsupported cases remain useful. Server delivery is not complete merely because the permission button renders.

### Phase 9 — Close the ledger and prepare rollout

1. Run lint, typecheck, all meaningful tests, production build, real PocketBase integration, and browser regressions against the same final commit. Restore pagination and failure-path coverage rather than substituting simpler assertions.
2. Test Chromium desktop/Android and Safari/iPhone, both browser and installed contexts where available. Cover cold/warm starts, offline restart, expired auth, two accounts, two devices, keyboard, safe areas, and update-in-progress. Automated emulation does not replace actual camera/install/keyboard/push evidence.
3. Run keyboard and screen-reader smoke tests plus automated accessibility checks. Review every route's copy and populated/error states.
4. Check financial and historical explanations against implemented calculations; verify any regulatory claims against current primary sources during implementation. Record assumptions and unresolved domain questions explicitly rather than certifying tax correctness from UI tests.
5. Validate backup/restore and upgrade from a populated prior schema. Rehearse client/server version compatibility, interrupted migrations, old SW clients, and rollback. A rollback must not unprotect receipts or restore destructive old writes.
6. Prepare an ordered release checklist: backup, compatible backend migration/protocol gate, client rollout, SW/cache transition, health/auth/sync/file smoke checks, and monitoring for queue age/conflicts/storage failures. Review required runtime configuration without printing values.
7. Attach evidence to every inventory ID and reconcile every failed scenario. Newly discovered defects that undermine an acceptance outcome become tracked work; none can be omitted to reach a zero count.

**Exit:** F01–F14, P01–P07, U01–U09, and W01–W08 are Verified, with no unapproved deferrals. State local verification and deployed verification separately. An unavailable real-device or production check remains pending.

## Dependencies and execution order

`0 → 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9`

Simple regression fixes from Phase 3 can land earlier after Phase 0, but do not close their broader integration requirements. Phase 4 uses durable blobs/outbox; Phase 5 uses session/sync guarantees; share intake, background execution, and reminders must not be built on the old snapshot sync. Each implementation package should be reviewable and preserve a working application.

## Prerequisites that must stay visible

| Prerequisite | Work possible locally | What remains open until supplied/tested |
| --- | --- | --- |
| Real Google OAuth client and callback configuration | Route/proxy/SW tests with synthetic callbacks and documented exact URLs | Interactive cold/warm login against the configured client. |
| iPhone and Android access | Browser automation, feature fallbacks, fixtures, responsive checks | Actual install, camera gesture, keyboard, offline launch, share, and supported background/push behavior. |
| Push delivery runtime and secrets | Scheduler, subscription rules, tests, configuration examples | Secure VAPID configuration, reachable scheduler, and closed-app delivery verification. |
| Production rollout | Reviewable migrations, manifests if necessary, compatibility and rollback checklist | Authorized application and post-deployment checks in the intended environment. |
| Legacy unscoped data ownership | Non-destructive detection, preservation, and recovery tooling | Safe adoption decision for ambiguous existing data. |

## Closure record template

For each ID, record:

```text
ID:
Status: Open / Partial / Blocked / Verified
Implementation commit:
Acceptance scenarios:
Test environment and commands:
Evidence/artifacts:
Migration and compatibility checks, if applicable:
Remaining dependency or failure:
```

Do not close a phase by counting changed files, passing only pre-existing tests, or describing intended behavior as implemented behavior.
