# Jornal

A calm, local-first journal built with Bun, React, TanStack Router and Query, shadcn/ui conventions, Tailwind CSS, and Vite PWA.

Company team invitations are implemented from
[TEAM_INVITATION_PLAN.md](TEAM_INVITATION_PLAN.md): Google-bound acceptance,
shared company access, queued SMTP delivery, revocation, and protocol-3 cache
isolation. Deployment and rollback steps are in
[TEAM_INVITATION_RUNBOOK.md](TEAM_INVITATION_RUNBOOK.md).

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
bun run test:team:integration # requires POCKETBASE_BIN=.../pocketbase 0.40.2
bun run test:team:email       # SMTP capture + retry/permanent failure assertions
bun run test:team:e2e         # requires POCKETBASE_BIN and Playwright Chromium
bun run test:tax:integration # requires POCKETBASE_BIN=.../pocketbase 0.40.2
bun run test:tax:e2e         # also requires Playwright Chromium
```

The tax compliance module supports tenant-owned tax subjects spanning one or
more companies, monthly/annual/document-driven obligations, confirmed amounts,
payment and filing history, protected evidence, in-app/email reminders, CSV,
and checksum-protected backup/restore. Operational setup and limitations are
documented in `TAX_REMINDERS_RUNBOOK.md`; legal-source provenance is in
`docs/tax/rules.md`.

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

## Brand assets

The Jornal mark combines a white **J** with sky blue ledger strokes on navy, using the app's existing palette. The shared `BrandMark` component uses `src/assets/jornal-logo.svg` in the app header and sign-in screen.

After editing that SVG, run `bun run icons` to regenerate the favicon, PNG fallback, Apple touch icon, and PWA icons in `public/`. Commit those generated assets with the source. Apple and maskable icons use an opaque square background so the device can apply its own shape.
