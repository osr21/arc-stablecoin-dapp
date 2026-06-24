# Security Audit Report

**Date:** June 2026
**Scope:** `ConditionalEscrow.sol`, `PayrollVesting.sol`, `CrosschainEscrow.sol`, `TimeLockHook.sol`
**Auditor:** Internal (pre-deployment review)
**Status:** All findings patched and redeployed ✅

---

## Summary

| ID | Severity | Contract | Title | Status |
|----|----------|----------|-------|--------|
| [SA-01](#sa-01) | 🔴 Critical | ConditionalEscrow | Beneficiary can drain escrow immediately via `release()` | Fixed |
| [SA-02](#sa-02) | 🔴 Critical | PayrollVesting | Vested-but-unclaimed tokens permanently locked on revoke | Fixed |
| [SA-03](#sa-03) | 🟠 High | ConditionalEscrow | Arbiter can be the beneficiary — collusion risk | Fixed |
| [SA-04](#sa-04) | 🟡 Medium | TimeLockHook | Zero-address recipient permanently locks USDC | Fixed |
| [SA-05](#sa-05) | 🟢 Low | TimeLockHook | `emit Released` fires before external transfer | Fixed |

---

## SA-01 — Critical: Beneficiary self-pay via `release()`

**Contract:** `ConditionalEscrow.sol`
**Function:** `release(uint256 id)`

### Description

The `release()` function used an `isParty` access guard that allowed **either** the depositor or the beneficiary to call it. An escrow beneficiary could call `release()` immediately after escrow creation — before any time-lock expired or condition was met — and drain the full escrowed amount to themselves.

### Vulnerable code

```solidity
// BEFORE — allowed beneficiary to self-pay
modifier isParty(uint256 id) {
    require(
        msg.sender == escrows[id].depositor ||
        msg.sender == escrows[id].beneficiary,
        "Not a party"
    );
    _;
}

function release(uint256 id) external isParty(id) { ... }
```

### Fix

Replaced `isParty` with `isDepositor` on `release()`. Only the depositor may call `release()` early. The separate `autoRelease()` remains open to anyone but verifies the time condition on-chain.

```solidity
// AFTER — only depositor can explicitly release early
modifier isDepositor(uint256 id) {
    require(msg.sender == escrows[id].depositor, "Not depositor");
    _;
}

function release(uint256 id) external isDepositor(id) { ... }
```

---

## SA-02 — Critical: Tokens permanently locked on revoke

**Contract:** `PayrollVesting.sol`
**Function:** `revoke(uint256 id)`

### Description

`revoke()` correctly returned the **unvested** portion to the employer, but silently discarded tokens that had **already vested but not yet been claimed** by the beneficiary. After `s.revoked = true`, `vestedAmount()` returned `amountClaimed`, making `claimableAmount()` return `0`. The unclaimed vested tokens became permanently stuck in the contract.

### Vulnerable code

```solidity
// BEFORE — unclaimed vested tokens stuck forever
function revoke(uint256 id) external onlyEmployer(id) {
    uint256 vested   = vestedAmount(id);
    uint256 unvested = s.totalAmount - vested;

    s.revoked = true;  // claim() now yields 0; unclaimed vested tokens locked

    if (unvested > 0) IERC20(s.token).transfer(s.employer, unvested);
}
```

### Fix

Compute and transfer unclaimed vested tokens to the beneficiary before marking revoked, then set `amountClaimed = vested` to prevent a racing `claim()` from double-withdrawing.

```solidity
// AFTER
function revoke(uint256 id) external onlyEmployer(id) {
    uint256 vested    = vestedAmount(id);
    uint256 unclaimed = vested - s.amountClaimed;
    uint256 unvested  = s.totalAmount - vested;

    s.revoked = true;
    s.amountClaimed = vested;  // prevent double-claim

    if (unclaimed > 0) IERC20(s.token).transfer(s.beneficiary, unclaimed);
    if (unvested  > 0) IERC20(s.token).transfer(s.employer,    unvested);
}
```

---

## SA-03 — High: Arbiter collusion (arbiter == beneficiary)

**Contract:** `ConditionalEscrow.sol`
**Function:** `createEscrow()`

### Description

No validation prevented `arbiter == beneficiary`. A colluding beneficiary set as their own arbiter could raise a dispute and immediately resolve it in their own favour.

### Fix

```solidity
require(arbiter != beneficiary, "Arbiter cannot be beneficiary");
require(arbiter != depositor,   "Arbiter cannot be depositor");
```

---

## SA-04 — Medium: Zero-address recipient permanently locks USDC

**Contract:** `TimeLockHook.sol`
**Function:** `relay()`

### Description

`relay()` accepted a caller-supplied `finalRecipient` without a zero-address check. If `finalRecipient = address(0)`, USDC would be minted to the contract and stored with `recipient = address(0)`. Since `claim()` requires `msg.sender == r.recipient`, the USDC would be permanently locked.

### Fix

```solidity
require(finalRecipient != address(0), "Zero recipient");
```

---

## SA-05 — Low: `emit Released` fires before external transfer

**Contract:** `TimeLockHook.sol`
**Function:** `claim()`

### Description

`emit Released` was emitted before the `IERC20.transfer()` call, violating checks-effects-interactions. EVM reverts make this safe today, but it emits misleading on-chain data if a re-entrancy path is introduced later.

### Fix

```solidity
// AFTER — emit follows the transfer
require(IERC20(usdc).transfer(r.recipient, amount), "USDC transfer failed");
emit Released(releaseId, r.recipient, amount);
```

---

## Out of Scope / Notes

- **CrosschainEscrow.sol** — no vulnerabilities found. Not redeployed.
- **TimeLockHook.sol (testnet limitation)** — `finalRecipient` and `unlockTimestamp` are caller-supplied and not parsed from CCTP `hookData`. For production, decode both from the `BurnMessageV2` hookData payload and verify on-chain. A NatSpec warning is present in the contract.
