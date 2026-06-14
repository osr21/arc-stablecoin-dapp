// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/ConditionalEscrow.sol";
import "../src/PayrollVesting.sol";
import "../src/CrosschainEscrow.sol";

contract Deploy is Script {
    // Arc Testnet addresses
    address constant USDC  = 0x3600000000000000000000000000000000000000;
    address constant TOKEN_MESSENGER_V2 = 0x28b0b9A9f49Ad9a09C9b80A4dc3C0e56F2b71406;

    function run() external {
        vm.startBroadcast();

        ConditionalEscrow escrow = new ConditionalEscrow();
        PayrollVesting vesting  = new PayrollVesting();
        CrosschainEscrow crosschain = new CrosschainEscrow(TOKEN_MESSENGER_V2, USDC);

        vm.stopBroadcast();

        console.log("CONDITIONAL_ESCROW=%s", address(escrow));
        console.log("PAYROLL_VESTING=%s",    address(vesting));
        console.log("CROSSCHAIN_ESCROW=%s",  address(crosschain));
    }
}
