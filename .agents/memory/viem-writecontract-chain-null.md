---
name: Viem writeContract chain:null
description: When walletClient is created with a chain typed as `any` or with `as const` cast, writeContract requires explicit `chain: null` to satisfy TypeScript.
---

When `createWalletClient({ chain: arcTestnet as any, ... })` is used, viem's TypeScript types require passing `chain: null` (or a chain override) inside the `writeContract({...})` call — otherwise TS2345 fires saying `Property 'chain' is missing`.

**Why:** Viem's generic types for `WriteContractParameters` require the chain override slot to be explicitly filled when the wallet client chain cannot be inferred statically.

**How to apply:** Add `chain: null` to any `walletClient.writeContract({...})` call that uses a custom chain defined with `as any` or `as const` that isn't a recognized viem chain type.
