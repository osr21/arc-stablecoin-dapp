# Arc Stablecoin DApp

> Advanced Circle stablecoin primitives on Arc Testnet — conditional escrow with dispute resolution, cliff + linear payroll vesting, and cross-chain CCTP v2 transfers with a custom TimeLockHook.

[![Arc Testnet](https://img.shields.io/badge/Chain-Arc%20Testnet%205042002-blue)](https://testnet.arcscan.app)
[![CCTP v2](https://img.shields.io/badge/CCTP-v2%20depositForBurnWithHook-orange)](https://github.com/circlefin/evm-cctp-contracts)
[![USDC + EURC](https://img.shields.io/badge/Tokens-USDC%20%2B%20EURC-green)](https://www.circle.com)
[![Live Demo](https://img.shields.io/badge/Demo-Live%20on%20Replit-purple)](https://arc-smart-stablecoin-logic.replit.app)

## Overview

Three production-grade stablecoin primitives on Arc, built with the full Circle stack (USDC as gas, CCTP v2, EURC). Also introduces two novel Arc patterns: the first CCTP v2 hook deployed on Arc Testnet and a self-hosted auto-release keeper daemon.

| Primitive | What it does |
|-----------|-------------|
| **ConditionalEscrow** | Time-based, milestone, or oracle escrow in USDC or EURC. On-chain dispute resolution with named arbiter. Auto-release when time expires. |
| **PayrollVesting** | Cliff + linear vesting schedules. Employee claims vested tokens; employer can revoke unvested portion. USDC and EURC. |
| **CrosschainEscrow + TimeLockHook** | Calls CCTP v2 `depositForBurnWithHook()` on Arc. USDC is held by `TimeLockHook` on the destination chain until an unlock timestamp. |

## Key Arc Integrations

- **USDC as gas** — all transactions pay gas in USDC; no ETH required
- **EURC as first-class currency** — all three contracts support EURC alongside USDC
- **CCTP v2 `depositForBurnWithHook()`** — first hook implementation on Arc Testnet, live on Ethereum Sepolia and Arbitrum Sepolia
- **Circle IRIS attestation polling** — API server polls `/v1/attestations/:txHash` to surface crosschain transfer status
- **Sub-second finality** — Arc's BFT consensus means escrow releases confirm in under 1 second

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│  Frontend (React + Vite + shadcn/ui)                             │
│  MetaMask · Viem · 60s countdown timers · auto-release trigger   │
└────────────────────────┬─────────────────────────────────────────┘
                         │ REST API
┌────────────────────────▼─────────────────────────────────────────┐
│  Express API Server                                               │
│  ├── /api/escrows     — CRUD + status                            │
│  ├── /api/vesting     — schedule management                      │
│  ├── /api/crosschain  — initiate + track CCTP transfers          │
│  ├── /api/cctp        — Circle IRIS attestation polling          │
│  ├── /api/keeper      — auto-release daemon live status          │
│  └── Keeper daemon    — 60s loop · autoRelease() · USDC gas      │
└────────────────────────┬─────────────────────────────────────────┘
                         │ Drizzle ORM
┌────────────────────────▼─────────────────────────────────────────┐
│  PostgreSQL                                                       │
└──────────────────────────────────────────────────────────────────┘
                         │ viem writeContract / Foundry
┌────────────────────────▼─────────────────────────────────────────┐
│  Arc Testnet (Chain ID 5042002)                                   │
│  ├── ConditionalEscrow  0x935e53ddd824f4fc9321ba94e70161f20c23ad04│
│  ├── PayrollVesting     0x9b96be4a489656b01d2922b1bea9c932ed258215│
│  └── CrosschainEscrow  0xfc3d201a3fd1ba72855ab7814dce36c43ea9f0de│
└──────────────────────────────────────────────────────────────────┘
                         │ CCTP v2 depositForBurnWithHook
┌────────────────────────▼─────────────────────────────────────────┐
│  Destination Chains                                               │
│  ├── TimeLockHook (Eth Sepolia)  0x22f2ea9050a25da1c24caa76558a65aecc4adf4c │
│  └── TimeLockHook (Arb Sepolia)  0x0e250b6b417e5b31c7f4bcc8a00352d0672474ad │
└──────────────────────────────────────────────────────────────────┘
```

## Novel Patterns for Arc Builders

### 1. CCTP v2 TimeLockHook (first on Arc)

`TimeLockHook.sol` is a reusable destination hook for CCTP v2. The sender burns USDC on Arc with `mintRecipient = address(TimeLockHook)`. After Circle attests, anyone calls `relay()` which mints USDC into the hook and stores a `PendingRelease`. The recipient calls `claim()` after the unlock timestamp.

```
Arc: CrosschainEscrow.initiateConditionalTransfer()
  → TokenMessengerV2.depositForBurnWithHook(mintRecipient=TimeLockHook, ...)
  → Circle IRIS: poll /v1/attestations/:txHash until status=complete
  → TimeLockHook.relay(message, attestation, recipient, unlockTs)
  → TimeLockHook.claim(releaseId)   ← recipient only, after unlock
```

MessageTransmitterV2 is at the same CREATE2 address on all CCTP v2 chains: `0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275`

### 2. Self-Hosted Auto-Release Keeper

A server-side Node.js daemon calls `autoRelease()` every 60 seconds on expired escrows. No Chainlink, no Gelato. Arc's predictable USDC gas makes this economical.

- Reads `contractAddress` per-row from DB (handles contracts across deployments)
- Persists `onChainId` lazily from `EscrowCreated` event in tx receipts
- 10-minute backoff after 3 failures — prevents gas waste on broken escrows
- Live status at `GET /api/keeper/status`

## Deployed Contracts

| Contract | Chain | Address |
|----------|-------|---------|
| ConditionalEscrow | Arc Testnet | `0x935e53ddd824f4fc9321ba94e70161f20c23ad04` |
| PayrollVesting | Arc Testnet | `0x9b96be4a489656b01d2922b1bea9c932ed258215` |
| CrosschainEscrow | Arc Testnet | `0xfc3d201a3fd1ba72855ab7814dce36c43ea9f0de` |
| TimeLockHook v6 | Ethereum Sepolia | `0x22f2ea9050a25da1c24caa76558a65aecc4adf4c` |
| TimeLockHook v6 | Arbitrum Sepolia | `0x0e250b6b417e5b31c7f4bcc8a00352d0672474ad` |

## Arc Testnet Reference

| Item | Value |
|------|-------|
| Chain ID | 5042002 |
| RPC | `https://rpc.testnet.arc.network` |
| Explorer | `https://testnet.arcscan.app` |
| USDC | `0x3600000000000000000000000000000000000000` |
| EURC | `0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a` |
| CCTP Domain ID | 26 |
| TokenMessengerV2 | `0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA` |
| minFinalityThreshold | 2000 |
| Faucet | `https://faucet.circle.com` |

## Quick Start

```bash
pnpm install

# Set DATABASE_URL, DEPLOYER_PRIVATE_KEY, SESSION_SECRET in your environment

pnpm --filter @workspace/db run push        # create tables
pnpm --filter @workspace/api-server run dev  # API on :8080 → /api
pnpm --filter @workspace/arc-dapp run dev    # Frontend → /
```

Connect MetaMask to Arc Testnet (Chain ID 5042002, RPC `https://rpc.testnet.arc.network`). Get testnet USDC from `https://faucet.circle.com`.

## Redeploy

```bash
# Core contracts on Arc
cd contracts && forge script script/Deploy.s.sol:Deploy \
  --rpc-url https://rpc.testnet.arc.network \
  --private-key "$DEPLOYER_PRIVATE_KEY" \
  --broadcast --config-path foundry.toml

# TimeLockHook on a destination chain
cd contracts && forge script script/DeployTimeLockHook.s.sol:DeployTimeLockHook \
  --rpc-url <destination-rpc> \
  --private-key "$DEPLOYER_PRIVATE_KEY" \
  --broadcast --config-path foundry.toml
```

## Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19 + Vite + Tailwind CSS + shadcn/ui + Wouter |
| Wallet | MetaMask via viem |
| API | Express 5 + Pino |
| Database | PostgreSQL + Drizzle ORM |
| Validation | Zod from Orval OpenAPI codegen |
| Contracts | Solidity 0.8.20 + Foundry |
| Cross-chain | CCTP v2 · Arc domain 26 |

## Related Arc Projects

- [arc-escrow](https://github.com/circlefin/arc-escrow) — AI-validated freelance escrow
- [arc-commerce](https://github.com/circlefin/arc-commerce) — USDC checkout
- [arc-fintech](https://github.com/circlefin/arc-fintech) — Multichain treasury
- [evm-cctp-contracts](https://github.com/circlefin/evm-cctp-contracts) — CCTP v2 contracts

---

[Live demo](https://arc-smart-stablecoin-logic.replit.app) · [Arc docs](https://docs.arc.io) · [Circle faucet](https://faucet.circle.com)
