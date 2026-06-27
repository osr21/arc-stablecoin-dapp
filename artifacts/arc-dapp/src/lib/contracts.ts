import { encodeAbiParameters, parseUnits, formatUnits, type Address } from "viem";

export const ARC_TESTNET = {
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 6 },
  rpcUrls: {
    default: { http: ["https://rpc.testnet.arc.network"] },
    public:  { http: ["https://rpc.testnet.arc.network"] },
  },
  blockExplorers: {
    default: { name: "ArcScan", url: "https://testnet.arcscan.app" },
  },
  testnet: true,
} as const;

export const CONTRACT_ADDRESSES = {
  CONDITIONAL_ESCROW:  (import.meta.env.VITE_CONDITIONAL_ESCROW_ADDRESS  ?? "0x935e53ddd824f4fc9321ba94e70161f20c23ad04") as `0x${string}`,
  PAYROLL_VESTING:     (import.meta.env.VITE_PAYROLL_VESTING_ADDRESS     ?? "0x9b96be4a489656b01d2922b1bea9c932ed258215") as `0x${string}`,
  CROSSCHAIN_ESCROW:   (import.meta.env.VITE_CROSSCHAIN_ESCROW_ADDRESS   ?? "0xfc3d201a3fd1ba72855ab7814dce36c43ea9f0de") as `0x${string}`,
  BATCH_TRANSFER:           "0x76d5dd51ad28D607cD8804dc5230cAE93403eD3d" as `0x${string}`,
  FX_FORWARD:               "0x8029d9bDCdB9434468d1351CAB97f4FbBf028f80" as `0x${string}`,
  CROSSCHAIN_HTLC:          "0x7F4Dbe26d09D260B6EEaee8f753F6D3E366cB828" as `0x${string}`,
  CROSSCHAIN_ATOMIC_HTLC:   "0xa22e098843ef65cb8263646303bb27da6efb8b7f" as `0x${string}`,
  AGENT_REGISTRY:           "0xF891f7cCF2A795801b9F1cE8Bd5753B5a6043e72" as `0x${string}`,
  SPLIT_PAYMENT:            "0xDcF9f0c13B3ffC8D108909794E8659FDA8864FCe" as `0x${string}`,
  USDC:                (import.meta.env.VITE_USDC_ADDRESS                ?? "0x3600000000000000000000000000000000000000") as `0x${string}`,
  EURC:                (import.meta.env.VITE_EURC_ADDRESS                ?? "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a") as `0x${string}`,
  TOKEN_MESSENGER_V2:  "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA" as `0x${string}`,
  MESSAGE_TRANSMITTER_V2: "0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275" as `0x${string}`,
};

export const BATCH_TRANSFER_ABI = [
  {
    name: "batchTransfer",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token",      type: "address"   },
      { name: "recipients", type: "address[]" },
      { name: "amounts",    type: "uint256[]" },
      { name: "memo",       type: "string"    },
    ],
    outputs: [],
  },
  {
    type: "event",
    name: "BatchExecuted",
    inputs: [
      { name: "sender",      type: "address", indexed: true  },
      { name: "token",       type: "address", indexed: true  },
      { name: "totalAmount", type: "uint256", indexed: false },
      { name: "count",       type: "uint256", indexed: false },
      { name: "memo",        type: "string",  indexed: false },
    ],
  },
] as const;

export const ERC20_ABI = [
  { name: "approve",     type: "function", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] },
  { name: "allowance",   type: "function", stateMutability: "view",       inputs: [{ name: "owner",   type: "address" }, { name: "spender", type: "address" }], outputs: [{ type: "uint256" }] },
  { name: "balanceOf",   type: "function", stateMutability: "view",       inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
  { name: "transfer",    type: "function", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] },
] as const;

export const CONDITIONAL_ESCROW_ABI = [
  {
    name: "createEscrow", type: "function", stateMutability: "nonpayable",
    inputs: [
      { name: "beneficiary",   type: "address" },
      { name: "arbiter",       type: "address" },
      { name: "token",         type: "address" },
      { name: "amount",        type: "uint256" },
      { name: "releaseTime",   type: "uint256" },
      { name: "conditionType", type: "string"  },
      { name: "conditionData", type: "bytes"   },
    ],
    outputs: [{ name: "id", type: "uint256" }],
  },
  {
    name: "release", type: "function", stateMutability: "nonpayable",
    inputs: [{ name: "id", type: "uint256" }], outputs: [],
  },
  {
    name: "raiseDispute", type: "function", stateMutability: "nonpayable",
    inputs: [{ name: "id", type: "uint256" }, { name: "reason", type: "string" }], outputs: [],
  },
  {
    name: "autoRelease", type: "function", stateMutability: "nonpayable",
    inputs: [{ name: "id", type: "uint256" }], outputs: [],
  },
] as const;

