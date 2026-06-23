import { Router } from "express";
import { logger } from "../lib/logger";

const router = Router();

const BRIDGE_BASE   = "https://arc-relay-bridge.replit.app";
const ARC_SRC_DOMAIN = 26;

// Maps CCTP destination domain → chain info for frontend
const DOMAIN_TO_CHAIN: Record<number, { chain: string; chainId: number; explorerBase: string; explorerTx: string }> = {
  0: { chain: "Ethereum Sepolia", chainId: 11155111, explorerBase: "https://sepolia.etherscan.io/address",  explorerTx: "https://sepolia.etherscan.io/tx"  },
  3: { chain: "Arbitrum Sepolia", chainId: 421614,   explorerBase: "https://sepolia.arbiscan.io/address",   explorerTx: "https://sepolia.arbiscan.io/tx"   },
  6: { chain: "Base Sepolia",     chainId: 84532,    explorerBase: "https://sepolia.basescan.org/address",  explorerTx: "https://sepolia.basescan.org/tx"  },
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

async function fetchBridgeAttestation(txHash: string): Promise<BridgeMessage | null> {
  const url = `${BRIDGE_BASE}/api/attest?domain=${ARC_SRC_DOMAIN}&txHash=${txHash}`;
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    signal:  AbortSignal.timeout(10_000),
  });
  if (!res.ok) return null;
  // Cap response body to 64 KB to prevent unbounded memory usage if the bridge misbehaves.
  const text = await res.text();
  if (text.length > 65_536) return null;
  const data = JSON.parse(text) as { messages?: BridgeMessage[] };
  const msg = data.messages?.[0];
  if (!msg) return null;
  return msg;
}

// GET /attestation/:txHash
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
        status:       "pending_confirmations",
        messageBytes: null,
        attestation:  null,
        receiveTarget: null,
      });
    }

    const destDomain    = parseInt(msg.decodedMessage?.destinationDomain ?? "-1", 10);
    const receiveTarget = DOMAIN_TO_CHAIN[destDomain] ?? null;
    const mintRecipient = msg.decodedMessage?.decodedMessageBody?.mintRecipient ?? null;
    const isComplete    = msg.status === "complete" && !!msg.attestation && msg.attestation !== "PENDING";

    return res.status(isComplete ? 200 : 202).json({
      txHash,
      status:        isComplete ? "complete" : "pending_confirmations",
      messageBytes:  msg.message ?? null,
      attestation:   isComplete ? msg.attestation : null,
      receiveTarget,
      mintRecipient,
    });
  } catch (err) {
    logger.error({ err, txHash }, "CCTP attestation fetch failed");
    // Return 500 so the frontend knows this is a server error, not just "still pending".
    return res.status(500).json({ error: "Attestation service temporarily unavailable" });
  }
});

export default router;
