# Changelog

All notable changes to the Arc Stablecoin DApp are documented here.

---

## [Unreleased]

### Batch Transfer (June 2026)

Added a **Batch Transfer** primitive — send USDC or EURC to multiple wallets in a single on-chain call, paying all recipients with only 2 MetaMask confirmations regardless of how many there are.

#### Smart contract — `BatchTransfer.sol`

Deployed and source-verified on Arc Testnet at [`0x76d5dd51ad28D607cD8804dc5230cAE93403eD3d`](https://testnet.arcscan.app/address/0x76d5dd51ad28D607cD8804dc5230cAE93403eD3d).

```solidity
function batchTransfer(
    address token,
    address[] calldata recipients,
    uint256[] calldata amounts,
    string  calldata memo
) external;
```

Flow:
1. Caller calls `token.approve(batchTransfer, totalAmount)`
2. Caller calls `batchTransfer(token, recipients, amounts, memo)` — the contract pulls the exact total from the caller and distributes to each recipient in one pass

The optional `memo` string is emitted in the `BatchExecuted` event and stored in the transaction's event log — no separate transaction or confirmation required.

```solidity
event BatchExecuted(
    address indexed sender,
    address indexed token,
    uint256 totalAmount,
    uint256 count,
    string  memo
);
```

The contract is source-verified on ArcScan, so all event fields (`totalAmount`, `count`, `memo`) are decoded and displayed by name on every transaction's Logs tab.

#### Batch Transfer UI (`/batch`)

- **Recipient table** with per-row token selection (USDC or EURC) and a global token switcher
- **Mixed batches**: rows are grouped by token; each group gets its own approve + batchTransfer pair
- **Allowance check**: if the contract already has sufficient allowance, the Approve step is skipped automatically
- **On-chain memo**: free-text field embedded in the `batchTransfer()` call — visible on ArcScan without a separate transaction
- **Live balance display**: fetches USDC and EURC balances on wallet connect and after every successful send; shows per-token "insufficient" warning when batch total exceeds available balance
- **Step-by-step progress** with state icons and ArcScan links for every transaction

#### Arc Testnet network quirk

Arc Testnet rejects any transaction sent from an EOA to its own address when `data` is non-empty:

> *"External transactions to internal accounts cannot include data"*

This is a consensus-level rule — not a MetaMask or RPC issue. The original design sent an on-chain memo as a self-call with calldata. After hitting this error, the approach was changed: the memo is now a parameter of the contract function itself and stored in the event log, bypassing the restriction entirely.

---

### Security — Smart Contract Audit & Fixes (June 2026)

A full security audit was conducted across all four contracts: `ConditionalEscrow`, `PayrollVesting`, `CrosschainEscrow`, and `TimeLockHook`. Five vulnerabilities were identified and patched before redeployment.

See [docs/security-audit.md](docs/security-audit.md) for full details.

**Critical fixes**

- **ConditionalEscrow — Beneficiary self-pay via `release()`**
  The `release()` function previously allowed *either* the depositor or beneficiary to call it (using an `isParty` check). A beneficiary could call `release()` immediately after escrow creation and drain the funds before any time-lock expired. Fixed: only the **depositor** may call `release()` early; anyone may call `autoRelease()` after the time condition is met.

- **PayrollVesting — Tokens permanently locked on revoke**
  `revoke()` returned the unvested portion to the employer but silently discarded vested-but-unclaimed tokens — they were left stuck in the contract with no way to retrieve them. Fixed: `revoke()` now transfers vested-but-unclaimed tokens to the beneficiary first, then sets `amountClaimed = vested` to prevent double-claiming.

**High severity**

- **ConditionalEscrow — Arbiter collusion possible**
  No guard prevented `arbiter == beneficiary`. A colluding beneficiary could raise a dispute and immediately resolve it in their own favour. Fixed: `createEscrow()` now requires `arbiter ≠ beneficiary` and `arbiter ≠ depositor`.

**Medium severity**

- **TimeLockHook — Zero-address recipient locks USDC**
  If `relay()` was called with `finalRecipient = address(0)`, USDC would be minted to the contract and permanently locked with no claimable owner. Fixed: added `require(finalRecipient != address(0))`.

**Low severity**

- **TimeLockHook — `emit Released` fired before external transfer**
  The event was emitted before the `USDC.transfer()` call, violating the checks-effects-interactions pattern (even though EVM reverts make this safe). Fixed: emit now follows the transfer.

---

### Redeployments (June 2026)

All Arc Testnet contracts and TimeLockHook contracts were redeployed and source-verified after the security fixes.

#### Arc Testnet (Chain ID 5042002)

| Contract | Address |
|----------|---------|
| ConditionalEscrow | [`0x34733fbbC101F2244Df03508170893013528004e`](https://testnet.arcscan.app/address/0x34733fbbC101F2244Df03508170893013528004e) |
| PayrollVesting | [`0x113F24249b0521d7288E52D12AE869d5903E6143`](https://testnet.arcscan.app/address/0x113F24249b0521d7288E52D12AE869d5903E6143) |
| CrosschainEscrow | [`0x1e0AaD16aaBFe906987D70A00783E9ab67954aFF`](https://testnet.arcscan.app/address/0x1e0AaD16aaBFe906987D70A00783E9ab67954aFF) |
| BatchTransfer | [`0x76d5dd51ad28D607cD8804dc5230cAE93403eD3d`](https://testnet.arcscan.app/address/0x76d5dd51ad28D607cD8804dc5230cAE93403eD3d) |

#### Ethereum Sepolia

| Contract | Address |
|----------|---------|
| TimeLockHook v6 | [`0x22f2ea9050a25da1c24caa76558a65aecc4adf4c`](https://eth-sepolia.blockscout.com/address/0x22f2ea9050a25da1c24caa76558a65aecc4adf4c) |

#### Arbitrum Sepolia

| Contract | Address |
|----------|---------|
| TimeLockHook v6 | [`0x0e250b6b417e5b31c7f4bcc8a00352d0672474ad`](https://arbitrum-sepolia.blockscout.com/address/0x0e250b6b417e5b31c7f4bcc8a00352d0672474ad) |

---

### TimeLockHook v6 (self-relay design)

Added `TimeLockHook.sol` — a CCTP v2 destination-chain hook contract that:

1. Receives the CCTP `receiveMessage()` call from the relayer
2. Holds USDC internally and records a `releaseId → (recipient, amount, unlockTimestamp, claimed)` entry
3. Lets the final recipient call `claim(releaseId)` after the time-lock expires to receive their USDC

This enables trustless **time-locked cross-chain USDC transfers**: Arc Testnet → Sepolia / Arbitrum Sepolia, where USDC is only claimable by the recipient after a specified timestamp — without any central custodian.

Each release ID is derived as:
```
keccak256(abi.encode(block.chainid, address(this), relayNonce++))
```

---

## Earlier

Prior deployment history is captured in the Foundry broadcast files under `contracts/broadcast/`.
