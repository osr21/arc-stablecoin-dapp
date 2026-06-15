---
name: Arc Testnet Deployed Contracts
description: Live smart contract addresses deployed to Arc Testnet (Chain ID 5042002) via Foundry forge script
---

# Arc Testnet Deployed Contracts

**Chain ID:** 5042002

## Current Contract Addresses (with owner field — Arcscan-visible)

| Contract | Address |
|----------|---------|
| ConditionalEscrow | `0x80365Ee810E3E33331a685B536Cc26eEF8faD189` |
| PayrollVesting | `0xc4fA76E30A5Ba75805dcd992B30c16d122ccCA52` |
| CrosschainEscrow | `0x88940708A558188636748d61aD5663A31c120fa7` |

## Key design notes

- All three contracts have `address public owner` set to `msg.sender` in constructor — Arcscan reads the `owner()` getter to display owner on the contract page.
- No OpenZeppelin dependency — minimal pattern directly in Solidity.
- Addresses are hardcoded as defaults in `artifacts/arc-dapp/src/lib/contracts.ts` (overridable via VITE_ env vars).
- `via_ir = true` in foundry.toml — required due to stack-too-deep in CrosschainEscrow (7 params + locals).

## Deployment

- `contracts/script/Deploy.s.sol:Deploy` — deploys all three, logs addresses
- **Command:** `cd contracts && forge script script/Deploy.s.sol:Deploy --rpc-url https://rpc.testnet.arc.network --private-key "$DEPLOYER_PRIVATE_KEY" --broadcast --config-path foundry.toml`
- forge-std in `contracts/lib/forge-std/`; shared `contracts/src/IERC20.sol`
