---
name: API Security Hardening
description: Security fixes applied to the Arc DApp API server — what was changed and why
---

# API Security Hardening

## Status-transition guards (CRITICAL fix)
All state-mutating routes now check the current DB status before applying updates using `and(eq(...id), eq(...status, allowedFrom))`. If the row doesn't match, the update returns no rows and the route returns 409.

- `POST /api/escrows/:id/dispute` — only proceeds if `status = 'active'`
- `POST /api/escrows/:id/release` — `resolution=beneficiary` requires `status = 'active'`; arbiter resolve (`resolution!=beneficiary`) requires `status = 'disputed'`
- `POST /api/vesting/:id/claim` — fetches current record first, rejects if new `amountClaimed ≤ current`, or > `totalAmount`

**Why:** Without these guards, anyone can POST with a fake txHash to corrupt DB state (e.g. mark active escrows as released, preventing keeper auto-release).

## txHash format validation on all write endpoints
Every POST that accepts a txHash now checks `/^0x[0-9a-fA-F]{64}$/` before touching the DB. Returns 400 on failure.

Applies to: escrow create/dispute/release, vesting create/claim, crosschain create.

## Rate limiting (`express-rate-limit`)
- General API: 120 req/min/IP
- Mutation routes (escrows, vesting, crosschain): 30 req/min/IP
- `app.set('trust proxy', 1)` required because Replit proxy sets X-Forwarded-For

## Body size limit
`express.json({ limit: '50kb' })` and `express.urlencoded({ extended: false, limit: '10kb' })`.
`extended: false` avoids the vulnerable `qs` library for urlencoded parsing.

## Dashboard crash prevention
`safeBigInt(val)` helper wraps all BigInt() calls — returns 0n on invalid strings instead of throwing.

## Keeper optimization
`resolveOnChainId()` checks `escrow.onChainId` from DB first before making an RPC call to fetch the tx receipt. On cache miss, it persists the resolved ID back to DB so future ticks skip the RPC call.
