import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { x402Facilitator } from "@x402/core/facilitator";
import { registerExactEvmScheme as registerFacilitatorScheme } from "@x402/evm/exact/facilitator";
import { ExactEvmScheme as ServerExactEvmScheme } from "@x402/evm/exact/server";
import { toFacilitatorEvmSigner } from "@x402/evm";
import { x402ResourceServer } from "@x402/core/server";
import { paymentMiddleware } from "@x402/express";
import type { RequestHandler } from "express";
import { logger } from "./logger";

const ARC_CHAIN_ID = 5042002;
const ARC_RPC = "https://rpc.testnet.arc.network";
export const ARC_USDC = "0x3600000000000000000000000000000000000000" as const;
export const X402_NETWORK = `eip155:${ARC_CHAIN_ID}` as const;

const arcTestnet = {
  id: ARC_CHAIN_ID,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 6 },
  rpcUrls: { default: { http: [ARC_RPC] }, public: { http: [ARC_RPC] } },
} as const;

export function buildX402Middleware(): RequestHandler | null {
  const rawKey = process.env.DEPLOYER_PRIVATE_KEY;
  if (!rawKey) {
    logger.warn("DEPLOYER_PRIVATE_KEY not set — x402 payment middleware disabled");
    return null;
  }

  const privKey = (rawKey.startsWith("0x") ? rawKey : `0x${rawKey}`) as `0x${string}`;
  const account = privateKeyToAccount(privKey);

  const publicClient = createPublicClient({
    chain: arcTestnet as any,
    transport: http(ARC_RPC),
  });

  const walletClient = createWalletClient({
    account,
    chain: arcTestnet as any,
    transport: http(ARC_RPC),
  });

  const combinedSigner = {
    address:                   account.address,
    signTypedData:             (args: any) => walletClient.signTypedData({ account, ...args } as any),
    verifyTypedData:           (args: any) => publicClient.verifyTypedData(args as any),
    writeContract:             (args: any) => walletClient.writeContract({ account, ...args } as any),
    waitForTransactionReceipt: (args: any) => publicClient.waitForTransactionReceipt(args),
    getLogs:                   (args: any) => publicClient.getLogs(args as any),
    readContract:              (args: any) => publicClient.readContract(args as any),
    getCode:                   (args: any) => publicClient.getCode(args as any),
  };

  const signer = toFacilitatorEvmSigner(combinedSigner as any);

  const facilitator = new x402Facilitator();
  registerFacilitatorScheme(facilitator, { signer, networks: X402_NETWORK });

  const facilitatorClient = {
    verify: async (...args: Parameters<typeof facilitator.verify>) => {
      const result = await facilitator.verify(...args);
      if (!result.isValid) {
        logger.warn(
          { invalidReason: result.invalidReason, payer: result.payer },
          "x402 payment verification failed",
        );
      }
      return result;
    },
    settle: async (...args: Parameters<typeof facilitator.settle>) => {
      const result = await facilitator.settle(...args);
      if (!result.success) {
        logger.warn(
          { errorReason: result.errorReason, payer: result.payer },
          "x402 payment settlement failed",
        );
      }
      return result;
    },
    getSupported: () => Promise.resolve(facilitator.getSupported()),
  };

  const resourceServer = new x402ResourceServer(facilitatorClient as any);

  const serverScheme = new ServerExactEvmScheme();
  serverScheme.registerMoneyParser(async (amount, network) => {
    if (network === X402_NETWORK) {
      return {
        amount: Math.round(amount * 1_000_000).toString(),
        asset:  ARC_USDC,
      };
    }
    return null;
  });
  resourceServer.register(X402_NETWORK, serverScheme);

  // Arc Testnet USDC EIP-712 domain (read from 0x3600...0000 via eth_call):
  //   name()    → "USDC"
  //   version() → "2"
  // The x402 exact client reads extra.name + extra.version to construct the
  // EIP-712 domain for the TransferWithAuthorization typed-data signature.
  const arcUsdcExtra = { name: "USDC", version: "2" };

  const routes = {
    "GET /api/escrows/:id/oracle-check": {
      description: "CoinGecko price oracle check — 0.01 USDC per call",
      accepts: [{
        scheme:            "exact",
        network:           X402_NETWORK,
        payTo:             account.address,
        price:             "$0.01",
        maxTimeoutSeconds: 60,
        extra:             arcUsdcExtra,
      }],
    },
    "GET /api/cctp/attestation/:txHash": {
      description: "Circle IRIS CCTP attestation poll — 0.05 USDC per call",
      accepts: [{
        scheme:            "exact",
        network:           X402_NETWORK,
        payTo:             account.address,
        price:             "$0.05",
        maxTimeoutSeconds: 60,
        extra:             arcUsdcExtra,
      }],
    },
  };

  logger.info(
    { recipient: account.address, network: X402_NETWORK, routes: Object.keys(routes) },
    "x402 payment middleware enabled",
  );

  return paymentMiddleware(routes as any, resourceServer) as unknown as RequestHandler;
}
