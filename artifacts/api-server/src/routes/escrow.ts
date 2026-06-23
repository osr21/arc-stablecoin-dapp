import { Router } from "express";
import { db, escrowsTable, activityLogTable } from "@workspace/db";
import { eq, or, and } from "drizzle-orm";
import {
  ListEscrowsQueryParams,
  CreateEscrowBody,
  GetEscrowParams,
  DisputeEscrowParams,
  DisputeEscrowBody,
  ReleaseEscrowParams,
  ReleaseEscrowBody,
} from "@workspace/api-zod";
import { logger } from "../lib/logger";

const router = Router();

const TX_HASH_RE = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/i;

router.get("/", async (req, res) => {
  const query = ListEscrowsQueryParams.safeParse(req.query);
  if (!query.success) {
    return res.status(400).json({ error: "Invalid query params" });
  }

  const PAGE_LIMIT = 500;
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
      )
      .limit(PAGE_LIMIT);
  } else if (query.data.status) {
    rows = await db
      .select()
      .from(escrowsTable)
      .where(eq(escrowsTable.status, query.data.status))
      .limit(PAGE_LIMIT);
  } else {
    rows = await db.select().from(escrowsTable).limit(PAGE_LIMIT);
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
    return res.status(400).json({ error: "Invalid body" });
  }

  if (!TX_HASH_RE.test(body.data.txHash)) {
    return res.status(400).json({ error: "Invalid txHash format" });
  }

  if (!ADDRESS_RE.test(body.data.depositor)) {
    return res.status(400).json({ error: "Invalid depositor address format" });
  }

  if (!ADDRESS_RE.test(body.data.beneficiary)) {
    return res.status(400).json({ error: "Invalid beneficiary address format" });
  }

  if (body.data.arbiter && !ADDRESS_RE.test(body.data.arbiter)) {
    return res.status(400).json({ error: "Invalid arbiter address format" });
  }

  const [escrow] = await db
    .insert(escrowsTable)
    .values({
      depositor:       body.data.depositor.toLowerCase(),
      beneficiary:     body.data.beneficiary.toLowerCase(),
      arbiter:         body.data.arbiter?.toLowerCase() ?? null,
      token:           body.data.token,
      amount:          body.data.amount,
      releaseTime:     body.data.releaseTime,
      status:          "active",
      conditionType:   body.data.conditionType ?? null,
      conditionData:   body.data.conditionData ?? null,
      contractAddress: body.data.contractAddress,
      txHash:          body.data.txHash,
      chainId:         body.data.chainId ?? 5042002,
      onChainId:       body.data.onChainId ?? null,
    })
    .returning();

  await db.insert(activityLogTable).values({
    type:        "escrow_created",
    description: `Escrow of ${escrow.amount} ${escrow.token} created between ${escrow.depositor.slice(0, 8)}... and ${escrow.beneficiary.slice(0, 8)}...`,
    txHash:      escrow.txHash,
    chainId:     escrow.chainId,
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

  if (!TX_HASH_RE.test(body.data.txHash)) {
    return res.status(400).json({ error: "Invalid txHash format" });
  }

  // Caller must be the depositor or beneficiary of this specific escrow.
  const caller = typeof req.body.caller === "string" ? req.body.caller.toLowerCase() : null;
  if (!caller || !ADDRESS_RE.test(caller)) {
    return res.status(400).json({ error: "Missing or invalid caller address" });
  }

  const [existing] = await db.select().from(escrowsTable).where(eq(escrowsTable.id, params.data.id));
  if (!existing) return res.status(404).json({ error: "Not found" });

  if (caller !== existing.depositor.toLowerCase() && caller !== existing.beneficiary.toLowerCase()) {
    return res.status(403).json({ error: "Caller is not a party to this escrow" });
  }

  const [escrow] = await db
    .update(escrowsTable)
    .set({
      status:        "disputed",
      disputeTxHash: body.data.txHash,
      disputeReason: body.data.reason,
    })
    .where(
      and(
        eq(escrowsTable.id, params.data.id),
        eq(escrowsTable.status, "active")
      )
    )
    .returning();

  if (!escrow) {
    return res.status(409).json({ error: `Cannot dispute an escrow with status '${existing.status}'` });
  }

  await db.insert(activityLogTable).values({
    type:        "escrow_disputed",
    description: `Dispute raised on escrow #${escrow.id}: "${body.data.reason}"`,
    txHash:      body.data.txHash,
    chainId:     escrow.chainId,
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

  if (!TX_HASH_RE.test(body.data.txHash)) {
    return res.status(400).json({ error: "Invalid txHash format" });
  }

  // Caller validation:
  //   - releasing to beneficiary ("beneficiary") → must be depositor
  //   - resolving a dispute ("depositor")         → must be arbiter
  const caller = typeof req.body.caller === "string" ? req.body.caller.toLowerCase() : null;
  if (!caller || !ADDRESS_RE.test(caller)) {
    return res.status(400).json({ error: "Missing or invalid caller address" });
  }

  const [existing] = await db.select().from(escrowsTable).where(eq(escrowsTable.id, params.data.id));
  if (!existing) return res.status(404).json({ error: "Not found" });

  if (body.data.resolution === "beneficiary") {
    // Depositor releases to beneficiary voluntarily
    if (caller !== existing.depositor.toLowerCase()) {
      return res.status(403).json({ error: "Only the depositor can release funds to the beneficiary" });
    }
  } else {
    // Arbiter resolves dispute (refund to depositor)
    const arbiter = existing.arbiter?.toLowerCase();
    if (!arbiter || caller !== arbiter) {
      return res.status(403).json({ error: "Only the arbiter can resolve a disputed escrow" });
    }
  }

  const newStatus        = body.data.resolution === "beneficiary" ? "released" : "resolved";
  const allowedFromStatus = body.data.resolution === "beneficiary" ? "active"   : "disputed";

  const [escrow] = await db
    .update(escrowsTable)
    .set({
      status:        newStatus,
      releaseTxHash: body.data.txHash,
    })
    .where(
      and(
        eq(escrowsTable.id, params.data.id),
        eq(escrowsTable.status, allowedFromStatus)
      )
    )
    .returning();

  if (!escrow) {
    return res.status(409).json({ error: `Cannot release/resolve an escrow with status '${existing.status}'` });
  }

  await db.insert(activityLogTable).values({
    type:        "escrow_released",
    description: `Escrow #${escrow.id} resolved — funds sent to ${body.data.resolution}`,
    txHash:      body.data.txHash,
    chainId:     escrow.chainId,
  });

  return res.json({
    ...escrow,
    createdAt: escrow.createdAt.toISOString(),
    updatedAt: escrow.updatedAt.toISOString(),
  });
});

const COIN_IDS: Record<string, string> = {
  ETH: "ethereum",
  BTC: "bitcoin",
  SOL: "solana",
  MATIC: "matic-network",
};

router.get("/:id/oracle-check", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id < 0) {
    return res.status(400).json({ error: "Invalid id" });
  }

  const [escrow] = await db
    .select()
    .from(escrowsTable)
    .where(eq(escrowsTable.id, id));
  if (!escrow) return res.status(404).json({ error: "Not found" });

  if (escrow.conditionType !== "oracle") {
    return res.json({
      conditionType: escrow.conditionType,
      oracleType: null,
      met: true,
      requiresConfirmation: false,
      description: "No oracle condition required",
    });
  }

  let condData: Record<string, string> = {};
  try {
    condData = JSON.parse(escrow.conditionData ?? "{}") as Record<string, string>;
  } catch {
    condData = {};
  }

  const oracleType = condData.oracleType ?? "custom";

  if (oracleType === "price_feed") {
    const asset = condData.asset ?? "ETH";
    const coinId = COIN_IDS[asset];
    if (!coinId) {
      return res.status(400).json({ error: `Unknown asset '${asset}'. Supported: ${Object.keys(COIN_IDS).join(", ")}` });
    }
    const direction = condData.direction ?? "above";
    if (direction !== "above" && direction !== "below") {
      return res.status(400).json({ error: "Invalid direction — must be 'above' or 'below'" });
    }
    const threshold = Number(condData.threshold ?? "0");
    if (!Number.isFinite(threshold)) {
      return res.status(400).json({ error: "Invalid threshold — must be a finite number" });
    }
    try {
      const priceRes = await fetch(
        `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(coinId)}&vs_currencies=usd`,
        { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(8_000) }
      );
      if (!priceRes.ok) throw new Error(`upstream ${priceRes.status}`);
      const raw = await priceRes.text();
      if (raw.length > 4096) throw new Error("response too large");
      const priceData = JSON.parse(raw) as Record<string, { usd?: number }>;
      const currentPrice = priceData[coinId]?.usd;
      if (currentPrice == null) throw new Error("price not found in response");
      const met = direction === "below" ? currentPrice <= threshold : currentPrice >= threshold;
      return res.json({
        oracleType: "price_feed",
        asset,
        direction,
        threshold: threshold.toString(),
        currentPrice: currentPrice.toFixed(2),
        met,
        requiresConfirmation: false,
        description: `${asset}/USD ${direction} $${threshold}`,
      });
    } catch (err) {
      req.log.warn({ err }, "oracle: price check failed");
      return res.status(502).json({ error: "Price oracle temporarily unavailable — try again shortly" });
    }
  }

  return res.json({
    oracleType,
    description: condData.description ?? "No condition description provided",
    met: false,
    requiresConfirmation: true,
  });
});

export default router;
