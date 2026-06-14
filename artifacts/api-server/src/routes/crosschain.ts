import { Router } from "express";
import { db, crosschainTransfersTable, activityLogTable } from "@workspace/db";
import { eq, or } from "drizzle-orm";
import {
  ListCrosschainTransfersQueryParams,
  CreateCrosschainTransferBody,
  GetCrosschainTransferParams,
} from "@workspace/api-zod";

const router = Router();

const TX_HASH_RE = /^0x[0-9a-fA-F]{64}$/;

router.get("/", async (req, res) => {
  const query = ListCrosschainTransfersQueryParams.safeParse(req.query);
  if (!query.success) {
    return res.status(400).json({ error: "Invalid query params" });
  }

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
      );
  } else if (query.data.status) {
    rows = await db
      .select()
      .from(crosschainTransfersTable)
      .where(eq(crosschainTransfersTable.status, query.data.status));
  } else {
    rows = await db.select().from(crosschainTransfersTable);
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
    return res.status(400).json({ error: "Invalid body", details: body.error.issues });
  }

  if (!TX_HASH_RE.test(body.data.burnTxHash)) {
    return res.status(400).json({ error: "Invalid burnTxHash format" });
  }

  const [transfer] = await db
    .insert(crosschainTransfersTable)
    .values({
      sender: body.data.sender,
      recipient: body.data.recipient,
      sourceChain: body.data.sourceChain,
      destChain: body.data.destChain,
      token: body.data.token,
      amount: body.data.amount,
      status: "pending",
      burnTxHash: body.data.burnTxHash,
      messageHash: body.data.messageHash ?? null,
      hookData: body.data.hookData ?? null,
      sourceChainId: body.data.sourceChainId ?? 5042002,
      destChainId: body.data.destChainId ?? null,
      chainId: body.data.sourceChainId ?? 5042002,
    })
    .returning();

  await db.insert(activityLogTable).values({
    type: "crosschain_initiated",
    description: `Cross-chain transfer of ${transfer.amount} ${transfer.token} from ${transfer.sourceChain} to ${transfer.destChain} initiated`,
    txHash: transfer.burnTxHash,
    chainId: transfer.chainId,
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

export default router;
