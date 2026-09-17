# Invoice Operations Runbook

## Deployment

1. Back up `/pb/pb_data` and verify the backup can be opened before migrating.
2. Deploy the additive PocketBase migrations and hooks before enabling invoice UI writes.
3. Deploy `invoice-renderer` from `services/invoice-renderer/Dockerfile`; set the same random `INVOICE_RENDERER_SECRET` on the app and renderer.
4. Set `INVOICE_RENDERER_URL`, then run `bun run test:invoice:renderer` and smoke-test the authenticated `/api/invoice-files/{id}` proxy.
5. Keep reminders disabled during first verification. Enable them after checking `/api/jornal/admin/invoices/health`.

## Kill switches and correction

- `JORNAL_INVOICE_EXPORT_ENABLED=false` stops new exports without affecting invoice reads or the ledger.
- `JORNAL_INVOICE_REMINDERS_ENABLED=false` stops reminder generation.
- Do not roll back to a backend without invoice ledger guards after payments exist.
- Correct payments from invoice detail. CREATED tombstones its generated ledger row; LINKED restores the exact pre-link snapshot.
- A failed renderer is isolated from ledger commands and browser print remains available.

## Backup and recovery

- Full recovery uses the PocketBase data-volume backup, containing invoice/customer records, immutable logo assets, private documents, commands, audit history, and ledger rows together.
- Pengaturan Invoice can export a versioned JSON domain bundle and perform checksum/conflict dry-run before an atomic restore. It includes referenced immutable logos and related payment ledger rows, supports account mapping through the API, advances the sequence beyond the largest restored number, and intentionally does not restore reminder backlog.
- The JSON domain bundle complements, but does not replace, the server-volume backup (which also contains authentication, documents, commands, and all other domains).
- After either restore path, run migrations and review invoice totals before enabling the reminder scheduler.
