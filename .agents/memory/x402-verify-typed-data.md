---
name: x402 verifyTypedData missing
description: The combinedSigner passed to toFacilitatorEvmSigner must include verifyTypedData, or ALL x402 payment verifications silently fail the EIP-712 signature check.
---

## The rule
Always include `verifyTypedData` in the `combinedSigner` object in `artifacts/api-server/src/lib/x402.ts`.

```ts
verifyTypedData: (args: any) => publicClient.verifyTypedData(args as any),
```

## Why
The x402 facilitator (inside `registerExactEvmScheme`) calls `signer.verifyTypedData(...)` to confirm the MetaMask EIP-712 signature is valid before proceeding to `simulateEip3009Transfer`. The call is wrapped in `try { ... } catch { isValid = false; }` — so if the method is missing (undefined is not a function), it throws silently, sets `isValid = false`, and the verify step returns `ErrInvalidSignature`. Every payment attempt fails even when the signature, balance, and nonce are all correct.

## How to apply
Whenever the `combinedSigner` object is rebuilt (e.g. after adding new viem clients), check that `verifyTypedData` is present alongside `signTypedData`, `readContract`, etc.

`toFacilitatorEvmSigner` simply spreads the object it receives — it adds no methods of its own beyond `getAddresses`.
