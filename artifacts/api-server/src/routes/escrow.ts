import { Router } from "express";
import { db, escrowsTable, activityLogTable } from "@workspace/db";
import { eq, or } from "drizzle-orm";
import {
  ListEscrowsQueryParams,
  CreateEscrowBody,
  GetEscrowParams,
  DisputeEscrowParams,
  DisputeEscrowBody,
  ReleaseEscrowParams,
  ReleaseEscrowBody,
} from "@workspace/api-zod";

const router = Router();

router.get("/", async (req, res) => {
  const query = ListEscrowsQueryParams.safeParse(req.query);
  if (!query.success) {
    return res.status(400).json({ error: "Invalid query params" });
  }

  let rows;
  if (query.data.address) {
    rows = await db
      .select()
      .from(escrowsTable)
      .where(
        or(
          eq(escrowsTable.depositor, query.data.address),
          eq(escrowsTable.beneficiary, query.data.address)
        )
      );
  } else if (query.data.status) {
    rows = await db
      .select()
      .from(escrowsTable)
      .where(eq(escrowsTable.status, query.data.status));
  } else {
    rows = await db.select().from(escrowsTable);
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
  const body = CreateEscrowBody.safeParse(req.body);
  if (!body.success) {
    return res.status(400).json({ error: "Invalid body", details: body.error.issues });
  }

  const [escrow] = await db
    .insert(escrowsTable)
    .values({
      depositor: body.data.depositor,
      beneficiary: body.data.beneficiary,
      arbiter: body.data.arbiter,
      token: body.data.token,
      amount: body.data.amount,
      releaseTime: body.data.releaseTime,
      status: "active",
      conditionType: body.data.conditionType ?? null,
      conditionData: body.data.conditionData ?? null,
      contractAddress: body.data.contractAddress,
      txHash: body.data.txHash,
      chainId: body.data.chainId ?? 5042002,
    })
    .returning();

  await db.insert(activityLogTable).values({
    type: "escrow_created",
    description: `Escrow of ${escrow.amount} ${escrow.token} created between ${escrow.depositor.slice(0, 8)}... and ${escrow.beneficiary.slice(0, 8)}...`,
    txHash: escrow.txHash,
    chainId: escrow.chainId,
  });

  return res.status(201).json({
    ...escrow,
    createdAt: escrow.createdAt.toISOString(),
    updatedAt: escrow.updatedAt.toISOString(),
  });
});

router.get("/:id", async (req, res) => {
  const params = GetEscrowParams.safeParse({ id: Number(req.params.id) });
  if (!params.success) {
    return res.status(400).json({ error: "Invalid id" });
  }

  const [escrow] = await db
    .select()
    .from(escrowsTable)
    .where(eq(escrowsTable.id, params.data.id));

  if (!escrow) return res.status(404).json({ error: "Not found" });

  return res.json({
    ...escrow,
    createdAt: escrow.createdAt.toISOString(),
    updatedAt: escrow.updatedAt.toISOString(),
  });
});

router.post("/:id/dispute", async (req, res) => {
  const params = DisputeEscrowParams.safeParse({ id: Number(req.params.id) });
  const body = DisputeEscrowBody.safeParse(req.body);
  if (!params.success || !body.success) {
    return res.status(400).json({ error: "Invalid input" });
  }

  const [escrow] = await db
    .update(escrowsTable)
    .set({
      status: "disputed",
      disputeTxHash: body.data.txHash,
      disputeReason: body.data.reason,
    })
    .where(eq(escrowsTable.id, params.data.id))
    .returning();

  if (!escrow) return res.status(404).json({ error: "Not found" });

  await db.insert(activityLogTable).values({
    type: "escrow_disputed",
    description: `Dispute raised on escrow #${escrow.id}: "${body.data.reason}"`,
    txHash: body.data.txHash,
    chainId: escrow.chainId,
  });

  return res.json({
    ...escrow,
    createdAt: escrow.createdAt.toISOString(),
    updatedAt: escrow.updatedAt.toISOString(),
  });
});

router.post("/:id/release", async (req, res) => {
  const params = ReleaseEscrowParams.safeParse({ id: Number(req.params.id) });
  const body = ReleaseEscrowBody.safeParse(req.body);
  if (!params.success || !body.success) {
    return res.status(400).json({ error: "Invalid input" });
  }

  const newStatus = body.data.resolution === "beneficiary" ? "released" : "resolved";

  const [escrow] = await db
    .update(escrowsTable)
    .set({
      status: newStatus,
      releaseTxHash: body.data.txHash,
    })
    .where(eq(escrowsTable.id, params.data.id))
    .returning();

  if (!escrow) return res.status(404).json({ error: "Not found" });

  await db.insert(activityLogTable).values({
    type: "escrow_released",
    description: `Escrow #${escrow.id} resolved — funds sent to ${body.data.resolution}`,
    txHash: body.data.txHash,
    chainId: escrow.chainId,
  });

  return res.json({
    ...escrow,
    createdAt: escrow.createdAt.toISOString(),
    updatedAt: escrow.updatedAt.toISOString(),
  });
});

export default router;
