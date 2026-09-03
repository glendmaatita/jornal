# syntax=docker/dockerfile:1.7

ARG BUN_VERSION=1.4.0

FROM oven/bun:${BUN_VERSION}-alpine AS dependencies
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM dependencies AS build
COPY . .
RUN bun run build

FROM oven/bun:${BUN_VERSION}-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

COPY --from=build --chown=bun:bun /app/dist ./dist
COPY --chown=bun:bun server.ts ./server.ts

USER bun
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD bun -e "const response = await fetch('http://127.0.0.1:3000/healthz'); if (!response.ok) process.exit(1)"

CMD ["bun", "run", "server.ts"]
