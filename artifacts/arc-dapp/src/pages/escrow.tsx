import { useState } from "react";
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
import { useWallet } from "../lib/wallet";
import { formatTokenAmount, parseTokenAmount } from "../lib/format";
import {
  CONTRACT_ADDRESSES, CONDITIONAL_ESCROW_ABI, ERC20_ABI,
  parseToken, ARC_TESTNET,
} from "../lib/contracts";
import { decodeEventLog, parseAbi, type Address } from "viem";

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

export default function Escrow() {
  const { data: escrows, isLoading } = useListEscrows();
  const queryClient = useQueryClient();
  const { address, walletClient, publicClient, isConnected, isWrongNetwork, switchToArc } = useWallet();

  const [createOpen, setCreateOpen] = useState(false);
  const [txPending, setTxPending] = useState(false);
  const [formData, setFormData] = useState({
    beneficiary: "",
    arbiter: "",
    token: "USDC" as "USDC" | "EURC",
    amount: "",
    releaseTime: "",
    conditionType: "time_based",
  });

  const createEscrow  = useCreateEscrow({ mutation: { onSuccess: () => { queryClient.invalidateQueries({ queryKey: getListEscrowsQueryKey() }); setCreateOpen(false); } } });
  const releaseEscrow = useReleaseEscrow({ mutation: { onSuccess: () => queryClient.invalidateQueries({ queryKey: getListEscrowsQueryKey() }) } });
  const disputeEscrow = useDisputeEscrow({ mutation: { onSuccess: () => queryClient.invalidateQueries({ queryKey: getListEscrowsQueryKey() }) } });

  const tokenAddress: Address = formData.token === "USDC" ? CONTRACT_ADDRESSES.USDC : CONTRACT_ADDRESSES.EURC;

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!address || !walletClient) return;
    if (isWrongNetwork) { await switchToArc(); return; }

    setTxPending(true);
    try {
      const rawAmount = parseToken(formData.amount);
      const releaseTimestamp = formData.releaseTime
        ? BigInt(Math.floor(new Date(formData.releaseTime).getTime() / 1000))
        : BigInt(Math.floor(Date.now() / 1000) + 86400);

      // 1. Approve token spend
      const approveTx = await walletClient.writeContract({
        address: tokenAddress,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [CONTRACT_ADDRESSES.CONDITIONAL_ESCROW, rawAmount],
        account: address,
        chain: ARC_TESTNET as any,
      });
      await publicClient.waitForTransactionReceipt({ hash: approveTx });

      // 2. Create escrow on-chain
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

      // 3. Record in DB
      await createEscrow.mutateAsync({
        data: {
          depositor:       address,
          beneficiary:     formData.beneficiary,
          arbiter:         formData.arbiter,
          token:           formData.token,
          amount:          rawAmount.toString(),
          releaseTime:     Number(releaseTimestamp),
          conditionType:   formData.conditionType as "time_based" | "milestone" | "oracle",
          contractAddress: CONTRACT_ADDRESSES.CONDITIONAL_ESCROW,
          txHash:          createTx,
          chainId:         ARC_TESTNET.id,
          ...(onChainId !== null ? { onChainId } : {}),
        },
      });
    } catch (err: any) {
      console.error("Create escrow failed", err);
      alert(`Transaction failed: ${err.shortMessage || err.message}`);
    } finally {
      setTxPending(false);
    }
  };

  const handleRelease = async (id: number, onChainId?: number | null) => {
    if (!address || !walletClient) return;
    if (isWrongNetwork) { await switchToArc(); return; }
    setTxPending(true);
    try {
      const contractId = onChainId != null ? BigInt(onChainId) : BigInt(id - 1);
      const tx = await walletClient.writeContract({
        address: CONTRACT_ADDRESSES.CONDITIONAL_ESCROW,
        abi: CONDITIONAL_ESCROW_ABI,
        functionName: "release",
        args: [contractId],
        account: address,
        chain: ARC_TESTNET as any,
      });
      await publicClient.waitForTransactionReceipt({ hash: tx });
      releaseEscrow.mutate({ id, data: { txHash: tx, resolution: "beneficiary" } });
    } catch (err: any) {
      alert(`Release failed: ${err.shortMessage || err.message}`);
    } finally {
      setTxPending(false);
    }
  };

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
            <DialogContent className="sm:max-w-[440px]">
              <DialogHeader><DialogTitle>Create Escrow</DialogTitle></DialogHeader>
              <form onSubmit={handleCreate} className="space-y-4 pt-4">
                <div className="space-y-2">
                  <Label>Your Address (Depositor)</Label>
                  <Input value={address ?? ""} disabled className="bg-muted font-mono text-xs" />
                </div>
                <div className="space-y-2">
                  <Label>Beneficiary Address</Label>
                  <Input required value={formData.beneficiary} onChange={e => setFormData({...formData, beneficiary: e.target.value})} placeholder="0x..." className="font-mono text-xs" />
                </div>
                <div className="space-y-2">
                  <Label>Arbiter Address</Label>
                  <Input required value={formData.arbiter} onChange={e => setFormData({...formData, arbiter: e.target.value})} placeholder="0x..." className="font-mono text-xs" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Token</Label>
                    <Select value={formData.token} onValueChange={(v: "USDC"|"EURC") => setFormData({...formData, token: v})}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="USDC">USDC</SelectItem>
                        <SelectItem value="EURC">EURC</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Amount</Label>
                    <Input required type="number" step="0.000001" min="0.000001" value={formData.amount} onChange={e => setFormData({...formData, amount: e.target.value})} placeholder="0.00" />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Condition Type</Label>
                  <Select value={formData.conditionType} onValueChange={v => setFormData({...formData, conditionType: v})}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="time_based">Time Based</SelectItem>
                      <SelectItem value="milestone">Milestone</SelectItem>
                      <SelectItem value="oracle">Oracle</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Release Time</Label>
                  <Input type="datetime-local" value={formData.releaseTime} onChange={e => setFormData({...formData, releaseTime: e.target.value})} />
                </div>
                <Button type="submit" className="w-full mt-4" disabled={txPending}>
                  {txPending ? "Waiting for wallet..." : "Approve & Deploy Escrow"}
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
              <TableRow><TableCell colSpan={6} className="text-center py-8">Loading...</TableCell></TableRow>
            ) : !escrows?.length ? (
              <TableRow><TableCell colSpan={6} className="text-center py-12 text-muted-foreground">No escrows yet. Create your first one above.</TableCell></TableRow>
            ) : escrows.map((escrow) => (
              <TableRow key={escrow.id} className="border-border hover:bg-muted/50">
                <TableCell className="font-mono text-xs">#{escrow.id}</TableCell>
                <TableCell className="font-mono">{formatTokenAmount(escrow.amount)} {escrow.token}</TableCell>
                <TableCell>
                  <Badge variant={statusVariant(escrow.status) as any}>{escrow.status}</Badge>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">{escrow.conditionType ?? "—"}</TableCell>
                <TableCell className="font-mono text-xs" title={escrow.beneficiary}>
                  {escrow.beneficiary.slice(0,6)}...{escrow.beneficiary.slice(-4)}
                </TableCell>
                <TableCell className="text-right space-x-2">
                  {escrow.status === "active" && isConnected && (
                    <Button variant="outline" size="sm" onClick={() => handleRelease(escrow.id, escrow.onChainId)} disabled={txPending}>
                      Release
                    </Button>
                  )}
                  {escrow.txHash && (
                    <a href={`https://testnet.arcscan.app/tx/${escrow.txHash}`} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline ml-2">
                      TxScan ↗
                    </a>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
