// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title ConditionalEscrow
 * @notice Arc Testnet — Conditional escrow with onchain dispute resolution and automatic time-based release.
 *         Supports USDC (0x3600000000000000000000000000000000000000) and EURC on Arc.
 *
 * @dev Advanced programmable logic using Circle stablecoins:
 *      - Funds held until releaseTime passes (automatic release)
 *      - Arbiter can resolve disputes in favor of either party
 *      - Depositor can reclaim if beneficiary raises dispute and arbiter sides with depositor
 *
 * Chain: Arc Testnet (Chain ID: 5042002)
 * USDC:  0x3600000000000000000000000000000000000000 (native, 18 decimals for gas, 6 for ERC-20)
 * EURC:  0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a
 */

import "./IERC20.sol";

contract ConditionalEscrow {
    enum Status { Active, Disputed, Released, Resolved }
    enum Resolution { None, ToBeneficiary, ToDepositor }

    struct EscrowData {
        address depositor;
        address beneficiary;
        address arbiter;
        address token;       // USDC or EURC address
        uint256 amount;
        uint256 releaseTime; // Unix timestamp for automatic release
        Status status;
        Resolution resolution;
        string conditionType; // "time_based" | "milestone" | "oracle"
        bytes conditionData;  // ABI-encoded condition parameters
        string disputeReason;
    }

    mapping(uint256 => EscrowData) public escrows;
    uint256 public nextId;

    event EscrowCreated(
        uint256 indexed id,
        address depositor,
        address beneficiary,
        address arbiter,
        address token,
        uint256 amount,
        uint256 releaseTime,
        string conditionType
    );
    event DisputeRaised(uint256 indexed id, address by, string reason);
    event EscrowReleased(uint256 indexed id, address to, uint256 amount);
    event EscrowResolved(uint256 indexed id, Resolution resolution, address arbiter);

    modifier onlyParties(uint256 id) {
        require(
            msg.sender == escrows[id].depositor || msg.sender == escrows[id].beneficiary,
            "Not a party"
        );
        _;
    }

    modifier onlyArbiter(uint256 id) {
        require(msg.sender == escrows[id].arbiter, "Not arbiter");
        _;
    }

    modifier inStatus(uint256 id, Status expected) {
        require(escrows[id].status == expected, "Wrong status");
        _;
    }

    /**
     * @notice Create a new conditional escrow.
     * @param beneficiary  Address to receive funds on release.
     * @param arbiter      Neutral party who can resolve disputes.
     * @param token        ERC-20 token address (USDC or EURC).
     * @param amount       Token amount (6 decimals for USDC/EURC).
     * @param releaseTime  Unix timestamp after which automatic release is permitted.
     * @param conditionType Human-readable condition identifier.
     * @param conditionData ABI-encoded condition parameters.
     */
    function createEscrow(
        address beneficiary,
        address arbiter,
        address token,
        uint256 amount,
        uint256 releaseTime,
        string calldata conditionType,
        bytes calldata conditionData
    ) external returns (uint256 id) {
        require(beneficiary != address(0), "Zero beneficiary");
        require(arbiter != address(0), "Zero arbiter");
        require(amount > 0, "Zero amount");
        require(releaseTime > block.timestamp, "Release time in past");

        IERC20(token).transferFrom(msg.sender, address(this), amount);

        id = nextId++;
        escrows[id] = EscrowData({
            depositor: msg.sender,
            beneficiary: beneficiary,
            arbiter: arbiter,
            token: token,
            amount: amount,
            releaseTime: releaseTime,
            status: Status.Active,
            resolution: Resolution.None,
            conditionType: conditionType,
            conditionData: conditionData,
            disputeReason: ""
        });

        emit EscrowCreated(id, msg.sender, beneficiary, arbiter, token, amount, releaseTime, conditionType);
    }

    /**
     * @notice Release funds to beneficiary when conditions are met.
     *         Anyone can call this after releaseTime has passed.
     *         Only depositor or beneficiary can release before releaseTime.
     */
    function release(uint256 id) external inStatus(id, Status.Active) {
        EscrowData storage e = escrows[id];

        bool isParty = (msg.sender == e.depositor || msg.sender == e.beneficiary);
        bool timeExpired = block.timestamp >= e.releaseTime;

        require(isParty || timeExpired, "Cannot release yet");

        e.status = Status.Released;
        IERC20(e.token).transfer(e.beneficiary, e.amount);

        emit EscrowReleased(id, e.beneficiary, e.amount);
    }

    /**
     * @notice Auto-release: permissionless release after time expires.
     */
    function autoRelease(uint256 id) external inStatus(id, Status.Active) {
        EscrowData storage e = escrows[id];
        require(block.timestamp >= e.releaseTime, "Time not expired");

        e.status = Status.Released;
        IERC20(e.token).transfer(e.beneficiary, e.amount);

        emit EscrowReleased(id, e.beneficiary, e.amount);
    }

    /**
     * @notice Raise a dispute on an active escrow.
     * @param reason Human-readable dispute reason.
     */
    function raiseDispute(uint256 id, string calldata reason)
        external
        onlyParties(id)
        inStatus(id, Status.Active)
    {
        escrows[id].status = Status.Disputed;
        escrows[id].disputeReason = reason;
        emit DisputeRaised(id, msg.sender, reason);
    }

    /**
     * @notice Arbiter resolves a disputed escrow.
     * @param toBeneficiary If true, sends funds to beneficiary; otherwise refunds depositor.
     */
    function resolveDispute(uint256 id, bool toBeneficiary)
        external
        onlyArbiter(id)
        inStatus(id, Status.Disputed)
    {
        EscrowData storage e = escrows[id];
        e.status = Status.Resolved;

        if (toBeneficiary) {
            e.resolution = Resolution.ToBeneficiary;
            IERC20(e.token).transfer(e.beneficiary, e.amount);
            emit EscrowResolved(id, Resolution.ToBeneficiary, msg.sender);
            emit EscrowReleased(id, e.beneficiary, e.amount);
        } else {
            e.resolution = Resolution.ToDepositor;
            IERC20(e.token).transfer(e.depositor, e.amount);
            emit EscrowResolved(id, Resolution.ToDepositor, msg.sender);
            emit EscrowReleased(id, e.depositor, e.amount);
        }
    }

    /**
     * @notice Get full escrow details.
     */
    function getEscrow(uint256 id) external view returns (EscrowData memory) {
        return escrows[id];
    }

    /**
     * @notice Check if an escrow is past its release time.
     */
    function isExpired(uint256 id) external view returns (bool) {
        return block.timestamp >= escrows[id].releaseTime;
    }
}
