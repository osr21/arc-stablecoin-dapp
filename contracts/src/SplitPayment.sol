// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./IERC20.sol";

/**
 * @title SplitPayment
 * @notice Arc Testnet — Reusable fixed-share USDC/EURC distribution contract.
 *
 * @dev Turns a single inbound payment into proportional payouts across multiple
 *      recipients without the sender needing to know the split details.
 *
 *   USE CASES:
 *   ─────────────────────────────────────────────────────
 *   • API marketplace: agent pays one contract address; proceeds fan out 70/20/10
 *     to data provider, platform, and referrer automatically.
 *   • Revenue sharing: subscription income split between contributors by stake.
 *   • Multi-party agent coordination: any party can trigger distribution once
 *     funds are available; recipients are locked at split creation time.
 *   • Payroll distribution: fixed-percentage disbursements across team members.
 *
 *   PROTOCOL:
 *   1. Creator calls createSplit(recipients, shares, token, description).
 *      shares[] is in basis points (1 bp = 0.01%); must sum to exactly 10000.
 *   2. Any payer calls distribute(splitId, amount) — ERC-20 is pulled from caller
 *      and immediately pushed to each recipient proportionally.
 *   3. Creator may deactivate the split at any time.
 *
 * Arc Testnet tokens:
 *   USDC: 0x3600000000000000000000000000000000000000
 *   EURC: 0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a
 */
contract SplitPayment {
    struct Split {
        address   creator;
        address   token;           // USDC or EURC
        address[] recipients;
        uint256[] shares;          // basis points per recipient; sum = 10000
        string    description;
        uint256   totalDistributed; // cumulative raw base units distributed
        bool      active;
    }

    /// @dev Only USDC and EURC on Arc Testnet are accepted.
    mapping(address => bool) public allowedTokens;

    mapping(uint256 => Split) public splits;
    uint256 public nextId;

    event SplitCreated(
        uint256 indexed splitId,
        address indexed creator,
        address         token,
        address[]       recipients,
        uint256[]       shares,
        string          description
    );
    event Distributed(
        uint256 indexed splitId,
        address indexed distributor,
        uint256         amount
    );
    event SplitDeactivated(uint256 indexed splitId);

    constructor() {
        allowedTokens[0x3600000000000000000000000000000000000000] = true; // USDC
        allowedTokens[0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a] = true; // EURC
    }

    // ─── Create ───────────────────────────────────────────────────────────────

    /**
     * @notice Create a reusable payment split.
     *
     * @param recipients  Array of payout addresses (2-20 entries, no zero addresses).
     * @param shares      Basis-point allocations per recipient. Must sum to 10000.
     *                    Example: [7000, 2000, 1000] = 70% / 20% / 10%.
     * @param token       USDC or EURC on Arc Testnet.
     * @param description Human-readable description of the split purpose.
     * @return splitId    ID to pass to distribute().
     */
    function createSplit(
        address[] calldata recipients,
        uint256[] calldata shares,
        address            token,
        string  calldata   description
    ) external returns (uint256 splitId) {
        require(allowedTokens[token],                                      "SplitPayment: token not allowed");
        require(recipients.length >= 2 && recipients.length <= 20,         "SplitPayment: 2-20 recipients");
        require(recipients.length == shares.length,                        "SplitPayment: length mismatch");

        uint256 totalShares = 0;
        for (uint256 i = 0; i < recipients.length; i++) {
            require(recipients[i] != address(0), "SplitPayment: zero recipient");
            require(shares[i] > 0,               "SplitPayment: zero share");
            totalShares += shares[i];
        }
        require(totalShares == 10000, "SplitPayment: shares must sum to 10000 bps");

        splitId = nextId++;
        Split storage s = splits[splitId];
        s.creator           = msg.sender;
        s.token             = token;
        s.description       = description;
        s.totalDistributed  = 0;
        s.active            = true;
        for (uint256 i = 0; i < recipients.length; i++) {
            s.recipients.push(recipients[i]);
            s.shares.push(shares[i]);
        }

        emit SplitCreated(splitId, msg.sender, token, recipients, shares, description);
    }

    // ─── Distribute ───────────────────────────────────────────────────────────

    /**
     * @notice Pull `amount` tokens from caller and distribute to all recipients
     *         according to their basis-point shares. Any rounding dust stays in
     *         the last recipient's payout (avoids stranded wei in contract).
     *
     * @dev Caller must have ERC-20 approved this contract for at least `amount`.
     */
    function distribute(uint256 splitId, uint256 amount) external {
        Split storage s = splits[splitId];
        require(s.active,   "SplitPayment: split inactive");
        require(amount > 0, "SplitPayment: zero amount");

        require(
            IERC20(s.token).transferFrom(msg.sender, address(this), amount),
            "SplitPayment: pull failed"
        );

        uint256 distributed = 0;
        for (uint256 i = 0; i < s.recipients.length; i++) {
            uint256 payout;
            if (i == s.recipients.length - 1) {
                // Last recipient gets any rounding dust
                payout = amount - distributed;
            } else {
                payout = (amount * s.shares[i]) / 10000;
            }
            if (payout > 0) {
                require(
                    IERC20(s.token).transfer(s.recipients[i], payout),
                    "SplitPayment: payout failed"
                );
                distributed += payout;
            }
        }

        s.totalDistributed += amount;
        emit Distributed(splitId, msg.sender, amount);
    }

    // ─── Owner controls ───────────────────────────────────────────────────────

    function deactivate(uint256 splitId) external {
        require(splits[splitId].creator == msg.sender, "SplitPayment: not creator");
        splits[splitId].active = false;
        emit SplitDeactivated(splitId);
    }

    // ─── View helpers ─────────────────────────────────────────────────────────

    function getSplit(uint256 splitId) external view returns (Split memory) {
        return splits[splitId];
    }

    function getRecipientCount(uint256 splitId) external view returns (uint256) {
        return splits[splitId].recipients.length;
    }

    /**
     * @notice Preview how much each recipient would receive for a given amount.
     * @return payouts Array of amounts in same order as recipients.
     */
    function previewDistribution(uint256 splitId, uint256 amount) external view returns (uint256[] memory payouts) {
        Split storage s = splits[splitId];
        payouts = new uint256[](s.recipients.length);
        uint256 distributed = 0;
        for (uint256 i = 0; i < s.recipients.length; i++) {
            if (i == s.recipients.length - 1) {
                payouts[i] = amount - distributed;
            } else {
                payouts[i] = (amount * s.shares[i]) / 10000;
                distributed += payouts[i];
            }
        }
    }
}
