import { useState } from "react";
import { getAddress, toHex } from "viem";
import { useWallet } from "../lib/wallet";
import { useX402Send } from "@workspace/api-client-react";
import { parseTokenAmount, formatTokenAmount } from "../lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Zap, ArrowRight, CheckCircle2, ExternalLink, Info, Loader2, AlertCircle } from "lucide-react";
import type { X402TransferReceipt } from "@workspace/api-client-react";

const USDC_ADDRESS  = "0x3600000000000000000000000000000000000000" as const;
const ARC_CHAIN_ID  = 5042002;
const ARCSCAN_TX    = "https://testnet.arcscan.app/tx";

const EIP712_DOMAIN = {
  name:              "USDC",
  version:           "2",
  chainId:           ARC_CHAIN_ID,
  verifyingContract: USDC_ADDRESS,
} as const;

const TRANSFER_AUTH_TYPES = {
  EIP712Domain: [
    { name: "name",              type: "string"  },
    { name: "version",           type: "string"  },
    { name: "chainId",           type: "uint256" },
    { name: "verifyingContract", type: "address" },
  ],
  TransferWithAuthorization: [
    { name: "from",        type: "address" },
    { name: "to",          type: "address" },
    { name: "value",       type: "uint256" },
    { name: "validAfter",  type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce",       type: "bytes32" },
  ],
} as const;

interface SentTx {
  txHash: string;
  from: string;
  to: string;
  value: string;
  blockNumber: string;
  timestamp: Date;
}

async function signTransferAuth(
  walletAddress: string,
  to: string,
  valueRaw: string,
): Promise<{ signature: `0x${string}`; nonce: string; validBefore: string; validAfter: string }> {
  const eth = (window as any).ethereum;
  if (!eth) throw new Error("MetaMask not found");

  const nonce       = toHex(crypto.getRandomValues(new Uint8Array(32)));
  const validAfter  = "0";
  const validBefore = String(Math.floor(Date.now() / 1000) + 600); // 10 min window

  const typedData = {
    domain:      EIP712_DOMAIN,
    types:       TRANSFER_AUTH_TYPES,
    primaryType: "TransferWithAuthorization",
    message: {
      from:        walletAddress,
      to:          getAddress(to),
      value:       valueRaw,
      validAfter,
      validBefore,
      nonce,
    },
  };

  // Serialize BigInt values as strings for JSON — MetaMask rejects BigInt directly.
  const replacer = (_: string, v: unknown) => (typeof v === "bigint" ? v.toString() : v);

  const signature = (await eth.request({
    method: "eth_signTypedData_v4",
    params: [walletAddress, JSON.stringify(typedData, replacer)],
  })) as `0x${string}`;

  return { signature, nonce, validBefore, validAfter };
}

export default function X402Pay() {
  const { address, isConnected, connect, isWrongNetwork, switchToArc } = useWallet();
  const { toast } = useToast();
  const sendMutation = useX402Send();

  const [recipient, setRecipient] = useState("");
  const [amount, setAmount]       = useState("");
  const [isSigning, setIsSigning] = useState(false);
  const [sentTxs, setSentTxs]     = useState<SentTx[]>([]);

  const isValidAddress = /^0x[0-9a-fA-F]{40}$/.test(recipient);
  const isValidAmount  = /^\d+(\.\d{0,6})?$/.test(amount) && parseFloat(amount) > 0;
  const canSend        = isConnected && !isWrongNetwork && isValidAddress && isValidAmount && !isSigning && !sendMutation.isPending;

  async function handleSend() {
    if (!address || !canSend) return;

    let valueRaw: string;
    try {
      valueRaw = parseTokenAmount(amount);
    } catch {
      toast({ title: "Invalid amount", description: "Enter a valid USDC amount.", variant: "destructive" });
      return;
    }

    setIsSigning(true);
    let sig: Awaited<ReturnType<typeof signTransferAuth>> | null = null;

    try {
      sig = await signTransferAuth(address, recipient, valueRaw);
    } catch (err: any) {
      const msg = err?.message ?? "Signing cancelled";
      toast({ title: "Signing failed", description: msg.includes("rejected") ? "You rejected the MetaMask request." : msg, variant: "destructive" });
      setIsSigning(false);
      return;
    } finally {
      if (!sig) setIsSigning(false);
    }

    setIsSigning(false);

    sendMutation.mutate(
      {
        data: {
          from:        address,
          to:          getAddress(recipient),
          value:       valueRaw,
          validAfter:  sig.validAfter,
          validBefore: sig.validBefore,
          nonce:       sig.nonce,
          signature:   sig.signature,
        },
      },
      {
        onSuccess: (result: X402TransferReceipt) => {
          setSentTxs((prev) => [
            {
              txHash:      result.txHash,
              from:        result.from,
              to:          result.to,
              value:       result.value,
              blockNumber: result.blockNumber,
              timestamp:   new Date(),
            },
            ...prev,
          ]);
          setRecipient("");
          setAmount("");
          toast({
            title:       "Transfer confirmed",
            description: `${formatTokenAmount(result.value, "USDC")} sent — block ${result.blockNumber}`,
          });
        },
        onError: (err: any) => {
          const msg = err?.message ?? "Transfer failed";
          toast({ title: "Transfer failed", description: msg, variant: "destructive" });
        },
      },
    );
  }

  const truncate = (addr: string) => `${addr.slice(0, 8)}…${addr.slice(-6)}`;
  const isPending = isSigning || sendMutation.isPending;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3 mb-2">
          <div className="w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center">
            <Zap className="w-4 h-4 text-primary" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">X402 Pay</h1>
        </div>
        <p className="text-muted-foreground">
          Send USDC on Arc Testnet using EIP-3009{" "}
          <span className="font-mono text-xs">TransferWithAuthorization</span> — sign in MetaMask,
          no gas required.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Send Form */}
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Send USDC</CardTitle>
              <CardDescription>
                Your MetaMask signs an off-chain authorization. The relay submits the on-chain
                transfer — you pay no gas.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {!isConnected ? (
                <div className="flex flex-col items-center gap-3 py-8">
                  <AlertCircle className="w-8 h-8 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">Connect your wallet to send USDC</p>
                  <Button onClick={connect} size="sm">Connect Wallet</Button>
                </div>
              ) : isWrongNetwork ? (
                <div className="flex flex-col items-center gap-3 py-8">
                  <AlertCircle className="w-8 h-8 text-amber-400" />
                  <p className="text-sm text-muted-foreground">Switch to Arc Testnet to continue</p>
                  <Button onClick={switchToArc} size="sm" variant="outline">Switch Network</Button>
                </div>
              ) : (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="recipient">Recipient Address</Label>
                    <Input
                      id="recipient"
                      placeholder="0x…"
                      value={recipient}
                      onChange={(e) => setRecipient(e.target.value)}
                      className="font-mono text-sm"
                    />
                    {recipient && !isValidAddress && (
                      <p className="text-xs text-destructive">Invalid address format</p>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="amount">Amount (USDC)</Label>
                    <div className="relative">
                      <Input
                        id="amount"
                        placeholder="0.00"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        className="pr-16"
                        type="number"
                        min="0"
                        step="0.01"
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground font-medium">
                        USDC
                      </span>
                    </div>
                    {amount && isValidAmount && (
                      <p className="text-xs text-muted-foreground">
                        = {parseTokenAmount(amount)} raw base units (6 decimals)
                      </p>
                    )}
                  </div>

                  {/* Preview */}
                  {isValidAddress && isValidAmount && (
                    <div className="rounded-md border border-border bg-muted/30 p-3 text-sm space-y-1">
                      <div className="flex justify-between text-muted-foreground">
                        <span>From</span>
                        <span className="font-mono">{truncate(address!)}</span>
                      </div>
                      <div className="flex justify-between text-muted-foreground">
                        <span>To</span>
                        <span className="font-mono">{truncate(recipient)}</span>
                      </div>
                      <div className="flex justify-between font-medium">
                        <span>Amount</span>
                        <span>{amount} USDC</span>
                      </div>
                      <div className="flex justify-between text-muted-foreground">
                        <span>Your gas cost</span>
                        <span className="text-emerald-400 font-medium">Free</span>
                      </div>
                    </div>
                  )}

                  <Button
                    onClick={handleSend}
                    disabled={!canSend}
                    className="w-full gap-2"
                  >
                    {isPending ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        {isSigning ? "Waiting for MetaMask…" : "Submitting on-chain…"}
                      </>
                    ) : (
                      <>
                        <Zap className="w-4 h-4" />
                        Sign &amp; Send
                      </>
                    )}
                  </Button>
                </>
              )}
            </CardContent>
          </Card>

          {/* Transaction History */}
          {sentTxs.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Recent Sends</CardTitle>
                <CardDescription>Transactions from this session</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {sentTxs.map((tx) => (
                  <div
                    key={tx.txHash}
                    className="flex items-center justify-between rounded-md border border-border p-3"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs text-muted-foreground">{truncate(tx.from)}</span>
                          <ArrowRight className="w-3 h-3 text-muted-foreground shrink-0" />
                          <span className="font-mono text-xs text-muted-foreground">{truncate(tx.to)}</span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Block {tx.blockNumber} · {tx.timestamp.toLocaleTimeString()}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge variant="secondary" className="font-mono text-xs">
                        {formatTokenAmount(tx.value, "USDC")}
                      </Badge>
                      <a
                        href={`${ARCSCAN_TX}/${tx.txHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-muted-foreground hover:text-foreground transition-colors"
                        title="View on ArcScan"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>

        {/* How it works */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Info className="w-4 h-4" />
                How it works
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              {[
                {
                  step: "1",
                  title: "Sign off-chain",
                  desc: "MetaMask signs an EIP-3009 TransferWithAuthorization — a typed-data message, not a transaction. No gas, no broadcast.",
                },
                {
                  step: "2",
                  title: "Relay submits",
                  desc: "The server's wallet calls transferWithAuthorization on the USDC contract, passing your signed auth. It pays the gas.",
                },
                {
                  step: "3",
                  title: "USDC moves",
                  desc: "The USDC contract verifies your signature and moves tokens from your wallet to the recipient atomically.",
                },
              ].map(({ step, title, desc }) => (
                <div key={step} className="flex gap-3">
                  <div className="w-5 h-5 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
                    {step}
                  </div>
                  <div>
                    <p className="font-medium">{title}</p>
                    <p className="text-muted-foreground text-xs mt-0.5">{desc}</p>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Token Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {[
                { label: "Token",    value: "USDC" },
                { label: "Network",  value: "Arc Testnet" },
                { label: "Chain ID", value: "5042002" },
                { label: "Standard", value: "EIP-3009" },
                { label: "Contract", value: truncateAddr(USDC_ADDRESS) },
              ].map(({ label, value }) => (
                <div key={label} className="flex justify-between">
                  <span className="text-muted-foreground">{label}</span>
                  <span className="font-mono text-xs">{value}</span>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="border-amber-500/20 bg-amber-500/5">
            <CardContent className="pt-4">
              <p className="text-xs text-amber-400">
                <strong>Testnet only.</strong> Arc Testnet USDC has no real value.
                Get test funds at{" "}
                <a
                  href="https://faucet.circle.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                >
                  faucet.circle.com
                </a>
                .
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function truncateAddr(addr: string) {
  return `${addr.slice(0, 8)}…${addr.slice(-6)}`;
}
