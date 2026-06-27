import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListSplits, useCreateSplit, useDistributeSplit, useDeactivateSplit,
  getListSplitsQueryKey,
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
  Split, Plus, RefreshCw, ExternalLink, Trash2, Send, GitFork,
  ArrowRight, Zap, DollarSign, Users, BarChart3, AlertTriangle,
} from "lucide-react";
import { decodeEventLog, isAddress, type Address } from "viem";
import { formatTokenAmount, parseTokenAmount } from "../lib/format";
import { useWallet } from "../lib/wallet";
import { CONTRACT_ADDRESSES, SPLIT_PAYMENT_ABI, ERC20_ABI, ARC_TESTNET } from "../lib/contracts";

const ARC_EXPLORER = "https://testnet.arcscan.app";
const USDC_ADDR    = "0x3600000000000000000000000000000000000000";
const EURC_ADDR    = "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a";

type Token = "USDC" | "EURC";

interface RecipientRow {
  address: string;
  sharePct: string;
}

function randomAddress(): string {
  return `0x${Array.from({ length: 40 }, () => Math.floor(Math.random() * 16).toString(16)).join("")}`;
}
function randomTx(): string {
  return `0x${Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join("")}`;
}
function pctToBps(pct: string): number {
  return Math.round(parseFloat(pct || "0") * 100);
}

type Receipt = { logs: readonly { address: Address; topics: readonly `0x${string}`[]; data: `0x${string}` }[] };

function parseSplitId(receipt: Receipt): number | null {
  for (const log of receipt.logs) {
    try {
      const decoded = decodeEventLog({ abi: SPLIT_PAYMENT_ABI, data: log.data, topics: log.topics as any });
      if (decoded.eventName === "SplitCreated") return Number((decoded.args as { splitId: bigint }).splitId);
    } catch { /* not this log */ }
  }
  return null;
}

