# CCTP v2 Cross-Chain Transfer Flow

This document describes the end-to-end flow for a USDC cross-chain transfer from Arc Testnet to a destination chain using Circle's Cross-Chain Transfer Protocol v2.

## Participants

- **User** — wallet holder on Arc Testnet
- **CrosschainEscrow.sol** — deployed on Arc Testnet at `0x72923f5f69AeD25aaf92779ceF221342dbE7dfDB`
- **TokenMessengerV2** — Circle's burn contract on Arc at `0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA`
- **Circle IRIS** — attestation service (proxied via `arc-relay-bridge.replit.app` for Arc domain 26)
- **MessageTransmitterV2** — Circle's receive contract at `0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275` (same CREATE2 address on all CCTP v2 chains)

## Step 1 — Initiate Transfer (Arc Testnet)

```
User → MetaMask
  → USDC.approve(CrosschainEscrow, amount)
  → CrosschainEscrow.initiateConditionalTransfer(
        recipient,
        destDomain,        // 0=Eth Sepolia, 3=Arb Sepolia, 6=Base Sepolia
        amount,
        maxFee=0,
        minFinalityThreshold=2000,
        hookData=0x,
        conditionDescription
    )
    → TokenMessengerV2.depositForBurnWithHook(...)
      → USDC burned on Arc Testnet
      → MessageSent event emitted (contains CCTP message bytes)
```

**Arc CCTP domain ID is 26** (not 7 as in some older docs).  
**`minFinalityThreshold = 2000`** corresponds to Arc's "finalized" finality level.

## Step 2 — Attestation Polling

Circle's IRIS attestation API does not yet support Arc domain 26 directly. Attestations are fetched via a bridge:

```
GET https://arc-relay-bridge.replit.app/api/attest?domain=26&txHash=<burnTxHash>

Response:
{
  "messages": [{
    "attestation": "0x...",   // ECDSA signatures from Circle attesters
    "message": "0x...",       // raw CCTP message bytes
    "status": "complete",     // pending | complete
    "decodedMessage": { ... } // parsed fields
  }]
}
```

The UI polls this endpoint every ~10 seconds until `status = "complete"`.

## Step 3 — Receive on Destination Chain

Once attested, the user submits a MetaMask transaction on the **destination chain**:

```
User → MetaMask (switches to destination chain)
  → MessageTransmitterV2.receiveMessage(
        message,      // from step 2
        attestation   // from step 2
    )
    → USDC minted to recipient address on destination chain
```

**Gas note:** The `receiveMessage` call uses `2× estimateFeesPerGas` to ensure `maxFeePerGas` always clears the current base fee. The user needs a small amount of ETH on the destination chain (~0.001–0.003 ETH).

## Supported Destination Chains

| Chain | CCTP Domain | Chain ID |
|-------|-------------|----------|
| Ethereum Sepolia | 0 | 11155111 |
| Arbitrum Sepolia | 3 | 421614 |
| Base Sepolia | 6 | 84532 |

## Condition Types

The `conditionDescription` field is stored on-chain in the `ConditionalTransferInitiated` event. Current UI presets:

| Type | Description format | Enforcement |
|------|-------------------|-------------|
| Unconditional | `"Unconditional CCTP transfer"` | None — funds mint immediately |
| Time-locked | `"Funds released after 2026-06-20 14:00 UTC"` | Requires a time-lock hook contract on destination |
| Oracle-verified | `"Funds released upon oracle confirmation of: ETH/USD > $4000"` | Requires an oracle hook contract on destination |
| Multisig approval | `"Funds released upon 2-of-3 multisig approval"` | Requires a Gnosis Safe or equivalent on destination |

The condition string is informational at the protocol level. Actual enforcement requires a `hookData`-encoded receiver contract on the destination chain.
