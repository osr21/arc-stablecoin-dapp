// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./IERC20.sol";

/**
 * @title TimeLockHook
 * @notice CCTP v2 hook contract deployed on destination chains (e.g. Ethereum Sepolia).
 *
 * ┌─────────────────────────────────────────────────────────────────────────────┐
 * │  FLOW                                                                       │
 * │                                                                             │
 * │  1. Sender on Arc Testnet calls:                                            │
 * │       CrosschainEscrow.initiateConditionalTransfer(                         │
 * │         recipient  = address(TimeLockHook),   ← this contract on dest      │
 * │         hookData   = abi.encode(finalRecipient, unlockTimestamp),           │
 * │         ...                                                                 │
 * │       )                                                                     │
 * │                                                                             │
 * │  2. Circle attests the burn. Anyone calls:                                  │
 * │       MessageTransmitterV2.receiveMessage(messageBytes, attestation)        │
 * │     → TokenMessengerV2 mints USDC to address(TimeLockHook)                 │
 * │     → TokenMessengerV2 calls TimeLockHook.handleReceiveMessage(...)         │
 * │       (msg.sender = TokenMessengerV2, NOT MessageTransmitterV2)             │
 * │                                                                             │
 * │  3. TimeLockHook stores a PendingRelease from decoded hookData.             │
 * │                                                                             │
 * │  4. After unlockTimestamp, finalRecipient calls:                            │
 * │       TimeLockHook.claim(releaseId)                                         │
 * │     → USDC transferred to finalRecipient                                   │
 * └─────────────────────────────────────────────────────────────────────────────┘
 *
 * hookData encoding:
 *   abi.encode(address finalRecipient, uint256 unlockTimestamp)
 *
 * releaseId (deterministic, pre-computable by frontend):
 *   keccak256(abi.encode(sourceDomain, messageSender_bytes32, finalRecipient, amount, unlockTimestamp))
 *
 * BurnMessageV2 packed layout (all offsets in bytes):
 *   [0:4]    version              uint32   (4 bytes)
 *   [4:36]   burnToken            bytes32  (32 bytes)
 *   [36:68]  mintRecipient        bytes32  (32 bytes)
 *   [68:100] amount               uint256  (32 bytes)
 *   [100:132] messageSender       bytes32  (32 bytes)
 *   [132:164] maxFee              uint256  (32 bytes)
 *   [164:168] minFinalityThreshold uint32  (4 bytes) ← NOT a hookData length prefix
 *   [168:]   hookData             bytes    (no length prefix; runs to end of messageBody)
 *
 * Caller hierarchy on destination chain:
 *   MessageTransmitterV2 (0xE737...275) calls TokenMessengerV2
 *   TokenMessengerV2     (0x8FE6...DAA) calls handleReceiveMessage on mintRecipient ← us
 *
 * Both addresses are deployed via CREATE2 at the same address on all CCTP v2 chains.
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

    /**
     * @param _tokenMessenger Circle TokenMessengerV2 on this (destination) chain.
     *                        This is the contract that calls handleReceiveMessage after minting.
     * @param _usdc           USDC address on this (destination) chain.
     */
    constructor(address _tokenMessenger, address _usdc) {
        tokenMessenger = _tokenMessenger;
        usdc = _usdc;
    }

    // ─── CCTP v2 Hook ─────────────────────────────────────────────────────────

    /**
     * @notice Called by TokenMessengerV2 after minting USDC to this contract.
     *
     * @dev msg.sender MUST be the Circle TokenMessengerV2 on this chain (not MessageTransmitterV2).
     *      Call chain: receiveMessage() → MessageTransmitterV2 → TokenMessengerV2 → handleReceiveMessage()
     *      Parses amount and hookData directly from the packed BurnMessageV2 body.
     *
     * @param sourceDomain   Source chain CCTP domain (Arc Testnet = 26).
     * @param sender         Sender address on source chain packed as bytes32
     *                       (i.e. CrosschainEscrow address, left-padded).
     * @param messageBody    Packed BurnMessageV2 bytes — see layout in file header.
     */
    function handleReceiveMessage(
        uint32  sourceDomain,
        bytes32 sender,
        bytes calldata messageBody
    ) external returns (bool) {
        if (msg.sender != tokenMessenger) revert OnlyTokenMessenger();
        // Fixed header: 4+32+32+32+32+32+4 = 168 bytes.
        // [164:168] is minFinalityThreshold (uint32), NOT a hookData length prefix.
        // hookData begins at offset 168 and runs to the end of messageBody.
        // Our hookData is always abi.encode(address, uint256) = 64 bytes minimum.
        if (messageBody.length < 168 + 64) revert MessageTooShort();

        // Parse amount at offset 68
        uint256 amount = uint256(bytes32(messageBody[68:100]));

        // hookData: everything from offset 168 to end (no length prefix in BurnMessageV2)
        bytes calldata hookData = messageBody[168:];

        // Decode hookData: (finalRecipient, unlockTimestamp)
        (address finalRecipient, uint256 unlockTimestamp) = abi.decode(hookData, (address, uint256));

        // Deterministic, pre-computable release ID (no state increment needed)
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
     *
     * @param releaseId  The release ID emitted in the ReleaseScheduled event, or
     *                   pre-computed by the frontend using computeReleaseId().
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

    /**
     * @notice Get the full state of a pending release.
     */
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
     *         Frontend can call this off-chain to know the releaseId before bridging completes.
     *
     * @param sourceDomain     CCTP domain of source chain (Arc = 26).
     * @param messageSender    CrosschainEscrow address on source chain, left-padded to bytes32.
     * @param finalRecipient   Address that will receive USDC after unlock.
     * @param amount           USDC amount (6 decimals).
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
