# AI Capture Release Evidence

Status: **implementation complete; production AI remains gated off pending an authorized benchmark dataset and operator-selected model/provider**.

Implemented controls: private scoped storage, hash duplicate detection, durable queue/leases/fencing, strict JSON Schema, server validation, provider allowlist, ZDR/data-collection routing, daily quota, monthly budget, bounded retry/fallback, stale-scope cancellation, atomic confirmation/correction, and no browser-to-provider access.

`scripts/benchmark-document-ai.ts` enforces at least 100 examples, a held-out subset, 100% schema validity, at least 98% clear-document amount exact match, at least 95% clear-document date exact match, and zero false invoice matches. No result is claimed because no authorized corpus or production model was supplied. The default-disabled flag prevents an unevaluated model from reaching users.
