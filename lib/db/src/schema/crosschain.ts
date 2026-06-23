import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const crosschainTransfersTable = pgTable("crosschain_transfers", {
  id: serial("id").primaryKey(),
  sender: text("sender").notNull(),
  recipient: text("recipient").notNull(),
  sourceChain: text("source_chain").notNull(),
  destChain: text("dest_chain").notNull(),
  token: text("token").notNull(),
  amount: text("amount").notNull(),
  status: text("status").notNull().default("pending"),
  burnTxHash: text("burn_tx_hash").notNull().unique(),
  mintTxHash: text("mint_tx_hash"),
  messageHash: text("message_hash"),
  attestation: text("attestation"),
  hookData: text("hook_data"),
  sourceChainId: integer("source_chain_id").notNull().default(5042002),
  destChainId: integer("dest_chain_id"),
  chainId: integer("chain_id").notNull().default(5042002),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertCrosschainTransferSchema = createInsertSchema(crosschainTransfersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCrosschainTransfer = z.infer<typeof insertCrosschainTransferSchema>;
export type CrosschainTransfer = typeof crosschainTransfersTable.$inferSelect;
