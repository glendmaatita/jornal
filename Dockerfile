# syntax=docker/dockerfile:1.7

ARG BUN_VERSION=1.4.0
ARG POCKETBASE_VERSION=0.40.2

# The SPA output is architecture-independent. Build it on the runner's native
# platform so the arm64 image does not compile the frontend through QEMU.
FROM --platform=$BUILDPLATFORM oven/bun:${BUN_VERSION}-alpine AS dependencies
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM dependencies AS build
# Same-origin path proxied to PocketBase by server.ts (/pb/* → 127.0.0.1:8090).
ARG VITE_POCKETBASE_URL=/pb
ARG VITE_MULTI_COMPANY_ENABLED=true
ARG VITE_TAX_COMPLIANCE_ENABLED=true
ENV VITE_POCKETBASE_URL=${VITE_POCKETBASE_URL}
ENV VITE_MULTI_COMPANY_ENABLED=${VITE_MULTI_COMPANY_ENABLED}
ENV VITE_TAX_COMPLIANCE_ENABLED=${VITE_TAX_COMPLIANCE_ENABLED}
# Keep backend, documentation, and e2e changes from invalidating the SPA build.
COPY index.html server.ts vite.config.ts tsconfig.json tsconfig.app.json tsconfig.node.json ./
COPY src ./src
COPY public ./public
COPY scripts ./scripts
RUN bun run build

# Download the target-architecture PocketBase binary without running the
# downloader and unzipper under emulation.
FROM --platform=$BUILDPLATFORM oven/bun:${BUN_VERSION}-alpine AS pocketbase
ARG POCKETBASE_VERSION
ARG TARGETARCH
RUN apk add --no-cache unzip curl \
    && case "$TARGETARCH" in \
      amd64) PB_ARCH=amd64 ;; \
      arm64) PB_ARCH=arm64 ;; \
      *) echo "unsupported TARGETARCH: $TARGETARCH" >&2; exit 1 ;; \
    esac \
    && curl -fsSL "https://github.com/pocketbase/pocketbase/releases/download/v${POCKETBASE_VERSION}/pocketbase_${POCKETBASE_VERSION}_linux_${PB_ARCH}.zip" -o /tmp/pocketbase.zip \
    && unzip -o /tmp/pocketbase.zip -d /pb \
    && chmod +x /pb/pocketbase \
    && rm /tmp/pocketbase.zip

# Single-container runtime: supervisord manages both the SPA server and
# PocketBase. Only this small stage has to run on the target architecture.
FROM oven/bun:${BUN_VERSION}-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
RUN apk add --no-cache supervisor

COPY --from=pocketbase /pb/pocketbase /pb/pocketbase
COPY backend/pocketbase/pb_migrations /pb/pb_migrations
COPY backend/pocketbase/pb_hooks /pb/pb_hooks
COPY supervisord.conf /etc/supervisord.conf

COPY --from=build --chown=bun:bun /app/dist ./dist
COPY --chown=bun:bun server.ts ./server.ts

# Runtime state (SQLite db, backups, admin UI assets) lives here; mount a
# volume at /pb/pb_data to persist across container restarts.
RUN mkdir -p /pb/pb_data /pb/pb_public /pb/pb_backup && chown -R bun:bun /pb

EXPOSE 3000 8090
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD bun -e "const response = await fetch('http://127.0.0.1:3000/healthz'); if (!response.ok) process.exit(1)"

CMD ["/usr/bin/supervisord", "-c", "/etc/supervisord.conf"]
