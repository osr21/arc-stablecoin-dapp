import { Router } from "express";
import { createWalletClient, createPublicClient, http, getAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { X402SendBody } from "@workspace/api-zod";

const ARC_RPC = "https://rpc.testnet.arc.network";
const USDC_ADDRESS = "0x3600000000000000000000000000000000000000" as `0x${string}`;

const arcTestnet = {
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 6 },
  rpcUrls: { default: { http: [ARC_RPC] }, public: { http: [ARC_RPC] } },
} as const;

const USDC_TRANSFER_AUTH_ABI = [
  {
    name: "transferWithAuthorization",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "from",        type: "address" },
      { name: "to",          type: "address" },
      { name: "value",       type: "uint256" },
      { name: "validAfter",  type: "uint256" },
      { name: "validBefore", type: "uint256" },
      { name: "nonce",       type: "bytes32" },
      { name: "v",           type: "uint8"   },
      { name: "r",           type: "bytes32" },
      { name: "s",           type: "bytes32" },
    ],
    outputs: [],
  },
] as const;


const router = Router();

router.post("/send", async (req, res) => {
  const body = X402SendBody.safeParse(req.body);
  if (!body.success) {
    return res.status(400).json({ error: "Invalid request body" });
  }

  const rawKey = process.env.DEPLOYER_PRIVATE_KEY;
  if (!rawKey) {
    return res.status(503).json({ error: "Payment relay not configured — DEPLOYER_PRIVATE_KEY missing" });
  }

  const { from, to, value, validAfter, validBefore, nonce, signature } = body.data;

  const r = `0x${signature.slice(2, 66)}`   as `0x${string}`;
  const s = `0x${signature.slice(66, 130)}`  as `0x${string}`;
  const v = parseInt(signature.slice(130, 132), 16);

  const privKey = (rawKey.startsWith("0x") ? rawKey : `0x${rawKey}`) as `0x${string}`;
  const account = privateKeyToAccount(privKey);

  const walletClient = createWalletClient({
    account,
    chain: arcTestnet as any,
    transport: http(ARC_RPC),
  });

  const publicClient = createPublicClient({
    chain: arcTestnet as any,
    transport: http(ARC_RPC),
  });

  try {
    const txHash = await walletClient.writeContract({
      chain: null,
      address: USDC_ADDRESS,
      abi: USDC_TRANSFER_AUTH_ABI,
      functionName: "transferWithAuthorization",
      args: [
        getAddress(from),
        getAddress(to),
        BigInt(value),
        BigInt(validAfter),
        BigInt(validBefore),
        nonce as `0x${string}`,
        v,
        r,
        s,
      ],
    });

    req.log.info({ txHash, from, to, value }, "x402 transferWithAuthorization submitted");

    const receipt = await publicClient.waitForTransactionReceipt({
      hash: txHash,
      timeout: 30_000,
    });

    if (receipt.status === "reverted") {
      req.log.warn({ txHash, from, to, value }, "x402 transferWithAuthorization reverted");
      return res.status(422).json({
        error: "Transaction reverted on-chain. Check that the authorization nonce has not been used before.",
        txHash,
      });
    }

    req.log.info({ txHash, from, to, value, blockNumber: receipt.blockNumber.toString() }, "x402 transfer confirmed");

    return res.json({
      txHash,
      from:        getAddress(from),
      to:          getAddress(to),
      value,
      blockNumber: receipt.blockNumber.toString(),
      status:      "success",
    });
  } catch (err: any) {
    req.log.error({ err, from, to, value }, "x402 transferWithAuthorization failed");
    const message = err?.shortMessage ?? err?.message ?? "Transfer failed";
    return res.status(500).json({ error: message });
  }
});

export default router;
