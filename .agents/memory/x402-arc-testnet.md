---
name: x402 Arc Testnet integration
description: How x402 payment middleware is wired on Arc Testnet — in-process facilitator, custom money parser, EVM signer construction, EIP-712 domain fix.
---

## Architecture

- `artifacts/api-server/src/lib/x402.ts` builds the full x402 stack in-process: viem PublicClient + WalletClient → `toFacilitatorEvmSigner` → `x402Facilitator` → `x402ResourceServer` → `paymentMiddleware`.
- `artifacts/arc-dapp/src/lib/x402-client.ts` builds a browser x402 client using MetaMask `eth_signTypedData_v4` → `@x402/fetch`'s `wrapFetchWithPayment`.

## Key quirks

**Custom money parser required**: Arc Testnet (eip155:5042002) is not in x402/evm's built-in network list, so `price: "$0.01"` would fail to resolve the USDC address. Fix: call `serverScheme.registerMoneyParser(...)` on the `ServerExactEvmScheme` to map `(amount, "eip155:5042002")` → `{ amount: rawAtomicUnits, asset: ARC_USDC }`.

**EIP-712 domain params must be in `extra`**: The x402 exact client reads `requirements.extra.name` and `requirements.extra.version` to sign the EIP-3009 TransferWithAuthorization. For networks not in x402's built-in registry, the server MUST include these in the route `accepts[i].extra`. Arc Testnet USDC values (verified via eth_call): `name: "USDC"`, `version: "2"`. Without these, the browser shows "Failed to create payment payload: EIP-712 domain parameters (name, version) are required".

**FacilitatorEvmSigner construction**: `toFacilitatorEvmSigner` requires a single object with both read (`getLogs`, `readContract`, `getCode`, `waitForTransactionReceipt`) and write (`signTypedData`, `writeContract`) methods. Build by merging a viem WalletClient + PublicClient into a plain object; use `as any` for the TypeScript incompatibilities.

**FacilitatorClient adapter**: `x402Facilitator.getSupported()` is synchronous but `FacilitatorClient.getSupported()` must return `Promise`. Wrap: `getSupported: () => Promise.resolve(facilitator.getSupported())`.

**`x402ResourceServer` constructor**: Takes `FacilitatorClient as any` because the types don't perfectly overlap. The runtime works fine.

## Gated routes

- `GET /api/escrows/:id/oracle-check` — 0.01 USDC (10000 raw)
- `GET /api/cctp/attestation/:txHash` — 0.05 USDC (50000 raw)

## Why

**Why:** Arc Testnet is custom (chain ID 5042002, USDC = 0x3600...0000, also native gas token). None of the x402 default network registries know it. Custom money parser + explicit EIP-712 domain in `extra` + explicit network string are all required.

**How to apply:** Whenever adding new x402-gated routes or adding a new non-standard EVM network, always include `extra: { name: "<token name>", version: "<token version>" }` in the accepts config. Read name/version via eth_call on the token contract (selectors: `0x06fdde03` = name, `0x54fd4d50` = version).
