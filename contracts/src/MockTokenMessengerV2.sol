// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title MockTokenMessengerV2
 * @notice Arc Testnet only — simulates Circle's CCTP v2 TokenMessengerV2 interface.
 *
 * Circle has not yet deployed their CCTP v2 contracts on Arc Testnet.
 * This mock allows the CrosschainEscrow DApp to demonstrate the full
 * depositForBurnWithHook flow end-to-end on Arc Testnet.
 *
 * The mock:
 *   - Accepts USDC (pulls via transferFrom, which CrosschainEscrow already approved)
 *   - Emits MessageSent with a deterministic messageHash derived from the burn params
 *   - Returns an incrementing nonce
 *   - Emits DepositForBurn to mirror the real CCTP event signature
 *
 * When Circle deploys real CCTP v2 on Arc, replace this address with theirs
 * and redeploy CrosschainEscrow.
 */

import "./IERC20.sol";

contract MockTokenMessengerV2 {
    uint64 public nextNonce;

    event DepositForBurn(
        uint64  indexed nonce,
        address indexed burnToken,
        uint256         amount,
        address indexed depositor,
        bytes32         mintRecipient,
        uint32          destinationDomain,
        bytes32         destinationTokenMessenger,
        bytes32         destinationCaller
    );

    // Mirrors the real CCTP MessageTransmitter event so IRIS-compatible listeners work
    event MessageSent(bytes message);

    /**
     * @notice Simulate CCTP v2 depositForBurnWithHook.
     *         Burns USDC by holding it in this contract (no real cross-chain relay).
     *         Emits DepositForBurn + MessageSent so off-chain watchers can track.
     */
    function depositForBurnWithHook(
        uint256 amount,
        uint32  destinationDomain,
        bytes32 mintRecipient,
        address burnToken,
        bytes32 destinationCaller,
        uint256 /* maxFee */,
        uint32  /* minFinalityThreshold */,
        bytes calldata hookData
    ) external returns (uint64 nonce) {
        require(amount > 0, "Zero amount");
        require(destinationDomain != 7, "Cannot burn to source chain");

        // Pull USDC from the caller (CrosschainEscrow already approved us)
        IERC20(burnToken).transferFrom(msg.sender, address(this), amount);

        nonce = nextNonce++;

        emit DepositForBurn(
            nonce,
            burnToken,
            amount,
            msg.sender,
            mintRecipient,
            destinationDomain,
            bytes32(0),
            destinationCaller
        );

        // Encode a deterministic message bytes so the messageHash is reproducible
        bytes memory message = abi.encode(
            nonce,
            destinationDomain,
            mintRecipient,
            amount,
            burnToken,
            hookData,
            block.chainid,
            block.timestamp
        );
        emit MessageSent(message);
    }

    /**
     * @notice Returns the keccak256 of what MessageSent would emit for a given nonce.
     *         Off-chain: compute messageHash = keccak256(abi.encode(nonce, ...)) to
     *         correlate with the emitted MessageSent bytes.
     */
    function getMessageHash(uint64 nonce) external view returns (bytes32) {
        return keccak256(abi.encode(nonce, block.chainid));
    }
}
