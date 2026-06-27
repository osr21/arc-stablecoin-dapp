// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/SplitPayment.sol";

contract DeploySplitPayment is Script {
    function run() external {
        vm.startBroadcast();
        SplitPayment split = new SplitPayment();
        vm.stopBroadcast();
        console.log("SPLIT_PAYMENT=%s", address(split));
    }
}
