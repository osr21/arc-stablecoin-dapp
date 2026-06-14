import { useState } from "react";
import { useListEscrows, useCreateEscrow, useDisputeEscrow, useReleaseEscrow, getListEscrowsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useWallet } from "../lib/wallet";
import { formatTokenAmount, parseTokenAmount } from "../lib/format";

export default function Escrow() {
  const { data: escrows, isLoading } = useListEscrows();
  const queryClient = useQueryClient();
  const { address } = useWallet();

  const [createOpen, setCreateOpen] = useState(false);
  const [formData, setFormData] = useState({
    beneficiary: "",
    arbiter: "",
    token: "USDC" as "USDC" | "EURC",
    amount: "",
    releaseTime: "",
  });

  const createEscrow = useCreateEscrow({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListEscrowsQueryKey() });
        setCreateOpen(false);
      }
    }
  });

  const releaseEscrow = useReleaseEscrow({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListEscrowsQueryKey() });
      }
    }
  });

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!address) return;
    createEscrow.mutate({
      data: {
        ...formData,
        amount: parseTokenAmount(formData.amount),
        depositor: address,
        releaseTime: Math.floor(new Date(formData.releaseTime).getTime() / 1000) || Math.floor(Date.now() / 1000) + 86400,
        contractAddress: "0x" + Math.random().toString(16).slice(2, 42).padEnd(40, '0'),
        txHash: "0x" + Math.random().toString(16).slice(2, 66).padEnd(64, '0'),
      }
    });
  };

  const handleRelease = (id: number, txHash: string) => {
    releaseEscrow.mutate({ id, data: { txHash, resolution: "beneficiary" } });
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Conditional Escrow</h1>
          <p className="text-muted-foreground mt-1">Manage trustless agreements onchain</p>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button>New Escrow</Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[425px]">
            <DialogHeader>
              <DialogTitle>Create Escrow</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleCreate} className="space-y-4 pt-4">
              <div className="space-y-2">
                <Label>Depositor</Label>
                <Input value={address || "Connect wallet first"} disabled className="bg-muted font-mono text-xs" />
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
                  <Input required type="number" step="0.000001" value={formData.amount} onChange={e => setFormData({...formData, amount: e.target.value})} placeholder="0.00" />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Release Time</Label>
                <Input type="datetime-local" value={formData.releaseTime} onChange={e => setFormData({...formData, releaseTime: e.target.value})} />
              </div>
              <Button type="submit" className="w-full mt-4" disabled={!address || createEscrow.isPending}>
                {createEscrow.isPending ? "Deploying..." : "Deploy Escrow"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Card className="bg-card/50 border-border">
        <Table>
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent">
              <TableHead>ID</TableHead>
              <TableHead>Token</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Beneficiary</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={6} className="text-center py-8">Loading...</TableCell></TableRow>
            ) : escrows?.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No escrows found</TableCell></TableRow>
            ) : escrows?.map((escrow) => (
              <TableRow key={escrow.id} className="border-border hover:bg-muted/50">
                <TableCell className="font-mono text-xs">{escrow.id}</TableCell>
                <TableCell>{escrow.token}</TableCell>
                <TableCell className="font-mono">{formatTokenAmount(escrow.amount)} {escrow.token}</TableCell>
                <TableCell>
                  <Badge variant={escrow.status === "active" ? "default" : escrow.status === "released" ? "secondary" : "destructive"}>
                    {escrow.status}
                  </Badge>
                </TableCell>
                <TableCell className="font-mono text-xs" title={escrow.beneficiary}>
                  {escrow.beneficiary.slice(0,6)}...{escrow.beneficiary.slice(-4)}
                </TableCell>
                <TableCell className="text-right">
                  {escrow.status === "active" && (
                    <Button variant="outline" size="sm" onClick={() => handleRelease(escrow.id, escrow.txHash)} disabled={releaseEscrow.isPending}>
                      Release
                    </Button>
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
