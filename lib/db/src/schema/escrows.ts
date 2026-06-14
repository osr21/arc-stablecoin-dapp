import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const escrowsTable = pgTable("escrows", {
  id: serial("id").primaryKey(),
  depositor: text("depositor").notNull(),
  beneficiary: text("beneficiary").notNull(),
  arbiter: text("arbiter").notNull(),
  token: text("token").notNull(),
  amount: text("amount").notNull(),
  releaseTime: integer("release_time").notNull(),
  status: text("status").notNull().default("active"),
  conditionType: text("condition_type"),
  conditionData: text("condition_data"),
  contractAddress: text("contract_address").notNull(),
  txHash: text("tx_hash").notNull(),
  disputeTxHash: text("dispute_tx_hash"),
  releaseTxHash: text("release_tx_hash"),
  disputeReason: text("dispute_reason"),
  chainId: integer("chain_id").notNull().default(5042002),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertEscrowSchema = createInsertSchema(escrowsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertEscrow = z.infer<typeof insertEscrowSchema>;
export type Escrow = typeof escrowsTable.$inferSelect;
