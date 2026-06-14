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
import { formatTokenAmount, parseTokenAmount } from "../lib/format";

export default function Crosschain() {
  const { data: transfers, isLoading } = useListCrosschainTransfers();
  const queryClient = useQueryClient();
  const { address } = useWallet();

  const [createOpen, setCreateOpen] = useState(false);
  const [formData, setFormData] = useState({
    recipient: "",
    sourceChain: "Arc Testnet",
    destChain: "Base Sepolia",
    token: "USDC" as "USDC" | "EURC",
    amount: "",
  });

  const createTransfer = useCreateCrosschainTransfer({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListCrosschainTransfersQueryKey() });
        setCreateOpen(false);
      }
    }
  });

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!address) return;
    createTransfer.mutate({
      data: {
        ...formData,
        amount: parseTokenAmount(formData.amount),
        sender: address,
        burnTxHash: "0x" + Math.random().toString(16).slice(2, 66).padEnd(64, '0'),
      }
    });
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Cross-chain Transfers</h1>
          <p className="text-muted-foreground mt-1">CCTP-powered value routing</p>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button>Initiate Transfer</Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[425px]">
            <DialogHeader>
              <DialogTitle>Initiate CCTP Transfer</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleCreate} className="space-y-4 pt-4">
              <div className="space-y-2">
                <Label>Sender</Label>
                <Input value={address || "Connect wallet first"} disabled className="bg-muted font-mono text-xs" />
              </div>
              <div className="space-y-2">
                <Label>Recipient Address</Label>
                <Input required value={formData.recipient} onChange={e => setFormData({...formData, recipient: e.target.value})} placeholder="0x..." className="font-mono text-xs" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Source Chain</Label>
                  <Input disabled value={formData.sourceChain} />
                </div>
                <div className="space-y-2">
                  <Label>Destination Chain</Label>
                  <Select value={formData.destChain} onValueChange={(v) => setFormData({...formData, destChain: v})}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Base Sepolia">Base Sepolia</SelectItem>
                      <SelectItem value="Ethereum Sepolia">Ethereum Sepolia</SelectItem>
                      <SelectItem value="Arbitrum Sepolia">Arbitrum Sepolia</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
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
                  <Input required type="number" step="0.000001" value={formData.amount} onChange={e => setFormData({...formData, amount: e.target.value})} placeholder="0.00" />
                </div>
              </div>
              <Button type="submit" className="w-full mt-4" disabled={!address || createTransfer.isPending}>
                {createTransfer.isPending ? "Initiating..." : "Initiate Transfer"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Card className="bg-card/50 border-border">
        <Table>
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent">
              <TableHead>Route</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Token</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Tx</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={5} className="text-center py-8">Loading...</TableCell></TableRow>
            ) : transfers?.length === 0 ? (
              <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No transfers found</TableCell></TableRow>
            ) : transfers?.map((tx) => (
              <TableRow key={tx.id} className="border-border hover:bg-muted/50">
                <TableCell className="text-sm">{tx.sourceChain} → {tx.destChain}</TableCell>
                <TableCell className="font-mono">{formatTokenAmount(tx.amount)} {tx.token}</TableCell>
                <TableCell>{tx.token}</TableCell>
                <TableCell>
                  <Badge variant="outline">{tx.status}</Badge>
                </TableCell>
                <TableCell className="text-right font-mono text-xs text-muted-foreground">
                  {tx.burnTxHash.slice(0,8)}...
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
