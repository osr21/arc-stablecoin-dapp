---
name: Arc Testnet Deployed Contracts
description: Live smart contract addresses deployed to Arc Testnet (Chain ID 5042002) via Foundry forge script
---

# Arc Testnet Deployed Contracts

**Chain ID:** 5042002  
**Deploy block:** 47047205  
**Deploy tx bundle:** 3 transactions, ~0.06 USDC gas total

## Contract Addresses

| Contract | Address |
|----------|---------|
| ConditionalEscrow | `0x8FB927c5C50B246cFD66Bc77BE6E3D28D9c63f83` |
| PayrollVesting | `0xdE7523701477282bE9e9DdDCB98d43A72EC5a31C` |
| CrosschainEscrow | `0x6f4cfDa3D91950DF38556a4a6D471Be817936370` |

## Stored as env vars (shared)
- `VITE_CONDITIONAL_ESCROW_ADDRESS`
- `VITE_PAYROLL_VESTING_ADDRESS`
- `VITE_CROSSCHAIN_ESCROW_ADDRESS`
- `VITE_ARC_RPC_URL`, `VITE_ARC_CHAIN_ID`, `VITE_USDC_ADDRESS`, `VITE_EURC_ADDRESS`

## Deployment setup
- Foundry (forge) installed via Nix `foundry` package
- `contracts/foundry.toml` — config with `via_ir = true` (required due to stack-too-deep in CrosschainEscrow)
- `contracts/script/Deploy.s.sol` — uses `vm.startBroadcast()` (no vm.envUint — private key passed via --private-key CLI flag)
- forge-std downloaded as tar from GitHub to `contracts/lib/forge-std/`
- `contracts/src/IERC20.sol` — shared interface (each contract had its own duplicate which caused compile collision)

**Why via_ir:** CrosschainEscrow.initiateConditionalTransfer has 7 params + local vars, hitting stack depth limit without IR pipeline.

**How to redeploy:** `cd contracts && forge script script/Deploy.s.sol:Deploy --rpc-url https://rpc.testnet.arc.network --private-key "$DEPLOYER_PRIVATE_KEY" --broadcast --config-path foundry.toml`
