# Arc Stablecoin DApp

A full-stack DApp on Arc Testnet (Chain ID: 5042002) demonstrating advanced Circle stablecoin logic with USDC and EURC. Features three on-chain primitives: Conditional Escrow with dispute resolution, Programmable Payroll/Vesting, and Cross-chain Conditional Transfers via Circle CCTP v2.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080 → `/api`)
- `pnpm --filter @workspace/arc-dapp run dev` — run the frontend (port 22967 → `/`)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React 19 + Vite + Tailwind CSS + shadcn/ui + Wouter routing
- API: Express 5 + Pino logging
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec → React Query hooks)
- Build: esbuild (CJS bundle)

## Where things live

- `lib/api-spec/openapi.yaml` — source of truth for all API contracts
- `lib/api-client-react/` — generated React Query hooks (from codegen)
- `lib/api-zod/` — generated Zod schemas (from codegen)
- `lib/db/src/schema/` — Drizzle ORM table definitions
- `artifacts/api-server/src/routes/` — Express route handlers (escrow, vesting, crosschain, cctp, dashboard)
- `artifacts/arc-dapp/src/pages/` — React page components
- `artifacts/arc-dapp/src/lib/format.ts` — token amount formatter (raw 6-decimal ↔ human-readable)
- `contracts/src/` — Solidity smart contracts (ConditionalEscrow, PayrollVesting, CrosschainEscrow)

## Architecture decisions

- **Contract-first API**: OpenAPI spec → Orval codegen drives both client hooks and server Zod validators. No manual type duplication.
- **Token amounts stored as raw base units**: All USDC/EURC amounts in DB and API are stored as strings in raw 6-decimal base units (e.g. `"5000000"` = 5 USDC). Frontend uses `formatTokenAmount()` / `parseTokenAmount()` from `lib/format.ts`.
- **CCTP v2 integration**: CrosschainEscrow.sol calls `depositForBurnWithHook()` on `TokenMessengerV2` (0x28b0...1406). The API's `/api/cctp/attestation/:txHash` polls Circle's IRIS sandbox API to surface attestation status.
- **Simulation-first UX**: Forms generate random contract addresses and tx hashes so the full UI flow works without a live wallet; real wallet interaction replaces these when MetaMask is connected.
- **Arc Testnet specifics**: USDC on Arc is the native gas token wrapped as ERC-20 at `0x3600...0000`; EURC is at `0x89B5...D72a`; CCTP Domain ID is 7.

## Product

- **Dashboard**: Live system overview — total escrows/vesting, USDC/EURC locked, recent activity feed, API health
- **Escrow**: Create time-based / milestone / oracle conditional escrows in USDC or EURC; raise disputes; release or resolve with arbiter
- **Vesting / Payroll**: Cliff + linear vesting schedules; claim vested tokens; employer can revoke unvested portion
- **Cross-chain**: Initiate CCTP v2 `depositForBurnWithHook` transfers from Arc to Eth Sepolia / Base Sepolia / Arb Sepolia; poll Circle IRIS for attestation
- **Contracts**: Reference card with deployed addresses, ABIs, and Arc Testnet chain info
- **Architecture**: SVG system diagram + canvas board showing full stack topology

## Deployed Contract Addresses (Arc Testnet, Block 47047205)

| Contract | Address |
|----------|---------|
| ConditionalEscrow | `0x8FB927c5C50B246cFD66Bc77BE6E3D28D9c63f83` |
| PayrollVesting | `0xdE7523701477282bE9e9DdDCB98d43A72EC5a31C` |
| CrosschainEscrow | `0x6f4cfDa3D91950DF38556a4a6D471Be817936370` |

To redeploy: `cd contracts && forge script script/Deploy.s.sol:Deploy --rpc-url https://rpc.testnet.arc.network --private-key "$DEPLOYER_PRIVATE_KEY" --broadcast --config-path foundry.toml`

## Arc Testnet Reference

| Item | Value |
|------|-------|
| Chain ID | 5042002 |
| RPC | https://rpc.testnet.arc.network |
| Explorer | https://testnet.arcscan.app |
| USDC | 0x3600000000000000000000000000000000000000 |
| EURC | 0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a |
| CCTP Domain ID | 7 |
| TokenMessengerV2 | 0x28b0b9a9F49AD9A09C9B80A4DC3C0E56f2B71406 |
| MessageTransmitterV2 | 0x81D40F21F12A8F0E3252Bccb954D722d4c464B64 |
| Faucet | https://faucet.circle.com |

## User preferences

- Keep amounts in raw base units (6 decimals) in DB/API; format only at the display layer.
- Use pnpm workspace filtering for all per-package commands.
- Never use `console.log` in server code — use `req.log` or the singleton `logger`.

## Gotchas

- Do not run `pnpm run dev` at workspace root — use workflow restart or per-package filter.
- After changing `lib/api-spec/openapi.yaml`, always run `pnpm --filter @workspace/api-spec run codegen` before editing routes or pages.
- `pnpm --filter @workspace/db run push` is for dev only; production migrations need explicit SQL.
- USDC on Arc is also the native gas token — the ERC-20 address above is for smart contract interactions.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
