# PocketBase backend image with jornal migrations baked in.
# PocketBase applies pending migrations from /pb/pb_migrations on startup.
FROM ghcr.io/pocketbase/pocketbase:0.40.2

COPY pb_migrations /pb/pb_migrations

EXPOSE 8090
