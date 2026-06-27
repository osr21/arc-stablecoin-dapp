---
name: CrosschainAtomicHTLC and SimpleHTLC deployed addresses
description: Addresses, protocol, and design decisions for the CCTP atomic swap HTLCs
---

CrosschainAtomicHTLC (Arc Testnet, chain 5042002): 0xa22e098843ef65cb8263646303bb27da6efb8b7f
SimpleHTLC (Ethereum Sepolia, chain 11155111):     0x10ad359b96b61ee5a01fad2ba459b9d2b24b2da1

Protocol (Arc→Sepolia):
1. Both parties agree on preimage P, hashlock H = keccak256(abi.encode(P)), T_arc > T_sep
2. Bob funds SimpleHTLC on Sepolia for Alice with H and T_sep
3. Alice creates CrosschainAtomicHTLC on Arc with H, T_arc, mintRecipient=bob_bytes32
4. Alice claims Sepolia HTLC with P → reveals P on Sepolia
5. Bob (or anyone) calls CrosschainAtomicHTLC.claim(id, P) on Arc → depositForBurn burns USDC
6. Circle attests → anyone relays MessageTransmitterV2.receiveMessage() on Sepolia

Claim is permissionless in CrosschainAtomicHTLC (mintRecipient locked at creation).
Only recipient may claim in SimpleHTLC.

DB status flow (crosschain_cctp): active → claimed → relayed (single_chain: active → claimed)
API relay endpoint: POST /htlc/{id}/relay with {txHash}

USDC only in CrosschainAtomicHTLC (CCTP bridges USDC not EURC).

**Why:** Needed trustless atomic swap; prior CrosschainHTLC was single-chain only.
**How to apply:** Always use CrosschainAtomicHTLC (not CrosschainHTLC) for new CCTP atomic swap HTLCs.
