---
name: Arc Testnet CCTP v2 correct config
description: Real CCTP v2 addresses and domain ID for Arc Testnet — discovered from arc-relay-bridge.replit.app bundle
---

Arc Testnet CCTP v2 is live but at different addresses than the "deterministic CREATE2" defaults assumed in Circle docs.

**Correct values (source: arc-relay-bridge.replit.app JS bundle)**

| Item | Value |
|------|-------|
| CCTP Domain ID | **26** (not 7) |
| TokenMessengerV2 | `0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA` |
| MessageTransmitterV2 | `0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275` |
| minFinalityThreshold | **2000** (not 1000 or 500) |

**Why:** Arc does not use the standard CREATE2-deterministic CCTP addresses (`0x28b0b9...` / `0x81D40F...`). Those have zero code on Arc. The real addresses are different and can be verified via `eth_getCode`. Domain 26 was confirmed by both the bridge UI label and the chain config object in the bundle.

**How to apply:** Any contract or frontend calling CCTP on Arc must use domain 26 and threshold 2000. If `eth_getCode` on the "standard" CCTP addresses returns `0x` on a new chain, check a working bridge UI bundle for that chain's actual addresses rather than assuming deterministic CREATE2.

**Vite HMR note:** The `useWallet must be used within WalletProvider` error seen in the Replit preview is a Vite Fast Refresh limitation — it fires during hot reload when a React Context module (wallet.tsx) is in the same HMR boundary as changed files (contracts.ts). It self-resolves; a hard refresh clears it. Not a real bug.
