import { Router } from "express";
import { db, agentsTable, activityLogTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import {
  ListAgentsQueryParams,
  CreateAgentBody,
  GetAgentParams,
  RecordAgentActivityParams,
  RecordAgentActivityBody,
  UpdateAgentStatusParams,
  UpdateAgentStatusBody,
} from "@workspace/api-zod";

const router = Router();

const TX_HASH_RE = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/i;

const VALID_TYPES = ["api-consumer", "market-maker", "data-provider", "orchestrator", "custom"];
const VALID_STATUSES = ["active", "suspended", "deactivated"];

function reputationScore(totalVolume: string, txCount: number): number {
  const txScore  = txCount * 5;
  const volScore = Math.floor(Number(BigInt(totalVolume) / 1_000_000_000n));
  const raw = txScore + volScore;
  return raw > 100 ? 100 : raw;
}

function fmt(row: typeof agentsTable.$inferSelect) {
  return {
    ...row,
    reputationScore: reputationScore(row.totalVolume, row.txCount),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

router.get("/", async (req, res) => {
  const query = ListAgentsQueryParams.safeParse(req.query);
  if (!query.success) return res.status(400).json({ error: "Invalid query params" });

  let rows;
  if (query.data.owner) {
    rows = await db.select().from(agentsTable)
      .where(eq(agentsTable.owner, query.data.owner))
      .orderBy(desc(agentsTable.createdAt))
      .limit(500);
  } else if (query.data.status) {
    rows = await db.select().from(agentsTable)
      .where(eq(agentsTable.status, query.data.status))
      .orderBy(desc(agentsTable.createdAt))
      .limit(500);
  } else {
    rows = await db.select().from(agentsTable)
      .orderBy(desc(agentsTable.createdAt))
      .limit(500);
  }

  return res.json(rows.map(fmt));
});

router.post("/", async (req, res) => {
  const body = CreateAgentBody.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "Invalid body" });

  if (!ADDRESS_RE.test(body.data.owner))         return res.status(400).json({ error: "Invalid owner address" });
  if (!TX_HASH_RE.test(body.data.txHash))        return res.status(400).json({ error: "Invalid txHash" });
  if (!ADDRESS_RE.test(body.data.contractAddress)) return res.status(400).json({ error: "Invalid contractAddress" });
  if (!VALID_TYPES.includes(body.data.agentType)) return res.status(400).json({ error: "Invalid agentType" });

  const [row] = await db.insert(agentsTable).values({
    owner:           body.data.owner,
    name:            body.data.name,
    agentType:       body.data.agentType,
    metadataUri:     body.data.metadataUri ?? null,
    status:          "active",
    totalVolume:     "0",
    txCount:         0,
    reputationScore: 0,
    contractAddress: body.data.contractAddress,
    txHash:          body.data.txHash,
    onChainId:       body.data.onChainId ?? null,
    chainId:         body.data.chainId ?? 5042002,
  }).returning();

  await db.insert(activityLogTable).values({
    type:        "agent_registered",
    description: `Agent "${body.data.name}" (${body.data.agentType}) registered`,
    metadata:    JSON.stringify({ id: row.id, name: body.data.name, agentType: body.data.agentType, owner: body.data.owner }),
    txHash:      body.data.txHash,
  }).catch(() => {});

  return res.status(201).json(fmt(row));
});

router.get("/:id", async (req, res) => {
  const params = GetAgentParams.safeParse(req.params);
  if (!params.success) return res.status(400).json({ error: "Invalid id" });

  const [row] = await db.select().from(agentsTable).where(eq(agentsTable.id, params.data.id));
  if (!row) return res.status(404).json({ error: "Agent not found" });
  return res.json(fmt(row));
});

router.post("/:id/activity", async (req, res) => {
  const params = RecordAgentActivityParams.safeParse(req.params);
  const body   = RecordAgentActivityBody.safeParse(req.body);
  if (!params.success) return res.status(400).json({ error: "Invalid id" });
  if (!body.success)   return res.status(400).json({ error: "Invalid body" });

  if (!TX_HASH_RE.test(body.data.txHash))    return res.status(400).json({ error: "Invalid txHash" });
  if (!ADDRESS_RE.test(body.data.caller))    return res.status(400).json({ error: "Invalid caller address" });

  const [existing] = await db.select().from(agentsTable).where(eq(agentsTable.id, params.data.id));
  if (!existing) return res.status(404).json({ error: "Agent not found" });
  if (existing.status !== "active") return res.status(400).json({ error: "Agent is not active" });

  const newVolume  = String(BigInt(existing.totalVolume) + BigInt(body.data.amount));
  const newTxCount = existing.txCount + 1;
  const newScore   = reputationScore(newVolume, newTxCount);

  const [row] = await db.update(agentsTable)
    .set({ totalVolume: newVolume, txCount: newTxCount, reputationScore: newScore })
    .where(eq(agentsTable.id, params.data.id))
    .returning();

  await db.insert(activityLogTable).values({
    type:        "agent_activity",
    description: `Activity recorded for agent "${row.name}": ${body.data.amount} raw units`,
    metadata:    JSON.stringify({ agentId: row.id, agentName: row.name, amount: body.data.amount, newScore, caller: body.data.caller }),
    txHash:      body.data.txHash,
  }).catch(() => {});

  return res.json(fmt(row));
});

router.patch("/:id/status", async (req, res) => {
  const params = UpdateAgentStatusParams.safeParse(req.params);
  const body   = UpdateAgentStatusBody.safeParse(req.body);
  if (!params.success) return res.status(400).json({ error: "Invalid id" });
  if (!body.success)   return res.status(400).json({ error: "Invalid body" });
  if (!VALID_STATUSES.includes(body.data.status)) return res.status(400).json({ error: "Invalid status" });

  const [row] = await db.update(agentsTable)
    .set({ status: body.data.status })
    .where(eq(agentsTable.id, params.data.id))
    .returning();

  if (!row) return res.status(404).json({ error: "Agent not found" });
  return res.json(fmt(row));
});

export default router;
