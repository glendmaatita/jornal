# Invoice Implementation Evidence

Implemented on 17 September 2026 across PocketBase, the React PWA, ledger reconciliation, reminder jobs, and an isolated Playwright renderer.

- `bun run test:invoice:integration`: 66 assertions against real PocketBase covering CREATE/LINK_EXISTING payment, both corrections, idempotency, private ownership, atomic document confirmation, reminder resolution, push claim/complete, and versioned invoice backup dry-run/restore/replay/corruption rejection.
- `bun run test:invoice:renderer`: authenticated PDF/PNG signatures and exact 1240×1754 normal-fixture PNG.
- `bun run test:invoice:e2e`: browser customer → issue → payment → ledger flow.
- `bun test`, lint, typecheck, and build are regression gates.
- Migrations 0009–0010 are verified on fresh apply and non-destructive down/up reapply.
- `bun run benchmark:invoice-scale` verified 10,000 unpaid invoices and 10,000 reminders: summary 227 ms, page 483 ms, reminder scheduler 4,911 ms on the development machine (17 September 2026).
- JSON recovery includes customers, settings, units, invoices, payments, related ledger rows, audit records, referenced logo assets, collection and bundle checksums, account/asset/ID mapping, conflict dry-run, atomic commit, idempotent replay, sequence preservation, and suppression of restored reminder backlog.

Full server recovery still uses a verified PocketBase volume backup. Actual OS share/push delivery and multi-architecture container execution remain release-environment checks because browser automation on this machine cannot emulate iOS/Android notification services or a second CPU architecture.
