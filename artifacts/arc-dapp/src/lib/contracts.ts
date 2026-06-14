import { parseUnits, formatUnits } from "viem";

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
  CONDITIONAL_ESCROW:  (import.meta.env.VITE_CONDITIONAL_ESCROW_ADDRESS  ?? "0xdD38D67Fe054308D56E4458fC47a43106871D874") as `0x${string}`,
  PAYROLL_VESTING:     (import.meta.env.VITE_PAYROLL_VESTING_ADDRESS     ?? "0xd98c4F2819b26d0E346469A808Ff892E87C057B6") as `0x${string}`,
  CROSSCHAIN_ESCROW:   (import.meta.env.VITE_CROSSCHAIN_ESCROW_ADDRESS   ?? "0xcBFc910c6bDD2c8877249E4A658A26A7009c3f8F") as `0x${string}`,
  USDC:                (import.meta.env.VITE_USDC_ADDRESS                ?? "0x3600000000000000000000000000000000000000") as `0x${string}`,
  EURC:                (import.meta.env.VITE_EURC_ADDRESS                ?? "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a") as `0x${string}`,
  // Circle CCTP v2 not yet deployed on Arc Testnet — MockTokenMessengerV2 used instead
  TOKEN_MESSENGER_V2:  "0x4718977f0C6A6D2a52Ec9Ae637e62b8465a2b7EB" as `0x${string}`,
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

export const DEST_DOMAINS: Record<string, number> = {
  "Ethereum Sepolia": 0,
  "Avalanche Fuji":   1,
  "Arbitrum Sepolia": 3,
  "Base Sepolia":     6,
};

export function parseToken(human: string): bigint {
  return parseUnits(human || "0", 6);
}

export function formatToken(raw: bigint | string): string {
  return formatUnits(typeof raw === "string" ? BigInt(raw) : raw, 6);
}
