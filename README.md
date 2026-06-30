# Arc Stablecoin DApp

A full-stack decentralized application on **Arc Testnet** (Chain ID: 5042002) demonstrating advanced Circle stablecoin logic — USDC and EURC — across a comprehensive suite of on-chain primitives.

Live demo: [arc-smart-stablecoin-logic.replit.app](https://arc-smart-stablecoin-logic.replit.app)

---

## Overview

The Arc Stablecoin DApp showcases production-grade stablecoin patterns that teams building on Circle's stack can use as a reference:

| Primitive | Contract | What it does |
|-----------|----------|--------------|
| **Conditional Escrow** | `ConditionalEscrow.sol` | Time-based, milestone, and oracle-triggered escrows in USDC or EURC with dispute resolution |
| **Programmable Payroll / Vesting** | `PayrollVesting.sol` | Cliff + linear vesting schedules; employees claim vested USDC; employer can revoke unvested portion |
| **Cross-chain CCTP v2** | `CrosschainEscrow.sol` | `depositForBurnWithHook()` transfers from Arc to Ethereum / Base / Arbitrum Sepolia; attestation polling via Circle IRIS |
| **Time-locked Delivery** | `TimeLockHook.sol` | Destination-chain CCTP hook; holds USDC until `unlockTimestamp`, then lets the recipient `claim()` |
| **Gasless Transfer** | EIP-3009 relay | MetaMask signs a `TransferWithAuthorization` off-chain; server relays in one tx with zero gas for the sender |
| **FX Forward** | `FXForward.sol` | Lock in a USDC↔EURC exchange rate for future settlement; hedge stablecoin FX exposure on-chain |
| **HTLC Swap** | `CrosschainHTLC.sol` / `CrosschainAtomicHTLC.sol` | Hash Time-Locked Contracts for atomic cross-chain swaps; SHA-256 preimage reveals unlock funds |
| **Batch Transfer** | `BatchTransfer.sol` | Send USDC or EURC to up to 200 recipients in a single transaction |
| **Agent Registry** | `AgentRegistry.sol` | On-chain registry for autonomous AI agents; register capabilities, stake USDC, update metadata |
| **Split Payment** | `SplitPayment.sol` | Programmatic revenue splitting; define percentage shares and trigger a single split transaction |
| **ERC-8183 Agentic Commerce** | `AgenticCommerce.sol` | On-chain job board for AI agents — post work, bid, accept, submit deliverables, release payment from escrow |
| **USYC Yield Vault** | Hashnote Teller (ERC-4626) | Deposit USDC into a tokenized T-bill vault; receive USYC shares representing a yield-bearing T-bill position |
| **X402 Pay** | HTTP 402 middleware | Machine-payable API endpoints — agents pay per call in USDC using the x402 protocol |

---

## Deployed Contracts

### Arc Testnet (Chain ID 5042002)

| Contract | Address | Explorer |
|----------|---------|---------|
| `ConditionalEscrow` | [`0x34733fbbC101F2244Df03508170893013528004e`](https://testnet.arcscan.app/address/0x34733fbbC101F2244Df03508170893013528004e) | ArcScan |
| `PayrollVesting` | [`0x113F24249b0521d7288E52D12AE869d5903E6143`](https://testnet.arcscan.app/address/0x113F24249b0521d7288E52D12AE869d5903E6143) | ArcScan |
| `CrosschainEscrow` | [`0x1e0AaD16aaBFe906987D70A00783E9ab67954aFF`](https://testnet.arcscan.app/address/0x1e0AaD16aaBFe906987D70A00783E9ab67954aFF) | ArcScan |
| `BatchTransfer` | [`0x76d5dd51ad28D607cD8804dc5230cAE93403eD3d`](https://testnet.arcscan.app/address/0x76d5dd51ad28D607cD8804dc5230cAE93403eD3d) | ArcScan |
| `FXForward` | [`0x8029d9bDCdB9434468d1351CAB97f4FbBf028f80`](https://testnet.arcscan.app/address/0x8029d9bDCdB9434468d1351CAB97f4FbBf028f80) | ArcScan |
| `CrosschainHTLC` | [`0x7F4Dbe26d09D260B6EEaee8f753F6D3E366cB828`](https://testnet.arcscan.app/address/0x7F4Dbe26d09D260B6EEaee8f753F6D3E366cB828) | ArcScan |
| `CrosschainAtomicHTLC` | [`0xa22e098843ef65cb8263646303bb27da6efb8b7f`](https://testnet.arcscan.app/address/0xa22e098843ef65cb8263646303bb27da6efb8b7f) | ArcScan |
| `AgentRegistry` | [`0xF891f7cCF2A795801b9F1cE8Bd5753B5a6043e72`](https://testnet.arcscan.app/address/0xF891f7cCF2A795801b9F1cE8Bd5753B5a6043e72) | ArcScan |
| `SplitPayment` | [`0xDcF9f0c13B3ffC8D108909794E8659FDA8864FCe`](https://testnet.arcscan.app/address/0xDcF9f0c13B3ffC8D108909794E8659FDA8864FCe) | ArcScan |
| `AgenticCommerce` | [`0x0Ecdad8fdA2Dde60E475e70Ebf177F2299FECB48`](https://testnet.arcscan.app/address/0x0Ecdad8fdA2Dde60E475e70Ebf177F2299FECB48) | ArcScan |

### Destination Chains

| Contract | Chain | Address | Explorer |
|----------|-------|---------|---------|
| `TimeLockHook` v6 | Ethereum Sepolia | [`0x22f2ea9050a25da1c24caa76558a65aecc4adf4c`](https://eth-sepolia.blockscout.com/address/0x22f2ea9050a25da1c24caa76558a65aecc4adf4c) | Blockscout |
| `TimeLockHook` v6 | Arbitrum Sepolia | [`0x0e250b6b417e5b31c7f4bcc8a00352d0672474ad`](https://arbitrum-sepolia.blockscout.com/address/0x0e250b6b417e5b31c7f4bcc8a00352d0672474ad) | Blockscout |
| `SimpleHTLC` | Ethereum Sepolia | [`0x10ad359b96b61ee5a01fad2ba459b9d2b24b2da1`](https://eth-sepolia.blockscout.com/address/0x10ad359b96b61ee5a01fad2ba459b9d2b24b2da1) | Blockscout |
| `TimeLockHook` v6 | Base Sepolia | *Not deployed — deployer wallet needs Base Sepolia ETH* | — |

> All contracts are source-verified. Security audit completed June 2026 — see [docs/security-audit.md](docs/security-audit.md).

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

> **Note:** USDC on Arc is also the native gas token. Arc's USDC precompile implements **EIP-3009** (`transferWithAuthorization`) natively — EIP-2612 permit is not supported. EIP-712 domain: `name="USDC"`, `version="2"`; EURC: `name="EURC"`, `version="2"`.

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

### Cross-chain Transfers (CCTP v2)
- Initiate `depositForBurnWithHook()` from Arc Testnet to Ethereum / Base / Arbitrum Sepolia
- Attestation polling via Circle IRIS bridge
- Self-relay `receiveMessage()` via MetaMask on the destination chain

### Batch Transfer
- Send USDC or EURC to up to 200 recipients in one transaction
- Add rows manually or upload a CSV of addresses and amounts
- Ideal for payroll disbursements, reward airdrops, and multi-party settlements

### X402 Pay
- HTTP 402 machine-payable API endpoints
- Agents pay per API call in USDC using the x402 protocol
- Demonstrates autonomous agent-to-server commerce

### FX Forward
- Lock in a USDC↔EURC exchange rate for future settlement
- Hedge stablecoin FX exposure entirely on-chain
- Counterparty deposits both sides; settlement executes at the agreed rate on the agreed date

### HTLC Swap
- Hash Time-Locked Contracts for trustless cross-chain atomic swaps
- Initiator locks USDC with a SHA-256 hash commitment; counterparty reveals preimage to claim
- Refund path available after timelock expires
- `CrosschainAtomicHTLC` variant links two HTLCs for full atomic cross-chain settlement

### Agent Registry
- On-chain registry for autonomous AI agents
- Register agent capabilities and metadata; stake USDC as collateral
- Lookup agents by capability for agentic commerce discovery

### Split Payment
- Define percentage shares for multiple recipients (must sum to 100%)
- Trigger a single on-chain transaction that splits USDC or EURC proportionally
- Useful for revenue sharing, royalty splits, and DAO treasury distributions

### ERC-8183 Agentic Commerce

On-chain job board implementing the [ERC-8183](https://eips.ethereum.org/EIPS/eip-8183) draft standard for autonomous agent commerce.

**Job lifecycle:**

```
createJob()  →  bid()  →  acceptBid()  →  submitDeliverable()  →  approveDeliverable()
   (client)    (agent)      (client)         (provider)               (client → pays)
```

- **Client** posts a job with title, description, token (USDC/EURC), budget (locked in escrow on creation), and deadline
- **Agents/providers** call `bid()` to register interest — multiple agents can bid on the same job
- **Client** calls `acceptBid(provider)` to lock in one provider and move to In Progress
- **Provider** submits a `keccak256` deliverable hash on-chain as tamper-proof proof of work
- **Client** calls `approveDeliverable()` which releases the full budget from escrow to the provider in a single `transfer()`
- **Cancel** available any time before `acceptBid` — refunds the full budget to the client

The UI enforces all contract-level role constraints:
- Clients cannot bid on their own jobs (`Unauthorized` guard)
- Only the accepted provider can submit a deliverable
- Bidding is disabled on jobs whose deadline has passed

### Gasless Transfer (EIP-3009)
- MetaMask signs a `TransferWithAuthorization` typed message entirely off-chain — zero gas, zero on-chain tx for the sender
- Server relay submits the single `transferWithAuthorization()` call and pays gas on the sender's behalf
- Random `bytes32` nonce makes each authorization replay-proof
- Session-local transaction history with ArcScan links

> **EIP-3009 vs EIP-2612:** Arc USDC natively implements EIP-3009 (`transferWithAuthorization`) — not EIP-2612 (`permit`). EIP-3009 uses a random `bytes32` nonce (replay-proof) and settles in a single transaction rather than two.

### USYC Yield Vault
- Deposit USDC into [Hashnote's](https://hashnote.com) ERC-4626-compliant tokenized T-bill vault
- Receive **USYC** shares representing a yield-bearing U.S. Treasury bill position
- Redeem USYC shares back to USDC at any time
- Live vault stats: total assets, total shares, share price, USDC→USYC exchange rate
- Requires on-chain allowlisting (institutional access, $100k minimum in production; testnet access via Circle Support ticket including your Arc Testnet wallet address)

---

## Security

A full security audit was conducted across all contracts in June 2026. Five vulnerabilities were identified and patched:

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
| Wallet | viem, MetaMask (EIP-1193, EIP-712, EIP-3009) |
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
    │                   ├─ /cctp/attestation/:txHash        → Circle IRIS bridge (attestation)
    │                   ├─ /gasless/relay                   → EIP-3009 transferWithAuthorization relay
    │                   ├─ /agentic, /agents, /splits       → PostgreSQL (job board, registry, splits)
    │                   └─ /x402                            → HTTP 402 machine-payable endpoints
    │
    └─── MetaMask (EIP-1193)
             │
             ├─ Arc Testnet (Chain 5042002)
             │       ├─ ConditionalEscrow.sol
             │       ├─ PayrollVesting.sol
             │       ├─ CrosschainEscrow.sol     → TokenMessengerV2.depositForBurnWithHook()
             │       ├─ BatchTransfer.sol
             │       ├─ FXForward.sol
             │       ├─ CrosschainHTLC.sol / CrosschainAtomicHTLC.sol
             │       ├─ AgentRegistry.sol
             │       ├─ SplitPayment.sol
             │       └─ AgenticCommerce.sol      ← ERC-8183 agentic job board
             │
             ├─ Destination Chains (Sepolia / Arbitrum Sepolia)
             │       ├─ MessageTransmitterV2.receiveMessage()
             │       ├─ TimeLockHook.sol         → recipient claim(releaseId)
             │       └─ SimpleHTLC.sol           → cross-chain atomic HTLC counterpart
             │
             └─ USYC Yield Vault (Hashnote Teller, Arc Testnet)
                     └─ ERC-4626 deposit/redeem USDC ↔ USYC shares
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

### Redeploy contracts

```bash
# Arc Testnet contracts
cd contracts && forge script script/Deploy.s.sol:Deploy \
  --rpc-url https://rpc.testnet.arc.network \
  --private-key "$DEPLOYER_PRIVATE_KEY" --broadcast --config-path foundry.toml

# TimeLockHook (Ethereum Sepolia)
cd contracts && forge script script/DeployTimeLockHook.s.sol:DeployTimeLockHook \
  --rpc-url https://ethereum-sepolia-rpc.publicnode.com \
  --private-key "$DEPLOYER_PRIVATE_KEY" --broadcast --config-path foundry.toml
```

---

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for full release history.

---

## License

MIT
