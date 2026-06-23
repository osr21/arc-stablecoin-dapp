import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const vestingSchedulesTable = pgTable("vesting_schedules", {
  id: serial("id").primaryKey(),
  employer: text("employer").notNull(),
  beneficiary: text("beneficiary").notNull(),
  token: text("token").notNull(),
  totalAmount: text("total_amount").notNull(),
  cliffDuration: integer("cliff_duration").notNull(),
  vestingDuration: integer("vesting_duration").notNull(),
  startTime: integer("start_time").notNull(),
  amountClaimed: text("amount_claimed").notNull().default("0"),
  claimTxHash: text("claim_tx_hash"),
  contractAddress: text("contract_address").notNull(),
  txHash: text("tx_hash").notNull().unique(),
  chainId: integer("chain_id").notNull().default(5042002),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertVestingScheduleSchema = createInsertSchema(vestingSchedulesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertVestingSchedule = z.infer<typeof insertVestingScheduleSchema>;
export type VestingSchedule = typeof vestingSchedulesTable.$inferSelect;
