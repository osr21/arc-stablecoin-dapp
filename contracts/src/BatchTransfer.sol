// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./IERC20.sol";

/**
 * @title BatchTransfer
 * @notice Send an ERC-20 token (USDC or EURC) to multiple recipients in one transaction.
 *
 * Flow:
 *   1. Caller calls token.approve(batchTransfer, totalAmount)
 *   2. Caller calls batchTransfer.batchTransfer(token, recipients, amounts, memo)
 *      → pulls the exact total from the caller, distributes to each recipient,
 *        and emits the memo string in the BatchExecuted event (stored on-chain
 *        in event logs — no separate transaction needed).
 *
 * Deployed on Arc Testnet to leverage the Zero7 hardfork's batch-transaction UX.
 */
contract BatchTransfer {
    event BatchExecuted(
        address indexed sender,
        address indexed token,
        uint256 totalAmount,
        uint256 count,
        string  memo
    );

    /**
     * @notice Transfer `token` to many recipients in a single on-chain call.
     * @param token      ERC-20 contract address (USDC or EURC on Arc Testnet).
     * @param recipients Ordered list of recipient addresses.
     * @param amounts    Amounts in raw 6-decimal base units, parallel to recipients.
     * @param memo       Optional free-text memo stored in the BatchExecuted event log.
     */
    function batchTransfer(
        address token,
        address[] calldata recipients,
        uint256[] calldata amounts,
        string  calldata memo
    ) external {
        uint256 len = recipients.length;
        require(len > 0,               "BatchTransfer: empty");
        require(len == amounts.length, "BatchTransfer: length mismatch");

        // Sum total and validate inputs before touching state.
        uint256 total = 0;
        for (uint256 i = 0; i < len; i++) {
            require(recipients[i] != address(0), "BatchTransfer: zero address");
            require(amounts[i] > 0,              "BatchTransfer: zero amount");
            total += amounts[i];
        }

        // Pull the full total from the caller in one transferFrom.
        require(
            IERC20(token).transferFrom(msg.sender, address(this), total),
            "BatchTransfer: pull failed"
        );

        // Distribute to each recipient.
        for (uint256 i = 0; i < len; i++) {
            require(
                IERC20(token).transfer(recipients[i], amounts[i]),
                "BatchTransfer: transfer failed"
            );
        }

        emit BatchExecuted(msg.sender, token, total, len, memo);
    }
}
