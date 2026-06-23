import { createPublicClient, createWalletClient, http, decodeEventLog, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { db, escrowsTable, activityLogTable } from "@workspace/db";
import { eq, and, lt } from "drizzle-orm";
import { logger } from "./logger";

const ARC_RPC = "https://rpc.testnet.arc.network";
const INTERVAL_MS = 60_000;

// Allowlist of contract addresses the keeper is permitted to call autoRelease() on.
// Must use lowercase for comparison — Ethereum addresses are case-insensitive.
const ALLOWED_CONTRACTS = new Set([
  "0x935e53ddd824f4fc9321ba94e70161f20c23ad04", // ConditionalEscrow — Arc Testnet
]);

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

// Tracks consecutive on-chain failures per escrow DB id.
// After MAX_FAILURES consecutive failures the keeper enters a 10-minute backoff
// before retrying — prevents infinite gas burn while recovering from transient errors.
interface FailInfo { count: number; lastFailAt: number }
const failCounts = new Map<number, FailInfo>();
const MAX_FAILURES  = 3;
const BACKOFF_MS    = 10 * 60 * 1000; // 10 minutes

// ─── Live status (read by /api/keeper/status) ─────────────────────────────────
const state = {
  running:            false,
  keeperAddress:      null as string | null,
  lastTickAt:         null as string | null,
  successfulReleases: 0,
};

export function getKeeperStatus() {
  const inBackoff: { escrowId: number; retryInSecs: number }[] = [];
  for (const [escrowId, info] of failCounts) {
    if (info.count >= MAX_FAILURES) {
      const remaining = BACKOFF_MS - (Date.now() - info.lastFailAt);
      if (remaining > 0) inBackoff.push({ escrowId, retryInSecs: Math.ceil(remaining / 1000) });
    }
  }
  return { ...state, inBackoff };
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
    const failInfo = failCounts.get(escrow.id);
    if (failInfo && failInfo.count >= MAX_FAILURES) {
      const elapsed = Date.now() - failInfo.lastFailAt;
      if (elapsed < BACKOFF_MS) {
        const retryInSecs = Math.ceil((BACKOFF_MS - elapsed) / 1000);
        logger.warn({ escrowId: escrow.id, failCount: failInfo.count, retryInSecs }, "keeper: in backoff — will retry soon");
        continue;
      }
      // Backoff expired — reset and give it another chance.
      logger.info({ escrowId: escrow.id }, "keeper: backoff expired — retrying auto-release");
      failCounts.delete(escrow.id);
    }

    try {
      const onChainId = await resolveOnChainId(escrow, publicClient);

      if (onChainId === null) {
        logger.warn({ escrowId: escrow.id }, "keeper: could not resolve on-chain id — skipping");
        continue;
      }

      const contractAddr = escrow.contractAddress as `0x${string}`;
      if (!contractAddr || !/^0x[0-9a-fA-F]{40}$/.test(contractAddr)) {
        logger.warn({ escrowId: escrow.id, contractAddr }, "keeper: invalid contractAddress — skipping");
        continue;
      }

      // Allowlist: only call the known deployed ConditionalEscrow contract.
      // Without this, any user could POST an escrow pointing to a malicious contract
      // and force the keeper wallet to call arbitrary code.
      if (!ALLOWED_CONTRACTS.has(contractAddr.toLowerCase())) {
        logger.warn({ escrowId: escrow.id, contractAddr }, "keeper: contract not on allowlist — skipping");
        continue;
      }

      logger.info({ escrowId: escrow.id, onChainId: onChainId.toString(), contractAddr }, "keeper: calling autoRelease");

      const tx = await walletClient.writeContract({
        address: contractAddr,
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

      failCounts.delete(escrow.id);
      state.successfulReleases += 1;
      logger.info({ escrowId: escrow.id, tx }, "keeper: escrow auto-released ✓");
    } catch (err) {
      const prev  = failCounts.get(escrow.id);
      const next  = (prev?.count ?? 0) + 1;
      failCounts.set(escrow.id, { count: next, lastFailAt: Date.now() });
      logger.error({ err, escrowId: escrow.id, failCount: next, backoffMins: next >= MAX_FAILURES ? 10 : 0 }, "keeper: failed to auto-release escrow");
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

  state.running       = true;
  state.keeperAddress = account.address;

  const run = () => {
    state.lastTickAt = new Date().toISOString();
    return tick(publicClient, walletClient).catch((err) => logger.error({ err }, "keeper: tick error"));
  };

  run();
  setInterval(run, INTERVAL_MS);
}
