// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./IERC20.sol";

interface IMessageTransmitterV2 {
    function receiveMessage(bytes calldata message, bytes calldata attestation) external returns (bool);
}

/**
 * @title TimeLockHook (v6 — self-relay design)
 * @notice CCTP v2 time-lock contract deployed on destination chains (e.g. Ethereum Sepolia).
 *
 * ┌─────────────────────────────────────────────────────────────────────────────┐
 * │  FLOW                                                                       │
 * │                                                                             │
 * │  1. Sender on Arc calls CrosschainEscrow.initiateConditionalTransfer with:  │
 * │       recipient  = address(TimeLockHook)  ← this contract on dest chain    │
 * │       hookData   = abi.encode(finalRecipient, unlockTimestamp, amount)      │
 * │                                                                             │
 * │  2. Circle attests the burn message.                                        │
 * │                                                                             │
 * │  3. Anyone calls THIS contract's relay():                                   │
 * │       TimeLockHook.relay(message, attestation, finalRecipient, unlockTs)    │
 * │     → internally calls MessageTransmitterV2.receiveMessage()               │
 * │     → USDC minted to address(this) [since mintRecipient = TimeLockHook]    │
 * │     → PendingRelease stored with a unique nonce-based releaseId             │
 * │     → ReleaseScheduled(releaseId, ...) emitted                             │
 * │                                                                             │
 * │  4. After unlockTimestamp, finalRecipient calls:                            │
 * │       TimeLockHook.claim(releaseId)                                         │
 * │     → USDC transferred to finalRecipient                                   │
 * └─────────────────────────────────────────────────────────────────────────────┘
 *
 * KEY DESIGN INSIGHT (v6 vs previous versions):
 *   Circle's CCTP v2 hook mechanism does NOT automatically call handleReceiveMessage
 *   on the mintRecipient. USDC is simply ERC-20 transferred to mintRecipient, and hooks
 *   only run if someone calls a Circle CCTPHookWrapper.relay(). We avoid that complexity
 *   by making TimeLockHook itself the relay entrypoint: it calls receiveMessage() and
 *   registers the pending release atomically.
 *
 * MessageTransmitterV2 is deployed via CREATE2 at the same address on all CCTP v2 chains:
 *   0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275
 *
 * releaseId is deterministic per relay() call:
 *   keccak256(abi.encode(block.chainid, address(this), relayNonce++))
 *   — unique per chain, per contract, per relay invocation.
 *   Frontend reads it from the ReleaseScheduled event emitted by relay().
 */
contract TimeLockHook {

    // ─── Owner (for Arcscan display) ─────────────────────────────────────────
    address public owner;

    // ─── State ────────────────────────────────────────────────────────────────

    /// @notice MessageTransmitterV2 on this chain — called internally by relay().
    address public immutable messageTransmitter;
    address public immutable usdc;

    uint256 private relayNonce;

    struct PendingRelease {
        address recipient;
        uint256 amount;
        uint256 unlockTime;
        bool    claimed;
    }

    mapping(bytes32 => PendingRelease) public pendingReleases;

    // ─── Events ───────────────────────────────────────────────────────────────

    event ReleaseScheduled(
        bytes32 indexed releaseId,
        address indexed recipient,
        uint256         amount,
        uint256         unlockTime
    );

    event Released(
        bytes32 indexed releaseId,
        address indexed recipient,
        uint256         amount
    );

    // ─── Errors ───────────────────────────────────────────────────────────────

    error RelayFailed();
    error NoUSDCReceived();
    error ReleaseNotFound();
    error NotRecipient();
    error StillLocked(uint256 unlockTime, uint256 current);
    error AlreadyClaimed();

    // ─── Constructor ──────────────────────────────────────────────────────────

    constructor(address _messageTransmitter, address _usdc) {
        owner = msg.sender;
        messageTransmitter = _messageTransmitter;
        usdc = _usdc;
    }

    // ─── Relay ────────────────────────────────────────────────────────────────

    /**
     * @notice Relay a CCTP v2 message and register a time-locked USDC release.
     *
     * @dev mintRecipient in the CCTP burn message MUST equal address(this).
     *      USDC is minted directly to this contract by MessageTransmitterV2.receiveMessage().
     *      The actual received amount (post-fee) is what gets locked, not the burn amount.
     *
     * @param message         CCTP message bytes (from Circle IRIS attestation API).
     * @param attestation     Attestation bytes (from Circle IRIS attestation API).
     * @param finalRecipient  Address that can claim USDC after unlockTimestamp.
     * @param unlockTimestamp Unix timestamp after which claim() is permitted.
     * @return releaseId      Unique ID — pass this to claim(). Also emitted in ReleaseScheduled.
     */
    /**
     * @dev SECURITY NOTE (testnet): `finalRecipient` and `unlockTimestamp` are
     *      caller-supplied and not verified against the hookData embedded in the
     *      CCTP message. A malicious relayer could supply an arbitrary recipient
     *      or a past unlock time. For production, parse and verify these values
     *      from the BurnMessageV2 hookData in `message`.
     *      In this demo the intended relayer is always the finalRecipient themselves.
     */
    function relay(
        bytes calldata message,
        bytes calldata attestation,
        address finalRecipient,
        uint256 unlockTimestamp
    ) external returns (bytes32 releaseId) {
        require(finalRecipient != address(0), "Zero recipient");

        uint256 balBefore = IERC20(usdc).balanceOf(address(this));

        bool ok = IMessageTransmitterV2(messageTransmitter).receiveMessage(message, attestation);
        if (!ok) revert RelayFailed();

        uint256 received = IERC20(usdc).balanceOf(address(this)) - balBefore;
        if (received == 0) revert NoUSDCReceived();

        releaseId = keccak256(abi.encode(block.chainid, address(this), relayNonce++));

        pendingReleases[releaseId] = PendingRelease({
            recipient:  finalRecipient,
            amount:     received,
            unlockTime: unlockTimestamp,
            claimed:    false
        });

        emit ReleaseScheduled(releaseId, finalRecipient, received, unlockTimestamp);
    }

    // ─── Claim ────────────────────────────────────────────────────────────────

    /**
     * @notice Claim time-locked USDC after the unlock timestamp.
     * @param releaseId  The ID emitted in the ReleaseScheduled event during relay().
     */
    function claim(bytes32 releaseId) external {
        PendingRelease storage r = pendingReleases[releaseId];
        if (r.recipient == address(0))      revert ReleaseNotFound();
        if (msg.sender != r.recipient)      revert NotRecipient();
        if (block.timestamp < r.unlockTime) revert StillLocked(r.unlockTime, block.timestamp);
        if (r.claimed)                       revert AlreadyClaimed();

        r.claimed = true;
        uint256 amount = r.amount;

        // Emit after state update, before external call — safe because a transfer
        // failure reverts the whole transaction (including the event and state change).
        require(IERC20(usdc).transfer(r.recipient, amount), "USDC transfer failed");
        emit Released(releaseId, r.recipient, amount);
    }

    // ─── Views ────────────────────────────────────────────────────────────────

    function getRelease(bytes32 releaseId) external view returns (
        address recipient,
        uint256 amount,
        uint256 unlockTime,
        bool    claimed,
        bool    claimable
    ) {
        PendingRelease storage r = pendingReleases[releaseId];
        return (
            r.recipient,
            r.amount,
            r.unlockTime,
            r.claimed,
            !r.claimed && block.timestamp >= r.unlockTime && r.recipient != address(0)
        );
    }
}
