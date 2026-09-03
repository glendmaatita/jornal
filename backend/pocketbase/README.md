# PocketBase backend

This app is wired to use PocketBase as a portable backend mirror.

The frontend still works locally-first. When `VITE_POCKETBASE_URL` is set, it:

- pulls remote data on startup
- pushes local changes after mutations
- keeps the browser cache as the fast UI store

## Run PocketBase locally

```bash
cd backend/pocketbase
docker compose up
```

PocketBase will listen on `http://127.0.0.1:8090`.

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
