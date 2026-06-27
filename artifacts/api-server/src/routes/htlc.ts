import { Router } from "express";
import { db, htlcSwapsTable, activityLogTable } from "@workspace/db";
import { eq, or, and } from "drizzle-orm";
import {
  ListHtlcSwapsQueryParams,
  CreateHtlcSwapBody,
  GetHtlcSwapParams,
  ClaimHtlcSwapParams,
  ClaimHtlcSwapBody,
  RefundHtlcSwapParams,
  RefundHtlcSwapBody,
  RelayHtlcSwapParams,
  RelayHtlcSwapBody,
} from "@workspace/api-zod";

const router = Router();

const TX_HASH_RE = /^0x[0-9a-fA-F]{64}$/;
const BYTES32_RE = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/i;

function fmt(row: typeof htlcSwapsTable.$inferSelect) {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

router.get("/", async (req, res) => {
  const query = ListHtlcSwapsQueryParams.safeParse(req.query);
  if (!query.success) return res.status(400).json({ error: "Invalid query params" });

  const PAGE_LIMIT = 500;
  let rows;
  if (query.data.address) {
    rows = await db.select().from(htlcSwapsTable)
      .where(or(eq(htlcSwapsTable.depositor, query.data.address), eq(htlcSwapsTable.recipient, query.data.address)))
      .limit(PAGE_LIMIT);
  } else if (query.data.status) {
    rows = await db.select().from(htlcSwapsTable)
      .where(eq(htlcSwapsTable.status, query.data.status))
      .limit(PAGE_LIMIT);
  } else {
    rows = await db.select().from(htlcSwapsTable).limit(PAGE_LIMIT);
  }

  return res.json(rows.map(fmt));
});

router.post("/", async (req, res) => {
  const body = CreateHtlcSwapBody.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "Invalid body" });

  if (!TX_HASH_RE.test(body.data.txHash))    return res.status(400).json({ error: "Invalid txHash" });
  if (!ADDRESS_RE.test(body.data.depositor)) return res.status(400).json({ error: "Invalid depositor address" });
  if (!BYTES32_RE.test(body.data.hashlock))  return res.status(400).json({ error: "Invalid hashlock format (must be 0x + 64 hex chars)" });

  const isCrosschain = body.data.swapMode === "crosschain_cctp";

  if (!isCrosschain && !ADDRESS_RE.test(body.data.recipient ?? "")) {
    return res.status(400).json({ error: "Invalid recipient address for single-chain HTLC" });
  }

  if (isCrosschain) {
    if (body.data.destinationDomain === undefined || body.data.destinationDomain === null) {
      return res.status(400).json({ error: "destinationDomain required for crosschain_cctp" });
    }
    if (!body.data.mintRecipient || !BYTES32_RE.test(body.data.mintRecipient)) {
      return res.status(400).json({ error: "mintRecipient must be 0x + 64 hex chars (bytes32) for crosschain_cctp" });
    }
  }

  const [row] = await db.insert(htlcSwapsTable).values({
    depositor:        body.data.depositor.toLowerCase(),
    recipient:        (body.data.recipient ?? body.data.depositor).toLowerCase(),
    token:            body.data.token,
    amount:           body.data.amount,
    hashlock:         body.data.hashlock,
    timelock:         body.data.timelock,
    contractAddress:  body.data.contractAddress,
    txHash:           body.data.txHash,
    status:           "active",
    chainId:          body.data.chainId ?? 5042002,
    onChainId:        body.data.onChainId ?? null,
    swapMode:         body.data.swapMode ?? "single_chain",
    destinationDomain: isCrosschain ? body.data.destinationDomain ?? null : null,
    mintRecipient:    isCrosschain ? body.data.mintRecipient ?? null : null,
    maxFee:           isCrosschain ? (body.data.maxFee ?? "0") : null,
    minFinalityThreshold: isCrosschain ? (body.data.minFinalityThreshold ?? 2000) : null,
  }).returning();

  const modeLabel = isCrosschain ? "atomic crosschain" : "single-chain";
  await db.insert(activityLogTable).values({
    type:        "crosschain_initiated",
    description: `HTLC created (${modeLabel}) — ${row.amount} ${row.token} locked by ${row.depositor.slice(0, 8)}…`,
    txHash:      row.txHash,
    chainId:     row.chainId,
  });

  return res.status(201).json(fmt(row));
});

router.get("/:id", async (req, res) => {
  const params = GetHtlcSwapParams.safeParse({ id: Number(req.params.id) });
  if (!params.success) return res.status(400).json({ error: "Invalid id" });

  const [row] = await db.select().from(htlcSwapsTable).where(eq(htlcSwapsTable.id, params.data.id));
  if (!row) return res.status(404).json({ error: "Not found" });
  return res.json(fmt(row));
});

