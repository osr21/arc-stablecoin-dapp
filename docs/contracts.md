# Smart Contract Reference

All contracts are deployed on **Arc Testnet** (Chain ID: 5042002) and verified on [ArcScan](https://testnet.arcscan.app).

## ConditionalEscrow

**Address:** [`0x5c4927C8b3b627415E78a151B68B07A079Bd21c1`](https://testnet.arcscan.app/address/0x5c4927C8b3b627415E78a151B68B07A079Bd21c1)

Holds USDC or EURC in escrow, releasing funds only when a specified condition is met. Supports dispute resolution via an arbiter.

### State Machine

```
created → active → complete
                 → disputed → resolved (released or refunded)
```

### Functions

```solidity
// Create a new escrow
function createEscrow(
    address beneficiary,
    address token,           // USDC: 0x3600...0000  |  EURC: 0x89B5...D72a
    uint256 amount,          // raw 6-decimal units (1000000 = 1 USDC)
    ConditionType condition, // 0=TIME_BASED, 1=MILESTONE, 2=ORACLE
    uint256 conditionValue,  // unix timestamp for TIME_BASED; ignored for others
    address arbiter,         // address authorised to resolve disputes
    string calldata description
) external returns (uint256 escrowId);

// Payer releases funds to beneficiary (if condition met)
function releaseEscrow(uint256 escrowId) external;

// Either party raises a dispute
function raiseDispute(uint256 escrowId) external;

// Arbiter resolves: true = release to beneficiary, false = refund to payer
function resolveDispute(uint256 escrowId, bool releaseToBeneficiary) external;
```

### Events

```solidity
event EscrowCreated(uint256 indexed id, address payer, address beneficiary, address token, uint256 amount);
event EscrowReleased(uint256 indexed id);
event DisputeRaised(uint256 indexed id, address raisedBy);
event DisputeResolved(uint256 indexed id, bool releasedToBeneficiary);
```

---

## PayrollVesting

**Address:** [`0xDB7672E26f203a0f37b93042Df150D2E95831387`](https://testnet.arcscan.app/address/0xDB7672E26f203a0f37b93042Df150D2E95831387)

Cliff + linear vesting for USDC payroll. The employer locks total tokens upfront; the employee claims vested amounts on-demand.

### Vesting Formula

```
Vested at time T (after cliff):
  vestedAmount = totalAmount × (T - cliffEnd) / vestingDuration
  claimable    = vestedAmount - alreadyClaimed
```

### Functions

```solidity
// Employer creates a vesting schedule (must approve token spend first)
function createVestingSchedule(
    address employee,
    address token,
    uint256 totalAmount,      // raw 6-decimal units
    uint256 cliffDuration,    // seconds until cliff
    uint256 vestingDuration   // seconds of linear vesting after cliff
) external returns (uint256 scheduleId);

// Employee claims all currently vested tokens
function claimVested(uint256 scheduleId) external;

// Employer revokes: unvested tokens returned to employer
function revokeSchedule(uint256 scheduleId) external;
```

### Events

```solidity
event ScheduleCreated(uint256 indexed id, address employer, address employee, uint256 totalAmount);
event TokensClaimed(uint256 indexed id, address employee, uint256 amount);
event ScheduleRevoked(uint256 indexed id, uint256 returnedToEmployer);
```

---

## CrosschainEscrow

**Address:** [`0x72923f5f69AeD25aaf92779ceF221342dbE7dfDB`](https://testnet.arcscan.app/address/0x72923f5f69AeD25aaf92779ceF221342dbE7dfDB)

Wraps Circle's `TokenMessengerV2.depositForBurnWithHook()` to attach a condition description to every cross-chain USDC transfer from Arc Testnet.

### Functions

```solidity
// Initiate a CCTP v2 burn-and-transfer (must approve USDC spend first)
function initiateConditionalTransfer(
    address recipient,              // recipient on destination chain
    uint32  destDomain,             // 0=Eth Sepolia, 3=Arb Sepolia, 6=Base Sepolia
    uint256 amount,                 // raw 6-decimal units
    uint256 maxFee,                 // 0 = no fee cap
    uint32  minFinalityThreshold,   // 2000 for Arc "finalized"
    bytes   calldata hookData,      // optional hook calldata
    string  calldata conditionDescription
) external;
```

### Events

```solidity
event ConditionalTransferInitiated(
    address indexed sender,
    address indexed recipient,
    uint32 destDomain,
    uint256 amount,
    string conditionDescription
);
```

### Deployment & Redeploy

```bash
cd contracts
forge script script/Deploy.s.sol:Deploy \
  --rpc-url https://rpc.testnet.arc.network \
  --private-key "$DEPLOYER_PRIVATE_KEY" \
  --broadcast \
  --config-path foundry.toml
```

After redeploying, update `CONTRACT_ADDRESSES` in `artifacts/arc-dapp/src/lib/contracts.ts` and `replit.md`.
