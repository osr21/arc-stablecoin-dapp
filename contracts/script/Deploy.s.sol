// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/ConditionalEscrow.sol";
import "../src/PayrollVesting.sol";
import "../src/CrosschainEscrow.sol";

contract Deploy is Script {
    // Arc Testnet addresses
    address constant USDC               = 0x3600000000000000000000000000000000000000;
    address constant TOKEN_MESSENGER_V2 = 0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA;

    function run() external {
        vm.startBroadcast();

        ConditionalEscrow escrow     = new ConditionalEscrow();
        PayrollVesting    vesting    = new PayrollVesting();
        CrosschainEscrow  crosschain = new CrosschainEscrow(TOKEN_MESSENGER_V2, USDC);

        vm.stopBroadcast();

        console.log("CONDITIONAL_ESCROW=%s", address(escrow));
        console.log("PAYROLL_VESTING=%s",    address(vesting));
        console.log("CROSSCHAIN_ESCROW=%s",  address(crosschain));
    }
}
