// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./IERC20.sol";

/**
 * @title CrosschainHTLC
 * @notice Arc Testnet — Hash Time Locked Contract (HTLC) for trustless
 *         cross-chain USDC/EURC atomic swaps.
 *
 * @dev HTLC enables atomic swaps without a custodian:
 *
 *   SETUP (off-chain):
 *     1. Alice generates a secret preimage and computes hashlock = keccak256(preimage).
 *     2. Bob deploys a matching HTLC on the destination chain (e.g. Ethereum Sepolia)
 *        using the SAME hashlock, a SHORTER timelock, and USDC for Alice.
 *
 *   EXECUTION:
 *     3. Alice calls createHTLC() on Arc — locks her USDC/EURC with the hashlock.
 *     4. Alice reveals preimage by calling claim() on Bob's destination chain HTLC
 *        → she receives Bob's USDC.
 *     5. Bob sees the revealed preimage on-chain → calls claim() on Alice's Arc HTLC
 *        → he receives Alice's tokens.
 *
 *   SAFETY:
 *     - Bob's timelock < Alice's timelock: if Alice never reveals, Bob refunds first.
 *     - Alice then refunds on Arc after her longer timelock expires.
 *     - No intermediary can steal funds; one party always refunds.
 *
 * Arc Testnet:
 *   USDC: 0x3600000000000000000000000000000000000000
 *   EURC: 0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a
 */

contract CrosschainHTLC {
    enum Status { Active, Claimed, Refunded }

    struct HTLC {
        address depositor;   // funds the HTLC; can refund after timelock
        address recipient;   // can claim by revealing preimage
        address token;       // USDC or EURC
        uint256 amount;      // raw 6-decimal token amount
        bytes32 hashlock;    // keccak256(abi.encode(preimage))
        uint256 timelock;    // Unix timestamp after which depositor can refund
        Status  status;
        bytes32 preimage;    // populated on claim(); zero otherwise
    }

    /// @dev Only USDC and EURC on Arc Testnet are accepted.
    mapping(address => bool) public allowedTokens;

    mapping(uint256 => HTLC) public htlcs;
    uint256 public nextId;

    event HTLCCreated(
        uint256 indexed id,
        address indexed depositor,
        address indexed recipient,
        address token,
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

    constructor() {
        allowedTokens[0x3600000000000000000000000000000000000000] = true; // USDC
        allowedTokens[0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a] = true; // EURC
    }

    modifier onlyActive(uint256 id) {
        require(htlcs[id].status == Status.Active, "CrosschainHTLC: not active");
        _;
    }

    /**
     * @notice Create a new HTLC and lock tokens.
     *
     * @param recipient   Address that can claim by revealing the preimage.
     * @param token       Token to lock (USDC or EURC on Arc Testnet).
     * @param amount      Token amount (6 decimals).
     * @param hashlock    keccak256(abi.encode(preimage)) — computed off-chain by depositor.
     * @param timelock    Unix timestamp after which depositor can refund.
     *                    Recommend >= 24h for cross-chain swaps to give counterparty time.
     * @return id         HTLC ID — share with counterparty for their matching HTLC.
     */
    function createHTLC(
        address recipient,
        address token,
        uint256 amount,
        bytes32 hashlock,
        uint256 timelock
    ) external returns (uint256 id) {
        require(allowedTokens[token],        "CrosschainHTLC: token not allowed");
        require(recipient != address(0),     "CrosschainHTLC: zero recipient");
        require(recipient != msg.sender,     "CrosschainHTLC: self-swap not allowed");
        require(amount > 0,                  "CrosschainHTLC: zero amount");
        require(hashlock != bytes32(0),      "CrosschainHTLC: zero hashlock");
        require(timelock > block.timestamp,  "CrosschainHTLC: timelock in past");

        require(
            IERC20(token).transferFrom(msg.sender, address(this), amount),
            "CrosschainHTLC: token pull failed"
        );

        id = nextId++;
        htlcs[id] = HTLC({
            depositor: msg.sender,
            recipient: recipient,
            token:     token,
            amount:    amount,
            hashlock:  hashlock,
            timelock:  timelock,
            status:    Status.Active,
            preimage:  bytes32(0)
        });

        emit HTLCCreated(id, msg.sender, recipient, token, amount, hashlock, timelock);
    }

    /**
     * @notice Claim the HTLC by revealing the preimage.
     *         Only the recipient may call this; must be before timelock.
     *
     * @param id        HTLC ID.
     * @param preimage  The secret value such that keccak256(abi.encode(preimage)) == hashlock.
     */
    function claim(uint256 id, bytes32 preimage) external onlyActive(id) {
        HTLC storage h = htlcs[id];
        require(msg.sender == h.recipient,                    "CrosschainHTLC: not recipient");
        require(block.timestamp < h.timelock,                 "CrosschainHTLC: timelock expired");
        require(keccak256(abi.encode(preimage)) == h.hashlock, "CrosschainHTLC: wrong preimage");

        h.status   = Status.Claimed;
        h.preimage = preimage;

        require(IERC20(h.token).transfer(h.recipient, h.amount), "CrosschainHTLC: transfer failed");

        emit HTLCClaimed(id, msg.sender, preimage);
    }

    /**
     * @notice Refund the depositor after the timelock has expired.
     *         Permissionless — anyone can trigger the refund once timelock passes,
     *         but funds always go to the original depositor.
     *
     * @param id  HTLC ID.
     */
    function refund(uint256 id) external onlyActive(id) {
        HTLC storage h = htlcs[id];
        require(block.timestamp >= h.timelock, "CrosschainHTLC: timelock not expired");

        h.status = Status.Refunded;

        require(IERC20(h.token).transfer(h.depositor, h.amount), "CrosschainHTLC: refund failed");

        emit HTLCRefunded(id, h.depositor);
    }

    /**
     * @notice Get full HTLC details.
     */
    function getHTLC(uint256 id) external view returns (HTLC memory) {
        return htlcs[id];
    }

    /**
     * @notice Verify a preimage against an HTLC's hashlock without claiming.
     *         Useful for counterparty to verify the preimage off-chain before funding.
     */
    function verifyPreimage(uint256 id, bytes32 preimage) external view returns (bool) {
        return keccak256(abi.encode(preimage)) == htlcs[id].hashlock;
    }

    /**
     * @notice Check whether the timelock has expired.
     */
    function isExpired(uint256 id) external view returns (bool) {
        return block.timestamp >= htlcs[id].timelock;
    }
}
