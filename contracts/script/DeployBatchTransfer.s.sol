// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/BatchTransfer.sol";

contract DeployBatchTransfer is Script {
    function run() external {
        vm.startBroadcast();
        BatchTransfer bt = new BatchTransfer();
        vm.stopBroadcast();
        console.log("BATCH_TRANSFER=%s", address(bt));
    }
}
