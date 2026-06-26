# Arc Stablecoin DApp

A full-stack decentralized application on **Arc Testnet** (Chain ID: 5042002) demonstrating advanced Circle stablecoin logic — USDC and EURC — across four on-chain primitives.

Live demo: [arc-smart-stablecoin-logic.replit.app](https://arc-smart-stablecoin-logic.replit.app)

---

## Overview

The Arc Stablecoin DApp showcases production-grade stablecoin patterns that teams building on Circle's stack can use as a reference:

| Primitive | Contract | What it does |
|-----------|----------|--------------|
| **Conditional Escrow** | `ConditionalEscrow.sol` | Time-based, milestone, and oracle-triggered escrows in USDC or EURC with dispute resolution |
| **Programmable Payroll / Vesting** | `PayrollVesting.sol` | Cliff + linear vesting schedules; employees claim vested USDC; employer can revoke unvested portion |
| **Cross-chain CCTP v2** | `CrosschainEscrow.sol` | `depositForBurnWithHook()` transfers from Arc to Ethereum Sepolia / Base Sepolia / Arbitrum Sepolia; attestation polling via Circle IRIS |
| **Batch Transfer** | `BatchTransfer.sol` | Send USDC or EURC to many recipients in one on-chain call — 2 confirmations regardless of recipient count; optional memo stored in event log |
| **Time-locked Delivery** | `TimeLockHook.sol` | Destination-chain CCTP hook; holds USDC until `unlockTimestamp`, then lets the recipient `claim()` |
| **X402 Pay** | EIP-3009 relay | Gasless USDC transfers via `TransferWithAuthorization` — MetaMask signs off-chain, server relays on-chain |

---

## Deployed Contracts

### Arc Testnet (Chain ID 5042002)

| Contract | Address | Explorer |
|----------|---------|---------|
| `ConditionalEscrow` | [`0x34733fbbC101F2244Df03508170893013528004e`](https://testnet.arcscan.app/address/0x34733fbbC101F2244Df03508170893013528004e) | ArcScan |
| `PayrollVesting` | [`0x113F24249b0521d7288E52D12AE869d5903E6143`](https://testnet.arcscan.app/address/0x113F24249b0521d7288E52D12AE869d5903E6143) | ArcScan |
| `CrosschainEscrow` | [`0x1e0AaD16aaBFe906987D70A00783E9ab67954aFF`](https://testnet.arcscan.app/address/0x1e0AaD16aaBFe906987D70A00783E9ab67954aFF) | ArcScan |
| `BatchTransfer` ✓ | [`0x76d5dd51ad28D607cD8804dc5230cAE93403eD3d`](https://testnet.arcscan.app/address/0x76d5dd51ad28D607cD8804dc5230cAE93403eD3d) | ArcScan |

### Destination Chains (TimeLockHook v6)

| Chain | Address | Explorer |
|-------|---------|---------|
| Ethereum Sepolia | [`0x22f2ea9050a25da1c24caa76558a65aecc4adf4c`](https://eth-sepolia.blockscout.com/address/0x22f2ea9050a25da1c24caa76558a65aecc4adf4c) | Blockscout |
| Arbitrum Sepolia | [`0x0e250b6b417e5b31c7f4bcc8a00352d0672474ad`](https://arbitrum-sepolia.blockscout.com/address/0x0e250b6b417e5b31c7f4bcc8a00352d0672474ad) | Blockscout |
| Base Sepolia | *Not deployed — deployer wallet needs Base Sepolia ETH* | — |

> All contracts are source-verified. ✓ marks contracts with full ABI verification (events and function calls fully decoded on ArcScan).

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

> **Note:** USDC on Arc is also the native gas token. The ERC-20 address above is used for smart contract interactions; wallets display the native balance directly.

> **Arc quirk:** Transactions sent from an EOA to its own address with non-empty `data` are rejected at network level ("External transactions to internal accounts cannot include data"). Memos and other calldata must be embedded in contract function parameters rather than sent as a self-call.

---

## Features

### Dashboard
- Live system stats: total escrows, vesting schedules, USDC/EURC locked
- Recent activity feed with on-chain links
- API health indicator

### Escrow
- Create escrows with three condition types: **Time-based**, **Milestone**, **Oracle-triggered**
- Choose USDC or EURC; raise disputes; arbiter resolves with release or refund
- Full lifecycle: `pending → active → complete / disputed → resolved`

### Vesting / Payroll
- Employer creates cliff + linear vesting schedules
- Employee claims vested tokens on-demand
- Employer can revoke unvested portion at any time

### Batch Transfer
- Send USDC or EURC to multiple wallets in **one on-chain call**
- Only **2 MetaMask confirmations** per token (approve + `batchTransfer`) regardless of recipient count
- Groups mixed USDC/EURC rows by token; checks existing allowance and skips approval if already sufficient
- Optional **on-chain memo** — passed as a `string` to `batchTransfer()` and emitted in the `BatchExecuted` event; visible on ArcScan with no extra transaction
- Live **USDC and EURC balance display** with per-token "insufficient" warning when batch total exceeds available balance
- Step-by-step progress UI with ArcScan transaction links for every confirmation

### Cross-chain Transfers (CCTP v2)
- Initiate `depositForBurnWithHook()` from Arc Testnet to Ethereum / Base / Arbitrum Sepolia
- Attestation polling via Circle IRIS bridge
- Self-relay `receiveMessage()` via MetaMask on the destination chain

### X402 Pay (EIP-3009)
- Gasless USDC send: MetaMask signs a `TransferWithAuthorization` typed message off-chain
- Server relay submits the `transferWithAuthorization()` call and pays gas
- Session-local transaction history with ArcScan links

### TimeLockHook (destination chains)
- Deployed on Ethereum Sepolia and Arbitrum Sepolia
- Holds CCTP-bridged USDC until `unlockTimestamp`; recipient calls `claim(releaseId)`

---

## Security

A full security audit was conducted across all four contracts in June 2026. Five vulnerabilities were identified and patched:

| ID | Severity | Summary |
|----|----------|---------|
| SA-01 | 🔴 Critical | Beneficiary could drain escrow immediately via `release()` |
| SA-02 | 🔴 Critical | Vested-but-unclaimed tokens permanently locked on revoke |
| SA-03 | 🟠 High | Arbiter could be set to beneficiary (collusion) |
| SA-04 | 🟡 Medium | Zero-address recipient permanently locks USDC in TimeLockHook |
| SA-05 | 🟢 Low | `emit Released` fired before external transfer in TimeLockHook |

All findings are patched and contracts redeployed. See [docs/security-audit.md](docs/security-audit.md) for full details.

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
| Smart contracts | Solidity 0.8.20, Foundry |
| Monorepo | pnpm workspaces, Node.js 24, TypeScript 5.9 |

---

## Architecture

```
Browser (React + viem)
    │
    ├─── /api  ──→  Express API Server
    │                   │
    │                   ├─ /escrows, /vesting, /crosschain  → PostgreSQL (Drizzle ORM)
    │                   ├─ /cctp/attestation/:txHash        → Circle IRIS bridge
    │                   └─ /x402/send                       → USDC transferWithAuthorization
    │
    └─── MetaMask (EIP-1193)
             │
             ├─ Arc Testnet (Chain 5042002)
             │       ├─ ConditionalEscrow.sol
             │       ├─ PayrollVesting.sol
             │       ├─ CrosschainEscrow.sol  → TokenMessengerV2.depositForBurnWithHook()
             │       └─ BatchTransfer.sol     → approve + batchTransfer(recipients, amounts, memo)
             │
             └─ Destination Chain (Sepolia / Arbitrum Sepolia)
                     ├─ MessageTransmitterV2.receiveMessage()
                     └─ TimeLockHook.sol → recipient claim(releaseId)
```

---

## Local Development

```bash
git clone https://github.com/osr21/arc-stablecoin-dapp.git
cd arc-stablecoin-dapp
pnpm install

# Set DATABASE_URL, SESSION_SECRET, DEPLOYER_PRIVATE_KEY in .env
pnpm --filter @workspace/db run push

# Two terminals:
pnpm --filter @workspace/api-server run dev   # API → :8080
pnpm --filter @workspace/arc-dapp run dev     # Frontend → :22967
```

Add Arc Testnet to MetaMask: RPC `https://rpc.testnet.arc.network`, Chain ID `5042002`, symbol `USDC`. Get testnet funds at [faucet.circle.com](https://faucet.circle.com).

---

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for full release history.

---

## License

MIT
