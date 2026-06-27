---
name: CCTP v2 depositForBurn interface
description: Key differences in CCTP v2 vs v1 that trip up callers
---

depositForBurn and depositForBurnWithHook in CCTP v2 return void — the nonce is
emitted in the DepositForBurn event, NOT as a return value.

depositForBurnWithHook requires non-empty hookData; use depositForBurn for plain transfers.

Signature (Arc Testnet TokenMessengerV2 = 0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA):
  depositForBurn(amount, destinationDomain, mintRecipient, burnToken, destinationCaller, maxFee, minFinalityThreshold)

mintRecipient = bytes32(uint256(uint160(addr))) — left-pad address to 32 bytes.
destinationCaller = bytes32(0) → anyone can relay the attestation on destination.

Arc minFinalityThreshold: 2000 (finalized). Fast = 1000.
maxFee = 0 for basic (no speed premium).

**Why:** Spent debug time expecting a return value; v2 changed the interface from v1.
**How to apply:** When writing contracts that call CCTP v2, never use the return value of depositForBurn*.
