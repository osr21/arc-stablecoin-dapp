import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const agentsTable = pgTable("agents", {
  id:              serial("id").primaryKey(),
  onChainId:       integer("on_chain_id"),
  owner:           text("owner").notNull(),
  name:            text("name").notNull(),
  agentType:       text("agent_type").notNull(),
  metadataUri:     text("metadata_uri"),
  status:          text("status").notNull().default("active"),
  totalVolume:     text("total_volume").notNull().default("0"),
  txCount:         integer("tx_count").notNull().default(0),
  reputationScore: integer("reputation_score").notNull().default(0),
  contractAddress: text("contract_address").notNull(),
  txHash:          text("tx_hash").notNull().unique(),
  chainId:         integer("chain_id").notNull().default(5042002),
  createdAt:       timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:       timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertAgentSchema = createInsertSchema(agentsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAgent = z.infer<typeof insertAgentSchema>;
export type Agent = typeof agentsTable.$inferSelect;
