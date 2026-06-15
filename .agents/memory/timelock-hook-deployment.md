---
name: TimeLockHook deployment + CCTP v2 hook pattern
description: How time-lock hooks work in CCTP v2, releaseId computation, deployed addresses, and all bug postmortems.
---

## Pattern
For a time-locked CCTP v2 transfer, the CCTP `mintRecipient` is set to the **TimeLockHook contract** (not the final user). The `hookData` carries `abi.encode(finalRecipient, unlockTimestamp, amount)`. After Circle attestation and `receiveMessage()`, USDC is minted to TimeLockHook which stores a `PendingRelease`. After `unlockTimestamp`, the `finalRecipient` calls `claim(releaseId)`.

## DEFINITIVE CCTP v2 Hook Interface (v5 — confirmed from on-chain evidence)
Circle passes **only the hookData bytes** (not the full BurnMessageV2) as `messageBody` to the hook.
`sender` = CrosschainEscrow (the address that called depositForBurnWithHook), left-padded to bytes32.

```solidity
function handleReceiveMessage(
    uint32  sourceDomain,  // Arc = 26
    bytes32 sender,        // CrosschainEscrow left-padded to bytes32
    bytes calldata messageBody  // = raw hookData from burn, NOT BurnMessageV2
) external returns (bool);
```

**Critical:** the original contract tried to parse BurnMessageV2 structure from `messageBody`. This was wrong.
Circle passes ONLY the hookData. The `messageBody.length < 232` check fired immediately (actual = 96 bytes).

## hookData encoding (v5 — 96 bytes)
```
abi.encode(address finalRecipient, uint256 unlockTimestamp, uint256 amount)
```
Amount is included so the contract knows how much USDC to release on claim.

## releaseId computation (matches on-chain v5)
```
releaseId = keccak256(abi.encode(
  sourceDomain,    // uint32 — ARC_CCTP_DOMAIN = 26
  sender,          // bytes32 — CrosschainEscrow addr LEFT-padded to 32 bytes
  finalRecipient,  // address
  amount,          // uint256
  unlockTimestamp  // uint256
))
```
Frontend: `computeTimeLockReleaseId(26, CONTRACT_ADDRESSES.CROSSCHAIN_ESCROW, recipient, amount, ts)`
with `padHex(addr, {size:32, dir:'left'})` — dir:'left' is REQUIRED (EVM address encoding).

## Deployed addresses (v5 — correct hookData-only design)
| Contract | Chain | Address |
|---|---|---|
| TimeLockHook v5 | Ethereum Sepolia (11155111) | 0x003f131f247EA8f8894B2edc8E41136be6F1EC94 |
| TimeLockHook v5 | Arbitrum Sepolia (421614) | 0xA5483717601038FC841b63a6e419897Fc58E7f84 |
| TimeLockHook v5 | Base Sepolia (84532) | NOT deployed — deployer wallet has no Base Sepolia ETH |

Previous broken addresses (v4): Sepolia 0x1985cE53...674c7, Arb 0xE1017349...8A088F16f6e8 — do not use.

## Caller hierarchy (confirmed via relay tx trace on Eth Sepolia)
```
User → MessageTransmitterV2 (0xE737...275) → TokenMessengerV2 (0x8FE6...DAA) → hook.handleReceiveMessage()
```
`msg.sender` inside `handleReceiveMessage` = TokenMessengerV2 = `0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA`

## CRITICAL BUG 5 (fixed in v5) — THE REAL ROOT CAUSE
**Circle passes ONLY hookData as `messageBody`, not the full BurnMessageV2.**

v4 contract checked `messageBody.length < 168 + 64 = 232`. Actual messageBody = 64 bytes (hookData).
64 < 232 → reverted with MessageTooShort. Circle's TokenMessengerV2 caught the revert silently,
emitted its own event, and considered the CCTP message fully processed (nonce consumed).
USDC was minted to TimeLockHook but no PendingRelease was stored.

Evidence: relay tx 0xceb7d5...eafde had status 0x1 (success), USDC minted to v4, but ZERO events
from v4 hook address → handleReceiveMessage silently reverted every time.

Fix (v5): `if (messageBody.length < 96) revert MessageTooShort()` and decode directly as
`(address finalRecipient, uint256 unlockTimestamp, uint256 amount) = abi.decode(messageBody, (address, uint256, uint256))`.

## CRITICAL BUG 4 (fixed in frontend): padHex dir:'right' → ReleaseNotFound
viem's `padHex(address, {size:32})` defaults to dir:'right' (appends zeros).
CCTP encodes addresses as bytes32 LEFT-padded. Always use `dir:'left'` when converting an Ethereum
address to bytes32 for keccak hashing to match on-chain abi.encode behavior.

## CRITICAL BUG 3 (was in v4 contract): wrong messageSender source — moot in v5
v4 read `messageSender = bytes32(messageBody[100:132])` from BurnMessageV2. In v5, `sender` parameter
IS CrosschainEscrow (Circle sets it to the address that called depositForBurnWithHook). Use directly.

## CRITICAL BUG 2 (fixed in v3/v4): wrong BurnMessageV2 hookData offset — moot in v5
BurnMessageV2[164:168] = minFinalityThreshold (uint32, value 2000), NOT a hookData length prefix.
Old code read it as hookDataLen=2000, checked 232 < 168+2000 → always failed.

## CRITICAL BUG 1 (fixed in v2+): wrong caller guard — moot in v5
Original checked msg.sender == messageTransmitter. Correct is msg.sender == tokenMessenger.

## Deploy for Arbitrum Sepolia (must pass USDC_ADDRESS env var!)
```bash
USDC_ADDRESS=0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d \
forge script script/DeployTimeLockHook.s.sol:DeployTimeLockHook \
  --rpc-url https://sepolia-rollup.arbitrum.io/rpc \
  --private-key "$DEPLOYER_PRIVATE_KEY" --broadcast --config-path foundry.toml
```
Without USDC_ADDRESS it defaults to Eth Sepolia USDC — wrong for Arb/Base.

## Deploy for Base Sepolia (once wallet has ETH)
```bash
USDC_ADDRESS=0x036CbD53842c5426634e7929541eC2318f3dCF7e \
forge script script/DeployTimeLockHook.s.sol:DeployTimeLockHook \
  --rpc-url https://sepolia.base.org \
  --private-key "$DEPLOYER_PRIVATE_KEY" --broadcast --config-path foundry.toml
```
Then update TIME_LOCK_HOOK_ADDRESSES in `artifacts/arc-dapp/src/lib/contracts.ts`.

## Recompute releaseId at claim time (do not use stale DB value)
Old transfers stored a wrong releaseId (computed with dir:'right' padHex). Claim always recomputes
freshReleaseId from `(ARC_CCTP_DOMAIN, CROSSCHAIN_ESCROW, finalRecipient, amount, unlockTimestamp)`.
Preflight getRelease(freshReleaseId) check before MetaMask to give clear error if relay incomplete.
