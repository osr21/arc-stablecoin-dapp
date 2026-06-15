import { useState, useEffect, useCallback } from "react";
import { createWalletClient, createPublicClient, custom, http, encodeFunctionData } from "viem";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useWallet } from "../lib/wallet";
import { formatTokenAmount } from "../lib/format";
import {
  CONTRACT_ADDRESSES, CROSSCHAIN_ESCROW_ABI, ERC20_ABI, DEST_DOMAINS,
  DEST_CHAIN_CONFIGS, MESSAGE_TRANSMITTER_V2_ADDRESS,
  parseToken, ARC_TESTNET,
} from "../lib/contracts";
import type { Address } from "viem";

const STATUS_LABELS: Record<string, string> = {
  pending:   "Pending",
  attesting: "Attesting",
  complete:  "Complete",
  failed:    "Failed",
};

const RECEIVE_MESSAGE_ABI = [
  {
    name: "receiveMessage",
    type: "function" as const,
    stateMutability: "nonpayable" as const,
    inputs: [
      { name: "message",     type: "bytes" as const },
      { name: "attestation", type: "bytes" as const },
    ],
    outputs: [{ name: "success", type: "bool" as const }],
  },
];

interface AttestationResult {
  status: string;
  messageBytes: string | null;
  attestation: string | null;
  mintRecipient: string | null;
  receiveTarget: {
    chain: string;
    chainId: number;
    explorerBase: string;
    explorerTx: string;
  } | null;
  relayFeeUsdc: string | null;
}

