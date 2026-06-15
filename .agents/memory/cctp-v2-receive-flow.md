---
name: CCTP v2 receive flow and IRIS attestation
description: How to get attestation and receive CCTP v2 burns on destination chain; Arc IRIS status
---

## IRIS attestation endpoint (CCTP v2)

**Correct endpoint:** `GET https://iris-api-sandbox.circle.com/attestations/{keccak256(messageBytes)}`

- NOT `/v1/messages/{txHash}` (returns 404 — not a valid v2 endpoint)
- NOT keccak256 of txHash — must be keccak256 of the **raw message bytes** from `MessageSent` event
- Response when pending: `{"status":"pending_confirmations"}` or `{"error":"Message hash not found"}`
- Response when ready: `{"status":"complete","attestation":"0x..."}`

**Why:** CCTP v2 IRIS uses the message content hash, not the transaction hash, as its lookup key.

## Arc Testnet IRIS status (as of June 2026)

Circle has deployed CCTP v2 contracts on Arc testnet domain 26, but **IRIS sandbox does not yet monitor Arc domain 26 messages**. The `/attestations/{messageHash}` endpoint returns `{"error":"Message hash not found"}` for Arc-originating burns. The burn IS on-chain and the message IS emitted — IRIS just doesn't watch Arc yet.

**How to apply:** Treat all Arc→* attestation responses as `pending_confirmations` until Circle adds Arc support. Show users the message bytes so they have what they need for when attestation becomes available.

## Message bytes extraction

From Arc RPC `eth_getTransactionReceipt`:
1. Find log with topic `0x8c5261668696ce22758910d05bab8f186d6eb247ceac2af2e82c7dc17669b036` (MessageSent)
2. ABI decode log.data: skip first 64 hex chars (offset slot) + 64 hex chars (length slot), read `length * 2` hex chars
3. keccak256(messageBytes) = IRIS lookup key

## Receive on destination

**MessageTransmitterV2**: `0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275` — same CREATE2 address on Arc (domain 26), Ethereum Sepolia (domain 0), Base Sepolia (domain 6), Arbitrum Sepolia (domain 3). Confirmed `localDomain=0` on Sepolia.

**Function:** `receiveMessage(bytes message, bytes attestation) returns (bool)`

## Known address typo to avoid

`0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275` lowercase = `0xe737e5cebeeba77efe34d4aa090756590b1ce275`
NOT `0xe737e5cee...` (extra `e` after `ce`)

## Successful Arc→Sepolia burn reference

- Tx: `0x62f592cd0145aed9870bec58239a86d3098dfe2bbcf4245fbf069aa34159b6fe`
- Amount: 8 USDC, destDomain=0 (Eth Sepolia)
- messageHash: `0xcfdcf3d2bf1586bf826f788e3598bac7bd896c73fc09949220af09be562b510d`
- messageBytes: 376 bytes, minFinalityThreshold=2000
