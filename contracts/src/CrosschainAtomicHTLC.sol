// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./IERC20.sol";

/**
 * @title CrosschainAtomicHTLC
 * @notice Arc Testnet — CCTP-powered Hash Time Locked Contract for trustless
 *         atomic cross-chain USDC swaps (Arc ↔ Ethereum Sepolia / Base Sepolia / Arb Sepolia).
 *
 * @dev Replaces the simple intra-chain CrosschainHTLC with real CCTP integration:
 *
 *   PROTOCOL (Arc → Sepolia example):
 *   ─────────────────────────────────
 *   Both parties agree off-chain on: secret preimage P, hashlock H = keccak256(abi.encode(P)),
 *   amounts, timelocks (T_arc > T_sep for safety margin), and destination.
 *
 *   1. Bob  → deploys/funds SimpleHTLC on Ethereum Sepolia:
 *             SimpleHTLC.createHTLC(alice, usdcSepolia, amount, H, T_sep)
 *
 *   2. Alice → calls createHTLC() here on Arc — locks USDC with CCTP params:
 *             CrosschainAtomicHTLC.createHTLC(destDomain=0, mintRecipient=bob, amount, H, T_arc, ...)
 *             USDC is held by this contract; nothing burns yet.
 *
 *   3. Alice → calls SimpleHTLC.claim(id, P) on Sepolia (reveals P, gets Bob's USDC on Sepolia).
 *
 *   4. Bob (or anyone) → calls claim(id, P) here on Arc once P is public.
 *             Contract verifies keccak256(abi.encode(P)) == H, then:
 *             → burns USDC via CCTP depositForBurn() → Circle mints USDC for Bob on Sepolia.
 *
 *   5. Anyone relays the Circle attestation on Sepolia: MessageTransmitterV2.receiveMessage().
 *
 *   SAFETY:
 *   - T_arc > T_sep: if Alice never reveals, Bob refunds on Sepolia first; Alice refunds on Arc after.
 *   - Claim is permissionless after preimage is public — anyone can trigger the CCTP burn.
 *   - mintRecipient is locked at HTLC creation time; no one can redirect funds.
 *
 *   NOTE: Only USDC is supported (CCTP only bridges USDC, not EURC).
 *
 * Arc Testnet:
 *   USDC:               0x3600000000000000000000000000000000000000
 *   TokenMessengerV2:   0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA
 *   CCTP Domain:        26
 *
 * Destination CCTP domain IDs:
 *   Ethereum Sepolia:   0
 *   Avalanche Fuji:     1
 *   Arbitrum Sepolia:   3
 *   Base Sepolia:       6
 */

interface ITokenMessengerV2 {
    /**
     * @notice Burn USDC and transfer to destination chain.
     *         CCTP v2 does NOT return the nonce — listen for DepositForBurn event.
     */
    function depositForBurn(
        uint256 amount,
        uint32  destinationDomain,
        bytes32 mintRecipient,
        address burnToken,
        bytes32 destinationCaller,
        uint256 maxFee,
        uint32  minFinalityThreshold
    ) external;
}

