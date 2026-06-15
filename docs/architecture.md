# Architecture

## System Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                        Browser (React 19)                        │
│                                                                  │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────────┐   │
│  │  Dashboard  │  │  Escrow UI   │  │  Vesting / Payroll   │   │
│  └─────────────┘  └──────────────┘  └──────────────────────┘   │
│  ┌──────────────────────┐  ┌───────────────────────────────┐    │
│  │  Cross-chain (CCTP)  │  │  Contracts / Architecture     │    │
│  └──────────────────────┘  └───────────────────────────────┘    │
│                                                                  │
│  React Query hooks (Orval-generated) ◄──── openapi.yaml         │
│  viem / MetaMask (EIP-1193)                                      │
└──────────┬───────────────────────────────┬──────────────────────┘
           │ HTTP /api/*                   │ JSON-RPC (EIP-1193)
           ▼                               ▼
┌──────────────────────┐       ┌────────────────────────────────┐
│   Express 5 API      │       │   MetaMask                     │
│   (Pino logging)     │       │                                │
│                      │       │  Arc Testnet (5042002)         │
│  /escrows            │       │  ├─ ConditionalEscrow.sol      │
│  /vesting            │       │  ├─ PayrollVesting.sol         │
│  /crosschain         │       │  └─ CrosschainEscrow.sol       │
│  /cctp/attestation   │       │       └─ TokenMessengerV2      │
│  /dashboard          │       │                                │
│         │            │       │  Destination Chains            │
│         ▼            │       │  └─ MessageTransmitterV2       │
│   PostgreSQL         │       │       (Eth / Base / Arb)       │
│   (Drizzle ORM)      │       └────────────────────────────────┘
│         │            │                    ▲
└─────────┼────────────┘                    │ attestation
          │                      ┌──────────┴──────────┐
          │                      │  arc-relay-bridge    │
          │                      │  (Circle IRIS proxy  │
          └──────────────────────│   for domain 26)     │
                                 └─────────────────────-┘
```

## Package Structure (pnpm Workspaces)

```
artifacts/              # Deployable services
  api-server/           # Express API — @workspace/api-server
  arc-dapp/             # React + Vite frontend — @workspace/arc-dapp

lib/                    # Shared libraries (composite TypeScript)
  api-spec/             # OpenAPI YAML + Orval codegen — @workspace/api-spec
  api-client-react/     # Generated React Query hooks — @workspace/api-client-react
  api-zod/              # Generated Zod schemas — @workspace/api-zod
  db/                   # Drizzle ORM schema + migrations — @workspace/db

contracts/              # Foundry project
  src/                  # Solidity source files
  script/               # Deployment scripts
  test/                 # Forge tests

scripts/                # Shared utility scripts — @workspace/scripts
```

## Data Flow: Contract-First API

```
lib/api-spec/openapi.yaml          ← single source of truth
        │
        ▼
pnpm codegen (Orval)
        │
        ├─→ lib/api-client-react/  ← React Query hooks (frontend)
        └─→ lib/api-zod/           ← Zod schemas (API server validation)
```

Both client and server types derive from the same YAML spec. Editing a route means:
1. Update `openapi.yaml`
2. Run `pnpm --filter @workspace/api-spec run codegen`
3. Update the route handler to satisfy the new Zod schema
4. Use the regenerated hook in the frontend

## Token Amount Convention

All USDC/EURC amounts are stored and transmitted as **raw 6-decimal base-unit strings**:

| Human | Raw string |
|-------|-----------|
| 1 USDC | `"1000000"` |
| 5.5 USDC | `"5500000"` |
| 100 EURC | `"100000000"` |

Conversion happens only at the display layer via `formatTokenAmount()` and `parseTokenAmount()` in `artifacts/arc-dapp/src/lib/format.ts`. This prevents floating-point rounding errors from reaching smart contracts.

## CCTP v2 Attestation Architecture

Circle's public IRIS API does not yet index Arc Testnet (domain 26). The attestation flow uses a bridge:

```
Frontend → GET /api/cctp/attestation/:txHash
                │
                ▼
         API server
                │
                ▼
  arc-relay-bridge.replit.app/api/attest?domain=26&txHash=…
                │
                ▼
         Circle IRIS (internal)
```

The API server acts as a transparent proxy, forwarding the bridge response directly to the frontend. Once Circle adds Arc domain 26 to their public IRIS API, the proxy URL in `artifacts/api-server/src/routes/cctp.ts` can be swapped to the official endpoint.

## Routing

A global reverse proxy routes by path prefix:

| Path | Service |
|------|---------|
| `/api` | Express API server (port 8080) |
| `/` | React + Vite frontend (port 22967) |

Paths are not rewritten — the API server handles its own `/api/*` prefix. All internal API calls use relative URLs (`/api/...`), which work identically in development and production.
