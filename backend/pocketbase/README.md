# PocketBase backend

This app is wired to use PocketBase as a portable backend mirror.

The frontend still works locally-first. When `VITE_POCKETBASE_URL` is set, it:

- pulls remote data on startup
- pushes local changes after mutations
- keeps the browser cache as the fast UI store

## Run PocketBase locally

PocketBase ships inside the main app image, managed by supervisord alongside
the web server. The SPA reaches it same-origin through the `/pb` reverse
proxy in `server.ts` (`VITE_POCKETBASE_URL=/pb`):

```bash
docker run -p 3000:3000 -v jornal-pb-data:/pb/pb_data \
  -e POCKETBASE_SUPERUSER_EMAIL=you@example.com -e POCKETBASE_SUPERUSER_PASSWORD=secret \
  ghcr.io/glendmaatita/jornal:latest
```

- SPA: `http://127.0.0.1:3000`
- PocketBase API: `http://127.0.0.1:3000/pb/api/...`
- Admin dashboard: `http://127.0.0.1:8090/_/` (needs `-p 8090:8090` and the
  `POCKETBASE_SUPERUSER_*` env vars, which upsert the superuser on startup)

## Schema and data isolation

Do not create collections manually. PocketBase applies the versioned files in
`pb_migrations` on boot. The current schema contains:

- `companies`: tenant-owned company catalog and lifecycle state;
- `jornal_records`: company-scoped ledger envelope with revision and data epoch;
- `company_audit`: private lifecycle audit trail.
- private `tax_*` collections for subjects, effective company memberships,
  registrations, period inputs, obligations, filings, settlements/allocations,
  evidence, notification delivery, commands, and audit history.

Every ledger request from the current client uses protocol `2` and an explicit
company scope. Collection rules and request hooks enforce tenant ownership,
company status, immutable identity, revision, epoch, file access, and
cross-record references. Raw public company create/update/delete is disabled;
use the `/api/jornal/companies/*` endpoints.

Raw tax collection access is also disabled. Use `/api/jornal/tax/*`; these
commands enforce tenant ownership, revision checks, idempotency, amount/date
provenance, and cross-record invariants. Evidence downloads are served only by
an authenticated ownership-checking endpoint.

## Frontend env

Set:

```bash
VITE_POCKETBASE_URL=http://127.0.0.1:8090
```

For local Vite development, start PocketBase separately; the repository `.env`
points the frontend at `http://127.0.0.1:8090`. The production Docker image already provides the `/pb` reverse
proxy and starts both services together. Google sign-in also requires
`GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` on the PocketBase process.

## Production environment timing

`VITE_POCKETBASE_URL` is a Vite variable, so it is compiled into the browser
bundle at image build time. For this single-container image, keep the default
`/pb` value:

```bash
docker build --build-arg VITE_POCKETBASE_URL=/pb -t jornal .
```

Multi-company creation has two independent rollout gates. The frontend value
is compiled into the image; the backend value is read at runtime:

```bash
docker build \
  --build-arg VITE_POCKETBASE_URL=/pb \
  --build-arg VITE_MULTI_COMPANY_ENABLED=true \
  -t jornal .

docker run -e JORNAL_MULTI_COMPANY_ENABLED=true ... jornal
```

Setting both flags to `false` pauses creation of company tambahan. Initial
onboarding and access to companies already created continue to work.

Tax compliance has a build-time UI flag and two runtime kill switches:

```bash
docker build \
  --build-arg VITE_POCKETBASE_URL=/pb \
  --build-arg VITE_TAX_COMPLIANCE_ENABLED=true \
  -t jornal .

docker run \
  -e JORNAL_TAX_COMPLIANCE_ENABLED=true \
  -e JORNAL_TAX_EMAIL_ENABLED=false \
  ... jornal
```

Keep email disabled until PocketBase SMTP is configured and an opt-in test
tenant has passed the mail-sink/dedupe checks. The tax scheduler runs in the
PocketBase process and does not depend on an open browser. See
`TAX_REMINDERS_RUNBOOK.md` for rollout, health, recovery, backup, and exact
verification commands.

`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and the optional
`POCKETBASE_SUPERUSER_*` values are runtime variables. Pass them as secrets
when starting the container:

```bash
docker run -d --name jornal \
  -p 3000:3000 \
  -v jornal-pb-data:/pb/pb_data \
  -e GOOGLE_CLIENT_ID="$GOOGLE_CLIENT_ID" \
  -e GOOGLE_CLIENT_SECRET="$GOOGLE_CLIENT_SECRET" \
  -e POCKETBASE_SUPERUSER_EMAIL="$POCKETBASE_SUPERUSER_EMAIL" \
  -e POCKETBASE_SUPERUSER_PASSWORD="$POCKETBASE_SUPERUSER_PASSWORD" \
  jornal
```

Configure Google with the production origin and PocketBase callback URL:
`https://your-domain.example/pb/api/oauth2-redirect`.

The migration reads the Google credentials when it first configures the users
collection. If `/pb/pb_data` already contains a migrated database, changing
the environment variables alone will not rerun that migration; update the
OAuth provider in PocketBase Admin or add a follow-up migration.

If the variable is absent, the app keeps using browser storage only.
