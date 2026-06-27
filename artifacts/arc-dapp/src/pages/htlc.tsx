import { useState, useMemo, useEffect, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListHtlcSwaps, useCreateHtlcSwap, useClaimHtlcSwap, useRefundHtlcSwap,
  useRelayHtlcSwap, getListHtlcSwapsQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import {
  Lock, Plus, RefreshCw, ExternalLink, Key, RotateCcw, Copy, Info,
  AlertTriangle, ArrowRight, Zap, Globe,
} from "lucide-react";
import { formatTokenAmount, parseTokenAmount } from "../lib/format";
import { useWallet } from "../lib/wallet";
import { CONTRACT_ADDRESSES } from "../lib/contracts";
import { keccak256, encodeAbiParameters } from "viem";

const ARC_EXPLORER = "https://testnet.arcscan.app";
const IRIS_BASE    = "https://iris-api-sandbox.circle.com";

type SwapMode = "single_chain" | "crosschain_cctp";

const DEST_CHAINS = [
  { label: "Ethereum Sepolia", domain: 0,  usdc: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238", explorerBase: "https://sepolia.etherscan.io" },
  { label: "Arbitrum Sepolia", domain: 3,  usdc: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d", explorerBase: "https://sepolia.arbiscan.io" },
  { label: "Base Sepolia",     domain: 6,  usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", explorerBase: "https://sepolia.basescan.org" },
];

function randomHex32(): `0x${string}` {
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  return `0x${Array.from(buf).map(b => b.toString(16).padStart(2, "0")).join("")}`;
}
function randomAddress(): string {
  return `0x${Array.from({ length: 40 }, () => Math.floor(Math.random() * 16).toString(16)).join("")}`;
}
function randomTx(): string {
  return `0x${Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join("")}`;
}
function addrToBytes32(addr: string): string {
  const clean = addr.replace(/^0x/, "").toLowerCase().padStart(64, "0");
  return `0x${clean}`;
}
function computeHashlock(preimage: `0x${string}`): `0x${string}` {
  return keccak256(encodeAbiParameters([{ type: "bytes32" }], [preimage]));
}

function statusBadge(status: string) {
  switch (status) {
    case "active":   return <Badge variant="outline" className="text-yellow-400 border-yellow-400/50">Active</Badge>;
    case "claimed":  return <Badge variant="outline" className="text-blue-400 border-blue-400/50">Claimed / Burning</Badge>;
    case "relayed":  return <Badge variant="outline" className="text-emerald-400 border-emerald-400/50">Relayed ✓</Badge>;
    case "refunded": return <Badge variant="outline" className="text-red-400 border-red-400/50">Refunded</Badge>;
    default:         return <Badge variant="outline">{status}</Badge>;
  }
}

function modeBadge(mode: string | null | undefined) {
  if (mode === "crosschain_cctp") {
    return <Badge variant="outline" className="text-purple-400 border-purple-400/40 text-[10px]">CCTP</Badge>;
  }
  return <Badge variant="outline" className="text-muted-foreground border-border/50 text-[10px]">1-chain</Badge>;
}

const DEFAULT_FORM = {
  mode:                "single_chain" as SwapMode,
  recipient:           "",
  token:               "USDC" as "USDC" | "EURC",
  amount:              "",
  timelockHours:       "24",
  destDomain:          "0",
  mintRecipientAddr:   "",
  maxFee:              "0",
  minFinality:         "2000",
};

type AttestationStatus = "idle" | "polling" | "pending" | "complete" | "error";

export default function HtlcSwap() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { address, isConnected } = useWallet();

  const [createOpen, setCreateOpen] = useState(false);
  const [claimOpen, setClaimOpen] = useState(false);
  const [claimId, setClaimId] = useState<number | null>(null);
  const [claimPreimage, setClaimPreimage] = useState("");
  const [form, setForm] = useState(DEFAULT_FORM);
  const [generatedPreimage, setGeneratedPreimage] = useState<string | null>(null);
  const [generatedHashlock, setGeneratedHashlock] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState("all");

  // Per-HTLC attestation tracking (keyed by htlc id)
  const [attestation, setAttestation] = useState<Record<number, { status: AttestationStatus; claimTx?: string }>>({});

  const { data: htlcs = [], isLoading, refetch } = useListHtlcSwaps();

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListHtlcSwapsQueryKey() });

  const createHtlc  = useCreateHtlcSwap({
    mutation: {
      onSuccess: () => {
        invalidate(); setCreateOpen(false); setForm(DEFAULT_FORM);
        setGeneratedPreimage(null); setGeneratedHashlock(null);
        toast({ title: "HTLC created", description: form.mode === "crosschain_cctp"
          ? "Lock created on Arc. When claimed, USDC burns via CCTP and mints for recipient on dest chain."
          : "Recipient can claim with the preimage before the timelock expires."
        });
      },
      onError: (e: unknown) => toast({ title: "Create failed", description: String(e), variant: "destructive" }),
    },
  });
  const claimHtlc   = useClaimHtlcSwap({
    mutation: {
      onSuccess: (data, vars) => {
        invalidate(); setClaimOpen(false); setClaimPreimage("");
        const htlc = htlcs.find(h => h.id === vars.id);
        if (htlc?.swapMode === "crosschain_cctp" && data.claimTxHash) {
          toast({ title: "Preimage revealed — CCTP burn initiated", description: "Polling Circle IRIS for attestation…" });
          setAttestation(a => ({ ...a, [vars.id]: { status: "polling", claimTx: data.claimTxHash ?? undefined } }));
        } else {
          toast({ title: "HTLC claimed", description: "Preimage revealed, tokens released." });
        }
      },
      onError: (e: unknown) => toast({ title: "Claim failed", description: String(e), variant: "destructive" }),
    },
  });
  const refundHtlc  = useRefundHtlcSwap({
    mutation: {
      onSuccess: () => { invalidate(); toast({ title: "HTLC refunded", description: "Expired lock refunded to depositor." }); },
      onError: (e: unknown) => toast({ title: "Refund failed", description: String(e), variant: "destructive" }),
    },
  });
  const relayHtlc   = useRelayHtlcSwap({
    mutation: {
      onSuccess: (_, vars) => {
        invalidate();
        setAttestation(a => ({ ...a, [vars.id]: { ...a[vars.id], status: "idle" } }));
        toast({ title: "HTLC relayed", description: "USDC minted on destination chain for the recipient." });
      },
      onError: (e: unknown) => toast({ title: "Relay failed", description: String(e), variant: "destructive" }),
    },
  });

  // Poll Circle IRIS for attestation on claimed crosschain HTLCs
  const pollAttestation = useCallback(async (htlcId: number, claimTxHash: string) => {
    try {
      const resp = await fetch(`/api/cctp/attestation/${claimTxHash}`);
      if (!resp.ok) { setAttestation(a => ({ ...a, [htlcId]: { ...a[htlcId], status: "error" } })); return; }
      const json = await resp.json() as { status?: string };
      if (json.status === "complete") {
        setAttestation(a => ({ ...a, [htlcId]: { ...a[htlcId], status: "complete" } }));
      } else {
        setAttestation(a => ({ ...a, [htlcId]: { ...a[htlcId], status: "pending" } }));
      }
    } catch {
      setAttestation(a => ({ ...a, [htlcId]: { ...a[htlcId], status: "error" } }));
    }
  }, []);

  // Auto-start polling for any claimed crosschain HTLC that we loaded from DB
  useEffect(() => {
    for (const h of htlcs) {
      if (h.swapMode === "crosschain_cctp" && h.status === "claimed" && h.claimTxHash && !attestation[h.id]) {
        setAttestation(a => ({ ...a, [h.id]: { status: "polling", claimTx: h.claimTxHash ?? undefined } }));
      }
    }
  }, [htlcs]); // eslint-disable-line react-hooks/exhaustive-deps

  // Polling interval
  useEffect(() => {
    const ids = Object.entries(attestation).filter(([, v]) => v.status === "polling" || v.status === "pending");
    if (ids.length === 0) return;
    const timer = setInterval(() => {
      for (const [id, info] of ids) {
        if (info.claimTx) void pollAttestation(Number(id), info.claimTx);
      }
    }, 8000);
    return () => clearInterval(timer);
  }, [attestation, pollAttestation]);

  const filtered = useMemo(() =>
    filterStatus === "all" ? htlcs : htlcs.filter(h => h.status === filterStatus),
  [htlcs, filterStatus]);

  function generateSecret() {
    const pre = randomHex32();
    const hash = computeHashlock(pre);
    setGeneratedPreimage(pre);
    setGeneratedHashlock(hash);
  }

  function copyToClipboard(text: string, label: string) {
    navigator.clipboard.writeText(text).then(() => toast({ title: `${label} copied` }));
  }

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!generatedPreimage || !generatedHashlock) {
      toast({ title: "Generate a secret preimage first", variant: "destructive" }); return;
    }
    const amount = parseTokenAmount(form.amount);
    if (!amount || amount === "0") { toast({ title: "Invalid amount", variant: "destructive" }); return; }

    const depositor   = isConnected && address ? address : randomAddress();
    const timelock    = Math.floor(Date.now() / 1000) + Number(form.timelockHours) * 3600;
    const isCrosschain = form.mode === "crosschain_cctp";

    if (isCrosschain) {
      const recipientAddr = form.mintRecipientAddr.trim() || randomAddress();
      const mintRecipient = addrToBytes32(recipientAddr);

      createHtlc.mutate({
        data: {
          depositor,
          recipient:   recipientAddr,
          token:       "USDC",
          amount,
          hashlock:    generatedHashlock,
          timelock,
          contractAddress: CONTRACT_ADDRESSES.CROSSCHAIN_ATOMIC_HTLC,
          txHash:      randomTx(),
          chainId:     5042002,
          swapMode:    "crosschain_cctp",
          destinationDomain: Number(form.destDomain),
          mintRecipient,
          maxFee:      String(Math.round(Number(form.maxFee) * 1e6)),
          minFinalityThreshold: Number(form.minFinality),
        },
      });
    } else {
      const recipient = form.recipient.trim() || randomAddress();
      createHtlc.mutate({
        data: {
          depositor, recipient,
          token: form.token,
          amount,
          hashlock: generatedHashlock,
          timelock,
          contractAddress: CONTRACT_ADDRESSES.CROSSCHAIN_HTLC,
          txHash:   randomTx(),
          chainId:  5042002,
          swapMode: "single_chain",
        },
      });
    }
  }

  function openClaim(id: number) {
    setClaimId(id);
    setClaimPreimage("");
    setClaimOpen(true);
  }

  function handleClaim(e: React.FormEvent) {
    e.preventDefault();
    if (claimId === null) return;
    if (!/^0x[0-9a-fA-F]{64}$/.test(claimPreimage)) {
      toast({ title: "Preimage must be 0x + 64 hex chars (bytes32)", variant: "destructive" }); return;
    }
    claimHtlc.mutate({ id: claimId, data: { txHash: randomTx(), preimage: claimPreimage } });
  }

  function handleRefund(id: number) {
    refundHtlc.mutate({ id, data: { txHash: randomTx() } });
  }

  function handleSimulateRelay(htlcId: number) {
    relayHtlc.mutate({ id: htlcId, data: { txHash: randomTx() } });
  }

  const activeCount  = htlcs.filter(h => h.status === "active").length;
  const totalLocked  = htlcs.filter(h => h.status === "active")
    .reduce((s, h) => s + BigInt(h.amount), 0n);
  const cctpCount    = htlcs.filter(h => h.swapMode === "crosschain_cctp").length;

  const selectedDest = DEST_CHAINS.find(d => String(d.domain) === form.destDomain) ?? DEST_CHAINS[0];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Lock className="w-6 h-6 text-primary" />
            HTLC Atomic Swap
          </h2>
          <p className="text-muted-foreground text-sm mt-1">
            Trustless atomic swaps — single-chain hashlock or CCTP-powered crosschain burn.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isLoading}>
            <RefreshCw className={`w-4 h-4 mr-1 ${isLoading ? "animate-spin" : ""}`} /> Refresh
          </Button>
          <Dialog open={createOpen} onOpenChange={open => { setCreateOpen(open); if (!open) { setGeneratedPreimage(null); setGeneratedHashlock(null); } }}>
            <DialogTrigger asChild>
              <Button size="sm"><Plus className="w-4 h-4 mr-1" /> Create HTLC</Button>
            </DialogTrigger>
            <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Create HTLC</DialogTitle>
                <DialogDescription>
                  Lock USDC/EURC with a hashlock. Choose single-chain (direct release) or atomic crosschain via CCTP.
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleCreate} className="space-y-4 mt-2">

                {/* Mode toggle */}
                <div className="grid grid-cols-2 gap-2">
                  {(["single_chain", "crosschain_cctp"] as SwapMode[]).map(m => (
                    <button key={m} type="button"
                      className={`rounded-md border px-3 py-2 text-sm font-medium text-left transition-colors ${form.mode === m ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:border-border/70"}`}
                      onClick={() => setForm(f => ({ ...f, mode: m }))}>
                      {m === "single_chain"
                        ? <><span className="flex items-center gap-1"><Lock className="w-3 h-3" /> Single Chain</span><span className="text-xs text-muted-foreground block mt-0.5">Claim releases tokens here on Arc</span></>
                        : <><span className="flex items-center gap-1"><Globe className="w-3 h-3 text-purple-400" /> Atomic Crosschain <span className="text-[10px] text-purple-400 border border-purple-400/40 rounded px-1">CCTP</span></span><span className="text-xs text-muted-foreground block mt-0.5">Claim burns USDC → mints on dest chain</span></>
                      }
                    </button>
                  ))}
                </div>

                {/* Step 1: generate secret */}
                <div className="rounded-md bg-muted/40 border border-border p-3 space-y-2">
                  <div className="text-xs font-medium text-foreground flex items-center gap-1">
                    <Key className="w-3 h-3" /> Step 1 — Generate secret preimage
                  </div>
                  <Button type="button" variant="outline" size="sm" onClick={generateSecret} className="w-full">
                    {generatedPreimage ? "Regenerate Secret" : "Generate Secret"}
                  </Button>
                  {generatedPreimage && (
                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-muted-foreground">Preimage (SECRET — save now!)</span>
                        <Button type="button" variant="ghost" size="sm" className="h-5 px-1" onClick={() => copyToClipboard(generatedPreimage, "Preimage")}>
                          <Copy className="w-3 h-3" />
                        </Button>
                      </div>
                      <div className="font-mono text-xs bg-background border border-border rounded px-2 py-1 break-all text-amber-400">{generatedPreimage}</div>
                      <div className="flex items-center justify-between mt-1">
                        <span className="text-xs text-muted-foreground">Hashlock (share with counterparty)</span>
                        <Button type="button" variant="ghost" size="sm" className="h-5 px-1" onClick={() => copyToClipboard(generatedHashlock!, "Hashlock")}>
                          <Copy className="w-3 h-3" />
                        </Button>
                      </div>
                      <div className="font-mono text-xs bg-background border border-border rounded px-2 py-1 break-all text-muted-foreground">{generatedHashlock}</div>
                      <div className="flex items-start gap-1 mt-1">
                        <AlertTriangle className="w-3 h-3 text-amber-400 mt-0.5 shrink-0" />
                        <span className="text-xs text-amber-400">Keep the preimage secret until your counterparty has locked their side.</span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Crosschain CCTP fields */}
                {form.mode === "crosschain_cctp" && (
                  <div className="rounded-md bg-purple-500/5 border border-purple-500/20 p-3 space-y-3">
                    <div className="text-xs font-medium text-purple-400 flex items-center gap-1">
                      <Globe className="w-3 h-3" /> Step 2 — Crosschain CCTP parameters
                    </div>
                    <div className="space-y-1">
                      <Label>Destination chain</Label>
                      <Select value={form.destDomain} onValueChange={v => setForm(f => ({ ...f, destDomain: v }))}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {DEST_CHAINS.map(d => <SelectItem key={d.domain} value={String(d.domain)}>{d.label} (domain {d.domain})</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label>Recipient address on {selectedDest.label}</Label>
                      <Input placeholder="0x… (counterparty's address on dest chain)" value={form.mintRecipientAddr}
                        onChange={e => setForm(f => ({ ...f, mintRecipientAddr: e.target.value }))} />
                      <p className="text-xs text-muted-foreground">USDC will be minted here on {selectedDest.label} when the HTLC is claimed on Arc.</p>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label>Max fee (USDC)</Label>
                        <Input type="number" min="0" step="0.01" value={form.maxFee}
                          onChange={e => setForm(f => ({ ...f, maxFee: e.target.value }))} />
                        <p className="text-xs text-muted-foreground">Circle relay fee (0 = basic)</p>
                      </div>
                      <div className="space-y-1">
                        <Label>Finality threshold</Label>
                        <Select value={form.minFinality} onValueChange={v => setForm(f => ({ ...f, minFinality: v }))}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="2000">2000 — Finalized (Arc)</SelectItem>
                            <SelectItem value="1000">1000 — Fast</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="rounded-sm bg-muted/40 border border-border px-2 py-1.5 text-xs text-muted-foreground">
                      USDC on {selectedDest.label}: <span className="font-mono">{selectedDest.usdc}</span>
                    </div>
                  </div>
                )}

                {/* Common fields */}
                {form.mode === "single_chain" && (
                  <div className="space-y-1">
                    <Label>Recipient address (Arc)</Label>
                    <Input placeholder="0x… (leave blank for simulated)" value={form.recipient}
                      onChange={e => setForm(f => ({ ...f, recipient: e.target.value }))} />
                  </div>
                )}
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <Label>Token</Label>
                    {form.mode === "crosschain_cctp" ? (
                      <div className="flex h-9 items-center rounded-md border border-input bg-muted/50 px-3 text-sm text-muted-foreground">
                        USDC only (CCTP)
                      </div>
                    ) : (
                      <Select value={form.token} onValueChange={v => setForm(f => ({ ...f, token: v as "USDC" | "EURC" }))}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="USDC">USDC</SelectItem>
                          <SelectItem value="EURC">EURC</SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                  <div className="space-y-1">
                    <Label>Amount</Label>
                    <Input placeholder="e.g. 100" type="number" min="0" step="0.000001" value={form.amount}
                      onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} required />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label>Your timelock (hours from now)</Label>
                  <Input type="number" min="1" value={form.timelockHours}
                    onChange={e => setForm(f => ({ ...f, timelockHours: e.target.value }))} required />
                  {form.mode === "crosschain_cctp" && (
                    <p className="text-xs text-muted-foreground">Must be longer than counterparty's Sepolia timelock (e.g. counterparty uses 12h, you use 24h).</p>
                  )}
                </div>
                <div className="rounded-md bg-muted/40 border border-border px-3 py-2 text-xs text-muted-foreground flex items-center gap-1">
                  <Info className="w-3 h-3" />
                  Contract: <span className="font-mono">
                    {form.mode === "crosschain_cctp"
                      ? `${CONTRACT_ADDRESSES.CROSSCHAIN_ATOMIC_HTLC.slice(0, 10)}…`
                      : `${CONTRACT_ADDRESSES.CROSSCHAIN_HTLC.slice(0, 10)}…`
                    }
                  </span>
                  {!isConnected && <span className="ml-2">No wallet — simulation mode.</span>}
                </div>
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
                  <Button type="submit" disabled={createHtlc.isPending || !generatedPreimage}>
                    {createHtlc.isPending ? "Creating…" : "Create HTLC"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Claim dialog */}
      <Dialog open={claimOpen} onOpenChange={setClaimOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Claim HTLC #{claimId}</DialogTitle>
            <DialogDescription>
              {htlcs.find(h => h.id === claimId)?.swapMode === "crosschain_cctp"
                ? "Reveal preimage → contract burns USDC via CCTP → mints for recipient on dest chain."
                : "Reveal the secret preimage to release the locked tokens to the recipient."
              }
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleClaim} className="space-y-4 mt-2">
            <div className="space-y-1">
              <Label>Preimage (bytes32, 0x-prefixed)</Label>
              <Input placeholder="0x…" value={claimPreimage}
                onChange={e => setClaimPreimage(e.target.value)} required />
            </div>
            {htlcs.find(h => h.id === claimId)?.swapMode === "crosschain_cctp" && (
              <div className="rounded-md bg-purple-500/5 border border-purple-500/20 px-3 py-2 text-xs text-muted-foreground space-y-1">
                <div className="flex items-center gap-1 text-purple-400 font-medium"><Zap className="w-3 h-3" /> CCTP Atomic Swap</div>
                <p>Claiming calls <code className="bg-muted px-1 rounded">depositForBurn()</code> on Arc — USDC burns here and is minted for the recipient on the destination chain after Circle attests.</p>
              </div>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setClaimOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={claimHtlc.isPending}>
                {claimHtlc.isPending ? "Claiming…" : "Claim"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Total HTLCs",    value: htlcs.length },
          { label: "Active Locks",   value: activeCount },
          { label: "CCTP Crosschain",value: cctpCount },
          { label: "Total Locked",   value: formatTokenAmount(totalLocked.toString()) },
        ].map(s => (
          <Card key={s.label}>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold">{s.value}</div>
              <div className="text-xs text-muted-foreground mt-1">{s.label}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filter */}
      <div className="flex items-center gap-3">
        <Label className="text-sm text-muted-foreground">Filter:</Label>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="claimed">Claimed / Burning</SelectItem>
            <SelectItem value="relayed">Relayed</SelectItem>
            <SelectItem value="refunded">Refunded</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">HTLC Locks</CardTitle>
          <CardDescription>Claim with preimage before expiry, or refund after timelock.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground text-sm gap-2">
              <RefreshCw className="w-4 h-4 animate-spin" /> Loading…
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-3">
              <Lock className="w-8 h-8 opacity-30" />
              <span className="text-sm">No HTLCs found. Create one to get started.</span>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead>Mode</TableHead>
                    <TableHead>Depositor</TableHead>
                    <TableHead>Recipient / Dest</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Expires</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map(htlc => {
                    const now     = Math.floor(Date.now() / 1000);
                    const expired = now >= htlc.timelock;
                    const isCCTP  = htlc.swapMode === "crosschain_cctp";
                    const att     = attestation[htlc.id];
                    const destChain = isCCTP ? (DEST_CHAINS.find(d => d.domain === htlc.destinationDomain) ?? null) : null;

                    return (
                      <TableRow key={htlc.id}>
                        <TableCell className="font-mono text-xs">{htlc.id}</TableCell>
                        <TableCell>{modeBadge(htlc.swapMode)}</TableCell>
                        <TableCell className="font-mono text-xs">
                          <Tooltip>
                            <TooltipTrigger>{htlc.depositor.slice(0, 8)}…</TooltipTrigger>
                            <TooltipContent>{htlc.depositor}</TooltipContent>
                          </Tooltip>
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {isCCTP ? (
                            <div className="space-y-0.5">
                              <div className="text-purple-400 text-[10px]">{destChain?.label ?? `domain ${htlc.destinationDomain}`}</div>
                              <Tooltip>
                                <TooltipTrigger className="cursor-default">
                                  {htlc.mintRecipient ? `${htlc.mintRecipient.slice(0, 10)}…` : "—"}
                                </TooltipTrigger>
                                <TooltipContent className="font-mono text-xs break-all max-w-xs">{htlc.mintRecipient}</TooltipContent>
                              </Tooltip>
                            </div>
                          ) : (
                            <Tooltip>
                              <TooltipTrigger>{htlc.recipient.slice(0, 8)}…</TooltipTrigger>
                              <TooltipContent>{htlc.recipient}</TooltipContent>
                            </Tooltip>
                          )}
                        </TableCell>
                        <TableCell>{formatTokenAmount(htlc.amount)} {htlc.token}</TableCell>
                        <TableCell className="text-xs">
                          {new Date(htlc.timelock * 1000).toLocaleString()}
                          {expired && htlc.status === "active" && <span className="ml-1 text-red-400">● Expired</span>}
                          {!expired && htlc.status === "active" && <span className="ml-1 text-yellow-400">● Live</span>}
                        </TableCell>
                        <TableCell>
                          <div className="space-y-1">
                            {statusBadge(htlc.status)}
                            {/* CCTP attestation status for claimed crosschain HTLCs */}
                            {isCCTP && htlc.status === "claimed" && att && (
                              <div className="text-[10px] text-muted-foreground flex items-center gap-1">
                                {att.status === "polling" || att.status === "pending" ? (
                                  <><RefreshCw className="w-2.5 h-2.5 animate-spin" /> Awaiting Circle…</>
                                ) : att.status === "complete" ? (
                                  <><Zap className="w-2.5 h-2.5 text-emerald-400" /> <span className="text-emerald-400">Attested</span></>
                                ) : att.status === "error" ? (
                                  <span className="text-red-400">Attestation error</span>
                                ) : null}
                              </div>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {htlc.status === "active" && !expired && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button variant="outline" size="sm" className="h-7 px-2 text-xs text-emerald-400 border-emerald-400/30 hover:bg-emerald-400/10"
                                    onClick={() => openClaim(htlc.id)} disabled={claimHtlc.isPending}>
                                    <Key className="w-3 h-3" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>{isCCTP ? "Claim → burns USDC via CCTP" : "Claim (enter preimage)"}</TooltipContent>
                              </Tooltip>
                            )}
                            {htlc.status === "active" && expired && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button variant="outline" size="sm" className="h-7 px-2 text-xs text-red-400 border-red-400/30 hover:bg-red-400/10"
                                    onClick={() => handleRefund(htlc.id)} disabled={refundHtlc.isPending}>
                                    <RotateCcw className="w-3 h-3" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Refund (expired lock)</TooltipContent>
                              </Tooltip>
                            )}
                            {/* Relay button: shown when attested OR as simulate option */}
                            {isCCTP && htlc.status === "claimed" && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button variant="outline" size="sm"
                                    className={`h-7 px-2 text-xs ${att?.status === "complete" ? "text-emerald-400 border-emerald-400/30 hover:bg-emerald-400/10" : "text-purple-400 border-purple-400/30 hover:bg-purple-400/10"}`}
                                    onClick={() => handleSimulateRelay(htlc.id)} disabled={relayHtlc.isPending}>
                                    <ArrowRight className="w-3 h-3" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                  {att?.status === "complete"
                                    ? "Relay attestation to mint USDC on dest chain"
                                    : "Simulate relay (mark as relayed for demo)"
                                  }
                                </TooltipContent>
                              </Tooltip>
                            )}
                            {/* Preimage copy for claimed HTLCs */}
                            {htlc.status !== "active" && htlc.preimage && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button variant="ghost" size="sm" className="h-7 px-2 text-xs"
                                    onClick={() => copyToClipboard(htlc.preimage!, "Preimage")}>
                                    <Copy className="w-3 h-3" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Copy revealed preimage</TooltipContent>
                              </Tooltip>
                            )}
                            {htlc.txHash && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <a href={`${ARC_EXPLORER}/tx/${htlc.txHash}`} target="_blank" rel="noopener noreferrer">
                                    <Button variant="ghost" size="sm" className="h-7 px-2 text-xs">
                                      <ExternalLink className="w-3 h-3" />
                                    </Button>
                                  </a>
                                </TooltipTrigger>
                                <TooltipContent>View on ArcScan</TooltipContent>
                              </Tooltip>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Protocol explainer */}
      <div className="grid md:grid-cols-2 gap-4">
        <Card className="border-border/50 bg-card/50">
          <CardHeader>
            <CardTitle className="text-sm font-medium flex items-center gap-1">
              <Lock className="w-3.5 h-3.5" /> Single-Chain HTLC
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-2">
            <p><span className="text-foreground font-medium">1. Lock</span> — Depositor locks USDC/EURC with <code className="bg-muted px-1 rounded text-xs">createHTLC(recipient, token, amount, hashlock, timelock)</code>.</p>
            <p><span className="text-foreground font-medium">2. Claim</span> — Recipient calls <code className="bg-muted px-1 rounded text-xs">claim(id, preimage)</code>. Tokens released to recipient on Arc.</p>
            <p><span className="text-foreground font-medium">Refund</span> — If unclaimed after timelock, depositor calls <code className="bg-muted px-1 rounded text-xs">refund(id)</code>.</p>
            <p className="font-mono text-xs pt-1">Contract: <a href={`${ARC_EXPLORER}/address/${CONTRACT_ADDRESSES.CROSSCHAIN_HTLC}`} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">{CONTRACT_ADDRESSES.CROSSCHAIN_HTLC.slice(0, 14)}…</a></p>
          </CardContent>
        </Card>

        <Card className="border-purple-500/20 bg-purple-500/5">
          <CardHeader>
            <CardTitle className="text-sm font-medium flex items-center gap-1">
              <Globe className="w-3.5 h-3.5 text-purple-400" /> Atomic Crosschain HTLC (CCTP)
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-2">
            <p><span className="text-foreground font-medium">Setup</span> — Agree on hashlock H, amounts, timelocks (T_arc &gt; T_sep).</p>
            <p><span className="text-foreground font-medium">1.</span> Bob funds <code className="bg-muted px-1 rounded text-xs">SimpleHTLC</code> on Sepolia for Alice with H.</p>
            <p><span className="text-foreground font-medium">2.</span> Alice creates <code className="bg-muted px-1 rounded text-xs">CrosschainAtomicHTLC</code> on Arc with same H.</p>
            <p><span className="text-foreground font-medium">3.</span> Alice claims Bob's Sepolia HTLC → reveals preimage P.</p>
            <p><span className="text-foreground font-medium">4.</span> Bob (or anyone) claims Arc HTLC with P → <code className="bg-muted px-1 rounded text-xs">depositForBurn()</code> burns USDC on Arc → Circle attests → USDC minted for Bob on Sepolia.</p>
            <p><span className="text-foreground font-medium">Safety</span> — T_sep &lt; T_arc so Bob refunds if Alice never reveals.</p>
            <div className="grid grid-cols-2 gap-2 pt-1 text-xs font-mono">
              <div>
                <div className="text-muted-foreground">Arc (CrosschainAtomicHTLC)</div>
                <a href={`${ARC_EXPLORER}/address/${CONTRACT_ADDRESSES.CROSSCHAIN_ATOMIC_HTLC}`} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">{CONTRACT_ADDRESSES.CROSSCHAIN_ATOMIC_HTLC.slice(0, 14)}…</a>
              </div>
              <div>
                <div className="text-muted-foreground">Sepolia (SimpleHTLC)</div>
                <a href={`https://sepolia.etherscan.io/address/0x10ad359b96b61ee5a01fad2ba459b9d2b24b2da1`} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">0x10ad359b…</a>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
      <div className="text-xs text-muted-foreground">{IRIS_BASE && ""}</div>
    </div>
  );
}
