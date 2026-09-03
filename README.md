# Jornal

A calm, local-first journal built with Bun, React, TanStack Router and Query, shadcn/ui conventions, Tailwind CSS, and Vite PWA.

## Local development

```bash
bun install
bun run dev
```

Useful checks:

```bash
bun run lint
bun run test
bun run typecheck
bun run build
```

The production server uses Bun and serves the SPA with cache headers and a health endpoint at `/healthz`:

```bash
bun run build
bun run preview
```

## Docker

```bash
docker build -t jornal .
docker run --rm -p 3000:3000 jornal
```

Open `http://localhost:3000`.

## Publishing

Pushes to `develop` run linting, tests, and a production build before publishing multi-architecture images to GitHub Container Registry:

- `ghcr.io/<owner>/<repository>:latest`
- `ghcr.io/<owner>/<repository>:develop-<sha>`

The workflow requires GitHub Actions to have read/write package permissions. For a public repository, the package can be made public from its GHCR package settings after the first publish.

## PWA behavior

The production build includes an installable web manifest, platform icons, offline precaching, SPA navigation fallback, update prompts, and iOS standalone metadata. In development, service workers are enabled so the install and offline flows can be exercised locally.
