import { useState } from "react";
import { useListVestingSchedules, useCreateVestingSchedule, getListVestingSchedulesQueryKey } from "@workspace/api-client-react";
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

export default function Vesting() {
  const { data: schedules, isLoading } = useListVestingSchedules();
  const queryClient = useQueryClient();
  const { address } = useWallet();

  const [createOpen, setCreateOpen] = useState(false);
  const [formData, setFormData] = useState({
    beneficiary: "",
    token: "USDC" as "USDC" | "EURC",
    totalAmount: "",
    cliffDuration: "2592000",
    vestingDuration: "31536000",
  });

  const createSchedule = useCreateVestingSchedule({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListVestingSchedulesQueryKey() });
        setCreateOpen(false);
      }
    }
  });

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!address) return;
    createSchedule.mutate({
      data: {
        ...formData,
        totalAmount: parseTokenAmount(formData.totalAmount),
        employer: address,
        cliffDuration: parseInt(formData.cliffDuration),
        vestingDuration: parseInt(formData.vestingDuration),
        startTime: Math.floor(Date.now() / 1000),
        contractAddress: "0x" + Math.random().toString(16).slice(2, 42).padEnd(40, '0'),
        txHash: "0x" + Math.random().toString(16).slice(2, 66).padEnd(64, '0'),
      }
    });
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Payroll & Vesting</h1>
          <p className="text-muted-foreground mt-1">Streaming token disbursements</p>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button>Create Schedule</Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[425px]">
            <DialogHeader>
              <DialogTitle>New Vesting Schedule</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleCreate} className="space-y-4 pt-4">
              <div className="space-y-2">
                <Label>Employer</Label>
                <Input value={address || "Connect wallet first"} disabled className="bg-muted font-mono text-xs" />
              </div>
              <div className="space-y-2">
                <Label>Beneficiary Address</Label>
                <Input required value={formData.beneficiary} onChange={e => setFormData({...formData, beneficiary: e.target.value})} placeholder="0x..." className="font-mono text-xs" />
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
                  <Label>Total Amount</Label>
                  <Input required type="number" step="0.000001" value={formData.totalAmount} onChange={e => setFormData({...formData, totalAmount: e.target.value})} placeholder="0.00" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Cliff (seconds)</Label>
                  <Input required type="number" value={formData.cliffDuration} onChange={e => setFormData({...formData, cliffDuration: e.target.value})} />
                </div>
                <div className="space-y-2">
                  <Label>Vesting (seconds)</Label>
                  <Input required type="number" value={formData.vestingDuration} onChange={e => setFormData({...formData, vestingDuration: e.target.value})} />
                </div>
              </div>
              <Button type="submit" className="w-full mt-4" disabled={!address || createSchedule.isPending}>
                {createSchedule.isPending ? "Deploying..." : "Create Schedule"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Card className="bg-card/50 border-border">
        <Table>
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent">
              <TableHead>Beneficiary</TableHead>
              <TableHead>Total Amount</TableHead>
              <TableHead>Claimed</TableHead>
              <TableHead>Token</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={5} className="text-center py-8">Loading...</TableCell></TableRow>
            ) : schedules?.length === 0 ? (
              <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No vesting schedules</TableCell></TableRow>
            ) : schedules?.map((sched) => (
              <TableRow key={sched.id} className="border-border hover:bg-muted/50">
                <TableCell className="font-mono text-xs" title={sched.beneficiary}>
                  {sched.beneficiary.slice(0,6)}...{sched.beneficiary.slice(-4)}
                </TableCell>
                <TableCell className="font-mono">{formatTokenAmount(sched.totalAmount)} {sched.token}</TableCell>
                <TableCell className="font-mono">{formatTokenAmount(sched.amountClaimed)} {sched.token}</TableCell>
                <TableCell>{sched.token}</TableCell>
                <TableCell className="text-right">
                  <Button variant="outline" size="sm">Claim</Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
