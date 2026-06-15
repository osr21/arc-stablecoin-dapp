import { Router } from "express";
import { db, escrowsTable, vestingSchedulesTable, crosschainTransfersTable, activityLogTable } from "@workspace/db";
import { desc, sql } from "drizzle-orm";
import { GetDashboardActivityQueryParams } from "@workspace/api-zod";

const router = Router();

function safeBigInt(val: string): bigint {
  try { return BigInt(val); } catch { return BigInt(0); }
}

router.get("/stats", async (_req, res) => {
  // Use SQL aggregation to avoid loading entire tables into memory (DoS prevention).
  const [escrowStats] = await db
    .select({
      total:    sql<number>`count(*)::int`,
      active:   sql<number>`count(*) filter (where status = 'active')::int`,
      disputed: sql<number>`count(*) filter (where status = 'disputed')::int`,
      released: sql<number>`count(*) filter (where status in ('released','resolved'))::int`,
      usdcLocked: sql<string>`coalesce(sum(case when token='USDC' and status in ('active','disputed') then amount::numeric else 0 end),0)::text`,
      eurcLocked: sql<string>`coalesce(sum(case when token='EURC' and status in ('active','disputed') then amount::numeric else 0 end),0)::text`,
    })
    .from(escrowsTable);

  const [vestingStats] = await db
    .select({
      total:      sql<number>`count(*)::int`,
      usdcLocked: sql<string>`coalesce(sum(case when token='USDC' then greatest(0,(total_amount::numeric - amount_claimed::numeric)) else 0 end),0)::text`,
      eurcLocked: sql<string>`coalesce(sum(case when token='EURC' then greatest(0,(total_amount::numeric - amount_claimed::numeric)) else 0 end),0)::text`,
    })
    .from(vestingSchedulesTable);

  const [crosschainStats] = await db
    .select({
      total:   sql<number>`count(*)::int`,
      volume:  sql<string>`coalesce(sum(case when status='complete' then amount::numeric else 0 end),0)::text`,
    })
    .from(crosschainTransfersTable);

  // Combine USDC/EURC locked across escrows + vesting using BigInt to avoid float imprecision.
  const totalUsdcLocked = (
    safeBigInt(escrowStats?.usdcLocked ?? "0") +
    safeBigInt(vestingStats?.usdcLocked ?? "0")
  ).toString();

  const totalEurcLocked = (
    safeBigInt(escrowStats?.eurcLocked ?? "0") +
    safeBigInt(vestingStats?.eurcLocked ?? "0")
  ).toString();

  return res.json({
    totalEscrows:              escrowStats?.total ?? 0,
    activeEscrows:             escrowStats?.active ?? 0,
    disputedEscrows:           escrowStats?.disputed ?? 0,
    releasedEscrows:           escrowStats?.released ?? 0,
    totalVestingSchedules:     vestingStats?.total ?? 0,
    totalCrosschainTransfers:  crosschainStats?.total ?? 0,
    totalUsdcLocked,
    totalEurcLocked,
    completedCrosschainVolume: crosschainStats?.volume ?? "0",
  });
});

router.get("/activity", async (req, res) => {
  const query = GetDashboardActivityQueryParams.safeParse(req.query);
  const limit = query.success ? Math.min(query.data.limit ?? 20, 100) : 20;

  const rows = await db
    .select()
    .from(activityLogTable)
    .orderBy(desc(activityLogTable.timestamp))
    .limit(limit);

  return res.json(
    rows.map((r) => ({
      id:          r.id,
      type:        r.type,
      description: r.description,
      txHash:      r.txHash,
      chainId:     r.chainId,
      timestamp:   r.timestamp.toISOString(),
      metadata:    r.metadata ?? null,
    }))
  );
});

export default router;
