import { Router } from "express";
import { logger } from "../lib/logger";

const router = Router();

const IRIS_API_BASE = "https://iris-api-sandbox.circle.com";

router.get("/attestation/:txHash", async (req, res) => {
  const { txHash } = req.params;

  if (!txHash || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    return res.status(400).json({ error: "Invalid txHash format" });
  }

  try {
    const messageHashUrl = `${IRIS_API_BASE}/v1/messages/${txHash}`;
    const msgRes = await fetch(messageHashUrl, {
      headers: { Accept: "application/json" },
    });

    if (!msgRes.ok) {
      if (msgRes.status === 404) {
        return res.status(202).json({
          txHash,
          status: "pending_confirmations",
          messageHash: null,
          attestation: null,
        });
      }
      throw new Error(`IRIS API error: ${msgRes.status}`);
    }

    const msgData = (await msgRes.json()) as { messages?: { messageHash: string; attestation?: string; status?: string }[] };
    const msg = msgData.messages?.[0];

    if (!msg) {
      return res.status(202).json({
        txHash,
        status: "pending_confirmations",
        messageHash: null,
        attestation: null,
      });
    }

    if (msg.attestation && msg.attestation !== "PENDING") {
      return res.json({
        txHash,
        status: "complete",
        messageHash: msg.messageHash,
        attestation: msg.attestation,
      });
    }

    return res.status(202).json({
      txHash,
      status: "pending_confirmations",
      messageHash: msg.messageHash ?? null,
      attestation: null,
    });
  } catch (err) {
    logger.error({ err, txHash }, "CCTP attestation fetch failed");
    return res.status(202).json({
      txHash,
      status: "pending_confirmations",
      messageHash: null,
      attestation: null,
    });
  }
});

export default router;
