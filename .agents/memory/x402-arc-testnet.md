---
name: x402 Arc Testnet integration
description: How x402 payment middleware is wired on Arc Testnet — in-process facilitator, custom money parser, EVM signer construction.
---

## Architecture

- `artifacts/api-server/src/lib/x402.ts` builds the full x402 stack in-process: viem PublicClient + WalletClient → `toFacilitatorEvmSigner` → `x402Facilitator` → `x402ResourceServer` → `paymentMiddleware`.
- `artifacts/arc-dapp/src/lib/x402-client.ts` builds a browser x402 client using MetaMask `eth_signTypedData_v4` → `@x402/fetch`'s `wrapFetchWithPayment`.

## Key quirks

**Custom money parser required**: Arc Testnet (eip155:5042002) is not in x402/evm's built-in network list, so `price: "$0.01"` would fail to resolve the USDC address. Fix: call `serverScheme.registerMoneyParser(...)` on the `ServerExactEvmScheme` to map `(amount, "eip155:5042002")` → `{ amount: rawAtomicUnits, asset: ARC_USDC }`.

**FacilitatorEvmSigner construction**: `toFacilitatorEvmSigner` requires a single object with both read (`getLogs`, `readContract`, `getCode`, `waitForTransactionReceipt`) and write (`signTypedData`, `writeContract`) methods. Build by merging a viem WalletClient + PublicClient into a plain object; use `as any` for the TypeScript incompatibilities.

**FacilitatorClient adapter**: `x402Facilitator.getSupported()` is synchronous but `FacilitatorClient.getSupported()` must return `Promise`. Wrap: `getSupported: () => Promise.resolve(facilitator.getSupported())`.

**`syncFacilitatorOnStart` default = true**: This calls `getSupported()` on startup. For the in-process case it completes instantly, so no special handling needed.

**`x402ResourceServer` constructor**: Takes `FacilitatorClient as any` because the types don't perfectly overlap. The runtime works fine.

## Gated routes

- `GET /api/escrows/:id/oracle-check` — 0.01 USDC (10000 raw)
- `GET /api/cctp/attestation/:txHash` — 0.05 USDC (50000 raw)

## Why

**Why:** Arc Testnet is custom (chain ID 5042002, USDC = 0x3600...0000, also native gas token). None of the x402 default network registries know it. Custom money parser + explicit network string are required.

**How to apply:** Whenever adding new x402-gated routes or changing prices, only touch `buildX402Middleware()` in `lib/x402.ts`; the middleware hot-swaps on server restart.
