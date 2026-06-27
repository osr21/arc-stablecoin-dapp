// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/CrosschainAtomicHTLC.sol";

contract DeployAtomicHTLC is Script {
    // Arc Testnet
    address constant TOKEN_MESSENGER_V2 = 0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA;
    address constant USDC               = 0x3600000000000000000000000000000000000000;

    function run() external {
        vm.startBroadcast();

        CrosschainAtomicHTLC htlc = new CrosschainAtomicHTLC(TOKEN_MESSENGER_V2, USDC);

        vm.stopBroadcast();

        console.log("CROSSCHAIN_ATOMIC_HTLC=%s", address(htlc));
    }
}
