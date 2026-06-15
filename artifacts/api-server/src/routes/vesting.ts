import { Router } from "express";
import { db, vestingSchedulesTable, activityLogTable } from "@workspace/db";
import { eq, or } from "drizzle-orm";
import {
  ListVestingSchedulesQueryParams,
  CreateVestingScheduleBody,
  GetVestingScheduleParams,
  ClaimVestingParams,
  ClaimVestingBody,
} from "@workspace/api-zod";

const router = Router();

const TX_HASH_RE = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/i;

router.get("/", async (req, res) => {
  const query = ListVestingSchedulesQueryParams.safeParse(req.query);
  if (!query.success) {
    return res.status(400).json({ error: "Invalid query params" });
  }

  let rows;
  if (query.data.address) {
    rows = await db
      .select()
      .from(vestingSchedulesTable)
      .where(
        or(
          eq(vestingSchedulesTable.employer, query.data.address),
          eq(vestingSchedulesTable.beneficiary, query.data.address)
        )
      );
  } else if (query.data.token) {
    rows = await db
      .select()
      .from(vestingSchedulesTable)
      .where(eq(vestingSchedulesTable.token, query.data.token));
  } else {
    rows = await db.select().from(vestingSchedulesTable);
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
  const body = CreateVestingScheduleBody.safeParse(req.body);
  if (!body.success) {
    return res.status(400).json({ error: "Invalid body", details: body.error.issues });
  }

  if (!TX_HASH_RE.test(body.data.txHash)) {
    return res.status(400).json({ error: "Invalid txHash format" });
  }

  if (!ADDRESS_RE.test(body.data.employer)) {
    return res.status(400).json({ error: "Invalid employer address format" });
  }

  if (!ADDRESS_RE.test(body.data.beneficiary)) {
    return res.status(400).json({ error: "Invalid beneficiary address format" });
  }

  const [schedule] = await db
    .insert(vestingSchedulesTable)
    .values({
      employer:        body.data.employer.toLowerCase(),
      beneficiary:     body.data.beneficiary.toLowerCase(),
      token:           body.data.token,
      totalAmount:     body.data.totalAmount,
      cliffDuration:   body.data.cliffDuration,
      vestingDuration: body.data.vestingDuration,
      startTime:       body.data.startTime,
      amountClaimed:   "0",
      contractAddress: body.data.contractAddress,
      txHash:          body.data.txHash,
      chainId:         body.data.chainId ?? 5042002,
    })
    .returning();

  await db.insert(activityLogTable).values({
    type:        "vesting_created",
    description: `Vesting schedule of ${schedule.totalAmount} ${schedule.token} created for ${schedule.beneficiary.slice(0, 8)}...`,
    txHash:      schedule.txHash,
    chainId:     schedule.chainId,
  });

  return res.status(201).json({
    ...schedule,
    createdAt: schedule.createdAt.toISOString(),
    updatedAt: schedule.updatedAt.toISOString(),
  });
});

router.get("/:id", async (req, res) => {
  const params = GetVestingScheduleParams.safeParse({ id: Number(req.params.id) });
  if (!params.success) return res.status(400).json({ error: "Invalid id" });

  const [schedule] = await db
    .select()
    .from(vestingSchedulesTable)
    .where(eq(vestingSchedulesTable.id, params.data.id));

  if (!schedule) return res.status(404).json({ error: "Not found" });

  return res.json({
    ...schedule,
    createdAt: schedule.createdAt.toISOString(),
    updatedAt: schedule.updatedAt.toISOString(),
  });
});

router.post("/:id/claim", async (req, res) => {
  const params = ClaimVestingParams.safeParse({ id: Number(req.params.id) });
  const body   = ClaimVestingBody.safeParse(req.body);
  if (!params.success || !body.success) {
    return res.status(400).json({ error: "Invalid input" });
  }

  if (!TX_HASH_RE.test(body.data.txHash)) {
    return res.status(400).json({ error: "Invalid txHash format" });
  }

  // Caller must be the beneficiary of this schedule.
  const caller = typeof req.body.caller === "string" ? req.body.caller.toLowerCase() : null;
  if (!caller || !ADDRESS_RE.test(caller)) {
    return res.status(400).json({ error: "Missing or invalid caller address" });
  }

  const [existing] = await db
    .select()
    .from(vestingSchedulesTable)
    .where(eq(vestingSchedulesTable.id, params.data.id));

  if (!existing) return res.status(404).json({ error: "Not found" });

  if (caller !== existing.beneficiary.toLowerCase()) {
    return res.status(403).json({ error: "Only the beneficiary can claim vesting tokens" });
  }

  let newClaimed: bigint;
  let currentClaimed: bigint;
  try {
    newClaimed     = BigInt(body.data.amountClaimed);
    currentClaimed = BigInt(existing.amountClaimed);
  } catch {
    return res.status(400).json({ error: "Invalid amountClaimed: must be a numeric string" });
  }

  if (newClaimed <= currentClaimed) {
    return res.status(409).json({
      error: `amountClaimed (${newClaimed}) must exceed current value (${currentClaimed})`,
    });
  }

  let totalAmount: bigint;
  try {
    totalAmount = BigInt(existing.totalAmount);
  } catch {
    return res.status(500).json({ error: "Schedule has invalid totalAmount in database" });
  }

  if (newClaimed > totalAmount) {
    return res.status(409).json({
      error: `amountClaimed (${newClaimed}) exceeds totalAmount (${totalAmount})`,
    });
  }

  const [schedule] = await db
    .update(vestingSchedulesTable)
    .set({
      amountClaimed: body.data.amountClaimed,
      claimTxHash:   body.data.txHash,
    })
    .where(eq(vestingSchedulesTable.id, params.data.id))
    .returning();

  await db.insert(activityLogTable).values({
    type:        "vesting_claimed",
    description: `${body.data.amountClaimed} ${schedule.token} claimed from vesting schedule #${schedule.id}`,
    txHash:      body.data.txHash,
    chainId:     schedule.chainId,
  });

  return res.json({
    ...schedule,
    createdAt: schedule.createdAt.toISOString(),
    updatedAt: schedule.updatedAt.toISOString(),
  });
});

export default router;
