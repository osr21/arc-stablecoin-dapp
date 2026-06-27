// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/AgentRegistry.sol";

contract DeployAgentRegistry is Script {
    function run() external {
        vm.startBroadcast();
        AgentRegistry registry = new AgentRegistry();
        vm.stopBroadcast();
        console.log("AGENT_REGISTRY=%s", address(registry));
    }
}
