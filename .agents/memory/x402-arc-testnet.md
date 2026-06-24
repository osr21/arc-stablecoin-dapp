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

**`verifyTypedData` must use local ecrecover**: Use `recoverTypedDataAddress` (pure local, zero RPC) and compare with `isAddressEqual`. Note: viem 2.52.2's `publicClient.verifyTypedData` also uses local ecrecover under the hood (confirmed from source), so the reason isn't Arc missing the Universal Signature Validator — it's belt-and-suspenders and avoids any future viem behavior changes.

```ts
verifyTypedData: async (args: any) => {
  try {
    const recovered = await recoverTypedDataAddress(args);
    return isAddressEqual(recovered, args.address);
  } catch {
    return false;
  }
},
```

**MetaMask EIP712Domain injection (root cause of `invalid_exact_evm_signature`)**: `@metamask/eth-sig-util`'s `sanitizeData()` inserts `EIP712Domain: []` (empty array) when `EIP712Domain` is absent from `types`. This makes MetaMask compute the domain separator with type string `"EIP712Domain()"` — completely different from viem's inferred 4-field type `"EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"`. The domain separators never match → every signature fails verification. Fix: always inject the correct EIP712Domain fields into `types` before calling `eth_signTypedData_v4`:

```ts
const eip712DomainFields = [];
if (message.domain.name !== undefined) eip712DomainFields.push({ name: "name", type: "string" });
if (message.domain.version !== undefined) eip712DomainFields.push({ name: "version", type: "string" });
if (message.domain.chainId !== undefined) eip712DomainFields.push({ name: "chainId", type: "uint256" });
if (message.domain.verifyingContract !== undefined) eip712DomainFields.push({ name: "verifyingContract", type: "address" });
const typesWithDomain = { EIP712Domain: eip712DomainFields, ...message.types };
// Pass typesWithDomain to eth_signTypedData_v4
```

## Gated routes

- `GET /api/escrows/:id/oracle-check` — 0.01 USDC (10000 raw)
- `GET /api/cctp/attestation/:txHash` — 0.05 USDC (50000 raw)

## Why

**Why:** Arc Testnet is custom (chain ID 5042002, USDC = 0x3600...0000, also native gas token). None of the x402 default network registries know it. Custom money parser + explicit EIP-712 domain in `extra` + explicit network string + local ecrecover are all required.

**How to apply:** Whenever using x402 on a custom/non-standard chain with viem v2: never use `publicClient.verifyTypedData` — it requires the Universal Signature Validator contract which is not deployed on most testnets. Always use `recoverTypedDataAddress` for EOA signature verification. Also always include `extra: { name, version }` in accepts config.
