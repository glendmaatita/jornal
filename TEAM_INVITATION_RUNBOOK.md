# Team invitation runbook

## Scope and safety contract

Team membership is company-scoped and has no roles. Every active member has the same application permissions. `companies.tenant_id` remains the legacy data owner; authorization always comes from an active `company_memberships` row. Disabling invitations must not remove existing shared access.

The feature requires PocketBase `0.40.2`, client protocol `3`, Google OAuth, and the existing SMTP transport. Never deploy an owner-only backend after a company has been shared.

## Configuration

Backend environment:

```text
JORNAL_TEAM_INVITATIONS_ENABLED=false
JORNAL_TEAM_INVITATION_EMAIL_ENABLED=false
JORNAL_PUBLIC_URL=https://jornal.example.com
SMTP_HOST=...
SMTP_PORT=...
SMTP_USERNAME=...
SMTP_PASSWORD=...
SMTP_AUTH_METHOD=PLAIN
SMTP_TLS=false
SMTP_FROM_ADDRESS=...
SMTP_FROM_NAME=Jornal
```

`JORNAL_PUBLIC_URL` must be absolute HTTPS outside localhost. SMTP credentials belong in a Kubernetes Secret/runtime environment and must not enter Git, logs, email templates, or test fixtures.

## Pre-deploy gate

1. Take a consistent PocketBase backup including `pb_data` files. Restore it into an isolated instance before continuing.
2. Record counts for users, companies, ledger records, transactions, invoices, tax settlements, and total opening/current balances.
3. Run:

```bash
bun install --frozen-lockfile
bun run typecheck
bun run lint
bun test
bun run build
POCKETBASE_BIN=/absolute/path/pocketbase bun run test:team:integration
POCKETBASE_BIN=/absolute/path/pocketbase bun run test:invoice:integration
POCKETBASE_BIN=/absolute/path/pocketbase bun run test:tax:integration
POCKETBASE_BIN=/absolute/path/pocketbase bun run test:team:e2e
```

The runners reject a binary other than PocketBase `0.40.2`. A skipped team integration test is not a passing release gate.

## Deployment order

1. Deploy schema/backend with both team flags `false`.
2. Run migrations and verify one active owner membership exists per legacy company. Compare the pre-deploy financial counts/checksums; the migration must not change amounts or ledger payloads.
3. Deploy the protocol-3 client. Old financial custom routes return HTTP 426 so stale clients cannot write using the owner-only contract.
4. Inspect quarantined protocol-2 outbox entries and reconcile them manually. Never force-upload a row without a known base revision.
5. Run a Google login smoke for an existing user and verify the private Google identity proof is created.
6. Enable `JORNAL_TEAM_INVITATIONS_ENABLED=true` for the pilot. Keep mail disabled until direct-login claiming is verified.
7. Verify SMTP connectivity with a non-production mailbox, then enable `JORNAL_TEAM_INVITATION_EMAIL_ENABLED=true`.
8. Pilot: invite, receive SMTP, login with the matching Google account, edit the shared ledger, observe the update from the inviter, remove the member, then verify access and queued push/email deliveries are denied.

## Operations

Health and one-shot processing require a PocketBase superuser:

```text
GET  /api/jornal/admin/team/health
POST /api/jornal/admin/team/run-jobs
```

Watch queue counts, `oldestPendingAt`, SMTP failures, bootstrap latency, membership revocations, HTTP 409 conflicts, and HTTP 426 responses. Alert when the oldest due delivery is more than ten minutes old or SMTP failures repeat.

Delivery states are `QUEUED`, `LEASED`, `SENT`, `RETRYABLE_FAILED`, `PERMANENTLY_FAILED`, and `CANCELLED`. `SENT` only means the SMTP server accepted the message. A 4xx SMTP response is retried with bounded backoff; a 5xx/auth/config/invalid-recipient response is permanent for that delivery. After configuration is corrected, use the application resend action to create a new generation. Do not edit a sent row back to queued.

If a worker dies during a lease, the next scheduled run recovers it. Lease recovery, expiry, and team listing process every row in bounded pages; operators do not need to truncate the table.

## Revocation and local data

Removal/leave increments the membership revision, cancels pending invitations created by that member, and cancels pending notification delivery to that member. On focus, reconnect, and the 30-second refresh, the client quarantines the old membership namespace before any upload.

Already-downloaded offline data cannot be remotely erased. A revoked offline browser may still display cached data until it reconnects, but it must not upload. Rejoining creates a new membership revision and does not replay the old outbox automatically.

## Incident controls and rollback

- Stop new invitation creation/claim: set `JORNAL_TEAM_INVITATIONS_ENABLED=false`.
- Stop email only: set `JORNAL_TEAM_INVITATION_EMAIL_ENABLED=false`. Existing queued rows remain deferred without consuming attempts.
- Existing memberships remain active under either switch.
- Do not roll back to an owner-only image. Forward-fix the shared-access backend.
- The migration down action is intentionally non-destructive. It retains membership collections, rules, audit history, and access. A subsequent up is idempotent.
- Restore a pre-feature backup only for disaster recovery after explicitly accounting for companies, memberships, and financial writes created since that backup.

After rollback or restore, run the full integration gates and compare financial checksums again before accepting writes.
