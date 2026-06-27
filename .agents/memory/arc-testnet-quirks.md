---
name: Arc Testnet quirks
description: Network-level restrictions and workarounds specific to Arc Testnet (Chain ID 5042002)
---

## Self-calls with data are blocked

Arc Testnet rejects transactions from EOAs to their own address when `data` is non-empty:
> "External transactions to internal accounts cannot include data"

**Why:** Arc consensus rule — not a MetaMask or RPC issue.

**How to apply:** Any "on-chain memo" feature that uses a self-call with calldata will always fail. Workaround: embed the memo as a parameter in a contract call so it gets stored in an event log instead.

## EIP-1559 fee fields

viem's `sendTransaction` auto-injects `maxFeePerGas` / `maxPriorityFeePerGas`. MetaMask rejects these for certain tx types on Arc. Use `writeContract` for contract calls (works fine); avoid raw `sendTransaction` for data-only txs.

## Other known quirks

- `eth_estimateGas` is unreliable — always pass explicit `gas`.
- `waitForTransactionReceipt` never throws on revert — always check `receipt.status`.
- USDC at `0x3600000000000000000000000000000000000000` is also the native gas token.
- CCTP Domain ID for Arc is **26** (not 7); `minFinalityThreshold` is **2000**.
