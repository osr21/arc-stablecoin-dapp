import { useState } from "react";
import { useListCrosschainTransfers, useCreateCrosschainTransfer, getListCrosschainTransfersQueryKey } from "@workspace/api-client-react";
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
import { CONTRACT_ADDRESSES, CROSSCHAIN_ESCROW_ABI, ERC20_ABI, DEST_DOMAINS, parseToken, ARC_TESTNET } from "../lib/contracts";
import type { Address } from "viem";

const STATUS_LABELS: Record<string, string> = {
  pending:    "Pending",
  attesting:  "Attesting",
  complete:   "Complete",
  failed:     "Failed",
};

export default function Crosschain() {
  const { data: transfers, isLoading } = useListCrosschainTransfers();
  const queryClient = useQueryClient();
  const { address, walletClient, publicClient, isConnected, isWrongNetwork, switchToArc } = useWallet();

  const [createOpen, setCreateOpen] = useState(false);
  const [txPending, setTxPending] = useState(false);
  const [formData, setFormData] = useState({
    recipient: "",
    destChain: "Base Sepolia",
    amount: "",
    conditionDescription: "Unconditional CCTP transfer",
  });

  const createTransfer = useCreateCrosschainTransfer({
    mutation: { onSuccess: () => { queryClient.invalidateQueries({ queryKey: getListCrosschainTransfersQueryKey() }); setCreateOpen(false); } },
  });

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!address || !walletClient) return;
    if (isWrongNetwork) { await switchToArc(); return; }

    setTxPending(true);
    try {
      const rawAmount = parseToken(formData.amount);
      const destDomain = DEST_DOMAINS[formData.destChain] ?? 6;

      // 1. Approve USDC spend to CrosschainEscrow
      const approveTx = await walletClient.writeContract({
        address: CONTRACT_ADDRESSES.USDC,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [CONTRACT_ADDRESSES.CROSSCHAIN_ESCROW, rawAmount],
        account: address,
        chain: ARC_TESTNET as any,
      });
      await publicClient.waitForTransactionReceipt({ hash: approveTx });

      // 2. Initiate CCTP v2 conditional transfer
      const transferTx = await walletClient.writeContract({
        address: CONTRACT_ADDRESSES.CROSSCHAIN_ESCROW,
        abi: CROSSCHAIN_ESCROW_ABI,
        functionName: "initiateConditionalTransfer",
        args: [
          formData.recipient as Address,
          destDomain,
          rawAmount,
          BigInt(0),     // maxFee: 0 for basic
          2000,          // minFinalityThreshold: Arc finalized = 2000
          "0x" as `0x${string}`,
          formData.conditionDescription,
        ],
        account: address,
        chain: ARC_TESTNET as any,
      });
      await publicClient.waitForTransactionReceipt({ hash: transferTx });

      createTransfer.mutate({
        data: {
          sender:       address,
          recipient:    formData.recipient,
          sourceChain:  "Arc Testnet",
          destChain:    formData.destChain,
          token:        "USDC",
          amount:       rawAmount.toString(),
          burnTxHash:   transferTx,
          sourceChainId: ARC_TESTNET.id,
        },
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
            CCTP v2 <code className="text-xs bg-muted px-1 rounded">depositForBurnWithHook</code>
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
            <DialogContent className="sm:max-w-[440px]">
              <DialogHeader><DialogTitle>Initiate CCTP v2 Transfer</DialogTitle></DialogHeader>
              <form onSubmit={handleCreate} className="space-y-4 pt-4">
                <div className="space-y-2">
                  <Label>Sender</Label>
                  <Input value={address ?? ""} disabled className="bg-muted font-mono text-xs" />
                </div>
                <div className="space-y-2">
                  <Label>Recipient Address (on destination chain)</Label>
                  <Input required value={formData.recipient} onChange={e => setFormData({...formData, recipient: e.target.value})} placeholder="0x..." className="font-mono text-xs" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Source Chain</Label>
                    <Input disabled value="Arc Testnet" />
                  </div>
                  <div className="space-y-2">
                    <Label>Destination Chain</Label>
                    <Select value={formData.destChain} onValueChange={v => setFormData({...formData, destChain: v})}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Base Sepolia">Base Sepolia (domain 6)</SelectItem>
                        <SelectItem value="Ethereum Sepolia">Ethereum Sepolia (domain 0)</SelectItem>
                        <SelectItem value="Arbitrum Sepolia">Arbitrum Sepolia (domain 3)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>USDC Amount</Label>
                  <Input required type="number" step="0.000001" min="0.000001" value={formData.amount} onChange={e => setFormData({...formData, amount: e.target.value})} placeholder="0.00" />
                </div>
                <div className="space-y-2">
                  <Label>Condition Description (for hookData)</Label>
                  <Input value={formData.conditionDescription} onChange={e => setFormData({...formData, conditionDescription: e.target.value})} />
                </div>
                <div className="bg-muted/50 rounded-md p-3 text-xs text-muted-foreground space-y-1">
                  <p>CCTP Domain: {formData.destChain} → {DEST_DOMAINS[formData.destChain] ?? "?"}</p>
                  <p>After burn tx confirms, Circle IRIS generates an attestation. Use that to mint on destination.</p>
                </div>
                <Button type="submit" className="w-full mt-4" disabled={txPending}>
                  {txPending ? "Waiting for wallet..." : "Approve & Burn via CCTP v2"}
                </Button>
                <p className="text-xs text-muted-foreground text-center">Two transactions: approve USDC, then depositForBurnWithHook</p>
              </form>
            </DialogContent>
          </Dialog>
        )}
        {!isConnected && <p className="text-sm text-muted-foreground">Connect wallet to initiate transfers</p>}
      </div>

      <Card className="bg-card/50 border-border">
        <Table>
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent">
              <TableHead>Route</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Burn Tx</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={4} className="text-center py-8">Loading...</TableCell></TableRow>
            ) : !transfers?.length ? (
              <TableRow><TableCell colSpan={4} className="text-center py-12 text-muted-foreground">No transfers yet.</TableCell></TableRow>
            ) : transfers.map((tx) => (
              <TableRow key={tx.id} className="border-border hover:bg-muted/50">
                <TableCell className="text-sm">{tx.sourceChain} → {tx.destChain}</TableCell>
                <TableCell className="font-mono">{formatTokenAmount(tx.amount)} {tx.token}</TableCell>
                <TableCell>
                  <Badge variant={tx.status === "complete" ? "secondary" : tx.status === "failed" ? "destructive" : "outline"}>
                    {STATUS_LABELS[tx.status] ?? tx.status}
                  </Badge>
                </TableCell>
                <TableCell className="font-mono text-xs">
                  <a href={`https://testnet.arcscan.app/tx/${tx.burnTxHash}`} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                    {tx.burnTxHash.slice(0,10)}... ↗
                  </a>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