router.post("/:id/claim", async (req, res) => {
  const params = ClaimHtlcSwapParams.safeParse({ id: Number(req.params.id) });
  const body   = ClaimHtlcSwapBody.safeParse(req.body);
  if (!params.success || !body.success) return res.status(400).json({ error: "Invalid input" });
  if (!TX_HASH_RE.test(body.data.txHash))   return res.status(400).json({ error: "Invalid txHash" });
  if (!BYTES32_RE.test(body.data.preimage)) return res.status(400).json({ error: "Invalid preimage format" });

  const [existing] = await db.select().from(htlcSwapsTable).where(eq(htlcSwapsTable.id, params.data.id));
  if (!existing) return res.status(404).json({ error: "Not found" });

  const [row] = await db.update(htlcSwapsTable)
    .set({ status: "claimed", claimTxHash: body.data.txHash, preimage: body.data.preimage })
    .where(and(eq(htlcSwapsTable.id, params.data.id), eq(htlcSwapsTable.status, "active")))
    .returning();

  if (!row) return res.status(409).json({ error: `Cannot claim an HTLC with status '${existing.status}'` });

  const isCrosschain = row.swapMode === "crosschain_cctp";
  await db.insert(activityLogTable).values({
    type:        "crosschain_complete",
    description: isCrosschain
      ? `HTLC #${row.id} claimed — USDC burn initiated via CCTP (dest domain ${row.destinationDomain})`
      : `HTLC #${row.id} claimed — ${row.amount} ${row.token} released to ${row.recipient.slice(0, 8)}…`,
    txHash:      body.data.txHash,
    chainId:     row.chainId,
  });

  return res.json(fmt(row));
});

router.post("/:id/refund", async (req, res) => {
  const params = RefundHtlcSwapParams.safeParse({ id: Number(req.params.id) });
  const body   = RefundHtlcSwapBody.safeParse(req.body);
  if (!params.success || !body.success) return res.status(400).json({ error: "Invalid input" });
  if (!TX_HASH_RE.test(body.data.txHash)) return res.status(400).json({ error: "Invalid txHash" });

  const [existing] = await db.select().from(htlcSwapsTable).where(eq(htlcSwapsTable.id, params.data.id));
  if (!existing) return res.status(404).json({ error: "Not found" });

  const [row] = await db.update(htlcSwapsTable)
    .set({ status: "refunded", refundTxHash: body.data.txHash })
    .where(and(eq(htlcSwapsTable.id, params.data.id), eq(htlcSwapsTable.status, "active")))
    .returning();

  if (!row) return res.status(409).json({ error: `Cannot refund an HTLC with status '${existing.status}'` });

  await db.insert(activityLogTable).values({
    type:        "escrow_released",
    description: `HTLC #${row.id} expired — ${row.amount} ${row.token} refunded to ${row.depositor.slice(0, 8)}…`,
    txHash:      body.data.txHash,
    chainId:     row.chainId,
  });

  return res.json(fmt(row));
});

router.post("/:id/relay", async (req, res) => {
  const params = RelayHtlcSwapParams.safeParse({ id: Number(req.params.id) });
  const body   = RelayHtlcSwapBody.safeParse(req.body);
  if (!params.success || !body.success) return res.status(400).json({ error: "Invalid input" });
  if (!TX_HASH_RE.test(body.data.txHash)) return res.status(400).json({ error: "Invalid txHash" });

  const [existing] = await db.select().from(htlcSwapsTable).where(eq(htlcSwapsTable.id, params.data.id));
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (existing.swapMode !== "crosschain_cctp") return res.status(400).json({ error: "Relay only applies to crosschain_cctp HTLCs" });

  const [row] = await db.update(htlcSwapsTable)
    .set({ status: "relayed", relayTxHash: body.data.txHash })
    .where(and(eq(htlcSwapsTable.id, params.data.id), eq(htlcSwapsTable.status, "claimed")))
    .returning();

  if (!row) return res.status(409).json({ error: `Cannot relay an HTLC with status '${existing.status}' (must be 'claimed')` });

  const domainMap: Record<number, string> = { 0: "Ethereum Sepolia", 3: "Arbitrum Sepolia", 6: "Base Sepolia" };
  const destName = domainMap[row.destinationDomain ?? -1] ?? `domain ${row.destinationDomain}`;

  await db.insert(activityLogTable).values({
    type:        "crosschain_complete",
    description: `HTLC #${row.id} relayed — USDC minted on ${destName} for recipient`,
    txHash:      body.data.txHash,
    chainId:     row.chainId,
  });

  return res.json(fmt(row));
});

export default router;
