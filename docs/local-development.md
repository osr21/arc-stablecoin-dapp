# Local Development Guide

## Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Node.js | 24+ | Required for workspace scripts |
| pnpm | 9+ | Package manager; `npm i -g pnpm` |
| PostgreSQL | 14+ | Local or hosted |
| Foundry | latest | For contract development (`curl -L https://foundry.paradigm.xyz \| bash`) |
| MetaMask | latest | Browser extension |

## Environment Variables

Create a `.env` file in the project root:

```env
# Required
DATABASE_URL=postgresql://user:password@localhost:5432/arc_dapp

# Required for contract deployment
DEPLOYER_PRIVATE_KEY=0x...

# Required for API session signing
SESSION_SECRET=any-long-random-string
```

## Installation

```bash
pnpm install
```

## Database Setup

```bash
# Push Drizzle schema to your PostgreSQL instance
pnpm --filter @workspace/db run push
```

## Running Services

Open two terminals:

```bash
# Terminal 1 — API server (port 8080, proxied to /api)
pnpm --filter @workspace/api-server run dev

# Terminal 2 — Frontend (port 22967, proxied to /)
pnpm --filter @workspace/arc-dapp run dev
```

Both services are proxied through a shared reverse proxy. Access the app at `http://localhost:80`.

## Adding Arc Testnet to MetaMask

1. Open MetaMask → Settings → Networks → Add a network
2. Fill in:

| Field | Value |
|-------|-------|
| Network Name | Arc Testnet |
| New RPC URL | `https://rpc.testnet.arc.network` |
| Chain ID | `5042002` |
| Currency Symbol | `USDC` |
| Block Explorer URL | `https://testnet.arcscan.app` |

3. Get testnet USDC at [faucet.circle.com](https://faucet.circle.com)
4. Get testnet ETH for destination chains (Sepolia, Base Sepolia, Arbitrum Sepolia) from their respective faucets

## Codegen Workflow

After any change to `lib/api-spec/openapi.yaml`:

```bash
pnpm --filter @workspace/api-spec run codegen
```

This regenerates:
- `lib/api-client-react/` — React Query hooks
- `lib/api-zod/` — Zod schemas used by the API server

Never edit generated files directly.

## TypeScript

```bash
# Full typecheck (builds libs first, then checks leaf packages)
pnpm run typecheck

# Frontend only
pnpm --filter @workspace/arc-dapp run typecheck

# API server only
pnpm --filter @workspace/api-server run typecheck
```

## Smart Contracts

```bash
cd contracts

# Build
forge build

# Test
forge test

# Deploy to Arc Testnet
forge script script/Deploy.s.sol:Deploy \
  --rpc-url https://rpc.testnet.arc.network \
  --private-key "$DEPLOYER_PRIVATE_KEY" \
  --broadcast \
  --config-path foundry.toml
```

## Common Pitfalls

- **Do not run `pnpm run dev` at the workspace root** — there is no root dev script; use per-package filters.
- **Do not use `console.log` in server code** — use `req.log` in route handlers or the `logger` singleton.
- **Do not hardcode port numbers** — services read the `PORT` env var set by the workflow runner.
- **USDC on Arc is also the native gas token** — wallets show it as the gas balance; the ERC-20 address is only needed for `approve` / `transfer` calls.
- **After editing the OpenAPI spec**, always run codegen before editing routes or pages — stale types will cause hard-to-debug mismatches.
