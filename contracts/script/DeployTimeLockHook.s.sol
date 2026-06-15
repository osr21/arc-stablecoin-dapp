// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/TimeLockHook.sol";

/**
 * @title DeployTimeLockHook
 * @notice Deploys TimeLockHook (v6) to a destination chain.
 *
 * v6 design: TimeLockHook is the relay entrypoint. Users call TimeLockHook.relay()
 * instead of MessageTransmitterV2.receiveMessage(). The constructor takes
 * MESSAGE_TRANSMITTER_V2 (NOT TokenMessengerV2) because relay() calls receiveMessage()
 * internally.
 *
 * MessageTransmitterV2 is deployed via CREATE2 at the same address on all CCTP v2 chains:
 *   0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275
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
 */
contract DeployTimeLockHook is Script {

    // ── Same address on ALL CCTP v2 chains (CREATE2) ─────────────────────────
    // MessageTransmitterV2 is called by TimeLockHook.relay() to relay the CCTP message.
    address constant MESSAGE_TRANSMITTER_V2 = 0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275;

    // ── USDC on Ethereum Sepolia (default) ───────────────────────────────────
    address constant USDC_SEPOLIA           = 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238;

    // ── USDC on Base Sepolia ─────────────────────────────────────────────────
    address constant USDC_BASE_SEPOLIA      = 0x036CbD53842c5426634e7929541eC2318f3dCF7e;

    // ── USDC on Arbitrum Sepolia ─────────────────────────────────────────────
    address constant USDC_ARB_SEPOLIA       = 0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d;

    function run() external {
        // Set USDC_ADDRESS env var to select the right chain's USDC, e.g.:
        //   USDC_ADDRESS=0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d
        // Defaults to Ethereum Sepolia USDC if not set.
        address usdcAddr = vm.envOr("USDC_ADDRESS", USDC_SEPOLIA);

        vm.startBroadcast();

        TimeLockHook hook = new TimeLockHook(MESSAGE_TRANSMITTER_V2, usdcAddr);

        vm.stopBroadcast();

        console.log("TimeLockHook v6 deployed at:", address(hook));
        console.log("  MessageTransmitterV2:", hook.messageTransmitter());
        console.log("  USDC:               ", hook.usdc());
        console.log("");
        console.log("Update TIME_LOCK_HOOK_ADDRESSES in artifacts/arc-dapp/src/lib/contracts.ts");
    }
}
