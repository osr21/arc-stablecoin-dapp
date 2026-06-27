import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const fxForwardsTable = pgTable("fx_forwards", {
  id: serial("id").primaryKey(),
  partyA: text("party_a").notNull(),
  partyB: text("party_b").notNull(),
  usdcAmount: text("usdc_amount").notNull(),
  eurcAmount: text("eurc_amount").notNull(),
  impliedRate: text("implied_rate"),
  maturity: integer("maturity").notNull(),
  fundingDeadline: integer("funding_deadline").notNull(),
  status: text("status").notNull().default("created"),
  contractAddress: text("contract_address").notNull(),
  txHash: text("tx_hash").notNull().unique(),
  fundTxHash: text("fund_tx_hash"),
  settleTxHash: text("settle_tx_hash"),
  cancelTxHash: text("cancel_tx_hash"),
  onChainId: integer("on_chain_id"),
  chainId: integer("chain_id").notNull().default(5042002),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertFxForwardSchema = createInsertSchema(fxForwardsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertFxForward = z.infer<typeof insertFxForwardSchema>;
export type FxForward = typeof fxForwardsTable.$inferSelect;
