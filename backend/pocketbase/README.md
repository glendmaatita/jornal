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

## Required collection

Create one collection named `jornal_records` with these fields:

- `business_id` — text
- `entity` — text
- `app_id` — text
- `payload` — json
- `revision` — number (monotonic sync version)
- `deleted_at` — date (nullable tombstone timestamp)

Recommended constraints:

- unique index on `app_id` + `entity` + `business_id`
- open read/write rules only for your private instance, or add auth before exposing it publicly

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
