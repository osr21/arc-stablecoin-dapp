import { Router } from "express";
import { db, escrowsTable, vestingSchedulesTable, crosschainTransfersTable, activityLogTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { GetDashboardActivityQueryParams } from "@workspace/api-zod";

const router = Router();

router.get("/stats", async (_req, res) => {
  const [escrows, vestingSchedules, crosschainTransfers] = await Promise.all([
    db.select().from(escrowsTable),
    db.select().from(vestingSchedulesTable),
    db.select().from(crosschainTransfersTable),
  ]);

  const activeEscrows = escrows.filter((e) => e.status === "active").length;
  const disputedEscrows = escrows.filter((e) => e.status === "disputed").length;
  const releasedEscrows = escrows.filter((e) => e.status === "released" || e.status === "resolved").length;

  const usdcEscrows = escrows.filter((e) => e.token === "USDC" && (e.status === "active" || e.status === "disputed"));
  const eurcEscrows = escrows.filter((e) => e.token === "EURC" && (e.status === "active" || e.status === "disputed"));

  const usdcVesting = vestingSchedules.filter((v) => v.token === "USDC");
  const eurcVesting = vestingSchedules.filter((v) => v.token === "EURC");

  const totalUsdcLocked = [
    ...usdcEscrows.map((e) => BigInt(e.amount)),
    ...usdcVesting.map((v) => BigInt(v.totalAmount) - BigInt(v.amountClaimed)),
  ].reduce((a, b) => a + b, BigInt(0)).toString();

  const totalEurcLocked = [
    ...eurcEscrows.map((e) => BigInt(e.amount)),
    ...eurcVesting.map((v) => BigInt(v.totalAmount) - BigInt(v.amountClaimed)),
  ].reduce((a, b) => a + b, BigInt(0)).toString();

  const completedTransfers = crosschainTransfers.filter((t) => t.status === "complete");
  const completedCrosschainVolume = completedTransfers
    .map((t) => BigInt(t.amount))
    .reduce((a, b) => a + b, BigInt(0))
    .toString();

  return res.json({
    totalEscrows: escrows.length,
    activeEscrows,
    disputedEscrows,
    releasedEscrows,
    totalVestingSchedules: vestingSchedules.length,
    totalCrosschainTransfers: crosschainTransfers.length,
    totalUsdcLocked,
    totalEurcLocked,
    completedCrosschainVolume,
  });
});

router.get("/activity", async (req, res) => {
  const query = GetDashboardActivityQueryParams.safeParse(req.query);
  const limit = query.success ? (query.data.limit ?? 20) : 20;

  const rows = await db
    .select()
    .from(activityLogTable)
    .orderBy(desc(activityLogTable.timestamp))
    .limit(limit);

  return res.json(
    rows.map((r) => ({
      id: r.id,
      type: r.type,
      description: r.description,
      txHash: r.txHash,
      chainId: r.chainId,
      timestamp: r.timestamp.toISOString(),
      metadata: r.metadata ?? null,
    }))
  );
});

export default router;
