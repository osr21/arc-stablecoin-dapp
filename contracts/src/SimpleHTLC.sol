// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title SimpleHTLC
 * @notice Ethereum Sepolia (and other destination chains) — standard ERC-20 Hash Time
 *         Locked Contract for the counterparty leg of a crosschain atomic swap.
 *
 * @dev This is the Sepolia-side complement to CrosschainAtomicHTLC on Arc.
 *
 *   PROTOCOL (Sepolia side):
 *   ─────────────────────────────────
 *   1. Bob creates SimpleHTLC here: locks USDC for Alice with hashlock H and SHORT timelock T_sep.
 *   2. Alice creates CrosschainAtomicHTLC on Arc: locks USDC with same H and LONG timelock T_arc.
 *   3. Alice calls claim(id, P) HERE → reveals P, receives Bob's USDC on Sepolia.
 *   4. Bob (or anyone) calls claim(id, P) on Arc → burns + mints for Bob via CCTP.
 *
 *   SAFETY:
 *   - T_sep < T_arc so Bob can always refund on Sepolia if Alice never reveals.
 *
 * USDC on Ethereum Sepolia: 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238
 * USDC on Base Sepolia:     0x036CbD53842c5426634e7929541eC2318f3dCF7e
 * USDC on Arbitrum Sepolia: 0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d
 */

interface IERC20 {
    function transferFrom(address, address, uint256) external returns (bool);
    function transfer(address, uint256) external returns (bool);
}

contract SimpleHTLC {
    enum Status { Active, Claimed, Refunded }

    struct HTLC {
        address depositor;
        address recipient;
        address token;
        uint256 amount;
        bytes32 hashlock;
        uint256 timelock;
        Status  status;
        bytes32 preimage;
    }

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
    event HTLCClaimed(uint256 indexed id, address claimedBy, bytes32 preimage);
    event HTLCRefunded(uint256 indexed id, address refundedTo);

    // ─── Create ───────────────────────────────────────────────────────────────

    /**
     * @notice Lock ERC-20 tokens (USDC on this chain) for a recipient.
     *
     * @param recipient  Address that can claim by revealing the preimage (e.g. Alice on Sepolia).
     * @param token      ERC-20 token address (USDC on this chain).
     * @param amount     Token amount.
     * @param hashlock   keccak256(abi.encode(preimage)) — must match the Arc-side HTLC.
     * @param timelock   Unix timestamp after which depositor can refund.
     *                   MUST be shorter than the Arc-side timelock.
     * @return id        HTLC ID — share with counterparty.
     */
    function createHTLC(
        address recipient,
        address token,
        uint256 amount,
        bytes32 hashlock,
        uint256 timelock
    ) external returns (uint256 id) {
        require(recipient != address(0) && recipient != msg.sender, "SimpleHTLC: bad recipient");
        require(amount > 0,                  "SimpleHTLC: zero amount");
        require(hashlock != bytes32(0),      "SimpleHTLC: zero hashlock");
        require(timelock > block.timestamp,  "SimpleHTLC: timelock in past");

        require(IERC20(token).transferFrom(msg.sender, address(this), amount), "SimpleHTLC: pull failed");

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

    // ─── Claim ────────────────────────────────────────────────────────────────

    /**
     * @notice Reveal preimage → releases tokens to recipient.
     *         Only the designated recipient may call this.
     */
    function claim(uint256 id, bytes32 preimage) external {
        HTLC storage h = htlcs[id];
        require(h.status == Status.Active,                         "SimpleHTLC: not active");
        require(msg.sender == h.recipient,                         "SimpleHTLC: not recipient");
        require(block.timestamp < h.timelock,                      "SimpleHTLC: expired");
        require(keccak256(abi.encode(preimage)) == h.hashlock,     "SimpleHTLC: wrong preimage");

        h.status   = Status.Claimed;
        h.preimage = preimage;

        require(IERC20(h.token).transfer(h.recipient, h.amount), "SimpleHTLC: transfer failed");

        emit HTLCClaimed(id, msg.sender, preimage);
    }

    // ─── Refund ───────────────────────────────────────────────────────────────

    /**
     * @notice Refund depositor after timelock expires.
     *         Permissionless — anyone may trigger; funds always go to original depositor.
     */
    function refund(uint256 id) external {
        HTLC storage h = htlcs[id];
        require(h.status == Status.Active,       "SimpleHTLC: not active");
        require(block.timestamp >= h.timelock,   "SimpleHTLC: not yet expired");

        h.status = Status.Refunded;
        require(IERC20(h.token).transfer(h.depositor, h.amount), "SimpleHTLC: refund failed");

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
}
