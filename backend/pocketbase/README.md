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

Recommended constraints:

- unique index on `app_id` + `entity` + `business_id`
- open read/write rules only for your private instance, or add auth before exposing it publicly

## Frontend env

Set:

```bash
VITE_POCKETBASE_URL=http://127.0.0.1:8090
```

If the variable is absent, the app keeps using browser storage only.