export const PAYROLL_VESTING_ABI = [
  {
    name: "createSchedule", type: "function", stateMutability: "nonpayable",
    inputs: [
      { name: "beneficiary",     type: "address" },
      { name: "token",           type: "address" },
      { name: "totalAmount",     type: "uint256" },
      { name: "cliffDuration",   type: "uint256" },
      { name: "vestingDuration", type: "uint256" },
      { name: "startTime",       type: "uint256" },
    ],
    outputs: [{ name: "id", type: "uint256" }],
  },
  {
    name: "claim", type: "function", stateMutability: "nonpayable",
    inputs: [{ name: "id", type: "uint256" }], outputs: [],
  },
  {
    name: "claimableAmount", type: "function", stateMutability: "view",
    inputs: [{ name: "id", type: "uint256" }], outputs: [{ type: "uint256" }],
  },
] as const;

export const CROSSCHAIN_ESCROW_ABI = [
  {
    name: "initiateConditionalTransfer", type: "function", stateMutability: "nonpayable",
    inputs: [
      { name: "recipient",              type: "address" },
      { name: "destinationDomain",      type: "uint32"  },
      { name: "amount",                 type: "uint256" },
      { name: "maxFee",                 type: "uint256" },
      { name: "minFinalityThreshold",   type: "uint32"  },
      { name: "hookData",               type: "bytes"   },
      { name: "conditionDescription",   type: "string"  },
    ],
    outputs: [{ name: "id", type: "uint256" }],
  },
] as const;

// ─── TimeLockHook ─────────────────────────────────────────────────────────────

/**
 * ABI for TimeLockHook deployed on destination chains.
 * Source: contracts/src/TimeLockHook.sol
 */
export const TIME_LOCK_HOOK_ABI = [
  {
    name: "relay", type: "function", stateMutability: "nonpayable",
    inputs: [
      { name: "message",         type: "bytes"    },
      { name: "attestation",     type: "bytes"    },
      { name: "finalRecipient",  type: "address"  },
      { name: "unlockTimestamp", type: "uint256"  },
    ],
    outputs: [{ name: "releaseId", type: "bytes32" }],
  },
  {
    name: "claim", type: "function", stateMutability: "nonpayable",
    inputs: [{ name: "releaseId", type: "bytes32" }],
    outputs: [],
  },
  {
    name: "getRelease", type: "function", stateMutability: "view",
    inputs: [{ name: "releaseId", type: "bytes32" }],
    outputs: [
      { name: "recipient",  type: "address" },
      { name: "amount",     type: "uint256" },
      { name: "unlockTime", type: "uint256" },
      { name: "claimed",    type: "bool"    },
      { name: "claimable",  type: "bool"    },
    ],
  },
] as const;

/**
 * ABI fragment for the ReleaseScheduled event emitted by TimeLockHook.relay().
 * Use with viem parseEventLogs() to extract the releaseId after relay.
 */
export const RELEASE_SCHEDULED_EVENT_ABI = [
  {
    type: "event",
    name: "ReleaseScheduled",
    inputs: [
      { name: "releaseId",  type: "bytes32", indexed: true  },
      { name: "recipient",  type: "address", indexed: true  },
      { name: "amount",     type: "uint256", indexed: false },
      { name: "unlockTime", type: "uint256", indexed: false },
    ],
  },
] as const;

/**
 * TimeLockHook deployed addresses per destination chain.
 *
 * Deploy with:
 *   forge script script/DeployTimeLockHook.s.sol \
 *     --rpc-url <chain-rpc> --private-key "$DEPLOYER_PRIVATE_KEY" --broadcast
 *
 * Then fill in the address below for each chain.
 */
export const TIME_LOCK_HOOK_ADDRESSES: Record<string, `0x${string}` | null> = {
  "Ethereum Sepolia": "0x22f2ea9050a25da1c24caa76558a65aecc4adf4c", // v6 + security fixes
  "Base Sepolia":     null, // deployer wallet needs Base Sepolia ETH — see replit.md
  "Arbitrum Sepolia": "0x0e250b6b417e5b31c7f4bcc8a00352d0672474ad", // v6 + security fixes
};

