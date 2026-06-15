import { Router } from "express";
import { logger } from "../lib/logger";

const router = Router();

const BRIDGE_BASE = "https://arc-relay-bridge.replit.app";
const ARC_SRC_DOMAIN = 26;
const RELAY_FEE = "1000000"; // 1 USDC covers gas on destination chain

// Maps CCTP destination domain → chain info for frontend
const DOMAIN_TO_CHAIN: Record<number, { chain: string; chainId: number; explorerBase: string; explorerTx: string }> = {
  0: { chain: "Ethereum Sepolia", chainId: 11155111, explorerBase: "https://sepolia.etherscan.io/address", explorerTx: "https://sepolia.etherscan.io/tx" },
  3: { chain: "Arbitrum Sepolia", chainId: 421614,   explorerBase: "https://sepolia.arbiscan.io/address",  explorerTx: "https://sepolia.arbiscan.io/tx"  },
  6: { chain: "Base Sepolia",     chainId: 84532,    explorerBase: "https://sepolia.basescan.org/address", explorerTx: "https://sepolia.basescan.org/tx" },
};

interface BridgeMessage {
  attestation: string;
  message: string;
  status: string;
  decodedMessage?: {
    destinationDomain?: string;
    decodedMessageBody?: {
      mintRecipient?: string;
      amount?: string;
    };
  };
}

// Fetch attestation + message bytes from arc-relay-bridge (supports Arc domain 26)
async function fetchBridgeAttestation(txHash: string): Promise<BridgeMessage | null> {
  const url = `${BRIDGE_BASE}/api/attest?domain=${ARC_SRC_DOMAIN}&txHash=${txHash}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) return null;
  const data = (await res.json()) as { messages?: BridgeMessage[] };
  const msg = data.messages?.[0];
  if (!msg) return null;
  return msg;
}

// GET /attestation/:txHash
// Returns attestation status, message bytes, and receive target for a given Arc burn tx
router.get("/attestation/:txHash", async (req, res) => {
  const { txHash } = req.params;

  if (!txHash || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    return res.status(400).json({ error: "Invalid txHash format" });
  }

  try {
    const msg = await fetchBridgeAttestation(txHash);

    if (!msg) {
      return res.status(202).json({
        txHash,
        status: "pending_confirmations",
        messageBytes: null,
        attestation: null,
        receiveTarget: null,
        relayFeeUsdc: null,
      });
    }

    const destDomain = parseInt(msg.decodedMessage?.destinationDomain ?? "-1", 10);
    const receiveTarget = DOMAIN_TO_CHAIN[destDomain] ?? null;
    const mintRecipient = msg.decodedMessage?.decodedMessageBody?.mintRecipient ?? null;
    const isComplete = msg.status === "complete" && !!msg.attestation && msg.attestation !== "PENDING";

    return res.status(isComplete ? 200 : 202).json({
      txHash,
      status: isComplete ? "complete" : "pending_confirmations",
      messageBytes: msg.message ?? null,
      attestation: isComplete ? msg.attestation : null,
      receiveTarget,
      mintRecipient,
      relayFeeUsdc: "1.00", // bridge charges 1 USDC for gas-free relay
    });
  } catch (err) {
    logger.error({ err, txHash }, "CCTP attestation fetch failed");
    return res.status(202).json({
      txHash,
      status: "pending_confirmations",
      messageBytes: null,
      attestation: null,
      receiveTarget: null,
      relayFeeUsdc: null,
    });
  }
});

// POST /relay
// Gas-free relay: arc-relay-bridge server mints USDC on destination (1 USDC fee)
// Body: { burnTxHash } — server fetches attestation and relays
router.post("/relay", async (req, res) => {
  const { burnTxHash } = req.body as { burnTxHash?: string };

  if (!burnTxHash || !/^0x[0-9a-fA-F]{64}$/.test(burnTxHash)) {
    return res.status(400).json({ error: "Invalid burnTxHash" });
  }

  try {
    // 1. Fetch attestation from bridge
    const msg = await fetchBridgeAttestation(burnTxHash);
    if (!msg || msg.status !== "complete" || !msg.attestation) {
      return res.status(202).json({ error: "Attestation not yet ready" });
    }

    const destDomain = parseInt(msg.decodedMessage?.destinationDomain ?? "-1", 10);
    const chainInfo  = DOMAIN_TO_CHAIN[destDomain];
    if (!chainInfo) {
      return res.status(400).json({ error: `Unknown destination domain: ${destDomain}` });
    }

    const mintRecipient = msg.decodedMessage?.decodedMessageBody?.mintRecipient ?? "0x0000000000000000000000000000000000000000";

    // 2. Submit gas-free relay via bridge
    const relayRes = await fetch(`${BRIDGE_BASE}/api/relay`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message:     msg.message,
        attestation: msg.attestation,
        recipient:   mintRecipient,
        destChainId: chainInfo.chainId,
        maxFee:      RELAY_FEE,
      }),
    });

    const relayData = (await relayRes.json()) as { txHash?: string; error?: string };

    if (!relayRes.ok || !relayData.txHash) {
      logger.error({ relayData, burnTxHash }, "Bridge relay failed");
      return res.status(502).json({ error: relayData.error ?? "Relay failed" });
    }

    return res.json({
      txHash:    relayData.txHash,
      chain:     chainInfo.chain,
      explorerTx: chainInfo.explorerTx,
    });
  } catch (err) {
    logger.error({ err, burnTxHash }, "CCTP relay failed");
    return res.status(500).json({ error: "Relay request failed" });
  }
});

export default router;
