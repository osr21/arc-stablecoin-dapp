// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/TimeLockHook.sol";

/**
 * @title DeployTimeLockHook
 * @notice Deploys TimeLockHook to a destination chain (Ethereum Sepolia, Base Sepolia, etc.)
 *
 * IMPORTANT: The constructor takes TOKEN_MESSENGER_V2 (not MessageTransmitterV2).
 * TokenMessengerV2 is the contract that calls handleReceiveMessage() on the hook
 * after minting USDC. MessageTransmitterV2 calls TokenMessengerV2, not the hook directly.
 *
 * Usage (Ethereum Sepolia):
 *   forge script script/DeployTimeLockHook.s.sol:DeployTimeLockHook \
 *     --rpc-url https://ethereum-sepolia-rpc.publicnode.com \
 *     --private-key "$DEPLOYER_PRIVATE_KEY" \
 *     --broadcast \
 *     --config-path foundry.toml
 *
 * Usage (Arbitrum Sepolia):
 *   USDC_ADDRESS=0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d \
 *   forge script script/DeployTimeLockHook.s.sol:DeployTimeLockHook \
 *     --rpc-url https://sepolia-rollup.arbitrum.io/rpc \
 *     --private-key "$DEPLOYER_PRIVATE_KEY" \
 *     --broadcast \
 *     --config-path foundry.toml
 *
 * Usage (Base Sepolia):
 *   USDC_ADDRESS=0x036CbD53842c5426634e7929541eC2318f3dCF7e \
 *   forge script script/DeployTimeLockHook.s.sol:DeployTimeLockHook \
 *     --rpc-url https://sepolia.base.org \
 *     --private-key "$DEPLOYER_PRIVATE_KEY" \
 *     --broadcast \
 *     --config-path foundry.toml
 *
 * TokenMessengerV2 and MessageTransmitterV2 are deployed via CREATE2 at the same
 * address on all CCTP v2 chains. Verify at:
 * https://developers.circle.com/stablecoins/docs/evm-smart-contracts
 */
contract DeployTimeLockHook is Script {

    // ── Same address on ALL CCTP v2 chains (CREATE2) ─────────────────────────
    // TokenMessengerV2 is the caller of handleReceiveMessage() on hook contracts.
    address constant TOKEN_MESSENGER_V2 = 0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA;

    // ── USDC on Ethereum Sepolia ─────────────────────────────────────────────
    address constant USDC_SEPOLIA       = 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238;

    // ── USDC on Base Sepolia ─────────────────────────────────────────────────
    address constant USDC_BASE_SEPOLIA  = 0x036CbD53842c5426634e7929541eC2318f3dCF7e;

    // ── USDC on Arbitrum Sepolia ─────────────────────────────────────────────
    address constant USDC_ARB_SEPOLIA   = 0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d;

    function run() external {
        // Set USDC_ADDRESS env var to select the right chain's USDC, e.g.:
        //   USDC_ADDRESS=0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d
        // Defaults to Ethereum Sepolia USDC if not set.
        address usdcAddr = vm.envOr("USDC_ADDRESS", USDC_SEPOLIA);

        vm.startBroadcast();

        TimeLockHook hook = new TimeLockHook(TOKEN_MESSENGER_V2, usdcAddr);

        vm.stopBroadcast();

        console.log("TimeLockHook deployed at:", address(hook));
        console.log("  TokenMessengerV2:", hook.tokenMessenger());
        console.log("  USDC:            ", hook.usdc());
        console.log("");
        console.log("Update TIME_LOCK_HOOK_ADDRESSES in artifacts/arc-dapp/src/lib/contracts.ts");
    }
}