/**
 * USDC contract addresses on destination chains (for balance queries).
 * https://developers.circle.com/stablecoins/docs/supported-domains
 */
export const USDC_ON_DEST: Record<string, `0x${string}`> = {
  "Ethereum Sepolia": "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
  "Base Sepolia":     "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  "Arbitrum Sepolia": "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
};

// ─── CCTP constants ───────────────────────────────────────────────────────────

// Arc Testnet CCTP Domain ID is 26 (source chain — not a valid destination from Arc)
export const ARC_CCTP_DOMAIN = 26;

export const DEST_DOMAINS: Record<string, number> = {
  "Ethereum Sepolia": 0,
  "Avalanche Fuji":   1,
  "Arbitrum Sepolia": 3,
  "Base Sepolia":     6,
};

// MessageTransmitterV2 is deployed at the same CREATE2 address on all CCTP v2 chains
export const MESSAGE_TRANSMITTER_V2_ADDRESS = "0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275" as `0x${string}`;

// ─── TimeLock helpers ─────────────────────────────────────────────────────────

/**
 * Encode hookData for a time-lock CCTP v2 transfer.
 * This is passed to CrosschainEscrow.initiateConditionalTransfer() as the `hookData` arg.
 *
 * In v6, TimeLockHook.relay() is called directly by the user (not by Circle's hook mechanism),
 * so hookData encoded here is embedded in the CCTP message for auditability only — not parsed
 * on-chain. The relay() params (finalRecipient, unlockTimestamp) are passed separately.
 *
 * Layout (96 bytes): abi.encode(address finalRecipient, uint256 unlockTimestamp, uint256 amount)
 */
export function encodeTimeLockHookData(
  finalRecipient: Address,
  unlockTimestamp: bigint,
  amount: bigint,
): `0x${string}` {
  return encodeAbiParameters(
    [{ type: "address" }, { type: "uint256" }, { type: "uint256" }],
    [finalRecipient, unlockTimestamp, amount],
  );
}


// ─── Chain configs ────────────────────────────────────────────────────────────

export interface DestChainConfig {
  chainId: number;
  name: string;
  rpc: string;
  explorerTx: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
}

export const DEST_CHAIN_CONFIGS: Record<string, DestChainConfig> = {
  "Ethereum Sepolia": {
    chainId: 11155111,
    name: "Ethereum Sepolia",
    rpc: "https://ethereum-sepolia-rpc.publicnode.com",
    explorerTx: "https://sepolia.etherscan.io/tx",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  },
  "Arbitrum Sepolia": {
    chainId: 421614,
    name: "Arbitrum Sepolia",
    rpc: "https://sepolia-rollup.arbitrum.io/rpc",
    explorerTx: "https://sepolia.arbiscan.io/tx",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  },
  "Base Sepolia": {
    chainId: 84532,
    name: "Base Sepolia",
    rpc: "https://sepolia.base.org",
    explorerTx: "https://sepolia.basescan.org/tx",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  },
};

export const FX_FORWARD_ABI = [
  {
    name: "createForward", type: "function", stateMutability: "nonpayable",
    inputs: [
      { name: "partyB",          type: "address" },
      { name: "usdcAmount",      type: "uint256" },
      { name: "eurcAmount",      type: "uint256" },
      { name: "maturity",        type: "uint256" },
      { name: "fundingDeadline", type: "uint256" },
    ],
    outputs: [{ name: "id", type: "uint256" }],
  },
  {
    name: "fund", type: "function", stateMutability: "nonpayable",
    inputs: [{ name: "id", type: "uint256" }], outputs: [],
  },
  {
    name: "settle", type: "function", stateMutability: "nonpayable",
    inputs: [{ name: "id", type: "uint256" }], outputs: [],
  },
  {
    name: "cancel", type: "function", stateMutability: "nonpayable",
    inputs: [{ name: "id", type: "uint256" }], outputs: [],
  },
  {
    name: "impliedRate", type: "function", stateMutability: "view",
    inputs: [{ name: "id", type: "uint256" }], outputs: [{ type: "uint256" }],
  },
  {
    type: "event", name: "ForwardCreated",
    inputs: [
      { name: "id",              type: "uint256", indexed: true  },
      { name: "partyA",          type: "address", indexed: true  },
      { name: "partyB",          type: "address", indexed: true  },
      { name: "usdcAmount",      type: "uint256", indexed: false },
      { name: "eurcAmount",      type: "uint256", indexed: false },
      { name: "maturity",        type: "uint256", indexed: false },
      { name: "fundingDeadline", type: "uint256", indexed: false },
    ],
  },
] as const;

