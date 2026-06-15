---
name: Full security audit findings + fixes
description: Decisions and patterns from the full security audit applied to the Arc Stablecoin DApp in June 2025.
---

## CORS
Replace `app.use(cors())` with an explicit allowlist in `app.ts`. Pattern: array of strings + RegExp for dev-preview domains (`.replit.dev`, `.repl.co`). Same-origin requests (no Origin header) are always allowed.

**Why:** Wildcard CORS allows any website to call write endpoints from a user's browser, enabling CSRF-style attacks against connected wallets.

## IDOR — caller field pattern
All write/mutation routes read `req.body.caller` (lowercased) and compare against the stored owner field. No JWT/session; this is the minimum viable ownership check for a wallet-auth-free DApp.
- `PATCH /crosschain/:id` → `caller` must equal stored `sender`
- `POST /escrows/:id/dispute` → `caller` must equal `depositor` or `beneficiary`
- `POST /escrows/:id/release` → `caller` must equal `depositor` (release) or `arbiter` (resolve)
- `POST /vesting/:id/claim` → `caller` must equal `beneficiary`

Frontend passes `caller: address` (from `useWallet()`) in all mutation bodies, cast `as any` to bypass generated Zod types (field not in OpenAPI spec).

**Why:** Without any ownership check, any unauthenticated actor can change any record's state — e.g. marking a competitor's transfer as "complete" or disputing arbitrary escrows.

## Address format validation
Added `ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/i` check on all inbound addresses in POST bodies (escrow, vesting, crosschain create routes). Addresses are lowercased before storing in DB. Frontend uses `isAddress()` from viem before form submission.

## Dashboard stats — SQL aggregation
Old: `db.select().from(table)` × 3 tables, then filter/sum in JS memory (unbounded DoS).
New: Single `db.select({ total: sql\`count(*)::int\`, ... }).from(table)` per table with Postgres `filter` aggregation. BigInt arithmetic for USDC/EURC locked totals to avoid float imprecision.

## CCTP error response
`GET /attestation/:txHash` catch block used to return `202` (masking failures). Changed to `500` so frontend can distinguish "server error" from "still pending".

Added `AbortSignal.timeout(10_000)` to the upstream bridge fetch to prevent indefinite hangs.

## Dependency vulnerabilities fixed
- `esbuild` HIGH + LOW: 0.27.3 → 0.28.1 (override in `pnpm-workspace.yaml`)
- `qs` MODERATE: added `qs: "6.15.2"` override in `pnpm-workspace.yaml`

## SAST false positives — do not re-flag
- `mockup-sandbox/App.tsx` unsafe-dynamic-method: static generated module map, not user input.
- `contracts/lib/forge-std/scripts/vm.py` subprocess: vendored Foundry library, do not modify.
