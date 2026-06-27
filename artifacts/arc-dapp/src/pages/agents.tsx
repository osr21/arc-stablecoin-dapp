import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListAgents, useCreateAgent, useRecordAgentActivity, useUpdateAgentStatus,
  getListAgentsQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import {
  Bot, Plus, RefreshCw, ExternalLink, Activity, Star,
  Shield, TrendingUp, Users, Zap, AlertTriangle,
} from "lucide-react";
import { decodeEventLog, type Address } from "viem";
import { formatTokenAmount, parseTokenAmount } from "../lib/format";
import { useWallet } from "../lib/wallet";
import { CONTRACT_ADDRESSES, AGENT_REGISTRY_ABI, ARC_TESTNET } from "../lib/contracts";

const ARC_EXPLORER = "https://testnet.arcscan.app";

type AgentType = "api-consumer" | "market-maker" | "data-provider" | "orchestrator" | "custom";
type AgentStatus = "active" | "suspended" | "deactivated";

const AGENT_TYPES: { value: AgentType; label: string; desc: string }[] = [
  { value: "api-consumer",  label: "API Consumer",   desc: "Purchases paid API endpoints or datasets" },
  { value: "market-maker",  label: "Market Maker",   desc: "Provides liquidity or executes automated trades" },
  { value: "data-provider", label: "Data Provider",  desc: "Sells or streams market/oracle data" },
  { value: "orchestrator",  label: "Orchestrator",   desc: "Coordinates multi-agent workflows" },
  { value: "custom",        label: "Custom",         desc: "General-purpose autonomous agent" },
];

function randomAddress(): string {
  return `0x${Array.from({ length: 40 }, () => Math.floor(Math.random() * 16).toString(16)).join("")}`;
}
function randomTx(): string {
  return `0x${Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join("")}`;
}

type Receipt = { logs: readonly { address: Address; topics: readonly `0x${string}`[]; data: `0x${string}` }[] };

function parseAgentId(receipt: Receipt): number | null {
  for (const log of receipt.logs) {
    try {
      const decoded = decodeEventLog({ abi: AGENT_REGISTRY_ABI, data: log.data, topics: log.topics as any });
      if (decoded.eventName === "AgentRegistered") return Number((decoded.args as { agentId: bigint }).agentId);
    } catch { /* not this log */ }
  }
  return null;
}

function statusBadge(status: string) {
  switch (status) {
    case "active":      return <Badge variant="outline" className="text-emerald-400 border-emerald-400/50">Active</Badge>;
    case "suspended":   return <Badge variant="outline" className="text-yellow-400 border-yellow-400/50">Suspended</Badge>;
    case "deactivated": return <Badge variant="outline" className="text-red-400 border-red-400/50">Deactivated</Badge>;
    default:            return <Badge variant="outline">{status}</Badge>;
  }
}

function typeBadge(type: string) {
  const colors: Record<string, string> = {
    "api-consumer":  "text-blue-400 border-blue-400/50",
    "market-maker":  "text-purple-400 border-purple-400/50",
    "data-provider": "text-amber-400 border-amber-400/50",
    "orchestrator":  "text-pink-400 border-pink-400/50",
    "custom":        "text-slate-400 border-slate-400/50",
  };
  const labels: Record<string, string> = {
    "api-consumer":  "API Consumer",
    "market-maker":  "Market Maker",
    "data-provider": "Data Provider",
    "orchestrator":  "Orchestrator",
    "custom":        "Custom",
  };
  return <Badge variant="outline" className={colors[type] ?? ""}>{labels[type] ?? type}</Badge>;
}

function reputationColor(score: number) {
  if (score >= 80) return "bg-emerald-500";
  if (score >= 50) return "bg-yellow-500";
  if (score >= 20) return "bg-amber-500";
  return "bg-red-500";
}

