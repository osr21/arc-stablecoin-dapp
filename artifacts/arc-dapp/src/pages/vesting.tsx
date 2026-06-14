import { useState } from "react";
import { useListVestingSchedules, useCreateVestingSchedule, useClaimVesting, getListVestingSchedulesQueryKey } from "@workspace/api-client-react";
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
import { CONTRACT_ADDRESSES, PAYROLL_VESTING_ABI, ERC20_ABI, parseToken, ARC_TESTNET } from "../lib/contracts";
import type { Address } from "viem";

export default function Vesting() {
  const { data: schedules, isLoading } = useListVestingSchedules();
  const queryClient = useQueryClient();
  const { address, walletClient, publicClient, isConnected, isWrongNetwork, switchToArc } = useWallet();

  const [createOpen, setCreateOpen] = useState(false);
  const [txPending, setTxPending] = useState(false);
  const [formData, setFormData] = useState({
    beneficiary: "",
    token: "USDC" as "USDC" | "EURC",
    totalAmount: "",
    cliffDays: "30",
    vestingMonths: "12",
  });

  const createSchedule = useCreateVestingSchedule({ mutation: { onSuccess: () => { queryClient.invalidateQueries({ queryKey: getListVestingSchedulesQueryKey() }); setCreateOpen(false); } } });
  const claimVesting   = useClaimVesting({ mutation: { onSuccess: () => queryClient.invalidateQueries({ queryKey: getListVestingSchedulesQueryKey() }) } });

  const tokenAddress: Address = formData.token === "USDC" ? CONTRACT_ADDRESSES.USDC : CONTRACT_ADDRESSES.EURC;

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!address || !walletClient) return;
    if (isWrongNetwork) { await switchToArc(); return; }

    setTxPending(true);
    try {
      const rawAmount       = parseToken(formData.totalAmount);
      const cliffSecs       = BigInt(parseInt(formData.cliffDays) * 86400);
      const vestingSecs     = BigInt(parseInt(formData.vestingMonths) * 30 * 86400);
      const startTime       = BigInt(Math.floor(Date.now() / 1000));

      // 1. Approve
      const approveTx = await walletClient.writeContract({
        address: tokenAddress,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [CONTRACT_ADDRESSES.PAYROLL_VESTING, rawAmount],
        account: address,
        chain: ARC_TESTNET as any,
      });
      await publicClient.waitForTransactionReceipt({ hash: approveTx });

      // 2. Create schedule on-chain
      const createTx = await walletClient.writeContract({
        address: CONTRACT_ADDRESSES.PAYROLL_VESTING,
        abi: PAYROLL_VESTING_ABI,
        functionName: "createSchedule",
        args: [
          formData.beneficiary as Address,
          tokenAddress,
          rawAmount,
          cliffSecs,
          vestingSecs,
          startTime,
        ],
        account: address,
        chain: ARC_TESTNET as any,
      });
      await publicClient.waitForTransactionReceipt({ hash: createTx });

      createSchedule.mutate({
        data: {
          employer:        address,
          beneficiary:     formData.beneficiary,
          token:           formData.token,
          totalAmount:     rawAmount.toString(),
          cliffDuration:   Number(cliffSecs),
          vestingDuration: Number(vestingSecs),
          startTime:       Number(startTime),
          contractAddress: CONTRACT_ADDRESSES.PAYROLL_VESTING,
          txHash:          createTx,
          chainId:         ARC_TESTNET.id,
        },
      });
    } catch (err: any) {
      alert(`Transaction failed: ${err.shortMessage || err.message}`);
    } finally {
      setTxPending(false);
    }
  };

  const handleClaim = async (dbId: number, onchainId: number) => {
    if (!address || !walletClient) return;
    if (isWrongNetwork) { await switchToArc(); return; }
    setTxPending(true);
    try {
      const tx = await walletClient.writeContract({
        address: CONTRACT_ADDRESSES.PAYROLL_VESTING,
        abi: PAYROLL_VESTING_ABI,
        functionName: "claim",
        args: [BigInt(onchainId)],
        account: address,
        chain: ARC_TESTNET as any,
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash: tx });
      claimVesting.mutate({ id: dbId, data: { txHash: tx, amountClaimed: "0" } });
    } catch (err: any) {
      alert(`Claim failed: ${err.shortMessage || err.message}`);
    } finally {
      setTxPending(false);
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Payroll & Vesting</h1>
          <p className="text-muted-foreground mt-1">Cliff + linear token disbursements · <span className="font-mono text-xs">{CONTRACT_ADDRESSES.PAYROLL_VESTING}</span></p>
        </div>
        {isConnected && isWrongNetwork && (
          <Button variant="destructive" size="sm" onClick={switchToArc}>Switch to Arc Testnet</Button>
        )}
        {isConnected && !isWrongNetwork && (
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild><Button>Create Schedule</Button></DialogTrigger>
            <DialogContent className="sm:max-w-[440px]">
              <DialogHeader><DialogTitle>New Vesting Schedule</DialogTitle></DialogHeader>
              <form onSubmit={handleCreate} className="space-y-4 pt-4">
                <div className="space-y-2">
                  <Label>Employer (you)</Label>
                  <Input value={address ?? ""} disabled className="bg-muted font-mono text-xs" />
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
                    <Input required type="number" step="0.000001" min="0.000001" value={formData.totalAmount} onChange={e => setFormData({...formData, totalAmount: e.target.value})} placeholder="0.00" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Cliff (days)</Label>
                    <Input required type="number" min="0" value={formData.cliffDays} onChange={e => setFormData({...formData, cliffDays: e.target.value})} />
                  </div>
                  <div className="space-y-2">
                    <Label>Vesting (months)</Label>
                    <Input required type="number" min="1" value={formData.vestingMonths} onChange={e => setFormData({...formData, vestingMonths: e.target.value})} />
                  </div>
                </div>
                <Button type="submit" className="w-full mt-4" disabled={txPending}>
                  {txPending ? "Waiting for wallet..." : "Approve & Create Schedule"}
                </Button>
                <p className="text-xs text-muted-foreground text-center">Two transactions: approve token spend, then create schedule</p>
              </form>
            </DialogContent>
          </Dialog>
        )}
        {!isConnected && <p className="text-sm text-muted-foreground">Connect wallet to create schedules</p>}
      </div>

      <Card className="bg-card/50 border-border">
        <Table>
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent">
              <TableHead>Beneficiary</TableHead>
              <TableHead>Total</TableHead>
              <TableHead>Claimed</TableHead>
              <TableHead>Token</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={5} className="text-center py-8">Loading...</TableCell></TableRow>
            ) : !schedules?.length ? (
              <TableRow><TableCell colSpan={5} className="text-center py-12 text-muted-foreground">No vesting schedules yet.</TableCell></TableRow>
            ) : schedules.map((sched, idx) => (
              <TableRow key={sched.id} className="border-border hover:bg-muted/50">
                <TableCell className="font-mono text-xs" title={sched.beneficiary}>
                  {sched.beneficiary.slice(0,6)}...{sched.beneficiary.slice(-4)}
                </TableCell>
                <TableCell className="font-mono">{formatTokenAmount(sched.totalAmount)}</TableCell>
                <TableCell className="font-mono">{formatTokenAmount(sched.amountClaimed)}</TableCell>
                <TableCell>{sched.token}</TableCell>
                <TableCell className="text-right space-x-2">
                  {isConnected && address?.toLowerCase() === sched.beneficiary.toLowerCase() && (
                    <Button variant="outline" size="sm" onClick={() => handleClaim(sched.id, idx)} disabled={txPending}>
                      Claim
                    </Button>
                  )}
                  {sched.txHash && (
                    <a href={`https://testnet.arcscan.app/tx/${sched.txHash}`} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline">
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
