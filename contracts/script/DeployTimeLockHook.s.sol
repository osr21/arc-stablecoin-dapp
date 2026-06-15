// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/TimeLockHook.sol";

/**
 * @title DeployTimeLockHook
 * @notice Deploys TimeLockHook to a destination chain (Ethereum Sepolia, Base Sepolia, etc.)
 *
 * Usage (Ethereum Sepolia):
 *   forge script script/DeployTimeLockHook.s.sol:DeployTimeLockHook \
 *     --rpc-url https://ethereum-sepolia-rpc.publicnode.com \
 *     --private-key "$DEPLOYER_PRIVATE_KEY" \
 *     --broadcast \
 *     --config-path foundry.toml
 *
 * Usage (Base Sepolia):
 *   forge script script/DeployTimeLockHook.s.sol:DeployTimeLockHook \
 *     --rpc-url https://sepolia.base.org \
 *     --private-key "$DEPLOYER_PRIVATE_KEY" \
 *     --broadcast \
 *     --config-path foundry.toml
 *
 * MessageTransmitterV2 is deployed at the same address on all CCTP v2 chains
 * (via CREATE2). USDC address varies by chain — verify at:
 * https://developers.circle.com/stablecoins/docs/supported-domains
 */
contract DeployTimeLockHook is Script {

    // ── Shared across all CCTP v2 chains (CREATE2 address) ──────────────────
    address constant MESSAGE_TRANSMITTER_V2 = 0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275;

    // ── USDC on Ethereum Sepolia ─────────────────────────────────────────────
    address constant USDC_SEPOLIA           = 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238;

    // ── USDC on Base Sepolia ─────────────────────────────────────────────────
    address constant USDC_BASE_SEPOLIA      = 0x036CbD53842c5426634e7929541eC2318f3dCF7e;

    // ── USDC on Arbitrum Sepolia ─────────────────────────────────────────────
    address constant USDC_ARB_SEPOLIA       = 0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d;

    function run() external {
        // Override USDC_ADDRESS env var to select the right chain's USDC, e.g.:
        //   USDC_ADDRESS=0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238
        address usdcAddr = vm.envOr("USDC_ADDRESS", USDC_SEPOLIA);

        vm.startBroadcast();

        TimeLockHook hook = new TimeLockHook(MESSAGE_TRANSMITTER_V2, usdcAddr);

        vm.stopBroadcast();

        console.log("TimeLockHook deployed at:", address(hook));
        console.log("  MessageTransmitterV2:", hook.messageTransmitter());
        console.log("  USDC:               ", hook.usdc());
        console.log("");
        console.log("Update TIME_LOCK_HOOK_ADDRESSES in artifacts/arc-dapp/src/lib/contracts.ts");
    }
}
