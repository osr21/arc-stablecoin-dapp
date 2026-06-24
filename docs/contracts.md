# Smart Contract Reference

All Arc Testnet contracts are deployed on **Arc Testnet** (Chain ID: 5042002) and verified on [ArcScan](https://testnet.arcscan.app). TimeLockHook is deployed on destination chains and verified on Blockscout.

> **Security audit completed June 2026.** See [security-audit.md](security-audit.md) for the full report and patch descriptions.

---

## ConditionalEscrow

**Network:** Arc Testnet
**Address:** [`0x34733fbbC101F2244Df03508170893013528004e`](https://testnet.arcscan.app/address/0x34733fbbC101F2244Df03508170893013528004e)

Holds USDC or EURC in escrow, releasing funds only when a specified condition is met. Supports dispute resolution via an arbiter.

### State Machine

```
created → active → complete
                 → disputed → resolved (released or refunded)
```

### Security notes
- `release()` is restricted to the **depositor only** — beneficiary cannot self-pay (SA-01 fix).
- `createEscrow()` requires `arbiter ≠ beneficiary` and `arbiter ≠ depositor` (SA-03 fix).

### Functions

```solidity
// Create a new escrow
function createEscrow(
    address beneficiary,
    address arbiter,         // must not equal beneficiary or depositor
    address token,           // USDC: 0x3600...0000  |  EURC: 0x89B5...D72a
    uint256 amount,          // raw 6-decimal units (1000000 = 1 USDC)
    ConditionType condition, // 0=TIME_BASED, 1=MILESTONE, 2=ORACLE
    uint256 conditionValue,  // unix timestamp for TIME_BASED; ignored for others
    string calldata description
) external returns (uint256 escrowId);

// Depositor explicitly releases funds to beneficiary
function release(uint256 id) external;

// Anyone can release after the time condition is met
function autoRelease(uint256 id) external;

// Either party raises a dispute
function raiseDispute(uint256 id) external;

// Arbiter resolves: true = release to beneficiary, false = refund to depositor
function resolveDispute(uint256 id, bool releaseToBeneficiary) external;
```

### Events

```solidity
event EscrowCreated(uint256 indexed id, address depositor, address beneficiary, address token, uint256 amount);
event EscrowReleased(uint256 indexed id);
event DisputeRaised(uint256 indexed id, address raisedBy);
event DisputeResolved(uint256 indexed id, bool releasedToBeneficiary);
```

---

## PayrollVesting

**Network:** Arc Testnet
**Address:** [`0x113F24249b0521d7288E52D12AE869d5903E6143`](https://testnet.arcscan.app/address/0x113F24249b0521d7288E52D12AE869d5903E6143)

Cliff + linear vesting for USDC payroll. The employer locks total tokens upfront; the employee claims vested amounts on-demand.

### Vesting Formula

```
Vested at time T (after cliff):
  vestedAmount = totalAmount × (T - cliffEnd) / vestingDuration
  claimable    = vestedAmount - alreadyClaimed
```

### Security notes
- `revoke()` now transfers vested-but-unclaimed tokens to the beneficiary before returning the unvested portion to the employer (SA-02 fix).

### Functions

```solidity
// Employer creates a vesting schedule (must approve token spend first)
function createSchedule(
    address beneficiary,
    address token,
    uint256 totalAmount,      // raw 6-decimal units
    uint256 cliffDuration,    // seconds until cliff
    uint256 vestingDuration   // seconds of linear vesting after cliff
) external returns (uint256 scheduleId);

// Beneficiary claims all currently vested tokens
function claim(uint256 id) external;

// Employer revokes:
//   - vested-but-unclaimed tokens → sent to beneficiary immediately
//   - unvested tokens             → returned to employer
function revoke(uint256 id) external;
```

### Events

```solidity
event ScheduleCreated(uint256 indexed id, address employer, address beneficiary, uint256 totalAmount);
event TokensClaimed(uint256 indexed id, address beneficiary, uint256 amount);
event ScheduleRevoked(uint256 indexed id, address employer, uint256 unvestedReturned);
```

---

## CrosschainEscrow

**Network:** Arc Testnet
**Address:** [`0x1e0AaD16aaBFe906987D70A00783E9ab67954aFF`](https://testnet.arcscan.app/address/0x1e0AaD16aaBFe906987D70A00783E9ab67954aFF)

Wraps Circle's `TokenMessengerV2.depositForBurnWithHook()` to attach a condition description to every cross-chain USDC transfer from Arc Testnet.

### Functions

```solidity
// Initiate a CCTP v2 burn-and-transfer (must approve USDC spend first)
function initiateConditionalTransfer(
    address recipient,
    uint32  destDomain,              // 0=Eth Sepolia, 3=Arb Sepolia, 6=Base Sepolia
    uint256 amount,                  // raw 6-decimal units
    uint256 maxFee,                  // 0 = no fee cap
    uint32  minFinalityThreshold,    // 2000 for Arc finalized
    bytes   calldata hookData,
    string  calldata conditionDescription
) external;
```

### Events

```solidity
event ConditionalTransferInitiated(
    uint256 indexed id,
    address sender,
    address recipient,
    uint32  destDomain,
    uint256 amount,
    bytes32 nonce,
    string  conditionDescription
);
```

---

## TimeLockHook (v6 — self-relay design)

A destination-chain hook contract that holds CCTP-bridged USDC until an `unlockTimestamp`, then lets the designated recipient `claim()` it.

### Addresses

| Chain | Address |
|-------|---------|
| Ethereum Sepolia | [`0x22f2ea9050a25da1c24caa76558a65aecc4adf4c`](https://eth-sepolia.blockscout.com/address/0x22f2ea9050a25da1c24caa76558a65aecc4adf4c) |
| Arbitrum Sepolia | [`0x0e250b6b417e5b31c7f4bcc8a00352d0672474ad`](https://arbitrum-sepolia.blockscout.com/address/0x0e250b6b417e5b31c7f4bcc8a00352d0672474ad) |
| Base Sepolia | *Not deployed — deployer wallet needs Base Sepolia ETH* |

### How it works

1. Relayer calls `relay(message, attestation, finalRecipient, unlockTimestamp)` after CCTP attestation is complete.
2. `relay()` internally calls `MessageTransmitterV2.receiveMessage()` — USDC is minted to TimeLockHook.
3. A release record is stored: `releaseId → { recipient, amount, unlockTime, claimed }`.
4. After `block.timestamp >= unlockTime`, the recipient calls `claim(releaseId)` to receive their USDC.

### Security notes
- `relay()` rejects `finalRecipient = address(0)` (SA-04 fix).
- `emit Released` fires after the transfer, not before (SA-05 fix).
- ⚠️ **Testnet only:** `finalRecipient` and `unlockTimestamp` are caller-supplied and not verified against the CCTP `hookData` payload. Production deployments should parse and verify these values from the `BurnMessageV2` hookData.

### Functions

```solidity
// Relayer calls after Circle attests the burn on Arc Testnet
function relay(
    bytes calldata message,
    bytes calldata attestation,
    address finalRecipient,    // must not be address(0)
    uint256 unlockTimestamp
) external returns (bytes32 releaseId);

// Recipient claims USDC after unlockTimestamp
function claim(bytes32 releaseId) external;

// View pending release
function releases(bytes32 releaseId) external view returns (
    address recipient,
    uint256 amount,
    uint256 unlockTime,
    bool    claimed
);
```

### Events

```solidity
event ReleaseScheduled(bytes32 indexed releaseId, address recipient, uint256 amount, uint256 unlockTime);
event Released(bytes32 indexed releaseId, address recipient, uint256 amount);
```
