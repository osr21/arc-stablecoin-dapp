import { createPublicClient, createWalletClient, http, decodeEventLog, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { db, escrowsTable, activityLogTable } from "@workspace/db";
import { eq, and, lt } from "drizzle-orm";
import { logger } from "./logger";

const ARC_RPC = "https://rpc.testnet.arc.network";
const CONDITIONAL_ESCROW = "0xdD38D67Fe054308D56E4458fC47a43106871D874" as `0x${string}`;
const INTERVAL_MS = 60_000;

const ARC_CHAIN = {
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 6 },
  rpcUrls: { default: { http: [ARC_RPC] } },
} as const;

const ESCROW_ABI = parseAbi([
  "event EscrowCreated(uint256 indexed id, address depositor, address beneficiary, address arbiter, address token, uint256 amount, uint256 releaseTime, string conditionType)",
  "function autoRelease(uint256 id)",
]);

async function resolveOnChainId(
  escrow: { id: number; txHash: string; onChainId: number | null },
  publicClient: ReturnType<typeof createPublicClient>,
): Promise<bigint | null> {
  // Prefer the stored DB value — avoids an RPC round-trip
  if (escrow.onChainId !== null && escrow.onChainId !== undefined) {
    return BigInt(escrow.onChainId);
  }

  try {
    const receipt = await publicClient.getTransactionReceipt({
      hash: escrow.txHash as `0x${string}`,
    });
    for (const log of receipt.logs) {
      try {
        const decoded = decodeEventLog({
          abi: ESCROW_ABI,
          data: log.data,
          topics: log.topics as any,
        });
        if (decoded.eventName === "EscrowCreated") {
          const onChainId = (decoded.args as { id: bigint }).id;
          // Persist the ID so future ticks skip the RPC call
          await db
            .update(escrowsTable)
            .set({ onChainId: Number(onChainId) })
            .where(eq(escrowsTable.id, escrow.id));
          return onChainId;
        }
      } catch {
        // not this log — try next
      }
    }
  } catch (err) {
    logger.warn({ err, txHash: escrow.txHash }, "keeper: failed to fetch tx receipt");
  }
  return null;
}

async function tick(
  publicClient: ReturnType<typeof createPublicClient>,
  walletClient: ReturnType<typeof createWalletClient>,
): Promise<void> {
  const nowSecs = Math.floor(Date.now() / 1000);

  const expired = await db
    .select()
    .from(escrowsTable)
    .where(and(eq(escrowsTable.status, "active"), lt(escrowsTable.releaseTime, nowSecs)));

  if (expired.length === 0) return;

  logger.info({ count: expired.length }, "keeper: found expired escrows");

  for (const escrow of expired) {
    try {
      const onChainId = await resolveOnChainId(escrow, publicClient);

      if (onChainId === null) {
        logger.warn({ escrowId: escrow.id }, "keeper: could not resolve on-chain id — skipping");
        continue;
      }

      logger.info({ escrowId: escrow.id, onChainId: onChainId.toString() }, "keeper: calling autoRelease");

      const tx = await walletClient.writeContract({
        address: CONDITIONAL_ESCROW,
        abi: ESCROW_ABI,
        functionName: "autoRelease",
        args: [onChainId],
        chain: ARC_CHAIN as any,
        account: walletClient.account!,
      });

      await publicClient.waitForTransactionReceipt({ hash: tx });

      await db
        .update(escrowsTable)
        .set({ status: "released", releaseTxHash: tx })
        .where(eq(escrowsTable.id, escrow.id));

      await db.insert(activityLogTable).values({
        type: "escrow_released",
        description: `Escrow #${escrow.id} auto-released by keeper — funds sent to beneficiary`,
        txHash: tx,
        chainId: escrow.chainId,
      });

      logger.info({ escrowId: escrow.id, tx }, "keeper: escrow auto-released ✓");
    } catch (err) {
      logger.error({ err, escrowId: escrow.id }, "keeper: failed to auto-release escrow");
    }
  }
}

export function startKeeper(): void {
  const rawKey = process.env["DEPLOYER_PRIVATE_KEY"];
  if (!rawKey) {
    logger.warn("DEPLOYER_PRIVATE_KEY not set — auto-release keeper disabled");
    return;
  }

  const key = rawKey.startsWith("0x") ? (rawKey as `0x${string}`) : (`0x${rawKey}` as `0x${string}`);
  const account = privateKeyToAccount(key);

  const publicClient = createPublicClient({ transport: http(ARC_RPC) });
  const walletClient = createWalletClient({ account, transport: http(ARC_RPC) });

  logger.info({ address: account.address }, "keeper: auto-release keeper started");

  const run = () => tick(publicClient, walletClient).catch((err) => logger.error({ err }, "keeper: tick error"));

  run();
  setInterval(run, INTERVAL_MS);
}
