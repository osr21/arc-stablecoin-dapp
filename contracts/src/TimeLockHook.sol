// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./IERC20.sol";

/**
 * @title TimeLockHook (v5 — hookData-only design)
 * @notice CCTP v2 hook contract deployed on destination chains (e.g. Ethereum Sepolia).
 *
 * ┌─────────────────────────────────────────────────────────────────────────────┐
 * │  FLOW                                                                       │
 * │                                                                             │
 * │  1. Sender on Arc calls CrosschainEscrow.initiateConditionalTransfer with:  │
 * │       recipient  = address(TimeLockHook)  ← this contract on dest chain    │
 * │       hookData   = abi.encode(finalRecipient, unlockTimestamp, amount)      │
 * │                                                                             │
 * │  2. Circle attests. Anyone calls:                                           │
 * │       MessageTransmitterV2.receiveMessage(messageBytes, attestation)        │
 * │     → TokenMessengerV2 mints USDC to address(TimeLockHook)                 │
 * │     → TokenMessengerV2 calls TimeLockHook.handleReceiveMessage(             │
 * │           sourceDomain,                                                     │
 * │           sender,       ← CrosschainEscrow on source chain (bytes32)       │
 * │           hookData      ← the raw hookData bytes from the burn, NOT        │
 * │                            the full BurnMessageV2 struct                    │
 * │         )                                                                   │
 * │                                                                             │
 * │  3. TimeLockHook decodes hookData and stores a PendingRelease.             │
 * │                                                                             │
 * │  4. After unlockTimestamp, finalRecipient calls:                            │
 * │       TimeLockHook.claim(releaseId)                                         │
 * │     → USDC transferred to finalRecipient                                   │
 * └─────────────────────────────────────────────────────────────────────────────┘
 *
 * KEY DESIGN INSIGHT:
 *   Circle passes hookData (not the full BurnMessageV2) as the `messageBody`
 *   parameter to handleReceiveMessage. The `sender` parameter is the address
 *   that called depositForBurnWithHook on the source chain = CrosschainEscrow.
 *
 * hookData encoding (96 bytes):
 *   abi.encode(address finalRecipient, uint256 unlockTimestamp, uint256 amount)
 *   Amount is included so the contract knows how much USDC to release on claim.
 *
 * releaseId (deterministic, pre-computable by frontend):
 *   keccak256(abi.encode(sourceDomain, sender_bytes32, finalRecipient, amount, unlockTimestamp))
 *   where sender_bytes32 = CrosschainEscrow left-padded to bytes32.
 *
 * Caller hierarchy on destination chain:
 *   MessageTransmitterV2 (0xE737...275) → TokenMessengerV2 (0x8FE6...DAA) → us
 *   msg.sender in handleReceiveMessage = TokenMessengerV2
 */
