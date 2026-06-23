import { Router } from "express";
import { db, crosschainTransfersTable, activityLogTable } from "@workspace/db";
import { eq, or, and } from "drizzle-orm";
import {
  ListCrosschainTransfersQueryParams,
  CreateCrosschainTransferBody,
  GetCrosschainTransferParams,
  UpdateCrosschainTransferStatusParams,
  UpdateCrosschainTransferStatusBody,
} from "@workspace/api-zod";

const VALID_TRANSITIONS: Record<string, string[]> = {
  pending:   ["attesting", "failed"],
  attesting: ["complete", "failed"],
  complete:  [],
  failed:    [],
};

const router = Router();

const TX_HASH_RE  = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS_RE  = /^0x[0-9a-fA-F]{40}$/i;

router.get("/", async (req, res) => {
  const query = ListCrosschainTransfersQueryParams.safeParse(req.query);
  if (!query.success) {
    return res.status(400).json({ error: "Invalid query params" });
  }

  const PAGE_LIMIT = 500;
  let rows;
  if (query.data.address) {
    rows = await db
      .select()
      .from(crosschainTransfersTable)
      .where(
        or(
          eq(crosschainTransfersTable.sender, query.data.address),
          eq(crosschainTransfersTable.recipient, query.data.address)
        )
      )
      .limit(PAGE_LIMIT);
  } else if (query.data.status) {
    rows = await db
      .select()
      .from(crosschainTransfersTable)
      .where(eq(crosschainTransfersTable.status, query.data.status))
      .limit(PAGE_LIMIT);
  } else {
    rows = await db.select().from(crosschainTransfersTable).limit(PAGE_LIMIT);
  }

  return res.json(
    rows.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }))
  );
});

router.post("/", async (req, res) => {
  const body = CreateCrosschainTransferBody.safeParse(req.body);
  if (!body.success) {
    return res.status(400).json({ error: "Invalid body" });
  }

  if (!TX_HASH_RE.test(body.data.burnTxHash)) {
    return res.status(400).json({ error: "Invalid burnTxHash format" });
  }

  if (!ADDRESS_RE.test(body.data.sender)) {
    return res.status(400).json({ error: "Invalid sender address format" });
  }

  if (!ADDRESS_RE.test(body.data.recipient)) {
    return res.status(400).json({ error: "Invalid recipient address format" });
  }

  const [transfer] = await db
    .insert(crosschainTransfersTable)
    .values({
      sender:        body.data.sender.toLowerCase(),
      recipient:     body.data.recipient.toLowerCase(),
      sourceChain:   body.data.sourceChain,
      destChain:     body.data.destChain,
      token:         body.data.token,
      amount:        body.data.amount,
      status:        "pending",
      burnTxHash:    body.data.burnTxHash,
      messageHash:   body.data.messageHash ?? null,
      hookData:      body.data.hookData ?? null,
      sourceChainId: body.data.sourceChainId ?? 5042002,
      destChainId:   body.data.destChainId ?? null,
      chainId:       body.data.sourceChainId ?? 5042002,
    })
    .returning();

  await db.insert(activityLogTable).values({
    type:        "crosschain_initiated",
    description: `Cross-chain transfer of ${transfer.amount} ${transfer.token} from ${transfer.sourceChain} to ${transfer.destChain} initiated`,
    txHash:      transfer.burnTxHash,
    chainId:     transfer.chainId,
  });

  return res.status(201).json({
    ...transfer,
    createdAt: transfer.createdAt.toISOString(),
    updatedAt: transfer.updatedAt.toISOString(),
  });
});

router.get("/:id", async (req, res) => {
  const params = GetCrosschainTransferParams.safeParse({ id: Number(req.params.id) });
  if (!params.success) return res.status(400).json({ error: "Invalid id" });

  const [transfer] = await db
    .select()
    .from(crosschainTransfersTable)
    .where(eq(crosschainTransfersTable.id, params.data.id));

  if (!transfer) return res.status(404).json({ error: "Not found" });

  return res.json({
    ...transfer,
    createdAt: transfer.createdAt.toISOString(),
    updatedAt: transfer.updatedAt.toISOString(),
  });
});

router.patch("/:id", async (req, res) => {
  const params = UpdateCrosschainTransferStatusParams.safeParse({ id: Number(req.params.id) });
  if (!params.success) return res.status(400).json({ error: "Invalid id" });

  const body = UpdateCrosschainTransferStatusBody.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "Invalid body" });

  // Caller must identify as the original sender — prevents IDOR from arbitrary clients.
  const caller = typeof req.body.caller === "string" ? req.body.caller.toLowerCase() : null;
  if (!caller || !ADDRESS_RE.test(caller)) {
    return res.status(400).json({ error: "Missing or invalid caller address" });
  }

  const [existing] = await db
    .select()
    .from(crosschainTransfersTable)
    .where(eq(crosschainTransfersTable.id, params.data.id));

  if (!existing) return res.status(404).json({ error: "Not found" });

  if (existing.sender.toLowerCase() !== caller) {
    return res.status(403).json({ error: "Caller is not the transfer sender" });
  }

  const allowed = VALID_TRANSITIONS[existing.status] ?? [];
  if (!allowed.includes(body.data.status)) {
    return res.status(409).json({
      error: `Invalid transition: ${existing.status} → ${body.data.status}`,
    });
  }

  if (body.data.mintTxHash && !TX_HASH_RE.test(body.data.mintTxHash)) {
    return res.status(400).json({ error: "Invalid mintTxHash format" });
  }

  // If a releaseId is supplied, merge it into the hookData JSON so it
  // survives browser cache clears (frontend reads it back from DB on mount).
  let updatedHookData = existing.hookData;
  const releaseId = typeof req.body.releaseId === "string" ? req.body.releaseId : null;
  if (releaseId && /^0x[0-9a-fA-F]+$/.test(releaseId)) {
    try {
      const parsed = existing.hookData ? (JSON.parse(existing.hookData) as Record<string, unknown>) : {};
      parsed.releaseId = releaseId;
      updatedHookData = JSON.stringify(parsed);
    } catch {
      // leave hookData unchanged if parsing fails
    }
  }

  const [updated] = await db
    .update(crosschainTransfersTable)
    .set({
      status:     body.data.status,
      mintTxHash: body.data.mintTxHash ?? existing.mintTxHash,
      hookData:   updatedHookData,
      updatedAt:  new Date(),
    })
    .where(and(
      eq(crosschainTransfersTable.id, params.data.id),
      eq(crosschainTransfersTable.status, existing.status),
    ))
    .returning();

  if (!updated) {
    return res.status(409).json({ error: "Status changed concurrently — please retry" });
  }

  if (body.data.status === "complete") {
    await db.insert(activityLogTable).values({
      type:        "crosschain_complete",
      description: `Cross-chain transfer of ${updated.amount} ${updated.token} from ${updated.sourceChain} to ${updated.destChain} completed`,
      txHash:      body.data.mintTxHash ?? updated.burnTxHash,
      chainId:     updated.chainId,
    });
  }

  return res.json({
    ...updated,
    createdAt: updated.createdAt.toISOString(),
    updatedAt: updated.updatedAt.toISOString(),
  });
});

export default router;
