---
name: CCTP v2 depositForBurn return values
description: CCTP v2 TokenMessengerV2 functions return nothing — declaring returns(uint64) causes raw 0x revert
---

## Rule

`ITokenMessengerV2.depositForBurn()` and `ITokenMessengerV2.depositForBurnWithHook()` in Circle CCTP v2 return **no value**. Declaring `returns (uint64 nonce)` in a Solidity interface causes the ABI decoder to try to decode an empty return payload as uint64, which reverts with raw `0x`.

**Why:** CCTP v2 dropped the return value. The nonce is emitted in the `DepositForBurn` event on the TokenMessengerV2, not as a function return. The bug manifested as a raw `0x` revert with all CCTP sub-calls succeeding (all appearing as "Parent reverted" in ArcScan) — the revert happened after the CCTP call when Solidity tried to decode the empty return.

**How to apply:** Always declare both functions as `external` with no return type:
```solidity
function depositForBurn(...) external;
function depositForBurnWithHook(...) external;
```

## Additional CCTP v2 facts for Arc Testnet

- `depositForBurnWithHook` reverts with `"Hook data is empty"` if `hookData.length == 0` — use `depositForBurn` for unconditional transfers
- `minFee` on TokenMessengerV2 is 0 on Arc testnet
- All remote domains (0,1,2,3,6,7) return `0x8FE6B999...` (TokenMessengerV2 itself) from `remoteTokenMessengers()` — this is correct Circle behavior
- `_depositAndBurn` calls `USDC.transferFrom(caller, TokenMinterV2, amount)` — spender is TokenMessengerV2 proxy, so approve must target TokenMessengerV2 proxy address
- Successful CCTP txs on Arc testnet all call TokenMessengerV2 directly from EOA wallets — via-contract also works once interface is correct
