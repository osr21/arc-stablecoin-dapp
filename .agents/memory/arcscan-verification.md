---
name: ArcScan contract verification
description: How to verify Solidity contracts on ArcScan (Arc Testnet explorer) with forge; includes bytecode matching strategy.
---

## Working foundry.toml config

Add to `contracts/foundry.toml` — no real API key is required for Arc Testnet:
```toml
[etherscan]
"5042002" = { key = "arc_testnet", url = "https://testnet.arcscan.app/api" }
```

Run:
```bash
cd contracts && forge verify-contract --chain-id 5042002 <ADDRESS> src/<Contract>.sol:<Contract> --watch
```

`--chain arc-testnet` is NOT valid — `--chain-id 5042002` with the numeric key is required.

## "Fail - Unable to verify" diagnosis

The submission succeeds (GUID returned) but the backend fails to reproduce the bytecode. **Always confirm bytecode size matches before submitting:**
- Get on-chain size: `eth_getCode` → `result.length/2 - 1`
- Get compiled size: check `out/<Contract>.sol/<Contract>.json` → `deployedBytecode.object.length/2 - 1`
- If they differ, the source used for deployment was a different version than `HEAD`.

**Why:** ArcScan's verifier must reproduce the exact bytecode from the submitted source. If the source changed after deployment, the sizes won't match and verification will always fail.

**Fix:** find the git commit whose source compiles to the same bytecode size as the on-chain deployment, then verify using that historical source checked out temporarily.

## ConditionalEscrow source divergence (current state)

The deployed ConditionalEscrow (active address from `VITE_CONDITIONAL_ESCROW_ADDRESS`) was compiled from an older commit than `HEAD`. Current `HEAD` source is ~175 bytes larger. If the contract is redeployed from current source, future verification will work directly with no source-hunting needed.
