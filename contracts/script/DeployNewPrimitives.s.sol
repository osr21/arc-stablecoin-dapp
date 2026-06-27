// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/FXForward.sol";
import "../src/CrosschainHTLC.sol";

contract DeployNewPrimitives is Script {
    function run() external {
        vm.startBroadcast();

        FXForward      fxForward = new FXForward();
        CrosschainHTLC htlc      = new CrosschainHTLC();

        vm.stopBroadcast();

        console.log("FX_FORWARD=%s",       address(fxForward));
        console.log("CROSSCHAIN_HTLC=%s",  address(htlc));
    }
}
