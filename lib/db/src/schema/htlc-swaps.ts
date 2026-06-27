import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const htlcSwapsTable = pgTable("htlc_swaps", {
  id:               serial("id").primaryKey(),
  depositor:        text("depositor").notNull(),
  recipient:        text("recipient").notNull(),
  token:            text("token").notNull(),
  amount:           text("amount").notNull(),
  hashlock:         text("hashlock").notNull(),
  timelock:         integer("timelock").notNull(),
  status:           text("status").notNull().default("active"),
  preimage:         text("preimage"),
  claimTxHash:      text("claim_tx_hash"),
  refundTxHash:     text("refund_tx_hash"),
  contractAddress:  text("contract_address").notNull(),
  txHash:           text("tx_hash").notNull().unique(),
  onChainId:        integer("on_chain_id"),
  chainId:          integer("chain_id").notNull().default(5042002),

  // ── Crosschain CCTP fields (null for single-chain HTLCs) ──────────────────
  swapMode:             text("swap_mode").default("single_chain"),
  destinationDomain:    integer("destination_domain"),
  mintRecipient:        text("mint_recipient"),      // bytes32 hex of recipient on dest chain
  maxFee:               text("max_fee"),             // raw base units, nullable
  minFinalityThreshold: integer("min_finality_threshold"),
  relayTxHash:          text("relay_tx_hash"),       // CCTP attestation relay tx on dest chain

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertHtlcSwapSchema = createInsertSchema(htlcSwapsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertHtlcSwap = z.infer<typeof insertHtlcSwapSchema>;
export type HtlcSwap = typeof htlcSwapsTable.$inferSelect;
