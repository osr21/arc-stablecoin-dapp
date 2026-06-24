import { wrapFetchWithPayment, x402Client, x402HTTPClient } from "@x402/fetch";
import { registerExactEvmScheme } from "@x402/evm/exact/client";

const ARC_CHAIN_ID = 5042002;
const ARC_RPC = "https://rpc.testnet.arc.network";

export const X402_PRICES = {
  oracleCheck: "0.01",
  attestation: "0.05",
} as const;

export const X402_PRICE_LABELS = {
  oracleCheck: "0.01 USDC",
  attestation: "0.05 USDC",
} as const;

/**
 * Builds an x402-capable fetch that automatically handles HTTP 402 responses
 * by prompting the connected MetaMask wallet to sign an EIP-3009 authorization.
 * The facilitator (embedded in our API server) then settles the USDC transfer
 * on Arc Testnet and serves the actual response.
 */
export function buildX402Fetch(walletAddress: `0x${string}`): typeof globalThis.fetch {
  const signer = {
    address: walletAddress,
    signTypedData: async (message: {
      domain: Record<string, unknown>;
      types: Record<string, unknown>;
      primaryType: string;
      message: Record<string, unknown>;
    }) => {
      const eth = (window as any).ethereum;
      if (!eth) throw new Error("MetaMask not found");
      return eth.request({
        method: "eth_signTypedData_v4",
        params: [walletAddress, JSON.stringify(message)],
      }) as Promise<`0x${string}`>;
    },
  };

  const client = new x402Client();
  registerExactEvmScheme(client, {
    signer: signer as any,
    networks: [`eip155:${ARC_CHAIN_ID}`],
    schemeOptions: { [ARC_CHAIN_ID]: { rpcUrl: ARC_RPC } },
  });

  const httpClient = new x402HTTPClient(client);
  return wrapFetchWithPayment(globalThis.fetch.bind(globalThis), httpClient) as typeof globalThis.fetch;
}
