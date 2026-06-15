import { encodeAbiParameters, keccak256, padHex, parseUnits, formatUnits, type Address } from "viem";

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
  CONDITIONAL_ESCROW:  (import.meta.env.VITE_CONDITIONAL_ESCROW_ADDRESS  ?? "0x5c4927C8b3b627415E78a151B68B07A079Bd21c1") as `0x${string}`,
  PAYROLL_VESTING:     (import.meta.env.VITE_PAYROLL_VESTING_ADDRESS     ?? "0xDB7672E26f203a0f37b93042Df150D2E95831387") as `0x${string}`,
  CROSSCHAIN_ESCROW:   (import.meta.env.VITE_CROSSCHAIN_ESCROW_ADDRESS   ?? "0x72923f5f69AeD25aaf92779ceF221342dbE7dfDB") as `0x${string}`,
  USDC:                (import.meta.env.VITE_USDC_ADDRESS                ?? "0x3600000000000000000000000000000000000000") as `0x${string}`,
  EURC:                (import.meta.env.VITE_EURC_ADDRESS                ?? "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a") as `0x${string}`,
  TOKEN_MESSENGER_V2:  "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA" as `0x${string}`,
  MESSAGE_TRANSMITTER_V2: "0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275" as `0x${string}`,
};

export const ERC20_ABI = [
  { name: "approve",     type: "function", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] },
  { name: "allowance",   type: "function", stateMutability: "view",       inputs: [{ name: "owner",   type: "address" }, { name: "spender", type: "address" }], outputs: [{ type: "uint256" }] },
  { name: "balanceOf",   type: "function", stateMutability: "view",       inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
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
  {
    name: "computeReleaseId", type: "function", stateMutability: "pure",
    inputs: [
      { name: "sourceDomain",    type: "uint32"  },
      { name: "messageSender",   type: "bytes32" },
      { name: "finalRecipient",  type: "address" },
      { name: "amount",          type: "uint256" },
      { name: "unlockTimestamp", type: "uint256" },
    ],
    outputs: [{ type: "bytes32" }],
  },
  {
    name: "handleReceiveMessage", type: "function", stateMutability: "nonpayable",
    inputs: [
      { name: "sourceDomain", type: "uint32"  },
      { name: "sender",       type: "bytes32" },
      { name: "messageBody",  type: "bytes"   },
    ],
    outputs: [{ type: "bool" }],
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
  "Ethereum Sepolia": "0x6f9E0D1745079A1C14B6546F13Bfc6ccd3d305E5",
  "Base Sepolia":     null, // deployer wallet needs Base Sepolia ETH — see replit.md
  "Arbitrum Sepolia": "0xfeC8d9ceC403817514dA770832fc92b64E3a3b3e",
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
 * Layout: abi.encode(address finalRecipient, uint256 unlockTimestamp)
 */
export function encodeTimeLockHookData(
  finalRecipient: Address,
  unlockTimestamp: bigint,
): `0x${string}` {
  return encodeAbiParameters(
    [{ type: "address" }, { type: "uint256" }],
    [finalRecipient, unlockTimestamp],
  );
}

/**
 * Pre-compute the releaseId that TimeLockHook will emit in ReleaseScheduled.
 * Matches the on-chain logic in TimeLockHook._computeReleaseId().
 *
 * Call this before broadcasting the burn tx so you can store it with the transfer record.
 *
 * @param sourceDomain       CCTP domain of Arc Testnet (ARC_CCTP_DOMAIN = 26)
 * @param crosschainEscrow   CrosschainEscrow address on Arc (becomes the CCTP messageSender)
 * @param finalRecipient     Address encoded in hookData — who receives USDC after unlock
 * @param amount             Raw USDC amount (6 decimals, same as passed to burn)
 * @param unlockTimestamp    Unix seconds, same value encoded in hookData
 */
export function computeTimeLockReleaseId(
  sourceDomain: number,
  crosschainEscrow: `0x${string}`,
  finalRecipient: Address,
  amount: bigint,
  unlockTimestamp: bigint,
): `0x${string}` {
  // CCTP encodes addresses as left-padded bytes32 (messageSender field in BurnMessageV2)
  const messageSenderBytes32 = padHex(crosschainEscrow, { size: 32 });
  return keccak256(
    encodeAbiParameters(
      [
        { type: "uint32"  },
        { type: "bytes32" },
        { type: "address" },
        { type: "uint256" },
        { type: "uint256" },
      ],
      [sourceDomain, messageSenderBytes32, finalRecipient, amount, unlockTimestamp],
    ),
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

export function parseToken(human: string): bigint {
  return parseUnits(human || "0", 6);
}

export function formatToken(raw: bigint | string): string {
  return formatUnits(typeof raw === "string" ? BigInt(raw) : raw, 6);
}
