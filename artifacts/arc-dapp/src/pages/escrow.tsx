import { useState, useEffect, useRef, useMemo } from "react";
import { useListEscrows, useCreateEscrow, useDisputeEscrow, useReleaseEscrow, getListEscrowsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useWallet } from "../lib/wallet";
import { formatTokenAmount, parseTokenAmount } from "../lib/format";
import { buildX402Fetch, X402_PRICE_LABELS } from "../lib/x402-client";
import {
  CONTRACT_ADDRESSES, CONDITIONAL_ESCROW_ABI, ERC20_ABI,
  parseToken, ARC_TESTNET,
} from "../lib/contracts";
import { decodeEventLog, parseAbi, isAddress, type Address } from "viem";

const ESCROW_EVENTS_ABI = parseAbi([
  "event EscrowCreated(uint256 indexed id, address depositor, address beneficiary, address arbiter, address token, uint256 amount, uint256 releaseTime, string conditionType)",
]);

function parseOnChainId(receipt: { logs: readonly { address: Address; topics: readonly `0x${string}`[]; data: `0x${string}` }[] }): number | null {
  for (const log of receipt.logs) {
    try {
      const decoded = decodeEventLog({ abi: ESCROW_EVENTS_ABI, data: log.data, topics: log.topics as any });
      if (decoded.eventName === "EscrowCreated") return Number((decoded.args as { id: bigint }).id);
    } catch { /* not this log */ }
  }
  return null;
}

function statusVariant(status: string) {
  if (status === "active")   return "default";
  if (status === "released" || status === "resolved") return "secondary";
  return "destructive";
}

