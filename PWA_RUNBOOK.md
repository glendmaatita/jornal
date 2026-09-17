# PWA, Document AI, and Push Runbook

`JORNAL_AI_CAPTURE_ENABLED` and `JORNAL_PUSH_ENABLED` default to disabled. Inbox/manual review stay usable when either service is off. Never expose OpenRouter or VAPID private keys through `VITE_*` variables.

## AI rollout

1. Prepare at least 100 synthetic or explicitly authorized, anonymized fixtures with a held-out split.
2. Pin primary/fallback models and provider allowlist; require structured output, `data_collection=deny`, and ZDR routing.
3. Run `bun scripts/benchmark-document-ai.ts <manifest.json>`. Do not enable AI when it fails.
4. Set daily/monthly limits, then enable AI for a test company.
5. Monitor `/api/jornal/admin/documents/health`; `UNKNOWN` means an ambiguous provider outcome and must not be blindly retried.

## Push rollout

1. Generate VAPID keys with `bunx web-push generate-vapid-keys` plus a random worker secret.
2. Deploy `services/push-worker/Dockerfile` with the same keys/secret configured in PocketBase.
3. Enable push; opt-in remains per device and monetary amounts are excluded from lock-screen payloads.
4. HTTP 404/410 revokes a subscription. Other failures use bounded retry; expired leases are reclaimed.
5. Archive/reset cancels queued deliveries and eligibility is rechecked before claim.

## PWA recovery

- Service-worker updates are prompted so active drafts can be flushed first.
- Shared files stage in IndexedDB without ownership until the signed-in user chooses a company.
- Test install/share/push on Android Chrome, iOS Home Screen PWA, and desktop Chromium each release; automation cannot prove OS-level delivery.
