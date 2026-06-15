---
name: CCTP v2 receive flow and arc-relay-bridge integration
description: How to get attestations and relay CCTP v2 burns from Arc; bridge API details
---

## arc-relay-bridge API (publicly accessible, no auth required)

**Base:** `https://arc-relay-bridge.replit.app`

### Attestation — use this, NOT Circle IRIS directly
`GET /api/attest?domain=26&txHash={arcBurnTxHash}`

Returns:
```json
{
  "messages": [{
    "attestation": "0x...",
    "message": "0x...",
    "status": "complete",
    "decodedMessage": {
      "destinationDomain": "0",
      "decodedMessageBody": { "mintRecipient": "0x...", "amount": "8000000" }
    }
  }]
}
```
- Works for Arc domain 26; Circle's raw IRIS sandbox returns "Message hash not found" for Arc
- `status: "complete"` + non-null `attestation` = ready to receive

### Gas-free relay
`POST /api/relay`
Body: `{ message, attestation, recipient, destChainId, maxFee }`
- `maxFee` must be >= `"1000000"` (1 USDC relay fee — bridge pays gas on destination)
- Returns `{ txHash }` on success; user needs NO ETH on destination

## Our API routes (proxy layer)
- `GET /api/cctp/attestation/:txHash` → bridge `/api/attest?domain=26&txHash=...`
- `POST /api/cctp/relay` → body `{ burnTxHash }`, fetches attestation then calls bridge relay with `maxFee: "1000000"`

## Circle IRIS direct (do NOT use for Arc)
`iris-api-sandbox.circle.com/attestations/{keccak256(messageBytes)}` returns "Message hash not found" for Arc domain 26. The bridge is the correct proxy.

## Self-relay (no fee, needs ETH on dest)
Contract: `0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275` (same CREATE2 on all CCTP v2 chains)
Function: `receiveMessage(bytes message, bytes attestation) returns (bool)`

## Known address typo to avoid
`0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275` lowercase = `0xe737e5cebeeba77efe34d4aa090756590b1ce275`
NOT `0xe737e5cee...` (extra `e` after `ce`)

## Confirmed working burn tx
- `0x62f592cd0145aed9870bec58239a86d3098dfe2bbcf4245fbf069aa34159b6fe`
- 8 USDC → Ethereum Sepolia (domain 0), mintRecipient `0x6B1E65761707f976dcE0d6f58520Fbf4eC0daa0C`
- Attestation complete and retrievable via bridge `/api/attest`
