FROM mcr.microsoft.com/playwright:v1.63.0-noble
WORKDIR /app
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH=/root/.bun/bin:$PATH NODE_ENV=production PORT=3100
COPY package.json bun.lock tsconfig.json tsconfig.app.json ./
COPY src ./src
COPY services/invoice-renderer ./services/invoice-renderer
RUN bun install --frozen-lockfile
EXPOSE 3100
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD curl -fsS http://127.0.0.1:3100/healthz || exit 1
CMD ["bun", "services/invoice-renderer/server.tsx"]
