---
name: Arc Testnet Deployed Contracts
description: Live smart contract addresses deployed to Arc Testnet (Chain ID 5042002) via Foundry forge script. Includes security-fixed versions.
---

# Arc Testnet Deployed Contracts

**Chain ID:** 5042002

## Current Contract Addresses (security-fixed, owner field, verified on Arcscan)

| Contract | Address |
|----------|---------|
| ConditionalEscrow | `0xe64a01283af91a601ebf5a86efe36312783330e8` |
| PayrollVesting | `0xdc14d0a5233173776fc4ea1007251afb174d67e8` |
| CrosschainEscrow | `0x54d8ecd5de6e1ead23a1f00ec8d8acad495f4865` |

## TimeLockHook (destination chains)

| Chain | Address |
|-------|---------|
| Ethereum Sepolia | `0x22f2ea9050a25da1c24caa76558a65aecc4adf4c` |
| Arbitrum Sepolia | `0x0e250b6b417e5b31c7f4bcc8a00352d0672474ad` |
| Base Sepolia | NOT deployed — deployer wallet has no Base Sepolia ETH |

## Security fixes applied in this version

**ConditionalEscrow:**
- `createEscrow`: Added `arbiter != beneficiary` and `arbiter != depositor` guards
- `release()`: Changed from `isParty` (depositor OR beneficiary) to `isDepositor` only — beneficiary was able to drain escrow before time expired

**PayrollVesting:**
- `revoke()`: Fixed lost-tokens bug — vested-but-unclaimed tokens now transferred to beneficiary during revoke; `amountClaimed` set to `vested` to prevent double-claim

**TimeLockHook:**
- `relay()`: Added `require(finalRecipient != address(0))`
- `claim()`: Moved `emit Released` to after the transfer (not before)
- Added `address public owner` for Arcscan display
- NatSpec warning added about caller-supplied params (testnet limitation)

## Key design notes

- All three Arc contracts have `address public owner = msg.sender` — Arcscan shows owner
- `via_ir = true` in foundry.toml — required due to stack-too-deep in CrosschainEscrow
- Addresses are in VITE_ shared env vars AND as defaults in `contracts.ts`
- `keeper.ts` in api-server has the ConditionalEscrow address hardcoded (update on redeploy)

## Deployment commands

```bash
# Arc Testnet (all three contracts)
cd contracts && forge script script/Deploy.s.sol:Deploy \
  --rpc-url https://rpc.testnet.arc.network \
  --private-key "$DEPLOYER_PRIVATE_KEY" --broadcast --config-path foundry.toml

# TimeLockHook — Ethereum Sepolia
forge script script/DeployTimeLockHook.s.sol:DeployTimeLockHook \
  --rpc-url https://ethereum-sepolia-rpc.publicnode.com \
  --private-key "$DEPLOYER_PRIVATE_KEY" --broadcast --config-path foundry.toml

# TimeLockHook — Arbitrum Sepolia (must pass USDC_ADDRESS!)
USDC_ADDRESS=0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d \
forge script script/DeployTimeLockHook.s.sol:DeployTimeLockHook \
  --rpc-url https://sepolia-rollup.arbitrum.io/rpc \
  --private-key "$DEPLOYER_PRIVATE_KEY" --broadcast --config-path foundry.toml
```

## Verification commands

```bash
# Arc contracts (Blockscout)
forge verify-contract --verifier blockscout \
  --verifier-url "https://testnet.arcscan.app/api/" \
  --compiler-version 0.8.20 --chain 5042002 \
  <ADDRESS> src/<Contract>.sol:<Contract>

# CrosschainEscrow needs constructor args:
# --constructor-args $(cast abi-encode "constructor(address,address)" 0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA 0x3600000000000000000000000000000000000000)

# TimeLockHook — Eth Sepolia
forge verify-contract --verifier blockscout \
  --verifier-url "https://eth-sepolia.blockscout.com/api/" \
  --compiler-version 0.8.20 --chain 11155111 <ADDRESS> src/TimeLockHook.sol:TimeLockHook \
  --constructor-args $(cast abi-encode "constructor(address,address)" 0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238)

# TimeLockHook — Arb Sepolia
forge verify-contract --verifier blockscout \
  --verifier-url "https://arbitrum-sepolia.blockscout.com/api/" \
  --compiler-version 0.8.20 --chain 421614 <ADDRESS> src/TimeLockHook.sol:TimeLockHook \
  --constructor-args $(cast abi-encode "constructor(address,address)" 0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275 0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d)
```

## After any redeploy — checklist
1. Update `artifacts/arc-dapp/src/lib/contracts.ts` (CONTRACT_ADDRESSES + TIME_LOCK_HOOK_ADDRESSES)
2. Update `artifacts/api-server/src/lib/keeper.ts` (CONDITIONAL_ESCROW address)
3. Update VITE_ shared env vars via setEnvVars()
4. Update `replit.md` deployed contract table
5. Verify on Arcscan / Blockscout
6. Restart both workflows