function ReceiveDialog({ txHash, destChain }: { txHash: string; destChain: string }) {
  const [open, setOpen]             = useState(false);
  const [attest, setAttest]         = useState<AttestationResult | null>(null);
  const [polling, setPolling]       = useState(false);
  const [relaying, setRelaying]     = useState(false);
  const [claiming, setClaiming]     = useState(false);
  const [relayTx, setRelayTx]       = useState<string | null>(null);
  const [claimTx, setClaimTx]       = useState<string | null>(null);
  const [err, setErr]               = useState<string | null>(null);
  const [copied, setCopied]         = useState(false);

  const destConfig = DEST_CHAIN_CONFIGS[destChain];

  const poll = useCallback(async () => {
    setPolling(true);
    try {
      const res = await fetch(`/api/cctp/attestation/${txHash}`);
      const data: AttestationResult = await res.json();
      setAttest(data);
    } catch {
    } finally {
      setPolling(false);
    }
  }, [txHash]);

  useEffect(() => {
    if (!open) return;
    poll();
    const id = setInterval(poll, 15_000);
    return () => clearInterval(id);
  }, [open, poll]);

  const copyText = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  // Option A: Gas-free relay via arc-relay-bridge (1 USDC fee, server mints)
  const handleGaslessRelay = async () => {
    setErr(null);
    setRelaying(true);
    try {
      const res = await fetch("/api/cctp/relay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ burnTxHash: txHash }),
      });
      const data = await res.json() as { txHash?: string; error?: string; explorerTx?: string };
      if (!res.ok || !data.txHash) throw new Error(data.error ?? "Relay failed");
      setRelayTx(data.txHash);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setRelaying(false);
    }
  };

  // Option B: Self-relay via MetaMask (free, needs ETH on destination)
  const handleSelfClaim = async () => {
    if (!attest?.messageBytes || !attest?.attestation) return;
    if (!destConfig) { setErr("Destination chain config not found"); return; }

    const eth = (window as any).ethereum;
    if (!eth) { setErr("MetaMask required"); return; }

    setErr(null);
    setClaiming(true);
    try {
      const chainHex = `0x${destConfig.chainId.toString(16)}`;
      try {
        await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: chainHex }] });
      } catch (switchErr: any) {
        if (switchErr.code === 4902) {
          await eth.request({
            method: "wallet_addEthereumChain",
            params: [{
              chainId: chainHex,
              chainName: destConfig.name,
              nativeCurrency: destConfig.nativeCurrency,
              rpcUrls: [destConfig.rpc],
            }],
          });
        } else throw switchErr;
      }

      const accounts: string[] = await eth.request({ method: "eth_accounts" });
      const account = accounts[0] as Address;
      const destViemChain = {
        id: destConfig.chainId,
        name: destConfig.name,
        nativeCurrency: destConfig.nativeCurrency,
        rpcUrls: { default: { http: [destConfig.rpc] }, public: { http: [destConfig.rpc] } },
      } as const;

      const wc = createWalletClient({ chain: destViemChain as any, transport: custom(eth) });
      const pc = createPublicClient({ chain: destViemChain as any, transport: http(destConfig.rpc) });

      const hash = await wc.writeContract({
        address: MESSAGE_TRANSMITTER_V2_ADDRESS,
        abi: RECEIVE_MESSAGE_ABI,
        functionName: "receiveMessage",
        args: [attest.messageBytes as `0x${string}`, attest.attestation as `0x${string}`],
        account,
        chain: destViemChain as any,
      });
      await pc.waitForTransactionReceipt({ hash });
      setClaimTx(hash);
    } catch (e: any) {
      setErr(e.shortMessage ?? e.message ?? "Claim failed");
    } finally {
      setClaiming(false);
    }
  };

  const isReady  = !!attest?.attestation;
  const doneTx   = relayTx ?? claimTx;
  const explorer = attest?.receiveTarget?.explorerTx ?? destConfig?.explorerTx;

  const calldata = isReady
    ? encodeFunctionData({
        abi: RECEIVE_MESSAGE_ABI,
        functionName: "receiveMessage",
        args: [attest!.messageBytes as `0x${string}`, attest!.attestation as `0x${string}`],
      })
    : null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="h-6 text-xs px-2 text-primary">
          Receive ↗
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[580px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Receive USDC on {destChain}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-2 text-sm">
          {/* Step progress */}
          <div className="grid grid-cols-3 gap-2 text-center text-xs">
            {[
              { label: "Burn on Arc",        done: true },
              { label: "Circle attests",      done: isReady },
              { label: "Mint on destination", done: !!doneTx },
            ].map((s, i) => (
              <div key={i} className={`rounded-md p-2 border ${s.done ? "border-green-500/40 bg-green-500/10 text-green-400" : "border-border bg-muted/40 text-muted-foreground"}`}>
                <div className="font-semibold">{s.done ? "✓" : i + 1}</div>
                <div>{s.label}</div>
              </div>
            ))}
          </div>

          {/* Success */}
          {doneTx && (
            <div className="rounded-md border border-green-500/40 bg-green-500/10 p-3 space-y-1">
              <p className="text-green-400 font-medium">✓ USDC minted on {destChain}</p>
              <a href={`${explorer}/${doneTx}`} target="_blank" rel="noreferrer"
                className="text-xs font-mono text-primary hover:underline break-all">
                {doneTx} ↗
              </a>
            </div>
          )}

          {/* Attestation status */}
          {!doneTx && (
            <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
              <span className="text-muted-foreground text-xs">Circle attestation</span>
              <div className="flex items-center gap-2">
                <Badge variant={isReady ? "secondary" : "outline"} className="text-xs">
                  {polling && !attest ? "Checking…" : isReady ? "Ready ✓" : "Pending"}
                </Badge>
                <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={poll} disabled={polling}>
                  {polling ? "…" : "Refresh"}
                </Button>
              </div>
            </div>
          )}

          {/* Receive options */}
          {!doneTx && (
            <Tabs defaultValue="gasless">
              <TabsList className="w-full">
                <TabsTrigger value="gasless" className="flex-1 text-xs">Gas-free Relay</TabsTrigger>
                <TabsTrigger value="self" className="flex-1 text-xs">Self-relay (MetaMask)</TabsTrigger>
              </TabsList>

              {/* Tab A: Gas-free relay */}
              <TabsContent value="gasless" className="space-y-3 pt-2">
                <div className="rounded-md bg-muted/50 border border-border p-3 text-xs space-y-1 text-muted-foreground">
                  <p>The arc-relay-bridge server submits the mint transaction on your behalf.</p>
                  <p>You need <strong>no ETH</strong> on {destChain}. A relay fee of <strong>1 USDC</strong> is deducted from the received amount.</p>
                </div>
                <Button className="w-full" disabled={!isReady || relaying} onClick={handleGaslessRelay}>
                  {relaying ? "Relaying…" : isReady ? `Gas-free Relay to ${destChain} (−1 USDC fee)` : "Waiting for attestation…"}
                </Button>
              </TabsContent>

              {/* Tab B: Self relay */}
              <TabsContent value="self" className="space-y-3 pt-2">
                <div className="rounded-md bg-muted/50 border border-border p-3 text-xs space-y-1 text-muted-foreground">
                  <p>You call <code>receiveMessage</code> yourself. MetaMask switches to {destChain}.</p>
                  <p>Receive full amount with <strong>no relay fee</strong>, but you need ETH on {destChain} for gas (~0.001 ETH).</p>
                </div>
                <Button className="w-full" variant="secondary" disabled={!isReady || claiming || !destConfig} onClick={handleSelfClaim}>
                  {claiming ? "Switching chain & claiming…" : isReady ? `Claim Full Amount on ${destChain}` : "Waiting for attestation…"}
                </Button>
              </TabsContent>
            </Tabs>
          )}

          {err && <p className="text-xs text-destructive">{err}</p>}

          {/* Message bytes + calldata (copy for advanced use) */}
          {attest?.messageBytes && (
            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                Raw data (message bytes, calldata)
              </summary>
              <div className="mt-2 space-y-2">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-muted-foreground">Message bytes</span>
                    <Button variant="ghost" size="sm" className="h-5 text-xs" onClick={() => copyText(attest.messageBytes!)}>
                      {copied ? "Copied!" : "Copy"}
                    </Button>
                  </div>
                  <div className="font-mono bg-muted rounded p-2 break-all leading-relaxed max-h-14 overflow-y-auto text-xs">
                    {attest.messageBytes}
                  </div>
                </div>
                {calldata && (
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-muted-foreground">receiveMessage calldata</span>
                      <Button variant="ghost" size="sm" className="h-5 text-xs" onClick={() => copyText(calldata)}>
                        Copy
                      </Button>
                    </div>
                    <div className="font-mono bg-muted rounded p-2 break-all leading-relaxed max-h-14 overflow-y-auto text-xs">
                      {calldata}
                    </div>
                  </div>
                )}
              </div>
            </details>
          )}

          <div className="text-xs text-muted-foreground border-t border-border pt-3 flex gap-4">
            <a href={`https://testnet.arcscan.app/tx/${txHash}`} target="_blank" rel="noreferrer" className="text-primary hover:underline">
              Burn tx ↗
            </a>
            {attest?.receiveTarget && (
              <a href={`${attest.receiveTarget.explorerBase}/0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275#writeContract`}
                target="_blank" rel="noreferrer" className="text-primary hover:underline">
                MessageTransmitterV2 on {destChain} ↗
              </a>
            )}
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
  const [txPending, setTxPending]   = useState(false);
  const [formData, setFormData]     = useState({
    recipient:            "",
    destChain:            "Ethereum Sepolia",
    amount:               "",
    conditionDescription: "Unconditional CCTP transfer",
  });

  const createTransfer = useCreateCrosschainTransfer({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListCrosschainTransfersQueryKey() });
        setCreateOpen(false);
      },
    },
  });

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!address || !walletClient) return;
    if (isWrongNetwork) { await switchToArc(); return; }

    setTxPending(true);
    try {
      const rawAmount  = parseToken(formData.amount);
      const destDomain = DEST_DOMAINS[formData.destChain] ?? 0;

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
            CCTP v2 via CrosschainEscrow
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
                  <Label>Sender (you)</Label>
                  <Input value={address ?? ""} disabled className="bg-muted font-mono text-xs" />
                </div>
                <div className="space-y-2">
                  <Label>Recipient Address (on destination chain)</Label>
                  <Input
                    required value={formData.recipient}
                    onChange={e => setFormData({ ...formData, recipient: e.target.value })}
                    placeholder="0x…" className="font-mono text-xs"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Source Chain</Label>
                    <Input disabled value="Arc Testnet" />
                  </div>
                  <div className="space-y-2">
                    <Label>Destination Chain</Label>
                    <Select value={formData.destChain} onValueChange={v => setFormData({ ...formData, destChain: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Ethereum Sepolia">Ethereum Sepolia (domain 0)</SelectItem>
                        <SelectItem value="Base Sepolia">Base Sepolia (domain 6)</SelectItem>
                        <SelectItem value="Arbitrum Sepolia">Arbitrum Sepolia (domain 3)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>USDC Amount</Label>
                  <Input
                    required type="number" step="0.000001" min="1.000001"
                    value={formData.amount}
                    onChange={e => setFormData({ ...formData, amount: e.target.value })}
                    placeholder="0.00"
                  />
                  <p className="text-xs text-muted-foreground">Minimum 1 USDC (relay fee) + transfer amount</p>
                </div>
                <div className="space-y-2">
                  <Label>Condition Description</Label>
                  <Input
                    value={formData.conditionDescription}
                    onChange={e => setFormData({ ...formData, conditionDescription: e.target.value })}
                  />
                </div>
                <div className="bg-muted/50 rounded-md p-3 text-xs text-muted-foreground space-y-1">
                  <p>Two txs: approve USDC spend, then burn via CrosschainEscrow → CCTP v2.</p>
                  <p>After burn, click <strong>Receive ↗</strong> to mint on the destination chain — no ETH needed with gas-free relay.</p>
                </div>
                <Button type="submit" className="w-full mt-4" disabled={txPending}>
                  {txPending ? "Waiting for wallet…" : "Approve & Burn via CCTP v2"}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        )}
        {!isConnected && (
          <p className="text-sm text-muted-foreground">Connect wallet to initiate transfers</p>
        )}
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
              <TableRow><TableCell colSpan={5} className="text-center py-8">Loading…</TableCell></TableRow>
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
