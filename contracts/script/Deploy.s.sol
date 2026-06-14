// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/ConditionalEscrow.sol";
import "../src/PayrollVesting.sol";
import "../src/CrosschainEscrow.sol";
import "../src/MockTokenMessengerV2.sol";

contract Deploy is Script {
    // Arc Testnet — USDC (native gas token wrapped as ERC-20)
    address constant USDC = 0x3600000000000000000000000000000000000000;

    // NOTE: Circle has not deployed CCTP v2 on Arc Testnet yet.
    // We deploy MockTokenMessengerV2 to enable the full DApp flow.
    // When Circle deploys real CCTP v2 on Arc, redeploy CrosschainEscrow
    // with the real TokenMessengerV2 address.

    function run() external {
        vm.startBroadcast();

        ConditionalEscrow escrow      = new ConditionalEscrow();
        PayrollVesting    vesting     = new PayrollVesting();
        MockTokenMessengerV2 mockCctp = new MockTokenMessengerV2();
        CrosschainEscrow  crosschain  = new CrosschainEscrow(address(mockCctp), USDC);

        vm.stopBroadcast();

        console.log("CONDITIONAL_ESCROW=%s",     address(escrow));
        console.log("PAYROLL_VESTING=%s",        address(vesting));
        console.log("MOCK_TOKEN_MESSENGER_V2=%s", address(mockCctp));
        console.log("CROSSCHAIN_ESCROW=%s",       address(crosschain));
    }
}
