import { useState, useEffect, useCallback } from "react";
import { createWalletClient, createPublicClient, custom, http, encodeFunctionData, isAddress } from "viem";
import { useListCrosschainTransfers, useCreateCrosschainTransfer, useUpdateCrosschainTransferStatus, getListCrosschainTransfersQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { useWallet } from "../lib/wallet";
import { formatTokenAmount } from "../lib/format";
import {
  CONTRACT_ADDRESSES, CROSSCHAIN_ESCROW_ABI, ERC20_ABI, DEST_DOMAINS,
  DEST_CHAIN_CONFIGS, MESSAGE_TRANSMITTER_V2_ADDRESS,
  TIME_LOCK_HOOK_ADDRESSES, TIME_LOCK_HOOK_ABI,
  encodeTimeLockHookData, computeTimeLockReleaseId, ARC_CCTP_DOMAIN,
  parseToken, ARC_TESTNET,
} from "../lib/contracts";
import type { Address } from "viem";

interface TimeLockMeta {
  type: "time_lock";
  releaseId: `0x${string}`;
  unlockTimestamp: number;
  finalRecipient: string;
  hookAddress?: string;
}

const STATUS_LABELS: Record<string, string> = {
  pending:   "Pending",
  attesting: "Attesting",
  complete:  "Complete",
  failed:    "Failed",
};

const RECEIVE_MESSAGE_ABI = [
  {
    name: "receiveMessage",
    type: "function" as const,
    stateMutability: "nonpayable" as const,
    inputs: [
      { name: "message",     type: "bytes" as const },
      { name: "attestation", type: "bytes" as const },
    ],
    outputs: [{ name: "success", type: "bool" as const }],
  },
];

interface AttestationResult {
  status: string;
  messageBytes: string | null;
  attestation: string | null;
  mintRecipient: string | null;
  receiveTarget: {
    chain: string;
    chainId: number;
    explorerBase: string;
    explorerTx: string;
  } | null;
  relayFeeUsdc: string | null;
}

// ~0.003 ETH: enough headroom for receiveMessage gas on any testnet at current base fees
const GAS_THRESHOLD_WEI = 3_000_000_000_000_000n;

function formatEth(wei: bigint): string {
  return (Number(wei) / 1e18).toFixed(5);
}

function ReceiveDialog({
  txHash, destChain, transferId, walletAddress, timeLockMeta, transferAmount,
}: {
  txHash: string;
  destChain: string;
  transferId: number;
  walletAddress: string | undefined;
  timeLockMeta?: TimeLockMeta;
  transferAmount?: string;
}) {
  const [open, setOpen]         = useState(false);
  const [attest, setAttest]     = useState<AttestationResult | null>(null);
  const [polling, setPolling]   = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [claimTx, setClaimTx]   = useState<string | null>(null);
  const [err, setErr]           = useState<string | null>(null);
  const [copied, setCopied]     = useState(false);
  const [destBalance, setDestBalance] = useState<bigint | null>(null);
  const [claimingTimeLock, setClaimingTimeLock] = useState(false);
  const [timeLockClaimTx, setTimeLockClaimTx]   = useState<string | null>(null);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  const queryClient = useQueryClient();
  const updateStatus = useUpdateCrosschainTransferStatus({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListCrosschainTransfersQueryKey() });
      },
    },
  });

  const destConfig = DEST_CHAIN_CONFIGS[destChain];

  const checkDestBalance = useCallback(async () => {
    if (!destConfig) return;
    const eth = (window as any).ethereum;
    if (!eth) return;
    try {
      const accounts: string[] = await eth.request({ method: "eth_accounts" });
      if (!accounts[0]) return;
      const pc = createPublicClient({
        chain: {
          id: destConfig.chainId,
          name: destConfig.name,
          nativeCurrency: destConfig.nativeCurrency,
          rpcUrls: { default: { http: [destConfig.rpc] }, public: { http: [destConfig.rpc] } },
        } as any,
        transport: http(destConfig.rpc),
      });
      const balance = await pc.getBalance({ address: accounts[0] as Address });
      setDestBalance(balance);
    } catch {
      // non-fatal — balance display is informational
    }
  }, [destConfig]);

  const poll = useCallback(async () => {
    setPolling(true);
    try {
      const res = await fetch(`/api/cctp/attestation/${txHash}`);
      const data: AttestationResult = await res.json();
      setAttest(data);
    } catch {
    } finally {
      setPolling(false);
    }
  }, [txHash]);

  useEffect(() => {
    if (!open) return;
    poll();
    const id = setInterval(poll, 15_000);
    return () => clearInterval(id);
  }, [open, poll]);

  // Check destination ETH balance once attestation is confirmed ready
  useEffect(() => {
    if (attest?.attestation) checkDestBalance();
  }, [attest?.attestation, checkDestBalance]);

  // Flip status to "attesting" once Circle has signed the message
  const [markedAttesting, setMarkedAttesting] = useState(false);
  useEffect(() => {
    if (attest?.attestation && !markedAttesting) {
      setMarkedAttesting(true);
      updateStatus.mutate({ id: transferId, data: { status: "attesting", caller: walletAddress } as any });
    }
  }, [attest?.attestation, markedAttesting, transferId, updateStatus, walletAddress]);

  // Tick the clock every 30 s so the time-lock countdown stays fresh
  useEffect(() => {
    if (!open || !timeLockMeta) return;
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 30_000);
    return () => clearInterval(id);
  }, [open, timeLockMeta]);

  const copyText = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleSelfClaim = async () => {
    if (!attest?.messageBytes || !attest?.attestation) return;
    if (!destConfig) { setErr("Destination chain config not found"); return; }

    const eth = (window as any).ethereum;
    if (!eth) { setErr("MetaMask required for self-relay"); return; }

    setErr(null);
    setClaiming(true);
    try {
      const chainHex = `0x${destConfig.chainId.toString(16)}`;
      try {
        await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: chainHex }] });
      } catch (switchErr: any) {
        if (switchErr.code === 4902) {
          await eth.request({
            method: "wallet_addEthereumChain",
            params: [{
              chainId: chainHex,
              chainName: destConfig.name,
              nativeCurrency: destConfig.nativeCurrency,
              rpcUrls: [destConfig.rpc],
            }],
          });
        } else throw switchErr;
      }

      const accounts: string[] = await eth.request({ method: "eth_accounts" });
      const account = accounts[0] as Address;
      const destViemChain = {
        id: destConfig.chainId,
        name: destConfig.name,
        nativeCurrency: destConfig.nativeCurrency,
        rpcUrls: { default: { http: [destConfig.rpc] }, public: { http: [destConfig.rpc] } },
      } as const;

      const wc = createWalletClient({ chain: destViemChain as any, transport: custom(eth) });
      const pc = createPublicClient({ chain: destViemChain as any, transport: http(destConfig.rpc) });

      // Fetch current fee data and double maxFeePerGas so we always clear the base fee,
      // even if it ticks up between estimation and submission.
      const feeData = await pc.estimateFeesPerGas().catch(() => null);
      const gasBump = feeData?.maxFeePerGas != null
        ? { maxFeePerGas: feeData.maxFeePerGas * 2n, maxPriorityFeePerGas: (feeData.maxPriorityFeePerGas ?? 1_000_000n) }
        : {};

      const hash = await wc.writeContract({
        address: MESSAGE_TRANSMITTER_V2_ADDRESS,
        abi: RECEIVE_MESSAGE_ABI,
        functionName: "receiveMessage",
        args: [attest.messageBytes as `0x${string}`, attest.attestation as `0x${string}`],
        account,
        chain: destViemChain as any,
        ...gasBump,
      });
      await pc.waitForTransactionReceipt({ hash });
      setClaimTx(hash);
      updateStatus.mutate({ id: transferId, data: { status: "complete", mintTxHash: hash, caller: walletAddress } as any });
    } catch (e: any) {
      setErr(e.shortMessage ?? e.message ?? "Claim failed");
    } finally {
      setClaiming(false);
    }
  };

  const handleTimeLockClaim = async () => {
    if (!timeLockMeta) return;
    if (!destConfig) { setErr("Destination chain config not found"); return; }
    // Prefer the address recorded at burn time (guards against redeployment breaking in-flight transfers)
    const hookAddress = (timeLockMeta.hookAddress as `0x${string}` | undefined) ?? TIME_LOCK_HOOK_ADDRESSES[destChain];
    if (!hookAddress) { setErr(`TimeLockHook not deployed on ${destChain} — deploy contracts/src/TimeLockHook.sol first`); return; }

    const eth = (window as any).ethereum;
    if (!eth) { setErr("MetaMask required to claim"); return; }

    setErr(null);
    setClaimingTimeLock(true);
    try {
      const chainHex = `0x${destConfig.chainId.toString(16)}`;
      try {
        await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: chainHex }] });
      } catch (switchErr: any) {
        if (switchErr.code === 4902) {
          await eth.request({
            method: "wallet_addEthereumChain",
            params: [{ chainId: chainHex, chainName: destConfig.name, nativeCurrency: destConfig.nativeCurrency, rpcUrls: [destConfig.rpc] }],
          });
        } else throw switchErr;
      }

      const accounts: string[] = await eth.request({ method: "eth_accounts" });
      const account = accounts[0] as Address;
      const destViemChain = {
        id: destConfig.chainId, name: destConfig.name,
        nativeCurrency: destConfig.nativeCurrency,
        rpcUrls: { default: { http: [destConfig.rpc] }, public: { http: [destConfig.rpc] } },
      } as const;

      const wc = createWalletClient({ chain: destViemChain as any, transport: custom(eth) });
      const pc = createPublicClient({ chain: destViemChain as any, transport: http(destConfig.rpc) });

      // Always recompute releaseId from raw components — the stored value may be stale
      // (e.g. computed with old padHex direction before the dir:'left' fix).
      // This ensures correctness for both old and new transfers.
      const amount = BigInt(transferAmount ?? "0");
      const freshReleaseId = computeTimeLockReleaseId(
        ARC_CCTP_DOMAIN,
        CONTRACT_ADDRESSES.CROSSCHAIN_ESCROW,
        timeLockMeta.finalRecipient as Address,
        amount,
        BigInt(timeLockMeta.unlockTimestamp),
      );

      // Preflight: check the release exists before prompting MetaMask
      const releaseInfo = await pc.readContract({
        address: hookAddress,
        abi: TIME_LOCK_HOOK_ABI,
        functionName: "getRelease",
        args: [freshReleaseId],
      }) as unknown as [string, bigint, bigint, boolean, boolean];
      if (!releaseInfo[0] || releaseInfo[0] === "0x0000000000000000000000000000000000000000") {
        setErr(
          "Release not found on-chain. The relay step (\"Mint to TimeLockHook\") must be completed before claiming. " +
          "Open the dialog and click the relay button to submit the Circle attestation first."
        );
        return;
      }
      if (releaseInfo[3]) {
        setErr("This release has already been claimed.");
        return;
      }

      const hash = await wc.writeContract({
        address: hookAddress,
        abi: TIME_LOCK_HOOK_ABI,
        functionName: "claim",
        args: [freshReleaseId],
        account,
        chain: destViemChain as any,
      });
      await pc.waitForTransactionReceipt({ hash });
      setTimeLockClaimTx(hash);
    } catch (e: any) {
      setErr(e.shortMessage ?? e.message ?? "Claim failed");
    } finally {
      setClaimingTimeLock(false);
    }
  };

  const isReady  = !!attest?.attestation;
  const explorer = attest?.receiveTarget?.explorerTx ?? destConfig?.explorerTx;
  const isTimeLock = !!timeLockMeta;
  const timeLockUnlocked = isTimeLock && now >= (timeLockMeta?.unlockTimestamp ?? Infinity);
  const timeLockSecsLeft = isTimeLock ? Math.max(0, (timeLockMeta?.unlockTimestamp ?? 0) - now) : 0;

  function formatCountdown(secs: number): string {
    if (secs <= 0) return "now";
    if (secs < 60) return `${secs}s`;
    if (secs < 3600) return `${Math.ceil(secs / 60)}m`;
    if (secs < 86400) return `${Math.ceil(secs / 3600)}h`;
    return `${Math.ceil(secs / 86400)}d`;
  }

  const calldata = isReady
    ? encodeFunctionData({
        abi: RECEIVE_MESSAGE_ABI,
        functionName: "receiveMessage",
        args: [attest!.messageBytes as `0x${string}`, attest!.attestation as `0x${string}`],
      })
    : null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="h-6 text-xs px-2 text-primary">
          Receive ↗
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[560px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isTimeLock ? "Time-Locked USDC Transfer" : `Receive USDC on ${destChain}`}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-2 text-sm">
          {/* Step progress */}
          {isTimeLock ? (
            <div className="grid grid-cols-4 gap-1.5 text-center text-xs">
              {[
                { label: "Burn on Arc",            done: true },
                { label: "Circle attests",          done: isReady },
                { label: "Mint to TimeLockHook",    done: !!claimTx },
                { label: "Claim after unlock",      done: !!timeLockClaimTx },
              ].map((s, i) => (
                <div key={i} className={`rounded-md p-2 border ${s.done ? "border-green-500/40 bg-green-500/10 text-green-400" : "border-border bg-muted/40 text-muted-foreground"}`}>
                  <div className="font-semibold">{s.done ? "✓" : i + 1}</div>
                  <div className="leading-tight mt-0.5">{s.label}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2 text-center text-xs">
              {[
                { label: "Burn on Arc",        done: true },
                { label: "Circle attests",     done: isReady },
                { label: "Mint on dest chain", done: !!claimTx },
              ].map((s, i) => (
                <div key={i} className={`rounded-md p-2 border ${s.done ? "border-green-500/40 bg-green-500/10 text-green-400" : "border-border bg-muted/40 text-muted-foreground"}`}>
                  <div className="font-semibold">{s.done ? "✓" : i + 1}</div>
                  <div>{s.label}</div>
                </div>
              ))}
            </div>
          )}

          {/* Time-lock info panel */}
          {isTimeLock && timeLockMeta && (
            <div className="rounded-md border border-blue-500/30 bg-blue-500/5 p-3 space-y-2 text-xs">
              <p className="text-blue-400 font-medium">⏳ Time-Locked Transfer</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-muted-foreground">
                <span>Beneficiary</span>
                <span className="font-mono text-foreground break-all">{timeLockMeta.finalRecipient.slice(0, 10)}…{timeLockMeta.finalRecipient.slice(-6)}</span>
                <span>Unlock time</span>
                <span className="text-foreground">{new Date(timeLockMeta.unlockTimestamp * 1000).toLocaleString()}</span>
                <span>Status</span>
                <span className={timeLockUnlocked ? "text-green-400" : "text-yellow-400"}>
                  {timeLockUnlocked ? "Unlocked — ready to claim" : `Locked (unlocks in ${formatCountdown(timeLockSecsLeft)})`}
                </span>
              </div>
              <details>
                <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Release ID</summary>
                <div className="font-mono mt-1 break-all text-muted-foreground">{timeLockMeta.releaseId}</div>
              </details>
            </div>
          )}

          {/* Time-lock claim success */}
          {timeLockClaimTx && (
            <div className="rounded-md border border-green-500/40 bg-green-500/10 p-3 space-y-1">
              <p className="text-green-400 font-medium">✓ USDC claimed from TimeLockHook!</p>
              <a href={`${explorer}/${timeLockClaimTx}`} target="_blank" rel="noreferrer"
                className="text-xs font-mono text-primary hover:underline break-all">
                {timeLockClaimTx} ↗
              </a>
            </div>
          )}

          {/* Mint-to-hook success (before time-lock claim) */}
          {claimTx && !timeLockClaimTx && (
            <div className="rounded-md border border-green-500/40 bg-green-500/10 p-3 space-y-1">
              <p className="text-green-400 font-medium">
                ✓ USDC {isTimeLock ? "minted to TimeLockHook" : `minted on ${destChain}`}
              </p>
              <a href={`${explorer}/${claimTx}`} target="_blank" rel="noreferrer"
                className="text-xs font-mono text-primary hover:underline break-all">
                {claimTx} ↗
              </a>
            </div>
          )}

          {/* Time-lock claim button — shown after bridge mint completes */}
          {isTimeLock && claimTx && !timeLockClaimTx && (
            <div className="space-y-3">
              <div className="rounded-md bg-muted/50 border border-border p-3 text-xs space-y-1 text-muted-foreground">
                <p>USDC is now held in <strong>TimeLockHook</strong> on {destChain}.</p>
                <p>
                  {timeLockUnlocked
                    ? "The time-lock has expired — you can claim now."
                    : `Claimable in ${formatCountdown(timeLockSecsLeft)}. Come back after the unlock time.`}
                </p>
                <p>Only the beneficiary address can call <code className="text-foreground">claim()</code>.</p>
              </div>
              <Button
                className="w-full"
                disabled={!timeLockUnlocked || claimingTimeLock}
                onClick={handleTimeLockClaim}
              >
                {claimingTimeLock
                  ? "Claiming…"
                  : !timeLockUnlocked
                  ? `Locked for ${formatCountdown(timeLockSecsLeft)} more`
                  : "Claim USDC from TimeLockHook"}
              </Button>
            </div>
          )}

          {/* Attestation status */}
          {!claimTx && (
            <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
              <span className="text-muted-foreground text-xs">Circle attestation</span>
              <div className="flex items-center gap-2">
                <Badge variant={isReady ? "secondary" : "outline"} className="text-xs">
                  {polling && !attest ? "Checking…" : isReady ? "Ready ✓" : "Pending"}
                </Badge>
                <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={poll} disabled={polling}>
                  {polling ? "…" : "Refresh"}
                </Button>
              </div>
            </div>
          )}

          {/* Self-relay */}
          {!claimTx && (
            <div className="space-y-3">
              {/* Low balance warning — shown as soon as we know */}
              {isReady && destBalance !== null && destBalance < GAS_THRESHOLD_WEI && destConfig && (
                <div className="rounded-md border border-yellow-500/40 bg-yellow-500/10 p-3 text-xs space-y-1">
                  <p className="text-yellow-400 font-medium">
                    ⚠ Low {destConfig.nativeCurrency.symbol} balance on {destChain}
                  </p>
                  <p className="text-muted-foreground">
                    Your wallet has <span className="text-foreground font-mono">{formatEth(destBalance)} {destConfig.nativeCurrency.symbol}</span> on {destChain}.
                    The <code>receiveMessage</code> call typically costs ~0.001–0.003 {destConfig.nativeCurrency.symbol} in gas.
                    Top up before claiming — the tx will revert with "insufficient funds" otherwise.
                  </p>
                  <div className="flex flex-wrap gap-3 pt-1">
                    <a href="https://faucet.circle.com" target="_blank" rel="noreferrer"
                      className="text-primary hover:underline">Circle faucet ↗</a>
                    <a href="https://sepolia-faucet.pk910.de" target="_blank" rel="noreferrer"
                      className="text-primary hover:underline">Sepolia PoW faucet ↗</a>
                    <a href="https://www.alchemy.com/faucets/ethereum-sepolia" target="_blank" rel="noreferrer"
                      className="text-primary hover:underline">Alchemy faucet ↗</a>
                  </div>
                </div>
              )}

              {/* Balance OK indicator */}
              {isReady && destBalance !== null && destBalance >= GAS_THRESHOLD_WEI && destConfig && (
                <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
                  <span>{destChain} balance</span>
                  <span className="text-green-400 font-mono">
                    {formatEth(destBalance)} {destConfig.nativeCurrency.symbol} ✓
                  </span>
                </div>
              )}

              <div className="rounded-md bg-muted/50 border border-border p-3 text-xs space-y-1 text-muted-foreground">
                <p>MetaMask switches to <strong>{destChain}</strong> and calls <code className="text-foreground">receiveMessage</code> on the Circle MessageTransmitter.</p>
                <p>You receive the <strong>full amount</strong> — no relay fee. Gas costs ~0.001–0.003 {destConfig?.nativeCurrency.symbol ?? "ETH"} on {destChain}.</p>
              </div>
              <Button
                className="w-full"
                disabled={!isReady || claiming || !destConfig || (destBalance !== null && destBalance < GAS_THRESHOLD_WEI)}
                onClick={handleSelfClaim}
              >
                {claiming
                  ? "Switching chain & submitting…"
                  : !isReady
                  ? "Waiting for attestation…"
                  : destBalance !== null && destBalance < GAS_THRESHOLD_WEI
                  ? `Insufficient ${destConfig?.nativeCurrency.symbol ?? "ETH"} for gas — top up first`
                  : `Claim USDC on ${destChain} via MetaMask`}
              </Button>
            </div>
          )}

          {err && <p className="text-xs text-destructive">{err}</p>}

          {/* Raw data — copy for Etherscan manual submit */}
          {attest?.messageBytes && (
            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                Raw data (manual submit via Etherscan)
              </summary>
              <div className="mt-2 space-y-2">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-muted-foreground">message bytes</span>
                    <Button variant="ghost" size="sm" className="h-5 text-xs" onClick={() => copyText(attest.messageBytes!)}>
                      {copied ? "Copied!" : "Copy"}
                    </Button>
                  </div>
                  <div className="font-mono bg-muted rounded p-2 break-all max-h-14 overflow-y-auto text-xs">
                    {attest.messageBytes}
                  </div>
                </div>
                {attest.attestation && (
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-muted-foreground">attestation</span>
                      <Button variant="ghost" size="sm" className="h-5 text-xs" onClick={() => copyText(attest.attestation!)}>
                        Copy
                      </Button>
                    </div>
                    <div className="font-mono bg-muted rounded p-2 break-all max-h-14 overflow-y-auto text-xs">
                      {attest.attestation}
                    </div>
                  </div>
                )}
                {calldata && (
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-muted-foreground">receiveMessage calldata</span>
                      <Button variant="ghost" size="sm" className="h-5 text-xs" onClick={() => copyText(calldata)}>
                        Copy
                      </Button>
                    </div>
                    <div className="font-mono bg-muted rounded p-2 break-all max-h-14 overflow-y-auto text-xs">
                      {calldata}
                    </div>
                  </div>
                )}
              </div>
            </details>
          )}

          <div className="text-xs text-muted-foreground border-t border-border pt-3 flex flex-wrap gap-4">
            <a href={`https://testnet.arcscan.app/tx/${txHash}`} target="_blank" rel="noreferrer" className="text-primary hover:underline">
              Burn tx on ArcScan ↗
            </a>
            {attest?.receiveTarget && (
              <a href={`${attest.receiveTarget.explorerBase}/0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275#writeContract`}
                target="_blank" rel="noreferrer" className="text-primary hover:underline">
                MessageTransmitterV2 on {destChain} ↗
              </a>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Predefined condition types with labels, description templates and on-chain hints
const CONDITION_TYPES = [
  {
    value:       "unconditional",
    label:       "Unconditional",
    description: "Unconditional CCTP transfer",
    hint:        "USDC mints to recipient immediately after attestation.",
  },
  {
    value:       "time_lock",
    label:       "Time-locked release",
    description: "Funds released after time-lock condition is met",
    hint:        "USDC mints to TimeLockHook on the destination chain, enforcing an on-chain time-lock. Set the unlock time below — only the beneficiary can claim after it expires.",
  },
  {
    value:       "oracle",
    label:       "Oracle-verified",
    description: "Funds released upon external oracle confirmation",
    hint:        "Encode an oracle contract that the hook calls before releasing USDC to the recipient.",
  },
  {
    value:       "multisig",
    label:       "Multisig approval",
    description: "Funds released upon multisig approval",
    hint:        "Encode a Gnosis Safe or similar multisig as the hook handler on the destination.",
  },
  {
    value:       "custom",
    label:       "Custom condition",
    description: "",
    hint:        "Describe any custom condition — stored on-chain in the CrosschainEscrow event.",
  },
] as const;

export default function Crosschain() {
  const { data: transfers, isLoading } = useListCrosschainTransfers();
  const queryClient = useQueryClient();
  const { address, walletClient, publicClient, isConnected, isWrongNetwork, switchToArc } = useWallet();

  const [createOpen, setCreateOpen]   = useState(false);
  const [txPending, setTxPending]     = useState(false);
  const [usdcBalance, setUsdcBalance] = useState<bigint | null>(null);
  const [conditionType, setConditionType] = useState("unconditional");
  const [conditionParams, setConditionParams] = useState({
    unlockTime:      "",
    oracleCondition: "",
    multisigM:       "2",
    multisigN:       "3",
  });

  const selectedCondition = CONDITION_TYPES.find(c => c.value === conditionType) ?? CONDITION_TYPES[0];

  const [formData, setFormData] = useState({
    recipient:            "",
    destChain:            "Ethereum Sepolia",
    amount:               "",
    conditionDescription: "Unconditional CCTP transfer",
  });

  // Fetch USDC balance on Arc when the dialog opens
  useEffect(() => {
    if (!createOpen || !address) return;
    publicClient.readContract({
      address: CONTRACT_ADDRESSES.USDC,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [address],
    }).then((bal: unknown) => setUsdcBalance(bal as bigint)).catch(() => {});
  }, [createOpen, address, publicClient]);

  // Derive description from condition type + params (skip for "custom" — user controls it directly)
  useEffect(() => {
    if (conditionType === "custom") return;
    let desc = "";
    if (conditionType === "unconditional") {
      desc = "Unconditional CCTP transfer";
    } else if (conditionType === "time_lock") {
      if (conditionParams.unlockTime) {
        const dt = new Date(conditionParams.unlockTime);
        desc = `Funds released after ${dt.toISOString().replace("T", " ").slice(0, 16)} UTC`;
      } else {
        desc = "Funds released after time-lock condition is met";
      }
    } else if (conditionType === "oracle") {
      const cond = conditionParams.oracleCondition.trim();
      desc = cond
        ? `Funds released upon oracle confirmation of: ${cond}`
        : "Funds released upon external oracle confirmation";
    } else if (conditionType === "multisig") {
      desc = `Funds released upon ${conditionParams.multisigM}-of-${conditionParams.multisigN} multisig approval`;
    }
    setFormData(prev => ({ ...prev, conditionDescription: desc }));
  }, [conditionType, conditionParams]);

  const parsedAmount  = parseFloat(formData.amount) || 0;
  const hasAmount     = parsedAmount > 0;
  const exceedsBalance = usdcBalance !== null && hasAmount && parseToken(formData.amount) > usdcBalance;

  const createTransfer = useCreateCrosschainTransfer({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListCrosschainTransfersQueryKey() });
        setCreateOpen(false);
      },
    },
  });

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!address || !walletClient) return;
    if (isWrongNetwork) { await switchToArc(); return; }

    if (!isAddress(formData.recipient)) {
      alert("Invalid recipient address — must be a valid 0x… Ethereum address");
      return;
    }

    // ── Time-lock validation ──────────────────────────────────────────────────
    if (conditionType === "time_lock") {
      if (!conditionParams.unlockTime) {
        alert("Set an unlock date & time for the time-lock transfer");
        return;
      }
      const unlockTs = Math.floor(new Date(conditionParams.unlockTime).getTime() / 1000);
      if (unlockTs <= Math.floor(Date.now() / 1000)) {
        alert("Unlock time must be in the future");
        return;
      }
      const hookAddr = TIME_LOCK_HOOK_ADDRESSES[formData.destChain];
      if (!hookAddr) {
        alert(
          `TimeLockHook is not yet deployed on ${formData.destChain}.\n\n` +
          `Deploy it with:\n  forge script script/DeployTimeLockHook.s.sol \\\n    --rpc-url <rpc> --private-key "$DEPLOYER_PRIVATE_KEY" --broadcast\n\n` +
          `Then update TIME_LOCK_HOOK_ADDRESSES in contracts.ts.`
        );
        return;
      }
    }

    setTxPending(true);
    try {
      const rawAmount  = parseToken(formData.amount);
      const destDomain = DEST_DOMAINS[formData.destChain] ?? 0;

      // ── Compute effective recipient and hookData ───────────────────────────
      // For time-lock: mintRecipient = TimeLockHook (not the user);
      //               hookData carries (finalRecipient, unlockTimestamp).
      // For all others: mintRecipient = formData.recipient, hookData = empty.
      let contractRecipient: Address = formData.recipient as Address;
      let encodedHookData: `0x${string}` = "0x";
      let timeLockMetaJson: string | null = null;

      if (conditionType === "time_lock") {
        const unlockTimestamp = BigInt(
          Math.floor(new Date(conditionParams.unlockTime).getTime() / 1000)
        );
        const hookAddr = TIME_LOCK_HOOK_ADDRESSES[formData.destChain]!;
        contractRecipient = hookAddr;
        encodedHookData   = encodeTimeLockHookData(formData.recipient as Address, unlockTimestamp, rawAmount);

        const releaseId = computeTimeLockReleaseId(
          ARC_CCTP_DOMAIN,
          CONTRACT_ADDRESSES.CROSSCHAIN_ESCROW,
          formData.recipient as Address,
          rawAmount,
          unlockTimestamp,
        );
        timeLockMetaJson = JSON.stringify({
          type:            "time_lock",
          releaseId,
          unlockTimestamp: Number(unlockTimestamp),
          finalRecipient:  formData.recipient,
          hookAddress:     hookAddr,
        });
      }

      const approveTx = await walletClient.writeContract({
        address: CONTRACT_ADDRESSES.USDC,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [CONTRACT_ADDRESSES.CROSSCHAIN_ESCROW, rawAmount],
        account: address,
        chain: ARC_TESTNET as any,
      });
      await publicClient.waitForTransactionReceipt({ hash: approveTx });

      const transferTx = await walletClient.writeContract({
        address: CONTRACT_ADDRESSES.CROSSCHAIN_ESCROW,
        abi: CROSSCHAIN_ESCROW_ABI,
        functionName: "initiateConditionalTransfer",
        args: [
          contractRecipient,
          destDomain,
          rawAmount,
          BigInt(0),
          2000,
          encodedHookData,
          formData.conditionDescription,
        ],
        account: address,
        chain: ARC_TESTNET as any,
      });
      await publicClient.waitForTransactionReceipt({ hash: transferTx });

      createTransfer.mutate({
        data: {
          sender:        address,
          recipient:     formData.recipient,
          sourceChain:   "Arc Testnet",
          destChain:     formData.destChain,
          token:         "USDC",
          amount:        rawAmount.toString(),
          burnTxHash:    transferTx,
          sourceChainId: ARC_TESTNET.id,
          ...(timeLockMetaJson ? { hookData: timeLockMetaJson } : {}),
        } as any,
      });
    } catch (err: any) {
      alert(`Transaction failed: ${err.shortMessage || err.message}`);
    } finally {
      setTxPending(false);
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Cross-chain Transfers</h1>
          <p className="text-muted-foreground mt-1">
            CCTP v2 via CrosschainEscrow
            {" · "}
            <span className="font-mono text-xs">{CONTRACT_ADDRESSES.CROSSCHAIN_ESCROW}</span>
          </p>
        </div>

        {isConnected && isWrongNetwork && (
          <Button variant="destructive" size="sm" onClick={switchToArc}>Switch to Arc Testnet</Button>
        )}
        {isConnected && !isWrongNetwork && (
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild><Button>Initiate Transfer</Button></DialogTrigger>
            <DialogContent className="sm:max-w-[460px]">
              <DialogHeader><DialogTitle>Initiate CCTP v2 Transfer</DialogTitle></DialogHeader>
              <form onSubmit={handleCreate} className="space-y-4 pt-4">

                {/* Sender */}
                <div className="space-y-2">
                  <Label>Sender (you)</Label>
                  <Input value={address ?? ""} disabled className="bg-muted font-mono text-xs" />
                </div>

                {/* Recipient */}
                <div className="space-y-2">
                  <Label>
                    {conditionType === "time_lock"
                      ? "Beneficiary Address (receives USDC after unlock)"
                      : "Recipient Address (on destination chain)"}
                  </Label>
                  <Input
                    required value={formData.recipient}
                    onChange={e => setFormData({ ...formData, recipient: e.target.value })}
                    placeholder="0x…" className="font-mono text-xs"
                  />
                  {conditionType === "time_lock" && (
                    <p className="text-xs text-muted-foreground">
                      USDC is minted to the <strong>TimeLockHook</strong> contract first, not directly to this address.
                      Only this address can call <code>claim()</code> after the unlock time.
                    </p>
                  )}
                </div>

                {/* Route */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Source Chain</Label>
                    <Input disabled value="Arc Testnet" />
                  </div>
                  <div className="space-y-2">
                    <Label>Destination Chain</Label>
                    <Select value={formData.destChain} onValueChange={v => setFormData({ ...formData, destChain: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Ethereum Sepolia">Ethereum Sepolia (domain 0)</SelectItem>
                        <SelectItem value="Base Sepolia">Base Sepolia (domain 6)</SelectItem>
                        <SelectItem value="Arbitrum Sepolia">Arbitrum Sepolia (domain 3)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Amount with live balance */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>USDC Amount</Label>
                    {usdcBalance !== null && (
                      <span className="text-xs text-muted-foreground">
                        Balance:{" "}
                        <button
                          type="button"
                          className="text-primary hover:underline font-mono"
                          onClick={() => setFormData(prev => ({ ...prev, amount: formatTokenAmount(usdcBalance.toString()) }))}
                        >
                          {formatTokenAmount(usdcBalance.toString())} USDC
                        </button>
                      </span>
                    )}
                  </div>
                  <Input
                    required type="number" step="0.000001" min="0.000001"
                    value={formData.amount}
                    onChange={e => setFormData({ ...formData, amount: e.target.value })}
                    placeholder="0.00"
                    className={exceedsBalance ? "border-destructive" : ""}
                  />
                  {exceedsBalance && (
                    <p className="text-xs text-destructive">Amount exceeds your USDC balance</p>
                  )}
                </div>

                {/* Condition type */}
                <div className="space-y-2">
                  <Label>Condition Type</Label>
                  <Select value={conditionType} onValueChange={setConditionType}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {CONDITION_TYPES.map(c => (
                        <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">{selectedCondition.hint}</p>
                </div>

                {/* Condition-type-specific parameters */}
                {conditionType === "time_lock" && (
                  <div className="space-y-2">
                    <Label>Unlock Date &amp; Time <span className="text-muted-foreground font-normal">(local time)</span></Label>
                    <Input
                      type="datetime-local"
                      value={conditionParams.unlockTime}
                      min={new Date().toISOString().slice(0, 16)}
                      onChange={e => setConditionParams(prev => ({ ...prev, unlockTime: e.target.value }))}
                    />
                    {TIME_LOCK_HOOK_ADDRESSES[formData.destChain] ? (
                      <p className="text-xs text-green-400">
                        ✓ TimeLockHook deployed on {formData.destChain}. USDC will be held on-chain until this time.
                      </p>
                    ) : (
                      <p className="text-xs text-yellow-500">
                        ⚠ TimeLockHook not deployed on {formData.destChain} yet.
                        Run: <code className="text-foreground">forge script script/DeployTimeLockHook.s.sol</code>
                      </p>
                    )}
                  </div>
                )}

                {conditionType === "oracle" && (
                  <div className="space-y-2">
                    <Label>Oracle Condition</Label>
                    <Input
                      value={conditionParams.oracleCondition}
                      onChange={e => setConditionParams(prev => ({ ...prev, oracleCondition: e.target.value }))}
                      placeholder="e.g. ETH/USD > $4000"
                    />
                    <p className="text-xs text-muted-foreground">
                      Free-form condition text stored in the CCTP event. An oracle contract on {formData.destChain} must verify this before releasing funds.
                    </p>
                  </div>
                )}

                {conditionType === "multisig" && (
                  <div className="space-y-2">
                    <Label>Multisig Threshold</Label>
                    <div className="flex items-center gap-3">
                      <Input
                        type="number" min="1"
                        value={conditionParams.multisigM}
                        onChange={e => setConditionParams(prev => ({ ...prev, multisigM: e.target.value }))}
                        className="w-20 text-center"
                      />
                      <span className="text-sm text-muted-foreground shrink-0">of</span>
                      <Input
                        type="number" min="1" max="20"
                        value={conditionParams.multisigN}
                        onChange={e => setConditionParams(prev => ({ ...prev, multisigN: e.target.value }))}
                        className="w-20 text-center"
                      />
                      <span className="text-sm text-muted-foreground shrink-0">signers required</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      A Gnosis Safe or equivalent multisig on {formData.destChain} must approve before USDC is released.
                    </p>
                  </div>
                )}

                {/* Condition description — auto-generated; editable, switches type to "custom" */}
                <div className="space-y-2">
                  <Label>Condition Description <span className="text-muted-foreground font-normal">(stored on-chain)</span></Label>
                  <Input
                    value={formData.conditionDescription}
                    onChange={e => {
                      setConditionType("custom");
                      setFormData({ ...formData, conditionDescription: e.target.value });
                    }}
                    placeholder="Describe the release condition…"
                  />
                  {conditionType !== "custom" && (
                    <p className="text-xs text-muted-foreground">Auto-generated from the fields above. Edit to switch to custom.</p>
                  )}
                </div>

                {/* Transfer preview */}
                {hasAmount && (
                  <div className="rounded-md border border-border bg-muted/30 p-3 text-xs space-y-1">
                    <div className="flex justify-between text-muted-foreground">
                      <span>You send (Arc Testnet)</span>
                      <span className="text-foreground font-mono">{parsedAmount.toFixed(6)} USDC</span>
                    </div>
                    <div className="flex justify-between text-muted-foreground">
                      <span>Recipient receives ({formData.destChain})</span>
                      <span className="text-green-400 font-mono">{parsedAmount.toFixed(6)} USDC</span>
                    </div>
                    <div className="flex justify-between text-muted-foreground border-t border-border pt-1 mt-1">
                      <span>Gas to claim on destination</span>
                      <span>~0.001–0.003 ETH</span>
                    </div>
                  </div>
                )}

                {/* Info */}
                <div className="bg-muted/50 rounded-md p-3 text-xs text-muted-foreground space-y-1">
                  <p>Two txs: approve USDC spend, then burn via CrosschainEscrow → CCTP v2.</p>
                  <p>After burn, click <strong>Receive ↗</strong> in the table to mint on the destination chain. You'll need a small amount of ETH on {formData.destChain} for gas.</p>
                </div>

                <Button type="submit" className="w-full mt-4" disabled={txPending || exceedsBalance}>
                  {txPending ? "Waiting for wallet…" : "Approve & Burn via CCTP v2"}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        )}
        {!isConnected && (
          <p className="text-sm text-muted-foreground">Connect wallet to initiate transfers</p>
        )}
      </div>

      <Card className="bg-card/50 border-border">
        <Table>
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent">
              <TableHead>Route</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Burn Tx</TableHead>
              <TableHead>Receive</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={5} className="text-center py-8">Loading…</TableCell></TableRow>
            ) : !transfers?.length ? (
              <TableRow><TableCell colSpan={5} className="text-center py-12 text-muted-foreground">No transfers yet.</TableCell></TableRow>
            ) : transfers.map((tx) => {
              const rawHookData = (tx as any).hookData as string | null | undefined;
              let timeLockMeta: TimeLockMeta | undefined;
              try {
                if (rawHookData) {
                  const parsed = JSON.parse(rawHookData);
                  if (parsed?.type === "time_lock") timeLockMeta = parsed as TimeLockMeta;
                }
              } catch { /* ignore bad JSON */ }

              return (
                <TableRow key={tx.id} className="border-border hover:bg-muted/50">
                  <TableCell className="text-sm">
                    {tx.sourceChain} → {tx.destChain}
                    {timeLockMeta && (
                      <span className="ml-1.5 text-xs text-blue-400">⏳ time-lock</span>
                    )}
                  </TableCell>
                  <TableCell className="font-mono">{formatTokenAmount(tx.amount)} {tx.token}</TableCell>
                  <TableCell>
                    <Badge variant={tx.status === "complete" ? "secondary" : tx.status === "failed" ? "destructive" : "outline"}>
                      {STATUS_LABELS[tx.status] ?? tx.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    <a href={`https://testnet.arcscan.app/tx/${tx.burnTxHash}`} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                      {tx.burnTxHash.slice(0, 10)}… ↗
                    </a>
                  </TableCell>
                  <TableCell>
                    <ReceiveDialog
                      txHash={tx.burnTxHash}
                      destChain={tx.destChain}
                      transferId={tx.id}
                      walletAddress={address ?? undefined}
                      timeLockMeta={timeLockMeta}
                      transferAmount={tx.amount}
                    />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
