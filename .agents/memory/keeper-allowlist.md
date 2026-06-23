---
name: Keeper contract allowlist
description: keeper.ts has a hardcoded ALLOWED_CONTRACTS Set; it must be updated when ConditionalEscrow is redeployed
---

`artifacts/api-server/src/lib/keeper.ts` has a `const ALLOWED_CONTRACTS = new Set([...])` near the top. It currently contains only the ConditionalEscrow address on Arc Testnet.

**Why:** Without the allowlist, any user can POST an escrow record with any `contractAddress` value, forcing the keeper wallet to call `autoRelease(onChainId)` on that address — effectively a keeper-as-proxy-caller exploit.

**How to apply:** Any time ConditionalEscrow is redeployed to a new address, update ALLOWED_CONTRACTS in keeper.ts. The address must be lowercase for the `.has()` comparison to work.
