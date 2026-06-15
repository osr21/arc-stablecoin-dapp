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
- **CCTP v2 integration**: CrosschainEscrow.sol calls `depositForBurnWithHook()` on the real Circle `TokenMessengerV2` (0x8FE6...DAA). Arc Testnet CCTP domain ID is **26** (not 7); `minFinalityThreshold` is 2000. The API's `/api/cctp/attestation/:txHash` polls Circle's IRIS sandbox API to surface attestation status.
- **Simulation-first UX**: Forms generate random contract addresses and tx hashes so the full UI flow works without a live wallet; real wallet interaction replaces these when MetaMask is connected.
- **Arc Testnet specifics**: USDC on Arc is the native gas token wrapped as ERC-20 at `0x3600...0000`; EURC is at `0x89B5...D72a`; CCTP Domain ID is **26**; `minFinalityThreshold` for Arc is **2000**.

## Product

- **Dashboard**: Live system overview — total escrows/vesting, USDC/EURC locked, recent activity feed, API health
- **Escrow**: Create time-based / milestone / oracle conditional escrows in USDC or EURC; raise disputes; release or resolve with arbiter
- **Vesting / Payroll**: Cliff + linear vesting schedules; claim vested tokens; employer can revoke unvested portion
- **Cross-chain**: Initiate CCTP v2 `depositForBurnWithHook` transfers from Arc to Eth Sepolia / Base Sepolia / Arb Sepolia; poll Circle IRIS for attestation
- **Contracts**: Reference card with deployed addresses, ABIs, and Arc Testnet chain info
- **Architecture**: SVG system diagram + canvas board showing full stack topology

## Deployed Contract Addresses (Arc Testnet, Block 47067610)

| Contract | Chain | Address |
|----------|-------|---------|
| ConditionalEscrow | Arc Testnet | `0x5c4927C8b3b627415E78a151B68B07A079Bd21c1` |
| PayrollVesting | Arc Testnet | `0xDB7672E26f203a0f37b93042Df150D2E95831387` |
| CrosschainEscrow | Arc Testnet | `0x72923f5f69AeD25aaf92779ceF221342dbE7dfDB` |
| TimeLockHook | Ethereum Sepolia | `0x003f131f247EA8f8894B2edc8E41136be6F1EC94` |
| TimeLockHook | Arbitrum Sepolia | `0xA5483717601038FC841b63a6e419897Fc58E7f84` |
| TimeLockHook | Base Sepolia | not deployed — deployer wallet needs Base Sepolia ETH |

To redeploy Arc contracts: `cd contracts && forge script script/Deploy.s.sol:Deploy --rpc-url https://rpc.testnet.arc.network --private-key "$DEPLOYER_PRIVATE_KEY" --broadcast --config-path foundry.toml`

To redeploy TimeLockHook (Ethereum Sepolia): `cd contracts && forge script script/DeployTimeLockHook.s.sol:DeployTimeLockHook --rpc-url https://ethereum-sepolia-rpc.publicnode.com --private-key "$DEPLOYER_PRIVATE_KEY" --broadcast --config-path foundry.toml`

## Arc Testnet Reference

| Item | Value |
|------|-------|
| Chain ID | 5042002 |
| RPC | https://rpc.testnet.arc.network |
| Explorer | https://testnet.arcscan.app |
| USDC | 0x3600000000000000000000000000000000000000 |
| EURC | 0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a |
| CCTP Domain ID | 26 |
| TokenMessengerV2 | 0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA |
| MessageTransmitterV2 | 0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275 |
| minFinalityThreshold | 2000 (Arc finalized) |
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
