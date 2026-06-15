---
name: TimeLockHook deployment + CCTP v2 hook pattern
description: How time-lock hooks work in CCTP v2, releaseId computation, and deployed addresses.
---

## Pattern
For a time-locked CCTP v2 transfer, the CCTP `mintRecipient` is set to the **TimeLockHook contract** (not the final user). The `hookData` carries `abi.encode(finalRecipient, unlockTimestamp)`. After Circle attestation and `receiveMessage()`, USDC is minted to TimeLockHook which stores a `PendingRelease`. After `unlockTimestamp`, the `finalRecipient` calls `claim(releaseId)`.

## releaseId computation (matches on-chain)
```
releaseId = keccak256(abi.encode(
  sourceDomain,         // uint32 — ARC_CCTP_DOMAIN = 26
  messageSender,        // bytes32 — CrosschainEscrow addr left-padded to 32 bytes
  finalRecipient,       // address
  amount,               // uint256
  unlockTimestamp       // uint256
))
```
Frontend uses `computeTimeLockReleaseId()` from `contracts.ts` (uses viem `padHex`, `encodeAbiParameters`, `keccak256`).

## BurnMessageV2 packed layout (for hook parsing)
```
[0:4]    version       uint32
[4:36]   burnToken     bytes32
[36:68]  mintRecipient bytes32
[68:100] amount        uint256
[100:132] messageSender bytes32
[132:164] maxFee       uint256
[164:168] hookDataLen  uint32  (4 bytes, NOT 32)
[168:]   hookData      bytes
```
TimeLockHook.handleReceiveMessage() parses amount (offset 68) and hookData (offset 168) directly from messageBody.

## Deployed addresses (current — v3, both bugs fixed)
| Contract | Chain | Address |
|---|---|---|
| TimeLockHook | Ethereum Sepolia (11155111) | 0xafC1BC5a555b723cA0bB7098f161F1f883F4a3c0 |
| TimeLockHook | Arbitrum Sepolia (421614) | 0x814583a132E83804fA4D2F1Ea35999A620093d97 |
| TimeLockHook | Base Sepolia (84532) | NOT deployed — deployer wallet has no Base Sepolia ETH |

## CRITICAL BUG 1 (fixed): wrong caller guard
Original contract checked `msg.sender == messageTransmitter` (MessageTransmitterV2).
Actual call chain is: MessageTransmitterV2 → TokenMessengerV2 → hook.handleReceiveMessage()
So msg.sender is TokenMessengerV2, not MessageTransmitterV2. Every receiveMessage reverted.
Fix: constructor now takes TOKEN_MESSENGER_V2 (0x8FE6...DAA), stored as `tokenMessenger`, checked in guard.

## CRITICAL BUG 2 (fixed): wrong BurnMessageV2 hookData offset
BurnMessageV2 layout: [164:168] = minFinalityThreshold (uint32, value 2000 on Arc), NOT a hookData length prefix.
hookData has NO length prefix — it runs from offset 168 to end of messageBody.
Original code read minFinalityThreshold (2000) as hookDataLen, then checked messageBody.length < 168+2000
which always failed (actual body = 232 bytes) → HookDataTooShort revert → gas estimation fail.
Fix: `bytes calldata hookData = messageBody[168:]` with minimum size check `< 168+64`.

To deploy on Base Sepolia once funded, run:
```bash
forge script script/DeployTimeLockHook.s.sol:DeployTimeLockHook \
  --rpc-url https://sepolia.base.org \
  --private-key "$DEPLOYER_PRIVATE_KEY" --broadcast --config-path foundry.toml
```
Then set `"Base Sepolia"` in `TIME_LOCK_HOOK_ADDRESSES` in `artifacts/arc-dapp/src/lib/contracts.ts`.

**Why:** Circle CCTP v2 mints to `mintRecipient` then calls `handleReceiveMessage(sourceDomain, sender, messageBody)` on it. The hook enforces any condition (time-lock, oracle, multisig) without modifying the CCTP protocol.

## Hook interface (Circle CCTP v2)
```solidity
function handleReceiveMessage(uint32 sourceDomain, bytes32 sender, bytes calldata messageBody) external returns (bool);
```
`msg.sender` will be the Circle `MessageTransmitterV2` (same CREATE2 address on all chains: `0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275`).

## Redeployment
```bash
forge script script/DeployTimeLockHook.s.sol:DeployTimeLockHook \
  --rpc-url <dest-chain-rpc> \
  --private-key "$DEPLOYER_PRIVATE_KEY" \
  --broadcast --config-path foundry.toml
```
Then update `TIME_LOCK_HOOK_ADDRESSES` in `artifacts/arc-dapp/src/lib/contracts.ts`.
