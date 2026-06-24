import { wrapFetchWithPayment, x402Client, x402HTTPClient } from "@x402/fetch";
import { registerExactEvmScheme } from "@x402/evm/exact/client";

const ARC_CHAIN_ID = 5042002;
const ARC_RPC = "https://rpc.testnet.arc.network";

const REASON_MESSAGES: Record<string, string> = {
  invalid_exact_evm_insufficient_balance:
    "Insufficient USDC on Arc Testnet. Get testnet funds at faucet.circle.com, then try again.",
  invalid_exact_evm_nonce_already_used:
    "This payment authorization was already used — please retry to generate a new one.",
  invalid_exact_evm_signature:
    "Payment signature invalid. Please reject any pending MetaMask requests and try again.",
  invalid_exact_evm_transaction_simulation_failed:
    "Transaction simulation failed on Arc Testnet. Check your USDC balance and network connection.",
  invalid_exact_evm_eip3009_not_supported:
    "Arc Testnet USDC does not support EIP-3009 transfers (unexpected).",
  invalid_exact_evm_network_mismatch:
    "Network mismatch — ensure MetaMask is connected to Arc Testnet (Chain ID 5042002).",
  invalid_exact_evm_recipient_mismatch:
    "Payment recipient mismatch — the server rejected the authorization.",
  invalid_exact_evm_payload_authorization_valid_before:
    "Payment authorization expired. Please try again.",
};

/**
 * Decode the X-PAYMENT-RESPONSE header from a retry-402 response to get
 * a human-readable error message explaining why the payment was rejected.
 */
export function decode402Error(response: Response, fallback: string): string {
  try {
    const header = response.headers.get("X-PAYMENT-RESPONSE");
    if (!header) return fallback;
    const decoded = JSON.parse(atob(header)) as { error?: string };
    const reason = decoded?.error ?? "";
    return REASON_MESSAGES[reason] ?? (reason ? `Payment rejected: ${reason}` : fallback);
  } catch {
    return fallback;
  }
}

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

      // @metamask/eth-sig-util's sanitizeData() inserts `EIP712Domain: []`
      // (empty) when the key is absent from `types`. This makes MetaMask hash
      // the domain separator with type string "EIP712Domain()" — completely
      // different from viem's inferred 4-field type — causing every signature
      // to fail verification. Inject the correct EIP712Domain explicitly so
      // both sides compute the same domain separator.
      const eip712DomainFields: { name: string; type: string }[] = [];
      if (message.domain.name !== undefined)
        eip712DomainFields.push({ name: "name", type: "string" });
      if (message.domain.version !== undefined)
        eip712DomainFields.push({ name: "version", type: "string" });
      if (message.domain.chainId !== undefined)
        eip712DomainFields.push({ name: "chainId", type: "uint256" });
      if (message.domain.verifyingContract !== undefined)
        eip712DomainFields.push({ name: "verifyingContract", type: "address" });

      const typesWithDomain = { EIP712Domain: eip712DomainFields, ...message.types };

      // BigInt values (value, validAfter, validBefore) must be serialized as
      // decimal strings for eth_signTypedData_v4 — JSON.stringify rejects BigInt.
      const replacer = (_: string, v: unknown) =>
        typeof v === "bigint" ? v.toString() : v;
      return eth.request({
        method: "eth_signTypedData_v4",
        params: [walletAddress, JSON.stringify({ ...message, types: typesWithDomain }, replacer)],
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
