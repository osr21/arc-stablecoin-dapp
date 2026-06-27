// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./IERC20.sol";

/**
 * @title FXForward
 * @notice Arc Testnet — On-chain FX forward contract between USDC and EURC.
 *
 * @dev Advanced Circle stablecoin logic — uniquely possible on Arc because both
 *      USDC and EURC are first-class tokens on the same chain.
 *
 * Flow:
 *   1. Party A calls createForward() — deposits USDC, sets eurcAmount, maturity, fundingDeadline.
 *      The implied FX rate is usdcAmount / eurcAmount (e.g. 1.08 USDC per EURC).
 *   2. Party B calls fund(id) — deposits EURC before fundingDeadline.
 *   3. At maturity: anyone calls settle(id) — A receives EURC, B receives USDC.
 *   4. If partyB never funds before fundingDeadline: partyA calls cancel(id) to reclaim USDC.
 *
 * Arc Testnet:
 *   USDC: 0x3600000000000000000000000000000000000000
 *   EURC: 0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a
 */

contract FXForward {
    address public constant USDC = 0x3600000000000000000000000000000000000000;
    address public constant EURC = 0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a;

    enum Status { Created, Funded, Settled, Cancelled }

    struct Forward {
        address partyA;           // deposits USDC; receives EURC at maturity
        address partyB;           // deposits EURC; receives USDC at maturity
        uint256 usdcAmount;       // raw 6-decimal USDC amount
        uint256 eurcAmount;       // raw 6-decimal EURC amount
        uint256 maturity;         // Unix timestamp — settlement not allowed before this
        uint256 fundingDeadline;  // Unix timestamp — partyB must fund before this
        Status  status;
    }

    mapping(uint256 => Forward) public forwards;
    uint256 public nextId;

    event ForwardCreated(
        uint256 indexed id,
        address indexed partyA,
        address indexed partyB,
        uint256 usdcAmount,
        uint256 eurcAmount,
        uint256 maturity,
        uint256 fundingDeadline
    );
    event ForwardFunded(uint256 indexed id, address partyB);
    event ForwardSettled(uint256 indexed id, address settledBy);
    event ForwardCancelled(uint256 indexed id, address cancelledBy, string reason);

    modifier inStatus(uint256 id, Status expected) {
        require(forwards[id].status == expected, "FXForward: wrong status");
        _;
    }

    /**
     * @notice Create a new FX forward. Caller becomes partyA and deposits USDC.
     * @param partyB           Address that will deposit EURC (counterparty).
     * @param usdcAmount       USDC amount partyA deposits (6 decimals).
     * @param eurcAmount       EURC amount partyB must deposit (6 decimals).
     * @param maturity         Unix timestamp when settlement is allowed.
     * @param fundingDeadline  Unix timestamp by which partyB must fund.
     *                         Must be < maturity and > block.timestamp.
     */
    function createForward(
        address partyB,
        uint256 usdcAmount,
        uint256 eurcAmount,
        uint256 maturity,
        uint256 fundingDeadline
    ) external returns (uint256 id) {
        require(partyB != address(0),              "FXForward: zero partyB");
        require(partyB != msg.sender,              "FXForward: partyB cannot be partyA");
        require(usdcAmount > 0,                    "FXForward: zero USDC amount");
        require(eurcAmount > 0,                    "FXForward: zero EURC amount");
        require(fundingDeadline > block.timestamp, "FXForward: funding deadline in past");
        require(maturity > fundingDeadline,        "FXForward: maturity must be after funding deadline");

        require(
            IERC20(USDC).transferFrom(msg.sender, address(this), usdcAmount),
            "FXForward: USDC pull failed"
        );

        id = nextId++;
        forwards[id] = Forward({
            partyA:          msg.sender,
            partyB:          partyB,
            usdcAmount:      usdcAmount,
            eurcAmount:      eurcAmount,
            maturity:        maturity,
            fundingDeadline: fundingDeadline,
            status:          Status.Created
        });

        emit ForwardCreated(id, msg.sender, partyB, usdcAmount, eurcAmount, maturity, fundingDeadline);
    }

    /**
     * @notice PartyB funds the forward by depositing EURC.
     *         Must be called before fundingDeadline.
     * @param id  Forward ID returned by createForward.
     */
    function fund(uint256 id) external inStatus(id, Status.Created) {
        Forward storage f = forwards[id];
        require(msg.sender == f.partyB,          "FXForward: caller is not partyB");
        require(block.timestamp <= f.fundingDeadline, "FXForward: funding deadline passed");

        require(
            IERC20(EURC).transferFrom(msg.sender, address(this), f.eurcAmount),
            "FXForward: EURC pull failed"
        );

        f.status = Status.Funded;
        emit ForwardFunded(id, msg.sender);
    }

    /**
     * @notice Settle the forward at or after maturity.
     *         Permissionless — anyone can trigger settlement once maturity is reached.
     *         PartyA receives EURC. PartyB receives USDC.
     * @param id  Forward ID.
     */
    function settle(uint256 id) external inStatus(id, Status.Funded) {
        Forward storage f = forwards[id];
        require(block.timestamp >= f.maturity, "FXForward: not yet at maturity");

        f.status = Status.Settled;

        require(IERC20(EURC).transfer(f.partyA, f.eurcAmount), "FXForward: EURC to partyA failed");
        require(IERC20(USDC).transfer(f.partyB, f.usdcAmount), "FXForward: USDC to partyB failed");

        emit ForwardSettled(id, msg.sender);
    }

    /**
     * @notice Cancel an unfunded forward after the funding deadline passes,
     *         and return USDC to partyA.
     *         Also callable by partyA at any time before partyB funds (early exit).
     * @param id  Forward ID.
     */
    function cancel(uint256 id) external inStatus(id, Status.Created) {
        Forward storage f = forwards[id];

        bool deadlinePassed = block.timestamp > f.fundingDeadline;
        bool isPartyA = msg.sender == f.partyA;

        require(deadlinePassed || isPartyA, "FXForward: only partyA can cancel before deadline");

        f.status = Status.Cancelled;

        require(IERC20(USDC).transfer(f.partyA, f.usdcAmount), "FXForward: USDC refund failed");

        string memory reason = isPartyA ? "partyA cancelled" : "funding deadline expired";
        emit ForwardCancelled(id, msg.sender, reason);
    }

    /**
     * @notice Get full forward details.
     */
    function getForward(uint256 id) external view returns (Forward memory) {
        return forwards[id];
    }

    /**
     * @notice Computed implied FX rate as a scaled integer: usdcAmount * 1e6 / eurcAmount.
     *         Represents USDC per EURC with 6 decimal precision.
     */
    function impliedRate(uint256 id) external view returns (uint256) {
        Forward storage f = forwards[id];
        if (f.eurcAmount == 0) return 0;
        return (f.usdcAmount * 1e6) / f.eurcAmount;
    }
}
