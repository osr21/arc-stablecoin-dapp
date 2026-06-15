// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title CrosschainEscrow
 * @notice Arc Testnet — Cross-chain conditional transfer using Circle CCTP v2.
 *         Escrows USDC on Arc, burns via CCTP, recipient mints on destination chain.
 *         Uses CCTP v2 Hooks for conditional post-transfer logic.
 *
 * @dev Advanced Circle stablecoin crosschain logic:
 *      - Sender deposits USDC into escrow with a condition
 *      - Contract calls CCTP TokenMessengerV2.depositForBurnWithHook()
 *      - Circle IRIS API watches for the burn and generates an attestation
 *      - Anyone calls mintOnDestination() on the destination chain with attestation
 *      - hookData enables conditional execution on destination (e.g., only release if oracle confirms)
 *
 * Arc Testnet CCTP Domain ID: 26
 * USDC on Arc: 0x3600000000000000000000000000000000000000
 *
 * CCTP v2 contracts (Arc Testnet):
 *   TokenMessengerV2:    0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA
 *   MessageTransmitterV2:0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275
 */

import "./IERC20.sol";

interface ITokenMessengerV2 {
    /**
     * @notice Burn USDC and transfer to destination chain (no hook).
     *         Use for unconditional transfers where no post-mint logic is needed.
     * @dev CCTP v2: returns nothing — nonce is emitted in the DepositForBurn event.
     */
    function depositForBurn(
        uint256 amount,
        uint32  destinationDomain,
        bytes32 mintRecipient,
        address burnToken,
        bytes32 destinationCaller,
        uint256 maxFee,
        uint32  minFinalityThreshold
    ) external;

    /**
     * @notice Burn USDC with a hook for conditional destination execution.
     *         hookData MUST be non-empty — use depositForBurn for plain transfers.
     * @dev CCTP v2: returns nothing — nonce is emitted in the DepositForBurn event.
     */
    function depositForBurnWithHook(
        uint256 amount,
        uint32  destinationDomain,
        bytes32 mintRecipient,
        address burnToken,
        bytes32 destinationCaller,
        uint256 maxFee,
        uint32  minFinalityThreshold,
        bytes calldata hookData
    ) external;
}

contract CrosschainEscrow {
    struct Transfer {
        address sender;
        address recipient;
        uint32  destinationDomain;
        address token;
        uint256 amount;
        bool    executed;
        uint64  cctpNonce;
        bytes   hookData;
        string  conditionDescription;
    }

    address public immutable tokenMessengerV2;
    address public immutable usdc;

    mapping(uint256 => Transfer) public transfers;
    uint256 public nextId;

    event TransferInitiated(
        uint256 indexed id,
        address sender,
        address recipient,
        uint32  destinationDomain,
        uint256 amount,
        uint64  cctpNonce,
        bytes   hookData
    );

    /**
     * @param _tokenMessengerV2 Circle CCTP v2 TokenMessenger address on Arc Testnet.
     * @param _usdc             USDC token address on this chain.
     */
    constructor(address _tokenMessengerV2, address _usdc) {
        tokenMessengerV2 = _tokenMessengerV2;
        usdc = _usdc;
    }

    /**
     * @notice Initiate a conditional cross-chain USDC transfer via CCTP v2.
     *
     * @param recipient            Recipient address on destination chain.
     * @param destinationDomain    CCTP domain ID (Arc=26, Eth Sepolia=0, Base Sepolia=6, Arb Sepolia=3).
     * @param amount               USDC amount (6 decimals).
     * @param maxFee               Max fee for Circle attestation service (0 for basic).
     * @param minFinalityThreshold Finality required (2000 = finalized on Arc).
     * @param hookData             ABI-encoded conditional hook instructions for destination.
     * @param conditionDescription Human-readable description of the condition.
     */
    function initiateConditionalTransfer(
        address recipient,
        uint32  destinationDomain,
        uint256 amount,
        uint256 maxFee,
        uint32  minFinalityThreshold,
        bytes calldata hookData,
        string calldata conditionDescription
    ) external returns (uint256 id) {
        require(recipient != address(0), "Zero recipient");
        require(amount > 0, "Zero amount");

        IERC20(usdc).transferFrom(msg.sender, address(this), amount);
        IERC20(usdc).approve(tokenMessengerV2, amount);

        bytes32 mintRecipient = bytes32(uint256(uint160(recipient)));
        bytes32 destCaller    = bytes32(0); // anyone can mint on destination

        // CCTP v2: depositForBurnWithHook requires non-empty hookData.
        // Route to the plain depositForBurn for unconditional transfers.
        // Neither function returns a value in CCTP v2 — the nonce is in the DepositForBurn event.
        if (hookData.length == 0) {
            ITokenMessengerV2(tokenMessengerV2).depositForBurn(
                amount,
                destinationDomain,
                mintRecipient,
                usdc,
                destCaller,
                maxFee,
                minFinalityThreshold
            );
        } else {
            ITokenMessengerV2(tokenMessengerV2).depositForBurnWithHook(
                amount,
                destinationDomain,
                mintRecipient,
                usdc,
                destCaller,
                maxFee,
                minFinalityThreshold,
                hookData
            );
        }

        id = nextId++;
        transfers[id] = Transfer({
            sender:               msg.sender,
            recipient:            recipient,
            destinationDomain:    destinationDomain,
            token:                usdc,
            amount:               amount,
            executed:             true,
            cctpNonce:            0, // CCTP v2 emits nonce in DepositForBurn event, not as return value
            hookData:             hookData,
            conditionDescription: conditionDescription
        });

        emit TransferInitiated(id, msg.sender, recipient, destinationDomain, amount, 0, hookData);
    }

    /**
     * @notice Helper to encode hook data for common condition types.
     * @param conditionType  "oracle_check" | "time_lock" | "multisig" | "none"
     * @param target         Contract to call on destination after mint.
     * @param callData       Encoded call to execute on target.
     */
    function encodeHookData(
        string calldata conditionType,
        address target,
        bytes calldata callData
    ) external pure returns (bytes memory) {
        return abi.encode(conditionType, target, callData);
    }

    /**
     * @notice Get transfer details by ID.
     */
    function getTransfer(uint256 id) external view returns (Transfer memory) {
        return transfers[id];
    }

    /**
     * @notice CCTP domain IDs for reference.
     *         Arc Testnet: 26
     *         Ethereum Sepolia: 0
     *         Avalanche Fuji: 1
     *         Optimism Sepolia: 2
     *         Arbitrum Sepolia: 3
     *         Base Sepolia: 6
     */
    function getDomainId(string calldata chainName) external pure returns (uint32) {
        bytes32 h = keccak256(bytes(chainName));
        if (h == keccak256("arc"))               return 26;
        if (h == keccak256("ethereum-sepolia"))  return 0;
        if (h == keccak256("avalanche-fuji"))    return 1;
        if (h == keccak256("optimism-sepolia"))  return 2;
        if (h == keccak256("arbitrum-sepolia"))  return 3;
        if (h == keccak256("base-sepolia"))      return 6;
        revert("Unknown chain");
    }
}
