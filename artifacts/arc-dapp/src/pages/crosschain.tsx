import { useState, useEffect, useCallback } from "react";
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
import { encodeFunctionData } from "viem";

const STATUS_LABELS: Record<string, string> = {
  pending:    "Pending",
  attesting:  "Attesting",
  complete:   "Complete",
  failed:     "Failed",
};

const RECEIVE_MESSAGE_ABI = [
  {
    name: "receiveMessage",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "message",     type: "bytes" },
      { name: "attestation", type: "bytes" },
    ],
    outputs: [{ name: "success", type: "bool" }],
  },
] as const;

interface AttestationResult {
  status: string;
  messageHash: string | null;
  messageBytes: string | null;
  attestation: string | null;
  receiveTarget: {
    chain: string;
    address: string;
    explorerBase: string;
  } | null;
}

function ReceiveDialog({ txHash, destChain }: { txHash: string; destChain: string }) {
  const [open, setOpen] = useState(false);
  const [attest, setAttest] = useState<AttestationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const poll = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/cctp/attestation/${txHash}`);
      const data: AttestationResult = await res.json();
      setAttest(data);
    } catch {
    } finally {
      setLoading(false);
    }
  }, [txHash]);

  useEffect(() => {
    if (!open) return;
    poll();
    const id = setInterval(poll, 15_000);
    return () => clearInterval(id);
  }, [open, poll]);

  const receiveCalldata = attest?.messageBytes && attest?.attestation
    ? encodeFunctionData({
        abi: RECEIVE_MESSAGE_ABI,
        functionName: "receiveMessage",
        args: [attest.messageBytes as `0x${string}`, attest.attestation as `0x${string}`],
      })
    : null;

  const copyText = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const target = attest?.receiveTarget;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="h-6 text-xs px-2 text-primary">
          Receive ↗
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[560px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Receive on {destChain}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-2 text-sm">
          {/* Step flow */}
          <div className="grid grid-cols-3 gap-2 text-center text-xs">
            {[
              { n: 1, label: "Burn on Arc", done: true },
              { n: 2, label: "Circle attests", done: attest?.status === "complete" },
              { n: 3, label: "Mint on destination", done: false },
            ].map(step => (
              <div key={step.n} className={`rounded-md p-2 border ${step.done ? "border-green-500/40 bg-green-500/10 text-green-400" : "border-border bg-muted/40 text-muted-foreground"}`}>
                <div className="font-semibold">{step.done ? "✓" : step.n}</div>
                <div>{step.label}</div>
              </div>
            ))}
          </div>

          {/* Attestation status */}
          <div className="rounded-md border border-border p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Attestation status</span>
              <div className="flex items-center gap-2">
                <Badge variant={attest?.status === "complete" ? "secondary" : "outline"}>
                  {loading && !attest ? "Checking…" : attest?.status === "complete" ? "Ready" : "Pending"}
                </Badge>
                <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={poll} disabled={loading}>
                  {loading ? "…" : "Refresh"}
                </Button>
              </div>
            </div>
            {attest?.messageHash && (
              <div className="text-xs font-mono text-muted-foreground truncate">
                Hash: {attest.messageHash}
              </div>
            )}
            {attest?.status !== "complete" && (
              <p className="text-xs text-muted-foreground">
                Circle IRIS monitors the Arc burn event and generates a signature once the block is finalized.
                This typically takes 10–30 minutes on testnet.
              </p>
            )}
          </div>

          {/* Message bytes — always show once fetched */}
          {attest?.messageBytes && (
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground text-xs">Message bytes (from Arc MessageSent event)</span>
                <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => copyText(attest.messageBytes!)}>
                  {copied ? "Copied!" : "Copy"}
                </Button>
              </div>
              <div className="font-mono text-xs bg-muted rounded-md p-2 break-all leading-relaxed max-h-20 overflow-y-auto">
                {attest.messageBytes}
              </div>
            </div>
          )}

          {/* Attestation signature */}
          {attest?.attestation && (
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground text-xs">Circle attestation signature</span>
                <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => copyText(attest.attestation!)}>
                  Copy
                </Button>
              </div>
              <div className="font-mono text-xs bg-muted rounded-md p-2 break-all leading-relaxed max-h-20 overflow-y-auto">
                {attest.attestation}
              </div>
            </div>
          )}

          {/* Receive instructions */}
          <div className="rounded-md border border-border p-3 space-y-3">
            <p className="font-medium">How to receive on {destChain}</p>
            <ol className="space-y-2 text-xs text-muted-foreground list-decimal list-inside">
              <li>
                Open{" "}
                {target ? (
                  <a
                    href={`${target.explorerBase}/${target.address}#writeProxyContract`}
                    target="_blank" rel="noreferrer"
                    className="text-primary underline font-mono"
                  >
                    MessageTransmitterV2 on {target.chain}
                  </a>
                ) : (
                  <span className="font-mono">MessageTransmitterV2</span>
                )}
              </li>
              <li>Connect your wallet (switch to {destChain})</li>
              <li>
                Call <code className="bg-muted px-1 rounded">receiveMessage</code> with:
                <ul className="ml-4 mt-1 space-y-1">
                  <li><strong>message:</strong> the message bytes above</li>
                  <li><strong>attestation:</strong> the Circle signature above (available once attested)</li>
                </ul>
              </li>
              <li>USDC mints to your recipient address</li>
            </ol>

            {target && (
              <div className="text-xs space-y-1">
                <p className="text-muted-foreground">Contract address on {target.chain}:</p>
                <p className="font-mono text-xs break-all">{target.address}</p>
              </div>
            )}
          </div>

          {/* Ready calldata */}
          {receiveCalldata && (
            <div className="rounded-md border border-green-500/30 bg-green-500/10 p-3 space-y-2">
              <p className="text-green-400 font-medium text-xs">✓ Attestation ready — calldata for receiveMessage:</p>
              <div className="font-mono text-xs bg-black/20 rounded p-2 break-all max-h-20 overflow-y-auto leading-relaxed">
                {receiveCalldata}
              </div>
              <Button variant="outline" size="sm" className="w-full text-xs border-green-500/40 text-green-400" onClick={() => copyText(receiveCalldata)}>
                Copy full calldata
              </Button>
            </div>
          )}

          <div className="text-xs text-muted-foreground border-t border-border pt-3">
            <p>Burn tx: <a href={`https://testnet.arcscan.app/tx/${txHash}`} target="_blank" rel="noreferrer" className="text-primary font-mono hover:underline">{txHash.slice(0, 18)}…</a></p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

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

      const approveTx = await walletClient.writeContract({
        address: CONTRACT_ADDRESSES.USDC,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [CONTRACT_ADDRESSES.CROSSCHAIN_ESCROW, rawAmount],
        account: address,
        chain: ARC_TESTNET as any,
      });
      await publicClient.waitForTransactionReceipt({ hash: approveTx });

      const transferTx = await walletClient.writeContract({
        address: CONTRACT_ADDRESSES.CROSSCHAIN_ESCROW,
        abi: CROSSCHAIN_ESCROW_ABI,
        functionName: "initiateConditionalTransfer",
        args: [
          formData.recipient as Address,
          destDomain,
          rawAmount,
          BigInt(0),
          2000,
          "0x" as `0x${string}`,
          formData.conditionDescription,
        ],
        account: address,
        chain: ARC_TESTNET as any,
      });
      await publicClient.waitForTransactionReceipt({ hash: transferTx });

      createTransfer.mutate({
        data: {
          sender:        address,
          recipient:     formData.recipient,
          sourceChain:   "Arc Testnet",
          destChain:     formData.destChain,
          token:         "USDC",
          amount:        rawAmount.toString(),
          burnTxHash:    transferTx,
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
            CCTP v2 <code className="text-xs bg-muted px-1 rounded">depositForBurn</code>
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
                  <Label>Condition Description</Label>
                  <Input value={formData.conditionDescription} onChange={e => setFormData({...formData, conditionDescription: e.target.value})} />
                </div>
                <div className="bg-muted/50 rounded-md p-3 text-xs text-muted-foreground space-y-1">
                  <p>CCTP Domain: {formData.destChain} → {DEST_DOMAINS[formData.destChain] ?? "?"}</p>
                  <p>Two txs: approve USDC, then depositForBurn via CrosschainEscrow.</p>
                  <p>After burn confirms, click <strong>Receive ↗</strong> in the table to get your message bytes and attestation.</p>
                </div>
                <Button type="submit" className="w-full mt-4" disabled={txPending}>
                  {txPending ? "Waiting for wallet..." : "Approve & Burn via CCTP v2"}
                </Button>
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
              <TableHead>Receive</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={5} className="text-center py-8">Loading...</TableCell></TableRow>
            ) : !transfers?.length ? (
              <TableRow><TableCell colSpan={5} className="text-center py-12 text-muted-foreground">No transfers yet.</TableCell></TableRow>
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
                    {tx.burnTxHash.slice(0, 10)}… ↗
                  </a>
                </TableCell>
                <TableCell>
                  <ReceiveDialog txHash={tx.burnTxHash} destChain={tx.destChain} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
