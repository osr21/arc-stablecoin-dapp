import { Router } from "express";
import { db, fxForwardsTable, activityLogTable } from "@workspace/db";
import { eq, or, and } from "drizzle-orm";
import {
  ListFxForwardsQueryParams,
  CreateFxForwardBody,
  GetFxForwardParams,
  FundFxForwardParams,
  FundFxForwardBody,
  SettleFxForwardParams,
  SettleFxForwardBody,
  CancelFxForwardParams,
  CancelFxForwardBody,
} from "@workspace/api-zod";

const router = Router();

const TX_HASH_RE  = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS_RE  = /^0x[0-9a-fA-F]{40}$/i;

function fmt(row: typeof fxForwardsTable.$inferSelect) {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

router.get("/", async (req, res) => {
  const query = ListFxForwardsQueryParams.safeParse(req.query);
  if (!query.success) return res.status(400).json({ error: "Invalid query params" });

  const PAGE_LIMIT = 500;
  let rows;
  if (query.data.address) {
    rows = await db.select().from(fxForwardsTable)
      .where(or(eq(fxForwardsTable.partyA, query.data.address), eq(fxForwardsTable.partyB, query.data.address)))
      .limit(PAGE_LIMIT);
  } else if (query.data.status) {
    rows = await db.select().from(fxForwardsTable)
      .where(eq(fxForwardsTable.status, query.data.status))
      .limit(PAGE_LIMIT);
  } else {
    rows = await db.select().from(fxForwardsTable).limit(PAGE_LIMIT);
  }

  return res.json(rows.map(fmt));
});

router.post("/", async (req, res) => {
  const body = CreateFxForwardBody.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "Invalid body" });

  if (!TX_HASH_RE.test(body.data.txHash))    return res.status(400).json({ error: "Invalid txHash" });
  if (!ADDRESS_RE.test(body.data.partyA))    return res.status(400).json({ error: "Invalid partyA address" });
  if (!ADDRESS_RE.test(body.data.partyB))    return res.status(400).json({ error: "Invalid partyB address" });

  const usdcRaw = BigInt(body.data.usdcAmount);
  const eurcRaw = BigInt(body.data.eurcAmount);
  const impliedRate = eurcRaw > 0n ? String((usdcRaw * 1_000_000n) / eurcRaw) : null;

  const [row] = await db.insert(fxForwardsTable).values({
    partyA:          body.data.partyA.toLowerCase(),
    partyB:          body.data.partyB.toLowerCase(),
    usdcAmount:      body.data.usdcAmount,
    eurcAmount:      body.data.eurcAmount,
    impliedRate,
    maturity:        body.data.maturity,
    fundingDeadline: body.data.fundingDeadline,
    contractAddress: body.data.contractAddress,
    txHash:          body.data.txHash,
    status:          "created",
    chainId:         body.data.chainId ?? 5042002,
    onChainId:       body.data.onChainId ?? null,
  }).returning();

  await db.insert(activityLogTable).values({
    type:        "escrow_created",
    description: `FX Forward created — ${row.usdcAmount} USDC ↔ ${row.eurcAmount} EURC, maturity ${new Date(row.maturity * 1000).toLocaleDateString()}`,
    txHash:      row.txHash,
    chainId:     row.chainId,
  });

  return res.status(201).json(fmt(row));
});

router.get("/:id", async (req, res) => {
  const params = GetFxForwardParams.safeParse({ id: Number(req.params.id) });
  if (!params.success) return res.status(400).json({ error: "Invalid id" });

  const [row] = await db.select().from(fxForwardsTable).where(eq(fxForwardsTable.id, params.data.id));
  if (!row) return res.status(404).json({ error: "Not found" });
  return res.json(fmt(row));
});

router.post("/:id/fund", async (req, res) => {
  const params = FundFxForwardParams.safeParse({ id: Number(req.params.id) });
  const body   = FundFxForwardBody.safeParse(req.body);
  if (!params.success || !body.success) return res.status(400).json({ error: "Invalid input" });
  if (!TX_HASH_RE.test(body.data.txHash)) return res.status(400).json({ error: "Invalid txHash" });

  const [existing] = await db.select().from(fxForwardsTable).where(eq(fxForwardsTable.id, params.data.id));
  if (!existing) return res.status(404).json({ error: "Not found" });

  const [row] = await db.update(fxForwardsTable)
    .set({ status: "funded", fundTxHash: body.data.txHash })
    .where(and(eq(fxForwardsTable.id, params.data.id), eq(fxForwardsTable.status, "created")))
    .returning();

  if (!row) return res.status(409).json({ error: `Cannot fund a forward with status '${existing.status}'` });

  await db.insert(activityLogTable).values({
    type:        "escrow_created",
    description: `FX Forward #${row.id} funded by partyB — ${row.eurcAmount} EURC deposited`,
    txHash:      body.data.txHash,
    chainId:     row.chainId,
  });

  return res.json(fmt(row));
});

router.post("/:id/settle", async (req, res) => {
  const params = SettleFxForwardParams.safeParse({ id: Number(req.params.id) });
  const body   = SettleFxForwardBody.safeParse(req.body);
  if (!params.success || !body.success) return res.status(400).json({ error: "Invalid input" });
  if (!TX_HASH_RE.test(body.data.txHash)) return res.status(400).json({ error: "Invalid txHash" });

  const [existing] = await db.select().from(fxForwardsTable).where(eq(fxForwardsTable.id, params.data.id));
  if (!existing) return res.status(404).json({ error: "Not found" });

  const [row] = await db.update(fxForwardsTable)
    .set({ status: "settled", settleTxHash: body.data.txHash })
    .where(and(eq(fxForwardsTable.id, params.data.id), eq(fxForwardsTable.status, "funded")))
    .returning();

  if (!row) return res.status(409).json({ error: `Cannot settle a forward with status '${existing.status}'` });

  await db.insert(activityLogTable).values({
    type:        "escrow_released",
    description: `FX Forward #${row.id} settled — partyA received ${row.eurcAmount} EURC, partyB received ${row.usdcAmount} USDC`,
    txHash:      body.data.txHash,
    chainId:     row.chainId,
  });

  return res.json(fmt(row));
});

router.post("/:id/cancel", async (req, res) => {
  const params = CancelFxForwardParams.safeParse({ id: Number(req.params.id) });
  const body   = CancelFxForwardBody.safeParse(req.body);
  if (!params.success || !body.success) return res.status(400).json({ error: "Invalid input" });
  if (!TX_HASH_RE.test(body.data.txHash)) return res.status(400).json({ error: "Invalid txHash" });

  const [existing] = await db.select().from(fxForwardsTable).where(eq(fxForwardsTable.id, params.data.id));
  if (!existing) return res.status(404).json({ error: "Not found" });

  const [row] = await db.update(fxForwardsTable)
    .set({ status: "cancelled", cancelTxHash: body.data.txHash })
    .where(and(eq(fxForwardsTable.id, params.data.id), eq(fxForwardsTable.status, "created")))
    .returning();

  if (!row) return res.status(409).json({ error: `Cannot cancel a forward with status '${existing.status}'` });

  await db.insert(activityLogTable).values({
    type:        "escrow_released",
    description: `FX Forward #${row.id} cancelled — ${row.usdcAmount} USDC refunded to partyA`,
    txHash:      body.data.txHash,
    chainId:     row.chainId,
  });

  return res.json(fmt(row));
});

export default router;
