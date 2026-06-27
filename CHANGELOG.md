# Changelog

All notable changes to the Arc Stablecoin DApp are documented here.

---

## [Unreleased]

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

| Contract | New Address |
|----------|-------------|
| ConditionalEscrow | [`0x34733fbbC101F2244Df03508170893013528004e`](https://testnet.arcscan.app/address/0x34733fbbC101F2244Df03508170893013528004e) |
| PayrollVesting | [`0x113F24249b0521d7288E52D12AE869d5903E6143`](https://testnet.arcscan.app/address/0x113F24249b0521d7288E52D12AE869d5903E6143) |
| CrosschainEscrow | [`0x1e0AaD16aaBFe906987D70A00783E9ab67954aFF`](https://testnet.arcscan.app/address/0x1e0AaD16aaBFe906987D70A00783E9ab67954aFF) |

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
