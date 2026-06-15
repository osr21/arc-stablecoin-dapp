# Arc Stablecoin DApp

A full-stack decentralized application on **Arc Testnet** (Chain ID: 5042002) demonstrating advanced Circle stablecoin logic — USDC and EURC — across three on-chain primitives.

Live demo: [arc-smart-stablecoin-logic.replit.app](https://arc-smart-stablecoin-logic.replit.app)

---

## Overview

The Arc Stablecoin DApp showcases production-grade stablecoin patterns that teams building on Circle's stack can use as a reference:

| Primitive | Contract | What it does |
|-----------|----------|--------------|
| **Conditional Escrow** | `ConditionalEscrow.sol` | Time-based, milestone, and oracle-triggered escrows in USDC or EURC with dispute resolution |
| **Programmable Payroll / Vesting** | `PayrollVesting.sol` | Cliff + linear vesting schedules; employees claim vested USDC; employer can revoke unvested portion |
| **Cross-chain CCTP v2** | `CrosschainEscrow.sol` | `depositForBurnWithHook()` transfers from Arc to Ethereum Sepolia / Base Sepolia / Arbitrum Sepolia; attestation polling via Circle IRIS |

---

## Deployed Contracts (Arc Testnet, Block 47067610)

| Contract | Address | Explorer |
|----------|---------|---------|
| `ConditionalEscrow` | [`0x5c4927C8b3b627415E78a151B68B07A079Bd21c1`](https://testnet.arcscan.app/address/0x5c4927C8b3b627415E78a151B68B07A079Bd21c1) | ArcScan |
| `PayrollVesting` | [`0xDB7672E26f203a0f37b93042Df150D2E95831387`](https://testnet.arcscan.app/address/0xDB7672E26f203a0f37b93042Df150D2E95831387) | ArcScan |
| `CrosschainEscrow` | [`0x72923f5f69AeD25aaf92779ceF221342dbE7dfDB`](https://testnet.arcscan.app/address/0x72923f5f69AeD25aaf92779ceF221342dbE7dfDB) | ArcScan |

---

## Arc Testnet Reference

| Item | Value |
|------|-------|
| Chain ID | `5042002` |
| RPC | `https://rpc.testnet.arc.network` |
| Block Explorer | `https://testnet.arcscan.app` |
| USDC (native gas token) | `0x3600000000000000000000000000000000000000` |
| EURC | `0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a` |
| CCTP Domain ID | `26` |
| TokenMessengerV2 | `0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA` |
| MessageTransmitterV2 | `0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275` |
| `minFinalityThreshold` | `2000` |
| Testnet Faucet | `https://faucet.circle.com` |

> **Note:** USDC on Arc is also the native gas token. The ERC-20 address above is used for smart contract interactions (approvals, transfers); wallets display the native balance directly.

---

## Features

### Dashboard
- Live system stats: total escrows, vesting schedules, USDC/EURC locked
- Recent activity feed with on-chain links
- API health indicator

### Escrow
- Create escrows with three condition types: **Time-based**, **Milestone**, **Oracle-triggered**
- Choose USDC or EURC
- Raise disputes; arbiter resolves with release or refund
- Full lifecycle: `pending → active → complete / disputed → resolved`

### Vesting / Payroll
- Employer creates cliff + linear vesting schedules
- Employee claims vested tokens on-demand
- Employer can revoke unvested portion at any time
- Displays: total allocated, vested, claimed, claimable now

### Cross-chain Transfers (CCTP v2)
- Initiate `depositForBurnWithHook()` from Arc Testnet to:
  - Ethereum Sepolia (CCTP domain 0)
  - Base Sepolia (CCTP domain 6)
  - Arbitrum Sepolia (CCTP domain 3)
- Condition types: Unconditional, Time-locked, Oracle-verified, Multisig approval
- Live USDC balance check before submission
- Attestation polling via Circle IRIS bridge
- Self-relay `receiveMessage()` via MetaMask on the destination chain
- ETH balance pre-flight check with faucet links

### Contracts Reference Card
- Deployed addresses with ArcScan links
- Full ABI for each contract
- Arc Testnet chain configuration

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, Vite, Tailwind CSS, shadcn/ui, Wouter |
| Wallet | viem, MetaMask (EIP-1193) |
| API | Express 5, Pino logging |
| Database | PostgreSQL + Drizzle ORM |
| Validation | Zod v4, drizzle-zod |
| API contracts | OpenAPI spec → Orval codegen (React Query hooks + Zod schemas) |
| Smart contracts | Solidity, Foundry |
| Monorepo | pnpm workspaces, Node.js 24, TypeScript 5.9 |

---

## Architecture

```
Browser (React + viem)
    │
    ├─── /api  ──→  Express API Server
    │                   │
    │                   ├─ GET  /escrows            → PostgreSQL (Drizzle ORM)
    │                   ├─ GET  /vesting
    │                   ├─ GET  /crosschain
    │                   ├─ PATCH /crosschain/:id/status
    │                   └─ GET  /cctp/attestation/:txHash → Circle IRIS bridge
    │
    └─── MetaMask (EIP-1193)
             │
             ├─ Arc Testnet (Chain 5042002)
             │       ├─ ConditionalEscrow.sol
             │       ├─ PayrollVesting.sol
             │       └─ CrosschainEscrow.sol
             │              └─ → Circle TokenMessengerV2.depositForBurnWithHook()
             │
             └─ Destination Chain (Sepolia / Base / Arbitrum)
                     └─ Circle MessageTransmitterV2.receiveMessage()
```

### Key Design Decisions

**Contract-first API:** `lib/api-spec/openapi.yaml` is the source of truth. Orval codegen generates both React Query hooks (client) and Zod validators (server). No manual type duplication.

**Raw base units everywhere:** All USDC/EURC amounts in the database and API are stored as strings in 6-decimal raw units (e.g. `"5000000"` = 5 USDC). The frontend converts to/from human-readable via `formatTokenAmount()` / `parseTokenAmount()`.

**Simulation-first UX:** Forms generate realistic contract addresses and tx hashes so the full UI flow works without a live wallet. Real wallet interaction replaces simulated data when MetaMask is connected.

**CCTP v2 attestation:** Arc Testnet domain 26 is not yet supported by Circle's public IRIS API. Attestations are fetched via the `arc-relay-bridge.replit.app` proxy (`GET /api/attest?domain=26&txHash=…`).

**Gas safety on destination chains:** `receiveMessage()` transactions use `2× estimateFeesPerGas` to ensure `maxFeePerGas` always clears the current base fee, even when it fluctuates between estimation and submission.

---

## Local Development

### Prerequisites
- Node.js 24+
- pnpm 9+
- PostgreSQL
- MetaMask with Arc Testnet added

### Setup

```bash
# Clone
git clone https://github.com/<your-org>/arc-stablecoin-dapp.git
cd arc-stablecoin-dapp

# Install
pnpm install

# Environment
cp .env.example .env
# Set DATABASE_URL, SESSION_SECRET, DEPLOYER_PRIVATE_KEY

# Push DB schema
pnpm --filter @workspace/db run push

# Start services (two terminals)
pnpm --filter @workspace/api-server run dev   # API on :8080
pnpm --filter @workspace/arc-dapp run dev     # Frontend on :22967
```

### Add Arc Testnet to MetaMask

| Field | Value |
|-------|-------|
| Network Name | Arc Testnet |
| RPC URL | `https://rpc.testnet.arc.network` |
| Chain ID | `5042002` |
| Currency Symbol | `USDC` |
| Block Explorer | `https://testnet.arcscan.app` |

Get testnet USDC at [faucet.circle.com](https://faucet.circle.com).

### Redeploy Contracts

```bash
cd contracts
forge script script/Deploy.s.sol:Deploy \
  --rpc-url https://rpc.testnet.arc.network \
  --private-key "$DEPLOYER_PRIVATE_KEY" \
  --broadcast \
  --config-path foundry.toml
```

### Codegen (after editing the OpenAPI spec)

```bash
pnpm --filter @workspace/api-spec run codegen
```

---

## Project Structure

```
.
├── artifacts/
│   ├── api-server/         # Express 5 API
│   │   └── src/routes/     # escrow, vesting, crosschain, cctp, dashboard
│   └── arc-dapp/           # React + Vite frontend
│       └── src/
│           ├── pages/      # Dashboard, Escrow, Vesting, Crosschain, Contracts, Architecture
│           └── lib/        # wallet.tsx, contracts.ts, format.ts
├── contracts/
│   └── src/                # ConditionalEscrow.sol, PayrollVesting.sol, CrosschainEscrow.sol
├── lib/
│   ├── api-spec/           # openapi.yaml — source of truth
│   ├── api-client-react/   # Generated React Query hooks
│   ├── api-zod/            # Generated Zod schemas
│   └── db/                 # Drizzle ORM schema + migrations
└── scripts/                # Shared utility scripts
```

---

## Smart Contract Interfaces

### ConditionalEscrow.sol

```solidity
function createEscrow(
    address beneficiary,
    address token,          // USDC or EURC
    uint256 amount,
    ConditionType condition, // TIME_BASED | MILESTONE | ORACLE
    uint256 conditionValue,
    address arbiter,
    string calldata description
) external returns (uint256 escrowId);

function releaseEscrow(uint256 escrowId) external;
function raiseDispute(uint256 escrowId) external;
function resolveDispute(uint256 escrowId, bool releaseToBeneficiary) external; // arbiter only
```

### PayrollVesting.sol

```solidity
function createVestingSchedule(
    address employee,
    address token,
    uint256 totalAmount,
    uint256 cliffDuration,   // seconds
    uint256 vestingDuration  // seconds (from cliff end)
) external returns (uint256 scheduleId);

function claimVested(uint256 scheduleId) external;
function revokeSchedule(uint256 scheduleId) external; // employer only
```

### CrosschainEscrow.sol

```solidity
function initiateConditionalTransfer(
    address recipient,
    uint32  destDomain,         // 0=Eth Sepolia, 3=Arb Sepolia, 6=Base Sepolia
    uint256 amount,
    uint256 maxFee,             // 0 = no fee cap
    uint32  minFinalityThreshold, // 2000 for Arc finalized
    bytes   calldata hookData,
    string  calldata conditionDescription
) external;
```

Calls Circle's `TokenMessengerV2.depositForBurnWithHook()` internally. On the destination chain, call `MessageTransmitterV2.receiveMessage(message, attestation)` once Circle attests the burn.

---

## CCTP v2 Transfer Flow

```
1. User calls initiateConditionalTransfer() on Arc Testnet
   └─ Contract calls TokenMessengerV2.depositForBurnWithHook()
   └─ USDC is burned on Arc; a CCTP message is emitted

2. Poll for attestation
   GET https://arc-relay-bridge.replit.app/api/attest?domain=26&txHash=<burnTxHash>
   └─ Returns { messages: [{ attestation, message, status }] }
   └─ Wait until status = "complete"

3. User calls receiveMessage() on the destination chain (via MetaMask)
   MessageTransmitterV2.receiveMessage(message, attestation)
   └─ Circle mints USDC to the recipient address
```

---

## License

MIT