export default function AgentRegistryPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { address, isConnected, walletClient, publicClient, isWrongNetwork, switchToArc } = useWallet();

  const [createOpen, setCreateOpen]         = useState(false);
  const [activityOpen, setActivityOpen]     = useState(false);
  const [statusOpen, setStatusOpen]         = useState(false);
  const [selectedId, setSelectedId]         = useState<number | null>(null);
  const [txPending, setTxPending]           = useState(false);

  const [newName, setNewName]               = useState("");
  const [newType, setNewType]               = useState<AgentType>("api-consumer");
  const [newMetadata, setNewMetadata]       = useState("");

  const [activityAmount, setActivityAmount] = useState("");
  const [newStatus, setNewStatus]           = useState<AgentStatus>("suspended");

  const { data: agents = [], isLoading, refetch } = useListAgents();
  const { mutate: createAgent, isPending: creating } = useCreateAgent({
    mutation: {
      onSuccess() {
        queryClient.invalidateQueries({ queryKey: getListAgentsQueryKey() });
        setCreateOpen(false);
        setNewName(""); setNewType("api-consumer"); setNewMetadata("");
        toast({ title: "Agent registered", description: "Identity live on Arc Testnet." });
      },
      onError(err) { toast({ title: "Error", description: String(err), variant: "destructive" }); },
    },
  });
  const { mutate: recordActivity, isPending: recording } = useRecordAgentActivity({
    mutation: {
      onSuccess() {
        queryClient.invalidateQueries({ queryKey: getListAgentsQueryKey() });
        setActivityOpen(false);
        setActivityAmount("");
        toast({ title: "Activity recorded", description: "Reputation score updated." });
      },
      onError(err) { toast({ title: "Error", description: String(err), variant: "destructive" }); },
    },
  });
  const { mutate: updateStatus, isPending: updatingStatus } = useUpdateAgentStatus({
    mutation: {
      onSuccess() {
        queryClient.invalidateQueries({ queryKey: getListAgentsQueryKey() });
        setStatusOpen(false);
        toast({ title: "Status updated" });
      },
      onError(err) { toast({ title: "Error", description: String(err), variant: "destructive" }); },
    },
  });

  async function handleCreate() {
    if (!newName.trim()) return;

    if (!walletClient || !address) {
      createAgent({
        data: {
          owner:           randomAddress(),
          name:            newName.trim(),
          agentType:       newType,
          metadataUri:     newMetadata.trim() || undefined,
          contractAddress: CONTRACT_ADDRESSES.AGENT_REGISTRY,
          txHash:          randomTx(),
          onChainId:       Math.floor(Math.random() * 10000),
          chainId:         5042002,
        },
      });
      return;
    }

    if (isWrongNetwork) { await switchToArc(); return; }

    setTxPending(true);
    try {
      const tx = await walletClient.writeContract({
        address:      CONTRACT_ADDRESSES.AGENT_REGISTRY,
        abi:          AGENT_REGISTRY_ABI,
        functionName: "registerAgent",
        args:         [newName.trim(), newType, newMetadata.trim() || ""],
        account:      address,
        chain:        ARC_TESTNET as any,
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash: tx });
      if (receipt.status !== "success") throw new Error("Transaction reverted");
      const onChainId = parseAgentId(receipt);
      createAgent({
        data: {
          owner:           address,
          name:            newName.trim(),
          agentType:       newType,
          metadataUri:     newMetadata.trim() || undefined,
          contractAddress: CONTRACT_ADDRESSES.AGENT_REGISTRY,
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

  async function handleRecordActivity() {
    if (!selectedId || !activityAmount) return;
    const amount    = parseTokenAmount(activityAmount);
    const agentOnChainId = (selectedAgent as any)?.onChainId as number | null | undefined;

    if (!walletClient || !address) {
      recordActivity({ id: selectedId, data: { amount, txHash: randomTx(), caller: randomAddress() } });
      return;
    }

    if (isWrongNetwork) { await switchToArc(); return; }

    if (agentOnChainId == null) {
      toast({ title: "No on-chain ID", description: "This agent was registered in simulation mode and has no on-chain record.", variant: "destructive" });
      return;
    }

    setTxPending(true);
    try {
      const tx = await walletClient.writeContract({
        address:      CONTRACT_ADDRESSES.AGENT_REGISTRY,
        abi:          AGENT_REGISTRY_ABI,
        functionName: "recordActivity",
        args:         [BigInt(agentOnChainId), BigInt(amount)],
        account:      address,
        chain:        ARC_TESTNET as any,
      });
      await publicClient.waitForTransactionReceipt({ hash: tx });
      recordActivity({ id: selectedId, data: { amount, txHash: tx, caller: address } });
    } catch (err: any) {
      toast({ title: "Transaction failed", description: err.shortMessage ?? err.message, variant: "destructive" });
    } finally {
      setTxPending(false);
    }
  }

  async function handleStatusChange() {
    if (!selectedId) return;
    const agentOnChainId = (selectedAgent as any)?.onChainId as number | null | undefined;

    if (!walletClient || !address || agentOnChainId == null) {
      updateStatus({ id: selectedId, data: { status: newStatus } });
      return;
    }

    if (isWrongNetwork) { await switchToArc(); return; }

    const statusIndex = newStatus === "active" ? 0 : newStatus === "suspended" ? 1 : 2;

    setTxPending(true);
    try {
      const tx = await walletClient.writeContract({
        address:      CONTRACT_ADDRESSES.AGENT_REGISTRY,
        abi:          AGENT_REGISTRY_ABI,
        functionName: "setStatus",
        args:         [BigInt(agentOnChainId), statusIndex],
        account:      address,
        chain:        ARC_TESTNET as any,
      });
      await publicClient.waitForTransactionReceipt({ hash: tx });
      updateStatus({ id: selectedId, data: { status: newStatus } });
    } catch (err: any) {
      toast({ title: "Transaction failed", description: err.shortMessage ?? err.message, variant: "destructive" });
    } finally {
      setTxPending(false);
    }
  }

  const totalVolume   = agents.reduce((s, a) => s + BigInt(a.totalVolume ?? "0"), 0n);
  const activeCount   = agents.filter(a => a.status === "active").length;
  const avgReputation = agents.length ? Math.round(agents.reduce((s, a) => s + (a.reputationScore ?? 0), 0) / agents.length) : 0;

  const selectedAgent = agents.find(a => a.id === selectedId);
  const busy = txPending || creating || recording || updatingStatus;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h2 className="text-2xl font-bold tracking-tight">Agent Registry</h2>
            <Badge className="bg-purple-500/20 text-purple-400 border-purple-500/30 text-xs">ERC-8004</Badge>
          </div>
          <p className="text-sm text-muted-foreground max-w-xl">
            On-chain identity for autonomous agents — register, validate, and build reputation through
            recorded economic activity. Used as the identity layer for agentic economic workflows.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isLoading}>
            <RefreshCw className={`w-4 h-4 mr-2 ${isLoading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button size="sm"><Plus className="w-4 h-4 mr-2" />Register Agent</Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Register Agent Identity</DialogTitle>
                <DialogDescription>
                  {isConnected
                    ? "Calls registerAgent() on-chain. The agent ID is returned by the contract and stored on-chain permanently."
                    : "No wallet connected — transaction will be simulated. Connect MetaMask to register on-chain."}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <div className="space-y-1.5">
                  <Label>Agent Name</Label>
                  <Input placeholder="TreasuryAgent-v2" value={newName} onChange={e => setNewName(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Agent Type</Label>
                  <Select value={newType} onValueChange={v => setNewType(v as AgentType)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {AGENT_TYPES.map(t => (
                        <SelectItem key={t.value} value={t.value}>
                          <div>
                            <div className="font-medium">{t.label}</div>
                            <div className="text-xs text-muted-foreground">{t.desc}</div>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Metadata URI <span className="text-muted-foreground">(optional)</span></Label>
                  <Input placeholder="https://example.com/agent-metadata.json" value={newMetadata} onChange={e => setNewMetadata(e.target.value)} />
                  <p className="text-xs text-muted-foreground">IPFS or HTTPS URI describing capabilities, public key, etc.</p>
                </div>
                <div className="rounded-md bg-muted/50 border border-border p-3 text-xs space-y-1">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Contract</span>
                    <span className="font-mono">{CONTRACT_ADDRESSES.AGENT_REGISTRY.slice(0, 10)}…</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Owner</span>
                    <span className="font-mono">{isConnected && address ? `${address.slice(0, 8)}…` : "random (simulated)"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Mode</span>
                    <span className={isConnected ? "text-emerald-400" : "text-amber-400"}>{isConnected ? "on-chain" : "simulation"}</span>
                  </div>
                </div>
                {isWrongNetwork && (
                  <div className="flex items-center gap-2 rounded-md bg-amber-500/10 border border-amber-500/30 p-3 text-xs text-amber-400">
                    <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                    Wrong network — click Register to switch to Arc Testnet automatically.
                  </div>
                )}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
                <Button onClick={handleCreate} disabled={busy || !newName.trim()}>
                  {txPending ? "Waiting for wallet…" : creating ? "Registering…" : "Register Agent"}
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
          { label: "Total Agents",   value: agents.length,                          icon: Users       },
          { label: "Active",         value: activeCount,                             icon: Shield      },
          { label: "Total Volume",   value: `${formatTokenAmount(String(totalVolume))} USDC`, icon: TrendingUp  },
          { label: "Avg Reputation", value: `${avgReputation} / 100`,               icon: Star        },
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

      {/* Agents Table */}
      <Card className="border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Bot className="w-4 h-4" />
            Registered Agents
          </CardTitle>
          <CardDescription className="text-xs">
            Each agent's reputation score (0–100) is computed from transaction count × 5 + total volume / $1 000 USDC.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">Loading…</div>
          ) : agents.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
              <Bot className="w-8 h-8 mb-2 opacity-30" />
              <p className="text-sm">No agents registered yet</p>
              <p className="text-xs mt-1">Register the first agent identity above</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Owner</TableHead>
                  <TableHead>Reputation</TableHead>
                  <TableHead className="text-right">Volume</TableHead>
                  <TableHead className="text-right">Txns</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {agents.map(agent => (
                  <TableRow key={agent.id}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                          <Bot className="w-3 h-3 text-primary" />
                        </div>
                        <div>
                          <span>{agent.name}</span>
                          {(agent as any).onChainId != null && (
                            <span className="ml-1.5 text-xs text-muted-foreground font-mono">#{(agent as any).onChainId}</span>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>{typeBadge(agent.agentType ?? "custom")}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      <Tooltip>
                        <TooltipTrigger>
                          <span>{agent.owner?.slice(0, 8)}…{agent.owner?.slice(-4)}</span>
                        </TooltipTrigger>
                        <TooltipContent>{agent.owner}</TooltipContent>
                      </Tooltip>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2 min-w-[80px]">
                        <Progress
                          value={agent.reputationScore ?? 0}
                          className={`h-1.5 w-16 [&>div]:${reputationColor(agent.reputationScore ?? 0)}`}
                        />
                        <span className="text-xs font-mono">{agent.reputationScore ?? 0}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {formatTokenAmount(agent.totalVolume ?? "0")} USDC
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">{agent.txCount ?? 0}</TableCell>
                    <TableCell>{statusBadge(agent.status ?? "active")}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1 justify-end">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost" size="icon" className="h-7 w-7"
                              disabled={agent.status !== "active" || busy}
                              onClick={() => { setSelectedId(agent.id ?? null); setActivityOpen(true); }}
                            >
                              <Activity className="w-3.5 h-3.5" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Record Activity</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost" size="icon" className="h-7 w-7"
                              disabled={busy}
                              onClick={() => { setSelectedId(agent.id ?? null); setNewStatus("suspended"); setStatusOpen(true); }}
                            >
                              <Shield className="w-3.5 h-3.5" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Change Status</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost" size="icon" className="h-7 w-7"
                              onClick={() => window.open(`${ARC_EXPLORER}/tx/${agent.txHash}`, "_blank")}
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>View on ArcScan</TooltipContent>
                        </Tooltip>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Record Activity Dialog */}
      <Dialog open={activityOpen} onOpenChange={setActivityOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Record Activity</DialogTitle>
            <DialogDescription>
              Attest an economic transaction for <strong>{selectedAgent?.name}</strong>.
              {isConnected && (selectedAgent as any)?.onChainId != null
                ? " Calls recordActivity() on-chain — permissionless, any address can attest."
                : " No wallet or no on-chain ID — will be simulated."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>USDC Amount</Label>
              <div className="relative">
                <Input
                  placeholder="100"
                  value={activityAmount}
                  onChange={e => setActivityAmount(e.target.value)}
                  className="pr-16"
                />
                <span className="absolute right-3 top-2.5 text-xs text-muted-foreground">USDC</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Permissionless attestation — any address can record activity for an active agent.
              </p>
            </div>
            {activityAmount && (
              <div className="rounded-md bg-muted/50 border border-border p-3 text-xs space-y-1">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Current volume</span>
                  <span>{formatTokenAmount(selectedAgent?.totalVolume ?? "0")} USDC</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">After this tx</span>
                  <span className="text-emerald-400">
                    {formatTokenAmount(String(BigInt(selectedAgent?.totalVolume ?? "0") + BigInt(parseTokenAmount(activityAmount) || 0n)))} USDC
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Tx count</span>
                  <span>{(selectedAgent?.txCount ?? 0)} → {(selectedAgent?.txCount ?? 0) + 1}</span>
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setActivityOpen(false)}>Cancel</Button>
            <Button onClick={handleRecordActivity} disabled={busy || !activityAmount}>
              {txPending ? "Waiting for wallet…" : recording ? "Recording…" : <><Activity className="w-4 h-4 mr-2" />Record</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Status Change Dialog */}
      <Dialog open={statusOpen} onOpenChange={setStatusOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Change Agent Status</DialogTitle>
            <DialogDescription>
              Update status for <strong>{selectedAgent?.name}</strong>.
              {isConnected && (selectedAgent as any)?.onChainId != null
                ? " Calls setStatus() on-chain — only the agent owner can call this."
                : " No wallet or no on-chain ID — status will update in database only."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>New Status</Label>
              <Select value={newStatus} onValueChange={v => setNewStatus(v as AgentStatus)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active — can participate in workflows</SelectItem>
                  <SelectItem value="suspended">Suspended — temporarily paused</SelectItem>
                  <SelectItem value="deactivated">Deactivated — permanently disabled</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStatusOpen(false)}>Cancel</Button>
            <Button onClick={handleStatusChange} disabled={busy}>
              {txPending ? "Waiting for wallet…" : updatingStatus ? "Updating…" : "Update Status"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* How it works */}
      <Card className="border-border bg-muted/30">
        <CardContent className="pt-4 pb-4">
          <div className="flex items-start gap-3">
            <Zap className="w-4 h-4 text-purple-400 mt-0.5 flex-shrink-0" />
            <div className="space-y-1">
              <p className="text-sm font-medium">ERC-8004 Agent Identity Protocol</p>
              <p className="text-xs text-muted-foreground">
                Each agent is registered via <code className="font-mono bg-muted px-1 rounded">registerAgent(name, agentType, metadataURI)</code> on Arc Testnet,
                receiving a persistent on-chain ID. Economic activity is attested via
                {" "}<code className="font-mono bg-muted px-1 rounded">recordActivity(agentId, amount)</code> — permissionless, so any
                counterparty can attest. Reputation score (0–100) is computed deterministically:
                <span className="font-mono ml-1">min(100, txCount×5 + totalVolume/$1000)</span>.
                Other contracts (escrow, subscriptions, spending limits) can call
                {" "}<code className="font-mono bg-muted px-1 rounded">validate(agentId, minReputation)</code> to gate access.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