contract CrosschainAtomicHTLC {
    enum Status { Active, Claimed, Refunded }

    struct HTLC {
        address  depositor;            // funds the HTLC; can refund after timelock
        uint32   destinationDomain;    // CCTP domain of the destination chain
        bytes32  mintRecipient;        // recipient on destination, padded to bytes32
        uint256  amount;               // USDC amount (6 decimals) deposited on Arc
        uint256  maxFee;               // Circle attestation fee (0 = basic speed)
        uint32   minFinalityThreshold; // 2000 = finalized; 1000 = fast
        bytes32  hashlock;             // keccak256(abi.encode(preimage))
        uint256  timelock;             // Unix ts after which depositor can refund
        Status   status;
        bytes32  preimage;             // populated after claim()
    }

    ITokenMessengerV2 public immutable tokenMessenger;
    IERC20            public immutable usdc;

    mapping(uint256 => HTLC) public htlcs;
    uint256 public nextId;

    event HTLCCreated(
        uint256 indexed id,
        address indexed depositor,
        uint32  destinationDomain,
        bytes32 mintRecipient,
        uint256 amount,
        bytes32 hashlock,
        uint256 timelock
    );
    event HTLCClaimed(
        uint256 indexed id,
        address claimedBy,
        bytes32 preimage
    );
    event HTLCRefunded(uint256 indexed id, address refundedTo);

    constructor(address _tokenMessenger, address _usdc) {
        tokenMessenger = ITokenMessengerV2(_tokenMessenger);
        usdc           = IERC20(_usdc);
    }

    // ─── Create ───────────────────────────────────────────────────────────────

    /**
     * @notice Lock USDC on Arc with CCTP destination params.
     *         When claimed, USDC is burned here and minted for mintRecipient on destinationDomain.
     *
     * @param destinationDomain     CCTP domain of destination (0 = Eth Sepolia, 3 = Arb, 6 = Base).
     * @param mintRecipient         Recipient on destination chain, left-padded to bytes32.
     *                              Use bytes32(uint256(uint160(addr))) to convert an address.
     * @param amount                USDC amount (6 decimals). Must exceed maxFee.
     * @param hashlock              keccak256(abi.encode(preimage)) — generated off-chain.
     * @param timelock              Unix timestamp after which depositor can refund.
     *                              Recommend >= counterparty's timelock + 24h.
     * @param maxFee                Maximum Circle attestation fee (0 for basic speed).
     * @param minFinalityThreshold  2000 for Arc finalized; 1000 for fast attestation.
     * @return id                   HTLC ID — share with counterparty.
     */
    function createHTLC(
        uint32  destinationDomain,
        bytes32 mintRecipient,
        uint256 amount,
        bytes32 hashlock,
        uint256 timelock,
        uint256 maxFee,
        uint32  minFinalityThreshold
    ) external returns (uint256 id) {
        require(mintRecipient != bytes32(0),  "CrosschainAtomicHTLC: zero mintRecipient");
        require(amount > maxFee,              "CrosschainAtomicHTLC: amount <= maxFee");
        require(hashlock != bytes32(0),       "CrosschainAtomicHTLC: zero hashlock");
        require(timelock > block.timestamp,   "CrosschainAtomicHTLC: timelock in past");

        require(
            usdc.transferFrom(msg.sender, address(this), amount),
            "CrosschainAtomicHTLC: USDC pull failed"
        );

        id = nextId++;
        htlcs[id] = HTLC({
            depositor:            msg.sender,
            destinationDomain:    destinationDomain,
            mintRecipient:        mintRecipient,
            amount:               amount,
            maxFee:               maxFee,
            minFinalityThreshold: minFinalityThreshold,
            hashlock:             hashlock,
            timelock:             timelock,
            status:               Status.Active,
            preimage:             bytes32(0)
        });

        emit HTLCCreated(id, msg.sender, destinationDomain, mintRecipient, amount, hashlock, timelock);
    }

    // ─── Claim ────────────────────────────────────────────────────────────────

    /**
     * @notice Reveal preimage → burns USDC on Arc via CCTP → minted for mintRecipient on dest.
     *
     * @dev Permissionless: anyone may call once the preimage is public (e.g. revealed on Sepolia).
     *      The mintRecipient is locked at creation; no one can redirect funds.
     *
     * @param id        HTLC ID.
     * @param preimage  Secret bytes32 such that keccak256(abi.encode(preimage)) == hashlock.
     */
    function claim(uint256 id, bytes32 preimage) external {
        HTLC storage h = htlcs[id];
        require(h.status == Status.Active,                          "CrosschainAtomicHTLC: not active");
        require(block.timestamp < h.timelock,                       "CrosschainAtomicHTLC: timelock expired");
        require(keccak256(abi.encode(preimage)) == h.hashlock,      "CrosschainAtomicHTLC: wrong preimage");

        h.status   = Status.Claimed;
        h.preimage = preimage;

        // Approve TokenMessengerV2 and burn USDC cross-chain.
        // CCTP v2 deducts maxFee from amount and mints (amount - maxFee) on destination.
        require(usdc.approve(address(tokenMessenger), h.amount), "CrosschainAtomicHTLC: approve failed");

        // destinationCaller = bytes32(0) → anyone can relay the attestation on destination.
        tokenMessenger.depositForBurn(
            h.amount,
            h.destinationDomain,
            h.mintRecipient,
            address(usdc),
            bytes32(0),          // any relayer
            h.maxFee,
            h.minFinalityThreshold
        );

        emit HTLCClaimed(id, msg.sender, preimage);
    }

    // ─── Refund ───────────────────────────────────────────────────────────────

    /**
     * @notice Refund depositor after timelock expiry.
     *         Permissionless — anyone may trigger; funds always return to depositor.
     */
    function refund(uint256 id) external {
        HTLC storage h = htlcs[id];
        require(h.status == Status.Active,          "CrosschainAtomicHTLC: not active");
        require(block.timestamp >= h.timelock,      "CrosschainAtomicHTLC: not yet expired");

        h.status = Status.Refunded;

        require(usdc.transfer(h.depositor, h.amount), "CrosschainAtomicHTLC: refund failed");

        emit HTLCRefunded(id, h.depositor);
    }

    // ─── View helpers ─────────────────────────────────────────────────────────

    function getHTLC(uint256 id) external view returns (HTLC memory) {
        return htlcs[id];
    }

    function verifyPreimage(uint256 id, bytes32 preimage) external view returns (bool) {
        return keccak256(abi.encode(preimage)) == htlcs[id].hashlock;
    }

    function isExpired(uint256 id) external view returns (bool) {
        return block.timestamp >= htlcs[id].timelock;
    }

    /**
     * @notice Convert a plain address to the bytes32 mintRecipient format required by CCTP.
     */
    function addressToBytes32(address addr) external pure returns (bytes32) {
        return bytes32(uint256(uint160(addr)));
    }
}
