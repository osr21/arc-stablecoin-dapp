import { Router } from "express";
import { keccak256 } from "viem";
import { logger } from "../lib/logger";

const router = Router();

const IRIS_API_BASE = "https://iris-api-sandbox.circle.com";
const ARC_RPC = "https://rpc.testnet.arc.network";
const MESSAGE_SENT_TOPIC =
  "0x8c5261668696ce22758910d05bab8f186d6eb247ceac2af2e82c7dc17669b036";
// 0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275 — same CREATE2 address on all chains
const MESSAGE_TRANSMITTER_V2 =
  "0xe737e5cebeeba77efe34d4aa090756590b1ce275";

// Receive target: Ethereum Sepolia MessageTransmitterV2 (same address as Arc — Circle CREATE2 deployment)
const RECEIVE_TARGET_BY_DOMAIN: Record<number, { chain: string; address: string; explorerBase: string }> = {
  0: { chain: "Ethereum Sepolia", address: "0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275", explorerBase: "https://sepolia.etherscan.io/address" },
  3: { chain: "Arbitrum Sepolia", address: "0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275", explorerBase: "https://sepolia.arbiscan.io/address" },
  6: { chain: "Base Sepolia",     address: "0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275", explorerBase: "https://sepolia.basescan.org/address" },
};

function decodeMsgSentLog(data: string): `0x${string}` | null {
  try {
    const hex = data.replace("0x", "");
    const len = parseInt(hex.slice(64, 128), 16);
    return ("0x" + hex.slice(128, 128 + len * 2)) as `0x${string}`;
  } catch {
    return null;
  }
}

async function fetchMessageBytes(txHash: string): Promise<{
  messageBytes: `0x${string}`;
  destinationDomain: number;
} | null> {
  const resp = await fetch(ARC_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "eth_getTransactionReceipt",
      params: [txHash],
      id: 1,
    }),
  });
  const json = (await resp.json()) as { result?: { logs?: { address: string; topics: string[]; data: string }[] } };
  const logs = json.result?.logs ?? [];

  const log =
    logs.find(
      (l) =>
        l.address?.toLowerCase() === MESSAGE_TRANSMITTER_V2 &&
        l.topics?.[0] === MESSAGE_SENT_TOPIC
    ) ?? logs.find((l) => l.topics?.[0] === MESSAGE_SENT_TOPIC);
  if (!log) return null;

  const messageBytes = decodeMsgSentLog(log.data);
  if (!messageBytes) return null;

  // Parse destination domain from message: version(4) srcDomain(4) destDomain(4) ...
  const msgHex = messageBytes.replace("0x", "");
  const destinationDomain = parseInt(msgHex.slice(16, 24), 16);

  return { messageBytes, destinationDomain };
}

router.get("/attestation/:txHash", async (req, res) => {
  const { txHash } = req.params;

  if (!txHash || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    return res.status(400).json({ error: "Invalid txHash format" });
  }

  try {
    // Step 1: Get message bytes from Arc transaction receipt
    const msgResult = await fetchMessageBytes(txHash);
    if (!msgResult) {
      return res.status(202).json({
        txHash,
        status: "pending_confirmations",
        messageHash: null,
        messageBytes: null,
        attestation: null,
        receiveTarget: null,
      });
    }

    const { messageBytes, destinationDomain } = msgResult;

    // Step 2: Compute keccak256(messageBytes) = messageHash for IRIS lookup
    const msgBuf = Buffer.from(messageBytes.replace("0x", ""), "hex");
    const messageHash = keccak256(msgBuf as unknown as `0x${string}`);

    // Step 3: Query IRIS attestations endpoint
    const irisUrl = `${IRIS_API_BASE}/attestations/${messageHash}`;
    const irisRes = await fetch(irisUrl, {
      headers: { Accept: "application/json" },
    });

    const irisData = (await irisRes.json()) as { status?: string; attestation?: string; error?: string };

    const receiveTarget = RECEIVE_TARGET_BY_DOMAIN[destinationDomain] ?? null;

    if (irisData.attestation && irisData.attestation !== "PENDING") {
      return res.json({
        txHash,
        status: "complete",
        messageHash,
        messageBytes,
        attestation: irisData.attestation,
        receiveTarget,
      });
    }

    const pending = irisData.status === "pending_confirmations" || irisData.error === "Message hash not found";
    return res.status(202).json({
      txHash,
      status: pending ? "pending_confirmations" : (irisData.status ?? "pending_confirmations"),
      messageHash,
      messageBytes,
      attestation: null,
      receiveTarget,
    });
  } catch (err) {
    logger.error({ err, txHash }, "CCTP attestation fetch failed");
    return res.status(202).json({
      txHash,
      status: "pending_confirmations",
      messageHash: null,
      messageBytes: null,
      attestation: null,
      receiveTarget: null,
    });
  }
});

export default router;
