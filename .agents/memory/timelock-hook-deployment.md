---
name: TimeLockHook — CCTP v2 hook pattern + v6 self-relay design
description: Definitive design for time-locked CCTP v2 transfers. Circle never calls handleReceiveMessage automatically — v6 makes TimeLockHook the relay entrypoint itself.
---

## THE ROOT CAUSE (applies to ALL versions before v6)

**Circle NEVER calls `handleReceiveMessage` on `mintRecipient` automatically.**

When `MessageTransmitterV2.receiveMessage()` is called, USDC is simply ERC-20 transferred to `mintRecipient`. There is no automatic hook invocation. The `handleReceiveMessage` pattern only works when going through Circle's `CCTPHookWrapper.relay()`, which is a separate wrapper contract that relays the CCTP message AND calls `target.call(calldata)` using the `hookData` field (format: `bytes20(target) + bytes(calldata)`).

Since users call `messageTransmitter.receiveMessage()` directly (not through CCTPHookWrapper), no hook is ever called. This was the fundamental flaw in v1–v5.

## v6 Design — Self-Relay Pattern (CORRECT)

TimeLockHook is now the relay entrypoint. Users call `TimeLockHook.relay()` instead of `messageTransmitter.receiveMessage()` directly.

**Flow:**
1. Sender on Arc calls `CrosschainEscrow.initiateConditionalTransfer` with:
   - `recipient` = `address(TimeLockHook)` — USDC mints here
   - `hookData` = `abi.encode(finalRecipient, unlockTimestamp, amount)` — for auditability only
2. Circle attests the burn message
3. Relayer calls `TimeLockHook.relay(message, attestation, finalRecipient, unlockTimestamp)`:
   - Calls `MessageTransmitterV2.receiveMessage()` internally → USDC minted to TimeLockHook
   - Measures balance delta to get actual received amount
   - Generates nonce-based `releaseId = keccak256(abi.encode(block.chainid, address(this), relayNonce++))`
   - Stores `PendingRelease{recipient, amount, unlockTime, claimed}`
   - Emits `ReleaseScheduled(releaseId, finalRecipient, amount, unlockTimestamp)`
4. Frontend reads `releaseId` from the `ReleaseScheduled` event in the relay tx receipt
5. After `unlockTimestamp`, `finalRecipient` calls `claim(releaseId)` → USDC transferred out

## Key design properties

- `releaseId` is **NOT pre-computable** (it's nonce-based on-chain). Frontend reads it from the `ReleaseScheduled` event after relay.
- `MessageTransmitterV2` address is the same on all CCTP v2 chains: `0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275`
- The `relay()` function uses balance delta (not the amount param) so no amount param is needed
- `hookData` in the burn is vestigial for v6 (TimeLockHook.relay() ignores it) but kept for auditability

## Frontend changes (v6)

- `handleSelfClaim` branches: if `isTimeLock`, calls `TimeLockHook.relay()` instead of `messageTransmitter.receiveMessage()`
- After relay tx, uses `parseEventLogs({ abi: RELEASE_SCHEDULED_EVENT_ABI, logs: receipt.logs })` to extract `releaseId`
- `actualReleaseId` stored in component state AND `localStorage.setItem(\`timeLock_releaseId_${transferId}\`, rid)` for persistence
- `handleTimeLockClaim` reads `actualReleaseId` from state (or localStorage fallback) — no more `computeTimeLockReleaseId` call
- `timeLockMetaJson` at burn time no longer includes `releaseId` (it's unknown until relay)
- `calldata` in "Raw data" section shows `TimeLockHook.relay()` calldata for time-lock transfers

## Deployed addresses (v6)

| Contract | Chain | Address |
|---|---|---|
| TimeLockHook v6 | Ethereum Sepolia (11155111) | `0x68c49409e3f5fC1e8CC745bE7082692f773945F6` |
| TimeLockHook v6 | Arbitrum Sepolia (421614) | `0x0650beEB6Dd48beA2540ae942Ef3318086644c27` |
| TimeLockHook v6 | Base Sepolia (84532) | NOT deployed — deployer wallet has no Base Sepolia ETH |

Previous addresses (v5 and earlier) — all broken, do not use:
- Eth Sepolia v5: `0x003f131f247EA8f8894B2edc8E41136be6F1EC94`
- Arb Sepolia v5: `0xA5483717601038FC841b63a6e419897Fc58E7f84`

## Contract interface (v6)

```solidity
function relay(
    bytes calldata message,
    bytes calldata attestation,
    address finalRecipient,
    uint256 unlockTimestamp
) external returns (bytes32 releaseId);

function claim(bytes32 releaseId) external;

function getRelease(bytes32 releaseId) external view returns (
    address recipient, uint256 amount, uint256 unlockTime, bool claimed, bool claimable
);

event ReleaseScheduled(bytes32 indexed releaseId, address indexed recipient, uint256 amount, uint256 unlockTime);
event Released(bytes32 indexed releaseId, address indexed recipient, uint256 amount);
```

## Deploy commands (v6)

```bash
# Ethereum Sepolia
forge script script/DeployTimeLockHook.s.sol:DeployTimeLockHook \
  --rpc-url https://ethereum-sepolia-rpc.publicnode.com \
  --private-key "$DEPLOYER_PRIVATE_KEY" --broadcast --config-path foundry.toml

# Arbitrum Sepolia (must pass USDC_ADDRESS!)
USDC_ADDRESS=0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d \
forge script script/DeployTimeLockHook.s.sol:DeployTimeLockHook \
  --rpc-url https://sepolia-rollup.arbitrum.io/rpc \
  --private-key "$DEPLOYER_PRIVATE_KEY" --broadcast --config-path foundry.toml

# Base Sepolia (once wallet has ETH)
USDC_ADDRESS=0x036CbD53842c5426634e7929541eC2318f3dCF7e \
forge script script/DeployTimeLockHook.s.sol:DeployTimeLockHook \
  --rpc-url https://sepolia.base.org \
  --private-key "$DEPLOYER_PRIVATE_KEY" --broadcast --config-path foundry.toml
```

**Why:**
- All v1–v5 assumed Circle calls handleReceiveMessage automatically — it never does
- v6 eliminates this assumption entirely by making the contract call receiveMessage() itself