export const CROSSCHAIN_ATOMIC_HTLC_ABI = [
  {
    name: "createHTLC", type: "function", stateMutability: "nonpayable",
    inputs: [
      { name: "destinationDomain",    type: "uint32"  },
      { name: "mintRecipient",        type: "bytes32" },
      { name: "amount",               type: "uint256" },
      { name: "hashlock",             type: "bytes32" },
      { name: "timelock",             type: "uint256" },
      { name: "maxFee",               type: "uint256" },
      { name: "minFinalityThreshold", type: "uint32"  },
    ],
    outputs: [{ name: "id", type: "uint256" }],
  },
  {
    name: "claim", type: "function", stateMutability: "nonpayable",
    inputs: [{ name: "id", type: "uint256" }, { name: "preimage", type: "bytes32" }],
    outputs: [],
  },
  {
    name: "refund", type: "function", stateMutability: "nonpayable",
    inputs: [{ name: "id", type: "uint256" }], outputs: [],
  },
  {
    name: "addressToBytes32", type: "function", stateMutability: "pure",
    inputs: [{ name: "addr", type: "address" }], outputs: [{ type: "bytes32" }],
  },
  {
    name: "verifyPreimage", type: "function", stateMutability: "view",
    inputs: [{ name: "id", type: "uint256" }, { name: "preimage", type: "bytes32" }],
    outputs: [{ type: "bool" }],
  },
  {
    name: "isExpired", type: "function", stateMutability: "view",
    inputs: [{ name: "id", type: "uint256" }], outputs: [{ type: "bool" }],
  },
  {
    type: "event", name: "HTLCCreated",
    inputs: [
      { name: "id",                type: "uint256", indexed: true  },
      { name: "depositor",         type: "address", indexed: true  },
      { name: "destinationDomain", type: "uint32",  indexed: false },
      { name: "mintRecipient",     type: "bytes32", indexed: false },
      { name: "amount",            type: "uint256", indexed: false },
      { name: "hashlock",          type: "bytes32", indexed: false },
      { name: "timelock",          type: "uint256", indexed: false },
    ],
  },
  {
    type: "event", name: "HTLCClaimed",
    inputs: [
      { name: "id",        type: "uint256", indexed: true  },
      { name: "claimedBy", type: "address", indexed: false },
      { name: "preimage",  type: "bytes32", indexed: false },
    ],
  },
] as const;

export const SIMPLE_HTLC_ABI = [
  {
    name: "createHTLC", type: "function", stateMutability: "nonpayable",
    inputs: [
      { name: "recipient", type: "address" },
      { name: "token",     type: "address" },
      { name: "amount",    type: "uint256" },
      { name: "hashlock",  type: "bytes32" },
      { name: "timelock",  type: "uint256" },
    ],
    outputs: [{ name: "id", type: "uint256" }],
  },
  {
    name: "claim", type: "function", stateMutability: "nonpayable",
    inputs: [{ name: "id", type: "uint256" }, { name: "preimage", type: "bytes32" }],
    outputs: [],
  },
  {
    name: "refund", type: "function", stateMutability: "nonpayable",
    inputs: [{ name: "id", type: "uint256" }], outputs: [],
  },
  {
    name: "verifyPreimage", type: "function", stateMutability: "view",
    inputs: [{ name: "id", type: "uint256" }, { name: "preimage", type: "bytes32" }],
    outputs: [{ type: "bool" }],
  },
] as const;

export const SIMPLE_HTLC_ADDRESS_SEPOLIA = "0x10ad359b96b61ee5a01fad2ba459b9d2b24b2da1" as `0x${string}`;

