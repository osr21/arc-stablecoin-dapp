import { Router } from "express";
import { db, splitsTable, splitDistributionsTable, activityLogTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import {
  ListSplitsQueryParams,
  CreateSplitBody,
  GetSplitParams,
  DistributeSplitParams,
  DistributeSplitBody,
  DeactivateSplitParams,
  DeactivateSplitBody,
} from "@workspace/api-zod";

const router = Router();

const TX_HASH_RE = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/i;

const ALLOWED_TOKENS: Record<string, string> = {
  USDC: "0x3600000000000000000000000000000000000000",
  EURC: "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a",
};

function fmt(row: typeof splitsTable.$inferSelect) {
  return {
    ...row,
    recipients: JSON.parse(row.recipients) as string[],
    shares:     JSON.parse(row.shares) as number[],
    createdAt:  row.createdAt.toISOString(),
    updatedAt:  row.updatedAt.toISOString(),
  };
}

function fmtDist(row: typeof splitDistributionsTable.$inferSelect) {
  return { ...row, createdAt: row.createdAt.toISOString() };
}

router.get("/", async (req, res) => {
  const query = ListSplitsQueryParams.safeParse(req.query);
  if (!query.success) return res.status(400).json({ error: "Invalid query params" });

  let rows;
  if (query.data.creator) {
    rows = await db.select().from(splitsTable)
      .where(eq(splitsTable.creator, query.data.creator))
      .orderBy(desc(splitsTable.createdAt))
      .limit(500);
  } else {
    rows = await db.select().from(splitsTable)
      .orderBy(desc(splitsTable.createdAt))
      .limit(500);
  }

  return res.json(rows.map(fmt));
});

router.post("/", async (req, res) => {
  const body = CreateSplitBody.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "Invalid body" });

  if (!ADDRESS_RE.test(body.data.creator))          return res.status(400).json({ error: "Invalid creator address" });
  if (!TX_HASH_RE.test(body.data.txHash))           return res.status(400).json({ error: "Invalid txHash" });
  if (!ADDRESS_RE.test(body.data.contractAddress))  return res.status(400).json({ error: "Invalid contractAddress" });
  if (!ALLOWED_TOKENS[body.data.token])             return res.status(400).json({ error: "Token must be USDC or EURC" });

  const recipients: string[] = body.data.recipients;
  const shares: number[]     = body.data.shares;

  if (recipients.length < 2 || recipients.length > 20) return res.status(400).json({ error: "2-20 recipients required" });
  if (recipients.length !== shares.length)              return res.status(400).json({ error: "recipients and shares length mismatch" });
  for (const r of recipients) {
    if (!ADDRESS_RE.test(r)) return res.status(400).json({ error: `Invalid recipient address: ${r}` });
  }
  const totalShares = shares.reduce((a, b) => a + b, 0);
  if (totalShares !== 10000) return res.status(400).json({ error: "Shares must sum to 10000 basis points (100%)" });

  const [row] = await db.insert(splitsTable).values({
    creator:         body.data.creator,
    token:           body.data.token,
    recipients:      JSON.stringify(recipients),
    shares:          JSON.stringify(shares),
    description:     body.data.description ?? null,
    totalDistributed:"0",
    active:          true,
    contractAddress: body.data.contractAddress,
    txHash:          body.data.txHash,
    onChainId:       body.data.onChainId ?? null,
    chainId:         body.data.chainId ?? 5042002,
  }).returning();

  await db.insert(activityLogTable).values({
    type:        "split_created",
    description: `Split created: ${recipients.length} recipients, ${body.data.token}${body.data.description ? ` — ${body.data.description}` : ""}`,
    metadata:    JSON.stringify({ id: row.id, recipients: recipients.length, token: body.data.token, creator: body.data.creator }),
    txHash:      body.data.txHash,
  }).catch(() => {});

  return res.status(201).json(fmt(row));
});

router.get("/:id", async (req, res) => {
  const params = GetSplitParams.safeParse(req.params);
  if (!params.success) return res.status(400).json({ error: "Invalid id" });

  const [row] = await db.select().from(splitsTable).where(eq(splitsTable.id, params.data.id));
  if (!row) return res.status(404).json({ error: "Split not found" });

  const distributions = await db.select().from(splitDistributionsTable)
    .where(eq(splitDistributionsTable.splitId, params.data.id))
    .orderBy(desc(splitDistributionsTable.createdAt))
    .limit(50);

  return res.json({ ...fmt(row), distributions: distributions.map(fmtDist) });
});

router.post("/:id/distribute", async (req, res) => {
  const params = DistributeSplitParams.safeParse(req.params);
  const body   = DistributeSplitBody.safeParse(req.body);
  if (!params.success) return res.status(400).json({ error: "Invalid id" });
  if (!body.success)   return res.status(400).json({ error: "Invalid body" });

  if (!TX_HASH_RE.test(body.data.txHash))    return res.status(400).json({ error: "Invalid txHash" });
  if (!ADDRESS_RE.test(body.data.distributor)) return res.status(400).json({ error: "Invalid distributor address" });

  const [existing] = await db.select().from(splitsTable).where(eq(splitsTable.id, params.data.id));
  if (!existing) return res.status(404).json({ error: "Split not found" });
  if (!existing.active) return res.status(400).json({ error: "Split is inactive" });

  const newTotal = String(BigInt(existing.totalDistributed) + BigInt(body.data.amount));

  await db.insert(splitDistributionsTable).values({
    splitId:       params.data.id,
    amount:        body.data.amount,
    txHash:        body.data.txHash,
    distributedBy: body.data.distributor,
    chainId:       existing.chainId,
  });

  const [row] = await db.update(splitsTable)
    .set({ totalDistributed: newTotal })
    .where(eq(splitsTable.id, params.data.id))
    .returning();

  await db.insert(activityLogTable).values({
    type:        "split_distributed",
    description: `Split #${row.id} distributed ${body.data.amount} raw ${row.token}${row.description ? ` — ${row.description}` : ""}`,
    metadata:    JSON.stringify({ splitId: row.id, amount: body.data.amount, token: row.token, distributor: body.data.distributor }),
    txHash:      body.data.txHash,
  }).catch(() => {});

  return res.json(fmt(row));
});

router.patch("/:id/deactivate", async (req, res) => {
  const params = DeactivateSplitParams.safeParse(req.params);
  const body   = DeactivateSplitBody.safeParse(req.body);
  if (!params.success) return res.status(400).json({ error: "Invalid id" });
  if (!body.success)   return res.status(400).json({ error: "Invalid body" });

  const [row] = await db.update(splitsTable)
    .set({ active: false })
    .where(eq(splitsTable.id, params.data.id))
    .returning();

  if (!row) return res.status(404).json({ error: "Split not found" });
  return res.json(fmt(row));
});

export default router;
