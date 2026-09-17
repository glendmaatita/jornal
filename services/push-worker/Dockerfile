FROM oven/bun:1.3.14-alpine
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --production --frozen-lockfile
COPY services/push-worker/worker.ts ./services/push-worker/worker.ts
USER bun
CMD ["bun", "run", "services/push-worker/worker.ts"]