export const CROSSCHAIN_HTLC_ABI = [
  {
    name: "createHTLC", type: "function", stateMutability: "nonpayable",
    inputs: [
      { name: "recipient", type: "address" },
      { name: "token",     type: "address" },
      { name: "amount",    type: "uint256" },
      { name: "hashlock",  type: "bytes32" },
      { name: "timelock",  type: "uint256" },
    ],
    outputs: [{ name: "id", type: "uint256" }],
  },
  {
    name: "claim", type: "function", stateMutability: "nonpayable",
    inputs: [{ name: "id", type: "uint256" }, { name: "preimage", type: "bytes32" }],
    outputs: [],
  },
  {
    name: "refund", type: "function", stateMutability: "nonpayable",
    inputs: [{ name: "id", type: "uint256" }], outputs: [],
  },
  {
    name: "verifyPreimage", type: "function", stateMutability: "view",
    inputs: [{ name: "id", type: "uint256" }, { name: "preimage", type: "bytes32" }],
    outputs: [{ type: "bool" }],
  },
  {
    name: "isExpired", type: "function", stateMutability: "view",
    inputs: [{ name: "id", type: "uint256" }], outputs: [{ type: "bool" }],
  },
  {
    type: "event", name: "HTLCCreated",
    inputs: [
      { name: "id",        type: "uint256", indexed: true  },
      { name: "depositor", type: "address", indexed: true  },
      { name: "recipient", type: "address", indexed: true  },
      { name: "token",     type: "address", indexed: false },
      { name: "amount",    type: "uint256", indexed: false },
      { name: "hashlock",  type: "bytes32", indexed: false },
      { name: "timelock",  type: "uint256", indexed: false },
    ],
  },
  {
    type: "event", name: "HTLCClaimed",
    inputs: [
      { name: "id",        type: "uint256", indexed: true  },
      { name: "claimedBy", type: "address", indexed: false },
      { name: "preimage",  type: "bytes32", indexed: false },
    ],
  },
] as const;

export const AGENT_REGISTRY_ABI = [
  {
    name: "registerAgent", type: "function", stateMutability: "nonpayable",
    inputs: [
      { name: "name",        type: "string" },
      { name: "agentType",   type: "string" },
      { name: "metadataURI", type: "string" },
    ],
    outputs: [{ name: "agentId", type: "uint256" }],
  },
  {
    name: "recordActivity", type: "function", stateMutability: "nonpayable",
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "amount",  type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "setStatus", type: "function", stateMutability: "nonpayable",
    inputs: [
      { name: "agentId",   type: "uint256" },
      { name: "newStatus", type: "uint8"   },
    ],
    outputs: [],
  },
  {
    type: "event", name: "AgentRegistered",
    inputs: [
      { name: "agentId",   type: "uint256", indexed: true  },
      { name: "owner",     type: "address", indexed: true  },
      { name: "name",      type: "string",  indexed: false },
      { name: "agentType", type: "string",  indexed: false },
    ],
  },
  {
    type: "event", name: "ActivityRecorded",
    inputs: [
      { name: "agentId",        type: "uint256", indexed: true  },
      { name: "amount",         type: "uint256", indexed: false },
      { name: "newTotalVolume", type: "uint256", indexed: false },
      { name: "newTxCount",     type: "uint256", indexed: false },
    ],
  },
] as const;

export const SPLIT_PAYMENT_ABI = [
  {
    name: "createSplit", type: "function", stateMutability: "nonpayable",
    inputs: [
      { name: "recipients",  type: "address[]" },
      { name: "shares",      type: "uint256[]" },
      { name: "token",       type: "address"   },
      { name: "description", type: "string"    },
    ],
    outputs: [{ name: "splitId", type: "uint256" }],
  },
  {
    name: "distribute", type: "function", stateMutability: "nonpayable",
    inputs: [
      { name: "splitId", type: "uint256" },
      { name: "amount",  type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "deactivate", type: "function", stateMutability: "nonpayable",
    inputs: [{ name: "splitId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "event", name: "SplitCreated",
    inputs: [
      { name: "splitId",     type: "uint256",   indexed: true  },
      { name: "creator",     type: "address",   indexed: true  },
      { name: "token",       type: "address",   indexed: false },
      { name: "recipients",  type: "address[]", indexed: false },
      { name: "shares",      type: "uint256[]", indexed: false },
      { name: "description", type: "string",    indexed: false },
    ],
  },
  {
    type: "event", name: "Distributed",
    inputs: [
      { name: "splitId",     type: "uint256", indexed: true  },
      { name: "distributor", type: "address", indexed: true  },
      { name: "amount",      type: "uint256", indexed: false },
    ],
  },
] as const;

export function parseToken(human: string): bigint {
  return parseUnits(human || "0", 6);
}

export function formatToken(raw: bigint | string): string {
  return formatUnits(typeof raw === "string" ? BigInt(raw) : raw, 6);
}