function SplitBar({ recipients, shares }: { recipients: string[]; shares: number[] }) {
  const colors = [
    "bg-blue-500", "bg-purple-500", "bg-emerald-500", "bg-amber-500",
    "bg-pink-500", "bg-cyan-500", "bg-red-500", "bg-indigo-500",
  ];
  const total = shares.reduce((a, b) => a + b, 0);
  return (
    <div className="flex h-2 w-full rounded-full overflow-hidden gap-px">
      {shares.map((share, i) => (
        <Tooltip key={i}>
          <TooltipTrigger asChild>
            <div
              className={`${colors[i % colors.length]} h-full`}
              style={{ width: `${(share / total) * 100}%` }}
            />
          </TooltipTrigger>
          <TooltipContent>
            <div className="text-xs">
              <div className="font-mono">{recipients[i]?.slice(0, 10)}…</div>
              <div>{(share / 100).toFixed(2)}%</div>
            </div>
          </TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
}

export default function SplitsPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { address, isConnected, walletClient, publicClient, isWrongNetwork, switchToArc } = useWallet();

  const [createOpen, setCreateOpen]      = useState(false);
  const [distributeOpen, setDistribOpen] = useState(false);
  const [selectedId, setSelectedId]      = useState<number | null>(null);
  const [txPending, setTxPending]        = useState(false);
  const [txStep, setTxStep]              = useState<"approve" | "distribute" | null>(null);

  const [description, setDescription]    = useState("");
  const [token, setToken]                = useState<Token>("USDC");
  const [rows, setRows]                  = useState<RecipientRow[]>([
    { address: "", sharePct: "70" },
    { address: "", sharePct: "30" },
  ]);
  const [distributeAmt, setDistributeAmt] = useState("");

  const { data: splits = [], isLoading, refetch } = useListSplits();
  const { mutate: createSplit, isPending: creating } = useCreateSplit({
    mutation: {
      onSuccess() {
        queryClient.invalidateQueries({ queryKey: getListSplitsQueryKey() });
        setCreateOpen(false);
        setDescription(""); setToken("USDC");
        setRows([{ address: "", sharePct: "70" }, { address: "", sharePct: "30" }]);
        toast({ title: "Split created", description: "Reusable payment split is live on Arc Testnet." });
      },
      onError(err) { toast({ title: "Error", description: String(err), variant: "destructive" }); },
    },
  });
  const { mutate: distributeSplit, isPending: distributing } = useDistributeSplit({
    mutation: {
      onSuccess() {
        queryClient.invalidateQueries({ queryKey: getListSplitsQueryKey() });
        setDistribOpen(false);
        setDistributeAmt("");
        toast({ title: "Distribution recorded", description: "Funds fanned out to all recipients." });
      },
      onError(err) { toast({ title: "Error", description: String(err), variant: "destructive" }); },
    },
  });
  const { mutate: deactivate, isPending: deactivating } = useDeactivateSplit({
    mutation: {
      onSuccess() {
        queryClient.invalidateQueries({ queryKey: getListSplitsQueryKey() });
        toast({ title: "Split deactivated" });
      },
      onError(err) { toast({ title: "Error", description: String(err), variant: "destructive" }); },
    },
  });

  const totalBps = rows.reduce((s, r) => s + pctToBps(r.sharePct), 0);
  const canCreate = rows.length >= 2 && totalBps === 10000 && rows.every(r => r.address.trim());

  function addRow() {
    if (rows.length < 20) setRows(prev => [...prev, { address: "", sharePct: "0" }]);
  }
  function removeRow(i: number) {
    if (rows.length > 2) setRows(prev => prev.filter((_, idx) => idx !== i));
  }
  function updateRow(i: number, field: keyof RecipientRow, value: string) {
    setRows(prev => prev.map((r, idx) => idx === i ? { ...r, [field]: value } : r));
  }
  function fillRandomAddresses() {
    setRows(prev => prev.map(r => ({ ...r, address: r.address.trim() || randomAddress() })));
  }

  async function handleCreate() {
    const recipients = rows.map(r => r.address.trim());
    const shares     = rows.map(r => pctToBps(r.sharePct));
    const tokenAddr  = token === "USDC" ? USDC_ADDR : EURC_ADDR;

    if (!walletClient || !address) {
      createSplit({
        data: {
          creator:         randomAddress(),
          token,
          recipients,
          shares,
          description:     description.trim() || undefined,
          contractAddress: CONTRACT_ADDRESSES.SPLIT_PAYMENT,
          txHash:          randomTx(),
          chainId:         5042002,
        },
      });
      return;
    }

    if (isWrongNetwork) { await switchToArc(); return; }

    const invalidAddrs = recipients.filter(r => !isAddress(r));
    if (invalidAddrs.length > 0) {
      toast({ title: "Invalid address", description: `Not a valid 0x address: ${invalidAddrs[0]}`, variant: "destructive" });
      return;
    }

    setTxPending(true);
    try {
      const tx = await walletClient.writeContract({
        address:      CONTRACT_ADDRESSES.SPLIT_PAYMENT,
        abi:          SPLIT_PAYMENT_ABI,
        functionName: "createSplit",
        args:         [recipients as `0x${string}`[], shares.map(BigInt), tokenAddr as `0x${string}`, description.trim() || ""],
        account:      address,
        chain:        ARC_TESTNET as any,
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash: tx });
      if (receipt.status !== "success") throw new Error("Transaction reverted");
      const onChainId = parseSplitId(receipt);
      createSplit({
        data: {
          creator:         address,
          token,
          recipients,
          shares,
          description:     description.trim() || undefined,
          contractAddress: CONTRACT_ADDRESSES.SPLIT_PAYMENT,
          txHash:          tx,
          ...(onChainId !== null ? { onChainId } : {}),
          chainId:         5042002,
        },
      });
    } catch (err: any) {
      toast({ title: "Transaction failed", description: err.shortMessage ?? err.message, variant: "destructive" });
    } finally {
      setTxPending(false);
    }
  }

  async function handleDistribute() {
    if (!selectedId || !distributeAmt) return;
    const amount      = BigInt(parseTokenAmount(distributeAmt));
    const splitOnChainId = (selectedSplit as any)?.onChainId as number | null | undefined;
    const tokenAddr   = selectedSplit?.token === "EURC" ? EURC_ADDR : USDC_ADDR;

    if (!walletClient || !address) {
      distributeSplit({ id: selectedId, data: { amount: parseTokenAmount(distributeAmt), txHash: randomTx(), distributor: randomAddress() } });
      return;
    }

    if (isWrongNetwork) { await switchToArc(); return; }

    if (splitOnChainId == null) {
      toast({ title: "No on-chain ID", description: "This split was created in simulation mode.", variant: "destructive" });
      return;
    }

    setTxPending(true);
    try {
      setTxStep("approve");
      const approveTx = await walletClient.writeContract({
        address:      tokenAddr as `0x${string}`,
        abi:          ERC20_ABI,
        functionName: "approve",
        args:         [CONTRACT_ADDRESSES.SPLIT_PAYMENT, amount],
        account:      address,
        chain:        ARC_TESTNET as any,
      });
      const approveReceipt = await publicClient.waitForTransactionReceipt({ hash: approveTx });
      if (approveReceipt.status !== "success") throw new Error("Token approval reverted");

      setTxStep("distribute");
      const tx = await walletClient.writeContract({
        address:      CONTRACT_ADDRESSES.SPLIT_PAYMENT,
        abi:          SPLIT_PAYMENT_ABI,
        functionName: "distribute",
        args:         [BigInt(splitOnChainId), amount],
        account:      address,
        chain:        ARC_TESTNET as any,
      });
      await publicClient.waitForTransactionReceipt({ hash: tx });
      distributeSplit({ id: selectedId, data: { amount: parseTokenAmount(distributeAmt), txHash: tx, distributor: address } });
    } catch (err: any) {
      toast({ title: "Transaction failed", description: err.shortMessage ?? err.message, variant: "destructive" });
    } finally {
      setTxPending(false);
      setTxStep(null);
    }
  }

  async function handleDeactivate(splitId: number, onChainId: number | null | undefined) {
    if (!walletClient || !address || onChainId == null) {
      deactivate({ id: splitId, data: { txHash: randomTx() } });
      return;
    }
    if (isWrongNetwork) { await switchToArc(); return; }
    setTxPending(true);
    try {
      const tx = await walletClient.writeContract({
        address:      CONTRACT_ADDRESSES.SPLIT_PAYMENT,
        abi:          SPLIT_PAYMENT_ABI,
        functionName: "deactivate",
        args:         [BigInt(onChainId)],
        account:      address,
        chain:        ARC_TESTNET as any,
      });
      await publicClient.waitForTransactionReceipt({ hash: tx });
      deactivate({ id: splitId, data: { txHash: tx } });
    } catch (err: any) {
      toast({ title: "Transaction failed", description: err.shortMessage ?? err.message, variant: "destructive" });
    } finally {
      setTxPending(false);
    }
  }

  const selectedSplit    = splits.find(s => s.id === selectedId);
  const totalDistributed = splits.reduce((s, sp) => s + BigInt(sp.totalDistributed ?? "0"), 0n);
  const activeSplits     = splits.filter(s => s.active);
  const busy             = txPending || creating || distributing || deactivating;

  function distributeButtonLabel() {
    if (txStep === "approve")    return "Approving token…";
    if (txStep === "distribute") return "Distributing…";
    if (distributing)            return "Recording…";
    return <><Send className="w-4 h-4 mr-2" />Distribute</>;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h2 className="text-2xl font-bold tracking-tight">Split Payment</h2>
            <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-xs">Fan-out</Badge>
          </div>
          <p className="text-sm text-muted-foreground max-w-xl">
            Define reusable distribution rules — anyone sends USDC or EURC to the contract and funds
            are immediately routed to all recipients by fixed basis-point shares.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isLoading}>
            <RefreshCw className={`w-4 h-4 mr-2 ${isLoading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button size="sm"><Plus className="w-4 h-4 mr-2" />Create Split</Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>Create Payment Split</DialogTitle>
                <DialogDescription>
                  {isConnected
                    ? "Calls createSplit() on-chain. Shares must total exactly 100%. Once created, any payer can trigger a distribution."
                    : "No wallet connected — will be simulated. Connect MetaMask to create a real on-chain split."}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Description</Label>
                    <Input placeholder="API revenue share" value={description} onChange={e => setDescription(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Token</Label>
                    <Select value={token} onValueChange={v => setToken(v as Token)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="USDC">USDC</SelectItem>
                        <SelectItem value="EURC">EURC</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>Recipients</Label>
                    <div className="flex gap-2">
                      <Button variant="ghost" size="sm" className="h-6 text-xs px-2" onClick={fillRandomAddresses}>
                        Fill random
                      </Button>
                      <Button variant="ghost" size="sm" className="h-6 text-xs px-2" onClick={addRow} disabled={rows.length >= 20}>
                        <Plus className="w-3 h-3 mr-1" />Add
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                    {rows.map((row, i) => (
                      <div key={i} className="flex gap-2 items-center">
                        <Input
                          className="flex-1 font-mono text-xs h-8"
                          placeholder="0x recipient address"
                          value={row.address}
                          onChange={e => updateRow(i, "address", e.target.value)}
                        />
                        <div className="relative w-20">
                          <Input
                            className="text-xs h-8 pr-6"
                            placeholder="70"
                            value={row.sharePct}
                            onChange={e => updateRow(i, "sharePct", e.target.value)}
                          />
                          <span className="absolute right-2 top-1.5 text-xs text-muted-foreground">%</span>
                        </div>
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => removeRow(i)} disabled={rows.length <= 2}>
                          <Trash2 className="w-3.5 h-3.5 text-muted-foreground" />
                        </Button>
                      </div>
                    ))}
                  </div>

                  <div className={`flex items-center justify-between text-xs px-1 ${totalBps === 10000 ? "text-emerald-400" : totalBps > 10000 ? "text-red-400" : "text-muted-foreground"}`}>
                    <span>Total</span>
                    <span className="font-mono">{(totalBps / 100).toFixed(2)}% {totalBps === 10000 ? "✓" : totalBps > 10000 ? "(over 100%)" : "(must equal 100%)"}</span>
                  </div>

                  {canCreate && (
                    <div className="space-y-1">
                      <SplitBar
                        recipients={rows.map(r => r.address)}
                        shares={rows.map(r => pctToBps(r.sharePct))}
                      />
                      <p className="text-xs text-muted-foreground text-center">Distribution preview</p>
                    </div>
                  )}
                </div>

                <div className="rounded-md bg-muted/50 border border-border p-3 text-xs space-y-1">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Contract</span>
                    <span className="font-mono">{CONTRACT_ADDRESSES.SPLIT_PAYMENT.slice(0, 10)}…</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Recipients</span>
                    <span>{rows.length}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Mode</span>
                    <span className={isConnected ? "text-emerald-400" : "text-amber-400"}>{isConnected ? "on-chain" : "simulation"}</span>
                  </div>
                </div>

                {isWrongNetwork && (
                  <div className="flex items-center gap-2 rounded-md bg-amber-500/10 border border-amber-500/30 p-3 text-xs text-amber-400">
                    <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                    Wrong network — click Create Split to switch to Arc Testnet automatically.
                  </div>
                )}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
                <Button onClick={handleCreate} disabled={busy || !canCreate}>
                  {txPending ? "Waiting for wallet…" : creating ? "Creating…" : "Create Split"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {!isConnected && (
        <div className="flex items-center gap-2 rounded-md bg-amber-500/10 border border-amber-500/30 p-3 text-sm text-amber-400">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          Wallet not connected — actions will be simulated. Connect MetaMask to send real on-chain transactions.
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Total Splits",       value: splits.length,                                         icon: GitFork    },
          { label: "Active",             value: activeSplits.length,                                   icon: Zap        },
          { label: "Total Distributed",  value: `${formatTokenAmount(String(totalDistributed))} USDC`, icon: DollarSign },
          { label: "Avg Recipients",     value: splits.length ? (splits.reduce((s, sp) => s + ((sp.recipients as string[])?.length ?? 0), 0) / splits.length).toFixed(1) : "—", icon: Users },
        ].map(s => (
          <Card key={s.label} className="border-border">
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-muted-foreground">{s.label}</span>
                <s.icon className="w-4 h-4 text-muted-foreground" />
              </div>
              <div className="text-xl font-bold">{s.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Splits Table */}
      <Card className="border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Split className="w-4 h-4" />
            Payment Splits
          </CardTitle>
          <CardDescription className="text-xs">
            Each split holds a static distribution rule. Any payer calls distribute() — funds fan out
            instantly to all recipients proportionally.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">Loading…</div>
          ) : splits.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
              <GitFork className="w-8 h-8 mb-2 opacity-30" />
              <p className="text-sm">No splits created yet</p>
              <p className="text-xs mt-1">Create the first distribution rule above</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Split</TableHead>
                  <TableHead>Token</TableHead>
                  <TableHead>Recipients</TableHead>
                  <TableHead>Distribution</TableHead>
                  <TableHead className="text-right">Total Distributed</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {splits.map(split => {
                  const recipients = split.recipients as string[] ?? [];
                  const shares     = split.shares     as number[] ?? [];
                  const onChainId  = (split as any).onChainId as number | null | undefined;
                  return (
                    <TableRow key={split.id}>
                      <TableCell className="font-medium">
                        <div>
                          <div className="flex items-center gap-1.5">
                            {split.description || `Split #${split.id}`}
                            {onChainId != null && (
                              <span className="text-xs text-muted-foreground font-mono">#{onChainId}</span>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground font-mono">
                            {split.creator?.slice(0, 8)}…
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={split.token === "EURC" ? "text-amber-400 border-amber-400/50" : "text-blue-400 border-blue-400/50"}>
                          {split.token}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-0.5">
                          {recipients.slice(0, 3).map((r, i) => (
                            <Tooltip key={i}>
                              <TooltipTrigger>
                                <span className="text-xs font-mono text-muted-foreground block text-left">
                                  {r.slice(0, 8)}… <span className="text-foreground font-normal">{(shares[i] / 100).toFixed(0)}%</span>
                                </span>
                              </TooltipTrigger>
                              <TooltipContent>{r}</TooltipContent>
                            </Tooltip>
                          ))}
                          {recipients.length > 3 && (
                            <span className="text-xs text-muted-foreground">+{recipients.length - 3} more</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="min-w-[120px]">
                        {recipients.length > 0 && <SplitBar recipients={recipients} shares={shares} />}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {formatTokenAmount(split.totalDistributed ?? "0")} {split.token}
                      </TableCell>
                      <TableCell>
                        {split.active
                          ? <Badge variant="outline" className="text-emerald-400 border-emerald-400/50">Active</Badge>
                          : <Badge variant="outline" className="text-muted-foreground">Inactive</Badge>
                        }
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1 justify-end">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost" size="icon" className="h-7 w-7"
                                disabled={!split.active || busy}
                                onClick={() => { setSelectedId(split.id ?? null); setDistribOpen(true); }}
                              >
                                <Send className="w-3.5 h-3.5" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Distribute</TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost" size="icon" className="h-7 w-7"
                                disabled={!split.active || busy}
                                onClick={() => handleDeactivate(split.id!, onChainId)}
                              >
                                <Trash2 className="w-3.5 h-3.5 text-muted-foreground" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Deactivate</TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost" size="icon" className="h-7 w-7"
                                onClick={() => window.open(`${ARC_EXPLORER}/tx/${split.txHash}`, "_blank")}
                              >
                                <ExternalLink className="w-3.5 h-3.5" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>View on ArcScan</TooltipContent>
                          </Tooltip>
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

      {/* Distribute Dialog */}
      <Dialog open={distributeOpen} onOpenChange={setDistribOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Distribute Funds</DialogTitle>
            <DialogDescription>
              {isConnected && (selectedSplit as any)?.onChainId != null
                ? <>Calls <code className="font-mono text-xs">approve()</code> then <code className="font-mono text-xs">distribute()</code> on-chain for <strong>{selectedSplit?.description || `Split #${selectedSplit?.id}`}</strong>. Funds fan out instantly to all {(selectedSplit?.recipients as string[])?.length ?? 0} recipients.</>
                : <>Simulates a <code className="font-mono text-xs">distribute()</code> call for <strong>{selectedSplit?.description || `Split #${selectedSplit?.id}`}</strong>. Connect wallet and use an on-chain split to send real tokens.</>
              }
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Amount ({selectedSplit?.token})</Label>
              <div className="relative">
                <Input
                  placeholder="1000"
                  value={distributeAmt}
                  onChange={e => setDistributeAmt(e.target.value)}
                  className="pr-16"
                />
                <span className="absolute right-3 top-2.5 text-xs text-muted-foreground">{selectedSplit?.token}</span>
              </div>
            </div>
            {distributeAmt && selectedSplit && (
              <div className="rounded-md bg-muted/50 border border-border p-3 text-xs space-y-1.5">
                <div className="text-muted-foreground mb-1">Payout preview</div>
                {(selectedSplit.recipients as string[] ?? []).map((r, i) => {
                  const shares = selectedSplit.shares as number[] ?? [];
                  const pct    = (shares[i] ?? 0) / 100;
                  const amt    = parseFloat(distributeAmt || "0") * pct / 100;
                  return (
                    <div key={i} className="flex justify-between">
                      <span className="font-mono text-muted-foreground">{r.slice(0, 8)}…</span>
                      <span className="flex items-center gap-1">
                        <ArrowRight className="w-3 h-3 text-emerald-400" />
                        {amt.toFixed(4)} {selectedSplit.token} ({pct.toFixed(0)}%)
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
            {isConnected && txStep === "approve" && (
              <p className="text-xs text-amber-400 text-center">Step 1/2: approving token spend…</p>
            )}
            {isConnected && txStep === "distribute" && (
              <p className="text-xs text-emerald-400 text-center">Step 2/2: distributing to recipients…</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDistribOpen(false)} disabled={busy}>Cancel</Button>
            <Button onClick={handleDistribute} disabled={busy || !distributeAmt}>
              {distributeButtonLabel()}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* How it works */}
      <Card className="border-border bg-muted/30">
        <CardContent className="pt-4 pb-4">
          <div className="flex items-start gap-3">
            <BarChart3 className="w-4 h-4 text-emerald-400 mt-0.5 flex-shrink-0" />
            <div className="space-y-1">
              <p className="text-sm font-medium">How Split Payment works</p>
              <p className="text-xs text-muted-foreground">
                <code className="font-mono bg-muted px-1 rounded">createSplit(recipients, shares, token, description)</code> stores a reusable distribution rule on-chain — shares are in basis points (10000 = 100%).
                Once created, any payer calls <code className="font-mono bg-muted px-1 rounded">distribute(splitId, amount)</code> after approving the contract as an ERC-20 spender. Funds are pulled from the payer and
                pushed proportionally to all recipients in a single transaction. The last recipient absorbs any rounding dust. This is different from <strong>Batch Transfer</strong>,
                which requires the sender to enumerate recipients every time — a Split is a persistent, reusable distribution contract.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
