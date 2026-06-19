// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title PayrollVesting
 * @notice Arc Testnet — Programmable payroll and token vesting in USDC or EURC.
 *         Implements cliff + linear vesting with multi-beneficiary support.
 *
 * @dev Advanced Circle stablecoin payroll logic:
 *      - Employer deposits total vesting amount upfront
 *      - Cliff period: no tokens claimable until cliff expires
 *      - Linear vesting: tokens unlock proportionally over vesting duration after cliff
 *      - Beneficiary claims any vested amount at any time
 *      - Revocable by employer before full vesting (returns unvested portion)
 *
 * Chain: Arc Testnet (Chain ID: 5042002)
 * USDC:  0x3600000000000000000000000000000000000000
 * EURC:  0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a
 */

import "./IERC20.sol";

contract PayrollVesting {
    struct Schedule {
        address employer;
        address beneficiary;
        address token;          // USDC or EURC
        uint256 totalAmount;    // Total tokens to vest
        uint256 cliffDuration;  // Seconds before any tokens vest
        uint256 vestingDuration;// Total vesting period (including cliff)
        uint256 startTime;      // Unix timestamp when vesting starts
        uint256 amountClaimed;  // Tokens already claimed
        bool revoked;
    }

    address public owner;

    mapping(uint256 => Schedule) public schedules;
    uint256 public nextId;

    constructor() {
        owner = msg.sender;
    }

    event ScheduleCreated(
        uint256 indexed id,
        address employer,
        address beneficiary,
        address token,
        uint256 totalAmount,
        uint256 cliffDuration,
        uint256 vestingDuration,
        uint256 startTime
    );
    event TokensClaimed(uint256 indexed id, address beneficiary, uint256 amount, uint256 totalClaimed);
    event ScheduleRevoked(uint256 indexed id, address employer, uint256 amountReturned);

    modifier onlyEmployer(uint256 id) {
        require(msg.sender == schedules[id].employer, "Not employer");
        _;
    }

    modifier onlyBeneficiary(uint256 id) {
        require(msg.sender == schedules[id].beneficiary, "Not beneficiary");
        _;
    }

    /**
     * @notice Create a vesting schedule.
     * @param beneficiary     Employee/recipient address.
     * @param token           USDC or EURC contract address.
     * @param totalAmount     Total tokens to vest (6 decimals for USDC/EURC).
     * @param cliffDuration   Seconds before any tokens vest (e.g. 30 days = 2592000).
     * @param vestingDuration Total vesting period in seconds (e.g. 1 year = 31536000).
     * @param startTime       Vesting start unix timestamp (can be in the future).
     */
    function createSchedule(
        address beneficiary,
        address token,
        uint256 totalAmount,
        uint256 cliffDuration,
        uint256 vestingDuration,
        uint256 startTime
    ) external returns (uint256 id) {
        require(beneficiary != address(0), "Zero beneficiary");
        require(totalAmount > 0, "Zero amount");
        require(vestingDuration > 0, "Zero vesting duration");
        require(cliffDuration <= vestingDuration, "Cliff exceeds vesting");
        // startTime = 0 would make elapsed ≈ 1.7 billion seconds → instantly fully vested.
        require(startTime > 0, "Zero startTime");

        IERC20(token).transferFrom(msg.sender, address(this), totalAmount);

        id = nextId++;
        schedules[id] = Schedule({
            employer: msg.sender,
            beneficiary: beneficiary,
            token: token,
            totalAmount: totalAmount,
            cliffDuration: cliffDuration,
            vestingDuration: vestingDuration,
            startTime: startTime,
            amountClaimed: 0,
            revoked: false
        });

        emit ScheduleCreated(
            id, msg.sender, beneficiary, token,
            totalAmount, cliffDuration, vestingDuration, startTime
        );
    }

    /**
     * @notice Compute how many tokens have vested so far.
     */
    function vestedAmount(uint256 id) public view returns (uint256) {
        Schedule storage s = schedules[id];
        if (s.revoked) return s.amountClaimed;

        uint256 elapsed = block.timestamp > s.startTime
            ? block.timestamp - s.startTime
            : 0;

        if (elapsed < s.cliffDuration) return 0;

        if (elapsed >= s.vestingDuration) return s.totalAmount;

        return (s.totalAmount * elapsed) / s.vestingDuration;
    }

    /**
     * @notice Compute tokens claimable right now (vested minus already claimed).
     */
    function claimableAmount(uint256 id) public view returns (uint256) {
        uint256 vested = vestedAmount(id);
        uint256 claimed = schedules[id].amountClaimed;
        return vested > claimed ? vested - claimed : 0;
    }

    /**
     * @notice Beneficiary claims all currently vested tokens.
     */
    function claim(uint256 id) external onlyBeneficiary(id) {
        require(!schedules[id].revoked, "Schedule revoked");

        uint256 claimable = claimableAmount(id);
        require(claimable > 0, "Nothing to claim");

        schedules[id].amountClaimed += claimable;
        IERC20(schedules[id].token).transfer(schedules[id].beneficiary, claimable);

        emit TokensClaimed(id, schedules[id].beneficiary, claimable, schedules[id].amountClaimed);
    }

    /**
     * @notice Employer revokes the schedule, returning unvested tokens.
     *         Beneficiary may still claim any already-vested portion.
     */
    function revoke(uint256 id) external onlyEmployer(id) {
        Schedule storage s = schedules[id];
        require(!s.revoked, "Already revoked");

        uint256 vested   = vestedAmount(id);
        // Tokens vested but not yet claimed by beneficiary — must be sent now, because
        // after s.revoked = true, vestedAmount() returns amountClaimed, making
        // claimableAmount() return 0 and locking these tokens in the contract forever.
        uint256 unclaimed = vested - s.amountClaimed;
        uint256 unvested  = s.totalAmount - vested;

        s.revoked = true;
        // Prevent beneficiary from double-claiming after revoke pays them out.
        s.amountClaimed = vested;

        if (unclaimed > 0) IERC20(s.token).transfer(s.beneficiary, unclaimed);
        if (unvested  > 0) IERC20(s.token).transfer(s.employer,    unvested);

        emit ScheduleRevoked(id, s.employer, unvested);
    }

    /**
     * @notice Get full schedule details.
     */
    function getSchedule(uint256 id) external view returns (Schedule memory) {
        return schedules[id];
    }
}
