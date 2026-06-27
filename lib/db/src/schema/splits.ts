import { pgTable, text, serial, timestamp, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const splitsTable = pgTable("splits", {
  id:               serial("id").primaryKey(),
  onChainId:        integer("on_chain_id"),
  creator:          text("creator").notNull(),
  token:            text("token").notNull(),
  recipients:       text("recipients").notNull(),   // JSON array of addresses
  shares:           text("shares").notNull(),        // JSON array of basis points
  description:      text("description"),
  totalDistributed: text("total_distributed").notNull().default("0"),
  active:           boolean("active").notNull().default(true),
  contractAddress:  text("contract_address").notNull(),
  txHash:           text("tx_hash").notNull().unique(),
  chainId:          integer("chain_id").notNull().default(5042002),
  createdAt:        timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:        timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const splitDistributionsTable = pgTable("split_distributions", {
  id:            serial("id").primaryKey(),
  splitId:       integer("split_id").notNull(),
  amount:        text("amount").notNull(),
  txHash:        text("tx_hash").notNull().unique(),
  distributedBy: text("distributed_by").notNull(),
  chainId:       integer("chain_id").notNull().default(5042002),
  createdAt:     timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertSplitSchema = createInsertSchema(splitsTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertSplitDistributionSchema = createInsertSchema(splitDistributionsTable).omit({ id: true, createdAt: true });
export type InsertSplit = z.infer<typeof insertSplitSchema>;
export type Split = typeof splitsTable.$inferSelect;
export type SplitDistribution = typeof splitDistributionsTable.$inferSelect;
