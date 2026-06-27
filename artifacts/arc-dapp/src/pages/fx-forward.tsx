import { useState, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListFxForwards, useCreateFxForward, useFundFxForward, useSettleFxForward, useCancelFxForward,
  getListFxForwardsQueryKey,
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
import { TrendingUp, Plus, RefreshCw, ExternalLink, HandCoins, CheckCircle2, XCircle, Info } from "lucide-react";
import { formatTokenAmount, parseTokenAmount } from "../lib/format";
import { useWallet } from "../lib/wallet";
import { CONTRACT_ADDRESSES } from "../lib/contracts";

const ARC_EXPLORER = "https://testnet.arcscan.app";

function randomAddress(): string {
  const hex = Array.from({ length: 40 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
  return `0x${hex}`;
}
function randomTx(): string {
  const hex = Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
  return `0x${hex}`;
}

function statusBadge(status: string) {
  switch (status) {
    case "created":  return <Badge variant="outline" className="text-yellow-400 border-yellow-400/50">Created</Badge>;
    case "funded":   return <Badge variant="outline" className="text-blue-400 border-blue-400/50">Funded</Badge>;
    case "settled":  return <Badge variant="outline" className="text-emerald-400 border-emerald-400/50">Settled</Badge>;
    case "cancelled":return <Badge variant="outline" className="text-red-400 border-red-400/50">Cancelled</Badge>;
    default:         return <Badge variant="outline">{status}</Badge>;
  }
}

const DEFAULT_FORM = {
  partyB: "",
  usdcAmount: "",
  eurcAmount: "",
  maturityDays: "30",
  fundingHours: "48",
};

export default function FxForward() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { address, isConnected } = useWallet();

  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState(DEFAULT_FORM);
  const [filterStatus, setFilterStatus] = useState<string>("all");

  const { data: forwards = [], isLoading, refetch } = useListFxForwards();

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListFxForwardsQueryKey() });

  const createForward = useCreateFxForward({
    mutation: {
      onSuccess: () => { invalidate(); setCreateOpen(false); setForm(DEFAULT_FORM); toast({ title: "FX Forward created", description: "Party B can now fund it before the deadline." }); },
      onError: (e: unknown) => toast({ title: "Create failed", description: String(e), variant: "destructive" }),
    },
  });
  const fundForward = useFundFxForward({
    mutation: {
      onSuccess: () => { invalidate(); toast({ title: "Forward funded", description: "Both parties have deposited. Settlement available at maturity." }); },
      onError: (e: unknown) => toast({ title: "Fund failed", description: String(e), variant: "destructive" }),
    },
  });
  const settleForward = useSettleFxForward({
    mutation: {
      onSuccess: () => { invalidate(); toast({ title: "Forward settled", description: "Tokens swapped between parties." }); },
      onError: (e: unknown) => toast({ title: "Settle failed", description: String(e), variant: "destructive" }),
    },
  });
  const cancelForward = useCancelFxForward({
    mutation: {
      onSuccess: () => { invalidate(); toast({ title: "Forward cancelled", description: "USDC refunded to Party A." }); },
      onError: (e: unknown) => toast({ title: "Cancel failed", description: String(e), variant: "destructive" }),
    },
  });

  const filtered = useMemo(() =>
    filterStatus === "all" ? forwards : forwards.filter(f => f.status === filterStatus),
  [forwards, filterStatus]);

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const usdc = parseTokenAmount(form.usdcAmount);
    const eurc = parseTokenAmount(form.eurcAmount);
    if (!usdc || !eurc || usdc === "0" || eurc === "0") {
      toast({ title: "Invalid amounts", variant: "destructive" }); return;
    }
    const partyA = isConnected && address ? address : randomAddress();
    const partyB = form.partyB.trim() || randomAddress();
    const now = Math.floor(Date.now() / 1000);
    const maturity = now + Number(form.maturityDays) * 86400;
    const fundingDeadline = now + Number(form.fundingHours) * 3600;
    createForward.mutate({
      data: {
        partyA, partyB,
        usdcAmount: usdc, eurcAmount: eurc,
        maturity, fundingDeadline,
        contractAddress: CONTRACT_ADDRESSES.FX_FORWARD,
        txHash: randomTx(),
        chainId: 5042002,
      },
    });
  }

  function handleFund(id: number) {
    fundForward.mutate({ id, data: { txHash: randomTx() } });
  }
  function handleSettle(id: number) {
    settleForward.mutate({ id, data: { txHash: randomTx() } });
  }
  function handleCancel(id: number) {
    cancelForward.mutate({ id, data: { txHash: randomTx() } });
  }

  const totalUsdc = forwards.filter(f => f.status === "funded" || f.status === "created")
    .reduce((s, f) => s + BigInt(f.usdcAmount), 0n);
  const totalEurc = forwards.filter(f => f.status === "funded" || f.status === "created")
    .reduce((s, f) => s + BigInt(f.eurcAmount), 0n);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <TrendingUp className="w-6 h-6 text-primary" />
            FX Forward
          </h2>
          <p className="text-muted-foreground text-sm mt-1">
            On-chain USDC/EURC forward contracts — lock in an exchange rate now, settle at maturity.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isLoading}>
            <RefreshCw className={`w-4 h-4 mr-1 ${isLoading ? "animate-spin" : ""}`} /> Refresh
          </Button>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button size="sm"><Plus className="w-4 h-4 mr-1" /> Create Forward</Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>Create FX Forward</DialogTitle>
                <DialogDescription>
                  You (Party A) deposit USDC. Party B deposits EURC. At maturity both sides receive the other's tokens at the agreed rate.
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleCreate} className="space-y-4 mt-2">
                <div className="space-y-1">
                  <Label>Party B address (counterparty)</Label>
                  <Input placeholder="0x… (leave blank for simulated address)" value={form.partyB}
                    onChange={e => setForm(f => ({ ...f, partyB: e.target.value }))} />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <Label>USDC amount (you deposit)</Label>
                    <Input placeholder="e.g. 1000" type="number" min="0" step="0.000001" value={form.usdcAmount}
                      onChange={e => setForm(f => ({ ...f, usdcAmount: e.target.value }))} required />
                  </div>
                  <div className="space-y-1">
                    <Label>EURC amount (party B deposits)</Label>
                    <Input placeholder="e.g. 920" type="number" min="0" step="0.000001" value={form.eurcAmount}
                      onChange={e => setForm(f => ({ ...f, eurcAmount: e.target.value }))} required />
                  </div>
                </div>
                {form.usdcAmount && form.eurcAmount && Number(form.eurcAmount) > 0 && (
                  <p className="text-xs text-muted-foreground bg-muted/50 rounded px-3 py-2">
                    Implied rate: 1 EURC = {(Number(form.usdcAmount) / Number(form.eurcAmount)).toFixed(6)} USDC
                  </p>
                )}
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <Label>Maturity (days from now)</Label>
                    <Input type="number" min="1" value={form.maturityDays}
                      onChange={e => setForm(f => ({ ...f, maturityDays: e.target.value }))} required />
                  </div>
                  <div className="space-y-1">
                    <Label>Funding deadline (hours from now)</Label>
                    <Input type="number" min="1" value={form.fundingHours}
                      onChange={e => setForm(f => ({ ...f, fundingHours: e.target.value }))} required />
                  </div>
                </div>
                <div className="rounded-md bg-muted/40 border border-border px-3 py-2 text-xs text-muted-foreground space-y-1">
                  <div className="flex items-center gap-1"><Info className="w-3 h-3" /> Contract: <span className="font-mono">{CONTRACT_ADDRESSES.FX_FORWARD.slice(0, 10)}…</span></div>
                  {!isConnected && <div>No wallet connected — Party A address will be simulated.</div>}
                </div>
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
                  <Button type="submit" disabled={createForward.isPending}>
                    {createForward.isPending ? "Creating…" : "Create Forward"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Total Forwards",   value: forwards.length },
          { label: "Active (created)", value: forwards.filter(f => f.status === "created").length },
          { label: "USDC Locked",      value: `${formatTokenAmount(totalUsdc.toString())} USDC` },
          { label: "EURC Locked",      value: `${formatTokenAmount(totalEurc.toString())} EURC` },
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
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="created">Created</SelectItem>
            <SelectItem value="funded">Funded</SelectItem>
            <SelectItem value="settled">Settled</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Forward Contracts</CardTitle>
          <CardDescription>Click an action to fund, settle, or cancel on-chain.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground text-sm gap-2">
              <RefreshCw className="w-4 h-4 animate-spin" /> Loading…
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-3">
              <TrendingUp className="w-8 h-8 opacity-30" />
              <span className="text-sm">No forwards found. Create one to get started.</span>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>Party A</TableHead>
                  <TableHead>Party B</TableHead>
                  <TableHead>USDC</TableHead>
                  <TableHead>EURC</TableHead>
                  <TableHead>Rate</TableHead>
                  <TableHead>Maturity</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(fwd => {
                  const now = Math.floor(Date.now() / 1000);
                  const mature = now >= fwd.maturity;
                  const rate = fwd.eurcAmount && BigInt(fwd.eurcAmount) > 0n
                    ? (Number(fwd.usdcAmount) / Number(fwd.eurcAmount)).toFixed(4)
                    : "—";
                  return (
                    <TableRow key={fwd.id}>
                      <TableCell className="font-mono text-xs">{fwd.id}</TableCell>
                      <TableCell className="font-mono text-xs">
                        <Tooltip>
                          <TooltipTrigger>{fwd.partyA.slice(0, 8)}…</TooltipTrigger>
                          <TooltipContent>{fwd.partyA}</TooltipContent>
                        </Tooltip>
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        <Tooltip>
                          <TooltipTrigger>{fwd.partyB.slice(0, 8)}…</TooltipTrigger>
                          <TooltipContent>{fwd.partyB}</TooltipContent>
                        </Tooltip>
                      </TableCell>
                      <TableCell>{formatTokenAmount(fwd.usdcAmount)} USDC</TableCell>
                      <TableCell>{formatTokenAmount(fwd.eurcAmount)} EURC</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{rate}</TableCell>
                      <TableCell className="text-xs">
                        {new Date(fwd.maturity * 1000).toLocaleDateString()}
                        {mature && fwd.status === "funded" && <span className="ml-1 text-emerald-400">● Ready</span>}
                      </TableCell>
                      <TableCell>{statusBadge(fwd.status)}</TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          {fwd.status === "created" && (
                            <>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => handleFund(fwd.id)}
                                    disabled={fundForward.isPending}>
                                    <HandCoins className="w-3 h-3" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Fund (Party B deposits EURC)</TooltipContent>
                              </Tooltip>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button variant="outline" size="sm" className="h-7 px-2 text-xs text-red-400 border-red-400/30 hover:bg-red-400/10" onClick={() => handleCancel(fwd.id)}
                                    disabled={cancelForward.isPending}>
                                    <XCircle className="w-3 h-3" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Cancel (refund USDC)</TooltipContent>
                              </Tooltip>
                            </>
                          )}
                          {fwd.status === "funded" && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button variant="outline" size="sm" className="h-7 px-2 text-xs text-emerald-400 border-emerald-400/30 hover:bg-emerald-400/10" onClick={() => handleSettle(fwd.id)}
                                  disabled={settleForward.isPending || !mature}>
                                  <CheckCircle2 className="w-3 h-3" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>{mature ? "Settle at maturity" : "Not yet mature"}</TooltipContent>
                            </Tooltip>
                          )}
                          {fwd.txHash && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <a href={`${ARC_EXPLORER}/tx/${fwd.txHash}`} target="_blank" rel="noopener noreferrer">
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
          )}
        </CardContent>
      </Card>

      {/* Explainer */}
      <Card className="border-border/50 bg-card/50">
        <CardHeader>
          <CardTitle className="text-sm font-medium">How FX Forwards Work</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p><span className="text-foreground font-medium">1. Create</span> — Party A approves + deposits USDC into the contract. A forward rate is locked on-chain.</p>
          <p><span className="text-foreground font-medium">2. Fund</span> — Party B deposits the agreed EURC amount before the funding deadline. Both deposits are held by the contract.</p>
          <p><span className="text-foreground font-medium">3. Settle</span> — After maturity, anyone calls <code className="bg-muted px-1 rounded text-xs">settle()</code>. USDC goes to Party B, EURC goes to Party A.</p>
          <p><span className="text-foreground font-medium">Cancel</span> — If Party B never funds before the deadline, Party A can cancel and recover their USDC.</p>
          <p className="font-mono text-xs pt-1">Contract: <a href={`${ARC_EXPLORER}/address/${CONTRACT_ADDRESSES.FX_FORWARD}`} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">{CONTRACT_ADDRESSES.FX_FORWARD}</a></p>
        </CardContent>
      </Card>
    </div>
  );
}