function useSecondsRemaining(releaseTime: number): number {
  const [secs, setSecs] = useState(() => releaseTime - Math.floor(Date.now() / 1000));
  useEffect(() => {
    const tick = () => setSecs(releaseTime - Math.floor(Date.now() / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [releaseTime]);
  return secs;
}

function formatCountdown(secs: number): string {
  if (secs <= 0) return "00:00:00";
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  if (d > 0) return `${d}d ${pad(h)}h ${pad(m)}m`;
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

function formatConditionCell(conditionType: string | null, conditionData: string | null): string {
  if (!conditionType) return "—";
  if (conditionType === "time_based") return "Time Lock";
  let data: Record<string, string> = {};
  try { data = JSON.parse(conditionData ?? "{}") as Record<string, string>; } catch {}
  if (conditionType === "oracle") {
    if (data.oracleType === "price_feed")
      return `${data.asset ?? "ETH"}/USD ${data.direction ?? "above"} $${data.threshold ?? "?"}`;
    if (data.oracleType === "delivery")
      return `Delivery: ${(data.description ?? "").slice(0, 28) || "no details"}`;
    return `Oracle: ${(data.description ?? "custom").slice(0, 28)}`;
  }
  if (conditionType === "milestone")
    return `Milestone: ${(data.description ?? "").slice(0, 28) || "no details"}`;
  return conditionType;
}

interface OracleCheckResult {
  oracleType?: string;
  description?: string;
  asset?: string;
  direction?: string;
  threshold?: string;
  currentPrice?: string;
  met: boolean;
  requiresConfirmation: boolean;
}

type EscrowRow = {
  id: number;
  status: string;
  conditionType: string | null;
  conditionData: string | null;
  releaseTime: number;
  onChainId: number | null;
  txHash: string;
  contractAddress: string;
};

function OracleVerifyDialog({
  escrow,
  open,
  onOpenChange,
  onRelease,
  txPending,
}: {
  escrow: EscrowRow | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onRelease: (id: number, onChainId: number | null | undefined, contractAddress: string) => void;
  txPending: boolean;
}) {
  const [result, setResult] = useState<OracleCheckResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [fetchError, setFetchError] = useState<string | null>(null);

  const { address: walletAddress } = useWallet();
  const x402Fetch = useMemo(
    () => (walletAddress ? buildX402Fetch(walletAddress) : null),
    [walletAddress],
  );

  const isMilestone = escrow?.conditionType === "milestone";
  let condData: Record<string, string> = {};
  try { condData = JSON.parse(escrow?.conditionData ?? "{}") as Record<string, string>; } catch {}

  useEffect(() => {
    if (!open || !escrow || isMilestone) return;
    setResult(null);
    setFetchError(null);
    setConfirmText("");
    setLoading(true);
    const doFetch = x402Fetch ?? globalThis.fetch.bind(globalThis);
    doFetch(`/api/escrows/${escrow.id}/oracle-check`)
      .then(r => {
        if (r.status === 402) {
          throw new Error(
            `Oracle check costs ${X402_PRICE_LABELS.oracleCheck} USDC per call (x402). ` +
            `Connect your MetaMask wallet to pay automatically.`,
          );
        }
        return r.ok
          ? (r.json() as Promise<OracleCheckResult>)
          : (r.json() as Promise<{ error: string }>).then(e => Promise.reject(new Error(e.error ?? "Unknown error")));
      })
      .then(data => setResult(data))
      .catch((err: Error) => setFetchError(err.message))
      .finally(() => setLoading(false));
  }, [open, escrow?.id, isMilestone, x402Fetch]);

  const canRelease = () => {
    if (isMilestone) return confirmText.trim().toUpperCase() === "CONFIRMED";
    if (!result) return false;
    if (result.requiresConfirmation) return confirmText.trim().toUpperCase() === "CONFIRMED";
    return result.met;
  };

  const handleRelease = () => {
    if (!escrow || !canRelease()) return;
    onRelease(escrow.id, escrow.onChainId, escrow.contractAddress);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>{isMilestone ? "Verify Milestone" : "Verify Oracle Condition"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-1">

          {isMilestone && (
            <div className="rounded-lg border border-border p-3 bg-muted/20 space-y-1">
              <p className="text-xs text-muted-foreground uppercase font-medium tracking-wide">Milestone Condition</p>
              <p className="text-sm">{condData.description || "No milestone description provided"}</p>
            </div>
          )}

          {!isMilestone && loading && (
            <div className="text-center py-6 text-muted-foreground text-sm animate-pulse">
              Querying oracle…
            </div>
          )}

          {!isMilestone && fetchError && (
            <div className="rounded-lg border border-destructive/50 p-3 bg-destructive/10 text-sm text-destructive">
              {fetchError}
            </div>
          )}

          {!isMilestone && result && (
            <div className="rounded-lg border border-border p-3 bg-muted/20 space-y-3">
              {result.oracleType === "price_feed" ? (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground uppercase font-medium tracking-wide">Price Feed Oracle</span>
                    <Badge variant={result.met ? "default" : "destructive"}>
                      {result.met ? "✓ Condition Met" : "✗ Not Yet Met"}
                    </Badge>
                  </div>
                  <div className="space-y-1.5 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Required</span>
                      <span className="font-mono">{result.asset}/USD {result.direction} ${result.threshold}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Current Price</span>
                      <span className={`font-mono font-semibold ${result.met ? "text-green-500" : "text-amber-500"}`}>
                        ${result.currentPrice}
                      </span>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground uppercase font-medium tracking-wide">
                      {result.oracleType === "delivery" ? "Delivery" : "Custom"} Oracle
                    </span>
                    <Badge variant="outline">Manual Confirmation</Badge>
                  </div>
                  <p className="text-sm">{result.description || "No condition description provided"}</p>
                </>
              )}
            </div>
          )}

          {(isMilestone || (result?.requiresConfirmation && !loading)) && (
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">
                Type <code className="bg-muted px-1 rounded font-mono">CONFIRMED</code> to attest the condition has been met
              </Label>
              <Input
                value={confirmText}
                onChange={e => setConfirmText(e.target.value)}
                placeholder="CONFIRMED"
                className="font-mono"
              />
            </div>
          )}

          <Button
            className="w-full"
            disabled={!canRelease() || txPending}
            onClick={handleRelease}
          >
            {txPending ? "Waiting for wallet…" : "Release Funds"}
          </Button>

          {!isMilestone && result && !result.met && !result.requiresConfirmation && (
            <p className="text-xs text-center text-muted-foreground">
              Oracle condition not yet satisfied. Funds are automatically released once the
              escrow's release time passes, regardless of oracle status.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface EscrowActionCellProps {
  escrow: EscrowRow;
  isConnected: boolean;
  walletReady: boolean;
  txPending: boolean;
  onRelease: (id: number, onChainId: number | null | undefined, contractAddress: string) => void;
  onOracleCheck: (escrow: EscrowRow) => void;
}

// Buffer between client-side countdown expiry and on-chain release attempt.
// Arc blocks may lag the browser clock by several seconds; without this buffer
// the release() call reverts because block.timestamp < releaseTime.
const RELEASE_BUFFER_SECS = 30;

function EscrowActionCell({ escrow, isConnected, walletReady, txPending, onRelease, onOracleCheck }: EscrowActionCellProps) {
  const isTimeBased = escrow.conditionType === "time_based";
  const isOracle    = escrow.conditionType === "oracle";
  const isMilestone = escrow.conditionType === "milestone";
  const secsLeft    = useSecondsRemaining(escrow.releaseTime);
  const expired     = secsLeft <= 0;
  // Only attempt release once we are at least RELEASE_BUFFER_SECS past expiry.
  const canRelease  = secsLeft <= -RELEASE_BUFFER_SECS;
  const bufferLeft  = expired && !canRelease ? RELEASE_BUFFER_SECS + secsLeft : 0;
  const autoFired   = useRef(false);

  useEffect(() => {
    if (!canRelease || escrow.status !== "active" || !isTimeBased || !walletReady || autoFired.current) return;
    autoFired.current = true;
    onRelease(escrow.id, escrow.onChainId, escrow.contractAddress);
  }, [canRelease, escrow.status, isTimeBased, walletReady]);

  return (
    <div className="flex items-center justify-end gap-2 flex-wrap">
      {escrow.status === "active" && isTimeBased && !expired && (
        <span className="font-mono text-xs tabular-nums text-muted-foreground border border-border rounded px-2 py-0.5 min-w-[80px] text-center">
          ⏱ {formatCountdown(secsLeft)}
        </span>
      )}
      {escrow.status === "active" && isTimeBased && expired && !canRelease && (
        <span className="font-mono text-xs text-muted-foreground border border-border rounded px-2 py-0.5 min-w-[80px] text-center animate-pulse">
          ⛓ {bufferLeft}s
        </span>
      )}
      {escrow.status === "active" && isTimeBased && canRelease && (
        <span className="text-xs text-amber-500 animate-pulse font-medium">Auto-releasing…</span>
      )}
      {escrow.status === "active" && isTimeBased && canRelease && isConnected && (
        <Button variant="outline" size="sm" onClick={() => onRelease(escrow.id, escrow.onChainId, escrow.contractAddress)} disabled={txPending}>
          Release Now
        </Button>
      )}

      {escrow.status === "active" && isOracle && isConnected && (
        <Button variant="outline" size="sm" onClick={() => onOracleCheck(escrow)} disabled={txPending}>
          Verify Oracle
        </Button>
      )}
      {escrow.status === "active" && isMilestone && isConnected && (
        <Button variant="outline" size="sm" onClick={() => onOracleCheck(escrow)} disabled={txPending}>
          Verify Milestone
        </Button>
      )}
      {escrow.status === "active" && !isTimeBased && !isOracle && !isMilestone && isConnected && (
        <Button variant="outline" size="sm" onClick={() => onRelease(escrow.id, escrow.onChainId, escrow.contractAddress)} disabled={txPending}>
          Release
        </Button>
      )}

      {escrow.txHash && (
        <a href={`https://testnet.arcscan.app/tx/${escrow.txHash}`} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline">
          TxScan ↗
        </a>
      )}
    </div>
  );
}

type OracleType   = "price_feed" | "custom" | "delivery";
type PriceAsset   = "ETH" | "BTC" | "SOL" | "MATIC";
type PriceDir     = "above" | "below";
type TokenType    = "USDC" | "EURC";
type CondType     = "time_based" | "milestone" | "oracle";

interface FormData {
  beneficiary: string;
  arbiter: string;
  token: TokenType;
  amount: string;
  releaseTime: string;
  conditionType: CondType;
  milestoneDescription: string;
  oracleType: OracleType;
  oraclePriceAsset: PriceAsset;
  oraclePriceDirection: PriceDir;
  oraclePriceThreshold: string;
  oracleDescription: string;
}

const DEFAULT_FORM: FormData = {
  beneficiary: "",
  arbiter: "",
  token: "USDC",
  amount: "",
  releaseTime: "",
  conditionType: "time_based",
  milestoneDescription: "",
  oracleType: "price_feed",
  oraclePriceAsset: "ETH",
  oraclePriceDirection: "above",
  oraclePriceThreshold: "",
  oracleDescription: "",
};

export default function Escrow() {
  const { data: escrows, isLoading } = useListEscrows();
  const queryClient = useQueryClient();
  const { address, walletClient, publicClient, isConnected, isWrongNetwork, switchToArc } = useWallet();

  const [createOpen, setCreateOpen] = useState(false);
  const [txPending, setTxPending] = useState(false);
  const [formData, setFormData] = useState<FormData>(DEFAULT_FORM);

  const [oracleOpen, setOracleOpen]   = useState(false);
  const [oracleEscrow, setOracleEscrow] = useState<EscrowRow | null>(null);

  const createEscrow  = useCreateEscrow({ mutation: { onSuccess: () => { queryClient.invalidateQueries({ queryKey: getListEscrowsQueryKey() }); setCreateOpen(false); setFormData(DEFAULT_FORM); } } });
  const releaseEscrow = useReleaseEscrow({ mutation: { onSuccess: () => queryClient.invalidateQueries({ queryKey: getListEscrowsQueryKey() }) } });
  const disputeEscrow = useDisputeEscrow({ mutation: { onSuccess: () => queryClient.invalidateQueries({ queryKey: getListEscrowsQueryKey() }) } });

  const tokenAddress: Address = formData.token === "USDC" ? CONTRACT_ADDRESSES.USDC : CONTRACT_ADDRESSES.EURC;

  const buildConditionData = (): string => {
    if (formData.conditionType === "oracle") {
      if (formData.oracleType === "price_feed") {
        return JSON.stringify({
          oracleType: "price_feed",
          asset:      formData.oraclePriceAsset,
          direction:  formData.oraclePriceDirection,
          threshold:  formData.oraclePriceThreshold,
        });
      }
      return JSON.stringify({
        oracleType:  formData.oracleType,
        description: formData.oracleDescription,
      });
    }
    if (formData.conditionType === "milestone") {
      return JSON.stringify({ description: formData.milestoneDescription });
    }
    return "{}";
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!address || !walletClient) return;
    if (isWrongNetwork) { await switchToArc(); return; }

    if (!isAddress(formData.beneficiary)) {
      alert("Invalid beneficiary address — must be a valid 0x… Ethereum address");
      return;
    }
    if (formData.arbiter && !isAddress(formData.arbiter)) {
      alert("Invalid arbiter address — must be a valid 0x… Ethereum address");
      return;
    }
    if (formData.conditionType === "oracle" && formData.oracleType === "price_feed" && !formData.oraclePriceThreshold) {
      alert("Enter a price threshold for the price feed oracle");
      return;
    }

    setTxPending(true);
    try {
      const rawAmount = parseToken(formData.amount);
      const releaseTimestamp = formData.releaseTime
        ? BigInt(Math.floor(new Date(formData.releaseTime).getTime() / 1000))
        : BigInt(Math.floor(Date.now() / 1000) + 86400);

      const approveTx = await walletClient.writeContract({
        address: tokenAddress,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [CONTRACT_ADDRESSES.CONDITIONAL_ESCROW, rawAmount],
        account: address,
        chain: ARC_TESTNET as any,
      });
      const approveReceipt = await publicClient.waitForTransactionReceipt({ hash: approveTx });
      if (approveReceipt.status !== "success") throw new Error("Token approval transaction reverted.");

      const createTx = await walletClient.writeContract({
        address: CONTRACT_ADDRESSES.CONDITIONAL_ESCROW,
        abi: CONDITIONAL_ESCROW_ABI,
        functionName: "createEscrow",
        args: [
          formData.beneficiary as Address,
          formData.arbiter as Address,
          tokenAddress,
          rawAmount,
          releaseTimestamp,
          formData.conditionType,
          "0x" as `0x${string}`,
        ],
        account: address,
        chain: ARC_TESTNET as any,
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash: createTx });
      const onChainId = parseOnChainId(receipt);

      await createEscrow.mutateAsync({
        data: {
          depositor:       address,
          beneficiary:     formData.beneficiary,
          arbiter:         formData.arbiter,
          token:           formData.token,
          amount:          rawAmount.toString(),
          releaseTime:     Number(releaseTimestamp),
          conditionType:   formData.conditionType,
          conditionData:   buildConditionData(),
          contractAddress: CONTRACT_ADDRESSES.CONDITIONAL_ESCROW,
          txHash:          createTx,
          chainId:         ARC_TESTNET.id,
          ...(onChainId !== null ? { onChainId } : {}),
        },
      });
    } catch (err: any) {
      alert(`Transaction failed: ${err.shortMessage || err.message}`);
    } finally {
      setTxPending(false);
    }
  };

  const handleRelease = async (id: number, onChainId?: number | null, contractAddress?: string) => {
    if (!address || !walletClient) return;
    if (isWrongNetwork) { await switchToArc(); return; }
    setTxPending(true);
    const escrowContract = (contractAddress ?? CONTRACT_ADDRESSES.CONDITIONAL_ESCROW) as `0x${string}`;
    try {
      const contractId = onChainId != null ? BigInt(onChainId) : BigInt(id - 1);
      const tx = await walletClient.writeContract({
        address: escrowContract,
        abi: CONDITIONAL_ESCROW_ABI,
        functionName: "release",
        args: [contractId],
        account: address,
        chain: ARC_TESTNET as any,
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash: tx });
      if (receipt.status !== "success") {
        throw new Error("Transaction reverted — the time lock may still be finalizing on-chain. Wait a moment and try again.");
      }
      releaseEscrow.mutate({ id, data: { txHash: tx, resolution: "beneficiary", caller: address } as any });
    } catch (err: any) {
      alert(`Release failed: ${err.shortMessage || err.message}`);
    } finally {
      setTxPending(false);
    }
  };

  const handleOracleCheck = (escrow: EscrowRow) => {
    setOracleEscrow(escrow);
    setOracleOpen(true);
  };

  const set = <K extends keyof FormData>(k: K) => (v: FormData[K]) =>
    setFormData(prev => ({ ...prev, [k]: v }));

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Conditional Escrow</h1>
          <p className="text-muted-foreground mt-1">Manage trustless agreements onchain · <span className="font-mono text-xs">{CONTRACT_ADDRESSES.CONDITIONAL_ESCROW}</span></p>
        </div>
        {isConnected && isWrongNetwork && (
          <Button variant="destructive" size="sm" onClick={switchToArc}>Switch to Arc Testnet</Button>
        )}
        {isConnected && !isWrongNetwork && (
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild><Button>New Escrow</Button></DialogTrigger>
            <DialogContent className="sm:max-w-[460px] max-h-[90vh] overflow-y-auto">
              <DialogHeader><DialogTitle>Create Escrow</DialogTitle></DialogHeader>
              <form onSubmit={handleCreate} className="space-y-4 pt-4">
                <div className="space-y-2">
                  <Label>Your Address (Depositor)</Label>
                  <Input value={address ?? ""} disabled className="bg-muted font-mono text-xs" />
                </div>
                <div className="space-y-2">
                  <Label>Beneficiary Address</Label>
                  <Input required value={formData.beneficiary} onChange={e => set("beneficiary")(e.target.value)} placeholder="0x..." className="font-mono text-xs" />
                </div>
                <div className="space-y-2">
                  <Label>Arbiter Address</Label>
                  <Input required value={formData.arbiter} onChange={e => set("arbiter")(e.target.value)} placeholder="0x..." className="font-mono text-xs" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Token</Label>
                    <Select value={formData.token} onValueChange={v => set("token")(v as TokenType)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="USDC">USDC</SelectItem>
                        <SelectItem value="EURC">EURC</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Amount</Label>
                    <Input required type="number" step="0.000001" min="0.000001" value={formData.amount} onChange={e => set("amount")(e.target.value)} placeholder="0.00" />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Condition Type</Label>
                  <Select value={formData.conditionType} onValueChange={v => set("conditionType")(v as CondType)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="time_based">Time Based — auto-release after lock expires</SelectItem>
                      <SelectItem value="milestone">Milestone — depositor confirms completion</SelectItem>
                      <SelectItem value="oracle">Oracle — verified by external data source</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {formData.conditionType === "milestone" && (
                  <div className="space-y-2 rounded-lg border border-border p-3 bg-muted/10">
                    <p className="text-xs text-muted-foreground uppercase font-medium tracking-wide">Milestone Details</p>
                    <Label className="text-xs">What must be achieved for funds to release?</Label>
                    <Textarea
                      rows={2}
                      placeholder="e.g. Project phase 1 completed and deliverables submitted"
                      value={formData.milestoneDescription}
                      onChange={e => set("milestoneDescription")(e.target.value)}
                      className="text-sm resize-none"
                    />
                  </div>
                )}

                {formData.conditionType === "oracle" && (
                  <div className="space-y-3 rounded-lg border border-border p-3 bg-muted/10">
                    <p className="text-xs text-muted-foreground uppercase font-medium tracking-wide">Oracle Settings</p>
                    <div className="space-y-2">
                      <Label className="text-xs">Oracle Type</Label>
                      <Select value={formData.oracleType} onValueChange={v => set("oracleType")(v as OracleType)}>
                        <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="price_feed">Price Feed — ETH, BTC, SOL, MATIC vs USD</SelectItem>
                          <SelectItem value="custom">Custom Condition — manual attestation</SelectItem>
                          <SelectItem value="delivery">Delivery Confirmation — off-chain delivery</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {formData.oracleType === "price_feed" && (
                      <div className="space-y-2">
                        <div className="grid grid-cols-3 gap-2">
                          <div className="space-y-1">
                            <Label className="text-xs">Asset</Label>
                            <Select value={formData.oraclePriceAsset} onValueChange={v => set("oraclePriceAsset")(v as PriceAsset)}>
                              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="ETH">ETH</SelectItem>
                                <SelectItem value="BTC">BTC</SelectItem>
                                <SelectItem value="SOL">SOL</SelectItem>
                                <SelectItem value="MATIC">MATIC</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Direction</Label>
                            <Select value={formData.oraclePriceDirection} onValueChange={v => set("oraclePriceDirection")(v as PriceDir)}>
                              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="above">Above ≥</SelectItem>
                                <SelectItem value="below">Below ≤</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Price (USD)</Label>
                            <Input
                              className="h-8 text-xs"
                              type="number"
                              min="0"
                              step="0.01"
                              placeholder="e.g. 3000"
                              value={formData.oraclePriceThreshold}
                              onChange={e => set("oraclePriceThreshold")(e.target.value)}
                            />
                          </div>
                        </div>
                        {formData.oraclePriceThreshold && (
                          <p className="text-xs text-muted-foreground">
                            Release when {formData.oraclePriceAsset}/USD is {formData.oraclePriceDirection === "above" ? "≥" : "≤"} ${formData.oraclePriceThreshold}
                          </p>
                        )}
                      </div>
                    )}

                    {(formData.oracleType === "custom" || formData.oracleType === "delivery") && (
                      <div className="space-y-1">
                        <Label className="text-xs">
                          {formData.oracleType === "delivery" ? "Delivery Description" : "Condition Description"}
                        </Label>
                        <Textarea
                          rows={2}
                          placeholder={
                            formData.oracleType === "delivery"
                              ? "e.g. Package delivered to 123 Main St by June 30"
                              : "e.g. Client has signed the service agreement"
                          }
                          value={formData.oracleDescription}
                          onChange={e => set("oracleDescription")(e.target.value)}
                          className="text-sm resize-none"
                        />
                      </div>
                    )}
                  </div>
                )}

                <div className="space-y-2">
                  <Label>Release Time <span className="text-muted-foreground text-xs">(deadline / time-lock expiry)</span></Label>
                  <Input type="datetime-local" value={formData.releaseTime} onChange={e => set("releaseTime")(e.target.value)} />
                </div>
                <Button type="submit" className="w-full mt-4" disabled={txPending}>
                  {txPending ? "Waiting for wallet…" : "Approve & Deploy Escrow"}
                </Button>
                <p className="text-xs text-muted-foreground text-center">Two transactions: approve token spend, then create escrow</p>
              </form>
            </DialogContent>
          </Dialog>
        )}
        {!isConnected && <p className="text-sm text-muted-foreground">Connect wallet to create escrows</p>}
      </div>

      <Card className="bg-card/50 border-border">
        <Table>
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent">
              <TableHead>ID</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Condition</TableHead>
              <TableHead>Beneficiary</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={6} className="text-center py-8">Loading…</TableCell></TableRow>
            ) : !escrows?.length ? (
              <TableRow><TableCell colSpan={6} className="text-center py-12 text-muted-foreground">No escrows yet. Create your first one above.</TableCell></TableRow>
            ) : escrows.map((escrow) => (
              <TableRow key={escrow.id} className="border-border hover:bg-muted/50">
                <TableCell className="font-mono text-xs">#{escrow.id}</TableCell>
                <TableCell className="font-mono">{formatTokenAmount(escrow.amount)} {escrow.token}</TableCell>
                <TableCell>
                  <Badge variant={statusVariant(escrow.status) as any}>{escrow.status}</Badge>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground max-w-[160px] truncate" title={formatConditionCell(escrow.conditionType ?? null, escrow.conditionData ?? null)}>
                  {formatConditionCell(escrow.conditionType ?? null, escrow.conditionData ?? null)}
                </TableCell>
                <TableCell className="font-mono text-xs" title={escrow.beneficiary}>
                  {escrow.beneficiary.slice(0,6)}…{escrow.beneficiary.slice(-4)}
                </TableCell>
                <TableCell className="text-right">
                  <EscrowActionCell
                    escrow={escrow as EscrowRow}
                    isConnected={isConnected}
                    walletReady={isConnected && !!walletClient}
                    txPending={txPending}
                    onRelease={handleRelease}
                    onOracleCheck={handleOracleCheck}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <OracleVerifyDialog
        escrow={oracleEscrow}
        open={oracleOpen}
        onOpenChange={setOracleOpen}
        onRelease={handleRelease}
        txPending={txPending}
      />
    </div>
  );
}
