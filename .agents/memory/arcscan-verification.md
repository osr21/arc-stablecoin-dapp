---
name: ArcScan contract verification
description: How to verify Solidity contracts on ArcScan (Arc Testnet explorer); includes foundry.toml config and deployed-vs-current source divergence note.
---

## Verified working config

Add to `contracts/foundry.toml`:
```toml
[etherscan]
"5042002" = { key = "arc_testnet", url = "https://testnet.arcscan.app/api" }
```

Then run (no API key env var needed):
```bash
cd contracts && forge verify-contract \
  --chain-id 5042002 \
  <ADDRESS> \
  src/<Contract>.sol:<Contract> \
  --watch
```

ArcScan is Etherscan-compatible. The `--chain` flag does NOT accept `arc-testnet`; you must use `--chain-id 5042002` with the numeric key in `[etherscan]`. No real API key is required — any non-empty string works.

## Bytecode must match exactly

"Fail - Unable to verify" means the compiled bytecode doesn't match the on-chain bytecode. Common causes:
- Source code has changed since deployment (most likely)
- `via_ir` mismatch (via_ir doesn't affect bytecode size for this project's contracts)

**How to diagnose**: check on-chain bytecode size via `eth_getCode` vs `forge build` output. If they differ, find the matching source in git history and verify with that historical version.

## ConditionalEscrow source divergence

The deployed ConditionalEscrow at `0x34733fbbC101F2244Df03508170893013528004e` compiles to **6068 bytes** from git commit `a8f8d6b` ("Fix conditional escrow to enforce time-lock on fund release"). The current `main` source compiles to **6243 bytes** (175 bytes larger — oracle-check logic was added server-side after deployment, and the Solidity source also grew).

**Why:** If ConditionalEscrow is redeployed from current source, its verification will work directly. Until then, keep the a8f8d6b source in a known location if re-verification is ever needed.