contract TimeLockHook {

    // ─── State ────────────────────────────────────────────────────────────────

    /// @notice The Circle TokenMessengerV2 on this chain — the ONLY allowed caller of
    ///         handleReceiveMessage(). This is TokenMessengerV2, not MessageTransmitterV2.
    address public immutable tokenMessenger;
    address public immutable usdc;

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
        uint256         unlockTime,
        uint32          sourceDomain,
        bytes32         messageSender
    );

    event Released(
        bytes32 indexed releaseId,
        address indexed recipient,
        uint256         amount
    );

    // ─── Errors ───────────────────────────────────────────────────────────────

    error OnlyTokenMessenger();
    error MessageTooShort();
    error ReleaseAlreadyExists();
    error ReleaseNotFound();
    error NotRecipient();
    error StillLocked(uint256 unlockTime, uint256 current);
    error AlreadyClaimed();

    // ─── Constructor ──────────────────────────────────────────────────────────

    constructor(address _tokenMessenger, address _usdc) {
        tokenMessenger = _tokenMessenger;
        usdc = _usdc;
    }

    // ─── CCTP v2 Hook ─────────────────────────────────────────────────────────

    /**
     * @notice Called by TokenMessengerV2 after minting USDC to this contract.
     *
     * @dev msg.sender MUST be the Circle TokenMessengerV2 on this chain.
     *      Call chain: receiveMessage() → MessageTransmitterV2 → TokenMessengerV2 → us
     *
     *      IMPORTANT: `messageBody` is the raw hookData bytes passed to depositForBurnWithHook
     *      on the source chain. It is NOT the full BurnMessageV2 struct.
     *
     *      `sender` is the address that called depositForBurnWithHook = CrosschainEscrow (bytes32).
     *
     * @param sourceDomain  Source chain CCTP domain (Arc Testnet = 26).
     * @param sender        CrosschainEscrow address on source chain, left-padded to bytes32.
     * @param messageBody   Raw hookData = abi.encode(finalRecipient, unlockTimestamp, amount).
     */
    function handleReceiveMessage(
        uint32  sourceDomain,
        bytes32 sender,
        bytes calldata messageBody
    ) external returns (bool) {
        if (msg.sender != tokenMessenger) revert OnlyTokenMessenger();

        // hookData = abi.encode(address, uint256, uint256) = 96 bytes minimum
        if (messageBody.length < 96) revert MessageTooShort();

        // Decode hookData: (finalRecipient, unlockTimestamp, amount)
        (address finalRecipient, uint256 unlockTimestamp, uint256 amount) =
            abi.decode(messageBody, (address, uint256, uint256));

        // Deterministic release ID — matches frontend's computeTimeLockReleaseId().
        // Uses `sender` = CrosschainEscrow bytes32 (left-padded) as passed by Circle.
        bytes32 releaseId = _computeReleaseId(sourceDomain, sender, finalRecipient, amount, unlockTimestamp);

        if (pendingReleases[releaseId].recipient != address(0)) revert ReleaseAlreadyExists();

        pendingReleases[releaseId] = PendingRelease({
            recipient:  finalRecipient,
            amount:     amount,
            unlockTime: unlockTimestamp,
            claimed:    false
        });

        emit ReleaseScheduled(releaseId, finalRecipient, amount, unlockTimestamp, sourceDomain, sender);
        return true;
    }

    // ─── Claim ────────────────────────────────────────────────────────────────

    /**
     * @notice Claim time-locked USDC after the unlock timestamp.
     * @param releaseId  The release ID emitted in the ReleaseScheduled event or pre-computed.
     */
    function claim(bytes32 releaseId) external {
        PendingRelease storage r = pendingReleases[releaseId];
        if (r.recipient == address(0))      revert ReleaseNotFound();
        if (msg.sender != r.recipient)      revert NotRecipient();
        if (block.timestamp < r.unlockTime) revert StillLocked(r.unlockTime, block.timestamp);
        if (r.claimed)                       revert AlreadyClaimed();

        r.claimed = true;
        uint256 amount = r.amount;

        emit Released(releaseId, r.recipient, amount);
        require(IERC20(usdc).transfer(r.recipient, amount), "USDC transfer failed");
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

    /**
     * @notice Pre-compute the releaseId for a pending transfer (matches handleReceiveMessage).
     * @param sourceDomain     CCTP domain of source chain (Arc = 26).
     * @param messageSender    CrosschainEscrow address on source chain, left-padded to bytes32.
     * @param finalRecipient   Address that will receive USDC after unlock.
     * @param amount           USDC amount (6 decimals), same value encoded in hookData.
     * @param unlockTimestamp  Unix timestamp after which claim() is allowed.
     */
    function computeReleaseId(
        uint32  sourceDomain,
        bytes32 messageSender,
        address finalRecipient,
        uint256 amount,
        uint256 unlockTimestamp
    ) external pure returns (bytes32) {
        return _computeReleaseId(sourceDomain, messageSender, finalRecipient, amount, unlockTimestamp);
    }

    // ─── Internal ─────────────────────────────────────────────────────────────

    function _computeReleaseId(
        uint32  sourceDomain,
        bytes32 messageSender,
        address finalRecipient,
        uint256 amount,
        uint256 unlockTimestamp
    ) internal pure returns (bytes32) {
        return keccak256(abi.encode(sourceDomain, messageSender, finalRecipient, amount, unlockTimestamp));
    }
}
