import { useEffect, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ExternalLink, CheckCircle2, Clock, Zap, RefreshCw, AlertTriangle, Server } from "lucide-react";

const TIMELOCK_DEPLOYMENTS = [
  {
    chain: "Ethereum Sepolia",
    chainId: 11155111,
    address: "0x22f2ea9050a25da1c24caa76558a65aecc4adf4c",
    explorer: "https://sepolia.etherscan.io/address/0x22f2ea9050a25da1c24caa76558a65aecc4adf4c",
    status: "live",
  },
  {
    chain: "Arbitrum Sepolia",
    chainId: 421614,
    address: "0x0e250b6b417e5b31c7f4bcc8a00352d0672474ad",
    explorer: "https://sepolia.arbiscan.io/address/0x0e250b6b417e5b31c7f4bcc8a00352d0672474ad",
    status: "live",
  },
  {
    chain: "Base Sepolia",
    chainId: 84532,
    address: "—",
    explorer: null,
    status: "pending",
  },
];

const RELAY_SNIPPET = `// 1. After Circle attests the CCTP message, call relay() on the destination chain.
//    Anyone can relay — gas is paid on the destination chain in ETH.
const releaseId = await timeLockHook.relay(
  message,         // bytes — from Circle IRIS /v1/attestations/:txHash
  attestation,     // bytes — from Circle IRIS
  finalRecipient,  // address — who can claim after unlock
  unlockTimestamp  // uint256 — Unix epoch seconds
);

// 2. After the unlock timestamp, the recipient calls claim().
await timeLockHook.claim(releaseId);`;

const KEEPER_SNIPPET = `// Auto-release daemon — runs every 60 seconds on your server.
// Costs near-zero USDC gas on Arc's predictable fee model.

setInterval(async () => {
  const nowSecs = Math.floor(Date.now() / 1000);

  const expired = await db.select().from(escrowsTable).where(
    and(eq(escrowsTable.status, "active"), lt(escrowsTable.releaseTime, nowSecs))
  );

  for (const escrow of expired) {
    // Use per-escrow contractAddress — handles contracts across deployments.
    await walletClient.writeContract({
      address: escrow.contractAddress,
      abi:     ESCROW_ABI,
      functionName: "autoRelease",
      args:    [BigInt(escrow.onChainId)],
    });
  }
}, 60_000);`;

const DEPLOY_SNIPPET = `# Deploy TimeLockHook to a new destination chain.
# MessageTransmitterV2 is at the same CREATE2 address on all CCTP v2 chains:
#   0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275

forge script script/DeployTimeLockHook.s.sol:DeployTimeLockHook \\
  --rpc-url <destination-chain-rpc> \\
  --private-key "$DEPLOYER_PRIVATE_KEY" \\
  --broadcast \\
  --config-path foundry.toml`;

interface KeeperStatus {
  running: boolean;
  keeperAddress: string | null;
  lastTickAt: string | null;
  successfulReleases: number;
  inBackoff: { escrowId: number; retryInSecs: number }[];
}

function CodeBlock({ code }: { code: string }) {
  return (
    <pre className="bg-muted/60 border border-border rounded-lg p-4 text-xs font-mono overflow-x-auto leading-relaxed text-foreground/80 whitespace-pre">
      {code}
    </pre>
  );
}

function FlowStep({ num, title, body }: { num: number; title: string; body: string }) {
  return (
    <div className="flex gap-4 items-start">
      <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center text-sm font-bold shrink-0 mt-0.5">
        {num}
      </div>
      <div>
        <p className="font-medium text-sm">{title}</p>
        <p className="text-sm text-muted-foreground mt-0.5">{body}</p>
      </div>
    </div>
  );
}

export default function Integrations() {
  const [keeper, setKeeper] = useState<KeeperStatus | null>(null);
  const [keeperError, setKeeperError] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch("/api/keeper/status");
        if (res.ok) { setKeeper(await res.json()); setKeeperError(false); }
        else setKeeperError(true);
      } catch { setKeeperError(true); }
    };
    load();
    const iv = setInterval(load, 30_000);
    return () => clearInterval(iv);
  }, []);

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div>
        <div className="flex items-center gap-3 mb-1">
          <h1 className="text-3xl font-semibold tracking-tight">Arc Integration Guide</h1>
          <Badge variant="outline" className="text-primary border-primary/30">Reference Implementation</Badge>
        </div>
        <p className="text-muted-foreground">
          Two novel patterns for the Arc ecosystem — CCTP v2 hooks and server-side auto-release.
          Fork either for your own Arc project.
        </p>
      </div>

      <Tabs defaultValue="cctp-hook">
        <TabsList className="w-full justify-start">
          <TabsTrigger value="cctp-hook">CCTP v2 Hook Registry</TabsTrigger>
          <TabsTrigger value="keeper">Auto-Release Keeper</TabsTrigger>
        </TabsList>

        {/* ─── CCTP v2 Hook ─────────────────────────────────────── */}
        <TabsContent value="cctp-hook" className="space-y-6 mt-6">

          <Card className="bg-card/50 border-border">
            <CardHeader>
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    TimeLockHook
                    <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 text-xs">First on Arc</Badge>
                  </CardTitle>
                  <CardDescription className="mt-1">
                    A reusable CCTP v2 destination hook that time-locks USDC on the receiving chain.
                    Sender burns on Arc; recipient can only claim after an unlock timestamp.
                  </CardDescription>
                </div>
                <a
                  href="https://github.com/circlefin/evm-cctp-contracts"
                  target="_blank" rel="noreferrer"
                  className="text-xs text-primary hover:underline flex items-center gap-1 shrink-0"
                >
                  evm-cctp-contracts <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-4">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">How it works</p>
                <div className="space-y-4 pl-1">
                  <FlowStep num={1} title="Burn on Arc" body="CrosschainEscrow.initiateConditionalTransfer() calls depositForBurnWithHook() on Arc's TokenMessengerV2. mintRecipient = address(TimeLockHook) on the destination chain." />
                  <FlowStep num={2} title="Circle attests" body="Circle's IRIS API signs the burn message. Poll /v1/attestations/:txHash until status = complete." />
                  <FlowStep num={3} title="Relay to destination" body="Anyone calls TimeLockHook.relay(message, attestation, recipient, unlockTs). USDC is minted to the hook contract and a PendingRelease is stored." />
                  <FlowStep num={4} title="Claim after unlock" body="After the unlock timestamp, the final recipient calls claim(releaseId). USDC is transferred out of the hook." />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-card/50 border-border">
            <CardHeader>
              <CardTitle className="text-base">Deployed Addresses</CardTitle>
              <CardDescription>All deployments use MessageTransmitterV2 at <code className="text-xs bg-muted px-1 rounded">0xE737...CE275</code> (same on all CCTP v2 chains)</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {TIMELOCK_DEPLOYMENTS.map(d => (
                  <div key={d.chain} className="flex items-center justify-between p-3 rounded-lg border border-border bg-background/50 gap-4 flex-wrap">
                    <div className="flex items-center gap-3">
                      {d.status === "live"
                        ? <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                        : <Clock className="w-4 h-4 text-muted-foreground shrink-0" />}
                      <div>
                        <p className="text-sm font-medium">{d.chain}</p>
                        <p className="text-xs text-muted-foreground">Chain ID {d.chainId}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      {d.address !== "—"
                        ? <code className="text-xs bg-muted/50 px-2 py-1 rounded border border-border font-mono">{d.address}</code>
                        : <span className="text-xs text-muted-foreground italic">Needs Base Sepolia ETH for deployment</span>}
                      {d.explorer && (
                        <a href={d.explorer} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline flex items-center gap-1">
                          Explorer <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="bg-card/50 border-border">
            <CardHeader>
              <CardTitle className="text-base">Interface</CardTitle>
              <CardDescription>Two functions — relay() once, claim() after unlock</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <CodeBlock code={RELAY_SNIPPET} />
            </CardContent>
          </Card>

          <Card className="bg-card/50 border-border">
            <CardHeader>
              <CardTitle className="text-base">Deploy Your Own</CardTitle>
              <CardDescription>
                TimeLockHook is parameterised by chain — deploy once per destination. The Foundry script reads
                <code className="text-xs bg-muted px-1 mx-1 rounded">DEPLOYER_PRIVATE_KEY</code> from your environment.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <CodeBlock code={DEPLOY_SNIPPET} />
              <div className="flex items-start gap-3 p-3 rounded-lg border border-amber-500/20 bg-amber-500/5 text-amber-400">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <p className="text-xs">
                  <strong>Production note:</strong> The current relay() accepts caller-supplied recipient and unlock time without verifying them against the CCTP message's hookData. For production, parse BurnMessageV2 hookData inside relay() and assert recipient and unlockTimestamp match what was encoded at burn time.
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── Keeper ───────────────────────────────────────────── */}
        <TabsContent value="keeper" className="space-y-6 mt-6">

          <Card className="bg-card/50 border-border">
            <CardHeader>
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    Auto-Release Keeper
                    <Badge className="bg-primary/10 text-primary border-primary/20 text-xs">Live</Badge>
                  </CardTitle>
                  <CardDescription className="mt-1">
                    A server-side daemon that monitors expired escrows and calls autoRelease() automatically —
                    no keeper network required. Arc's predictable USDC gas makes this cost-effective.
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Server className="w-4 h-4 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">Runs on the Express API server</span>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {/* Live Status */}
              <div className="rounded-lg border border-border bg-background/50 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Live Status</p>
                  <RefreshCw className="w-3.5 h-3.5 text-muted-foreground" />
                </div>
                {keeperError ? (
                  <p className="text-sm text-muted-foreground">Could not reach keeper status endpoint.</p>
                ) : keeper === null ? (
                  <div className="h-8 bg-muted/50 animate-pulse rounded" />
                ) : (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">State</p>
                      {keeper.running
                        ? <span className="flex items-center gap-1.5 text-sm text-emerald-400 font-medium"><span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />Running</span>
                        : <span className="text-sm text-muted-foreground">Stopped</span>}
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Releases</p>
                      <p className="text-sm font-semibold tabular-nums">{keeper.successfulReleases}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Last Tick</p>
                      <p className="text-sm font-mono">
                        {keeper.lastTickAt ? new Date(keeper.lastTickAt).toLocaleTimeString() : "—"}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Keeper Address</p>
                      <p className="text-xs font-mono text-muted-foreground truncate max-w-[120px]" title={keeper.keeperAddress ?? ""}>
                        {keeper.keeperAddress ? `${keeper.keeperAddress.slice(0, 6)}…${keeper.keeperAddress.slice(-4)}` : "—"}
                      </p>
                    </div>
                  </div>
                )}
                {keeper && keeper.inBackoff.length > 0 && (
                  <div className="flex items-center gap-2 text-xs text-amber-400">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    {keeper.inBackoff.length} escrow(s) in backoff — retrying in {Math.max(...keeper.inBackoff.map(b => b.retryInSecs))}s
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="bg-card/50 border-border">
            <CardHeader>
              <CardTitle className="text-base">How it works</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-4 pl-1">
                <FlowStep num={1} title="Polls the database every 60 seconds" body="Queries all active escrows where releaseTime < now. Near-zero cost — no on-chain reads until an expired escrow is found." />
                <FlowStep num={2} title="Resolves the on-chain ID" body="Reads onChainId from the DB row (stored at create time). Falls back to parsing the EscrowCreated event from the tx receipt and persists it for future ticks." />
                <FlowStep num={3} title="Uses per-escrow contract address" body="Calls autoRelease() on escrow.contractAddress from the DB — not a hardcoded global. Handles escrows across multiple contract deployments safely." />
                <FlowStep num={4} title="Retries with backoff" body="3 consecutive failures → 10-minute backoff before retrying. Prevents burning gas on permanently broken escrows while recovering from transient RPC errors." />
              </div>
            </CardContent>
          </Card>

          <Card className="bg-card/50 border-border">
            <CardHeader>
              <CardTitle className="text-base">Pattern</CardTitle>
              <CardDescription>Adapt this for any time-based Arc contract</CardDescription>
            </CardHeader>
            <CardContent>
              <CodeBlock code={KEEPER_SNIPPET} />
            </CardContent>
          </Card>

          <Card className="bg-card/50 border-border">
            <CardHeader>
              <CardTitle className="text-base">Why self-hosted over a keeper network?</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid md:grid-cols-2 gap-4">
                <div className="space-y-3">
                  <div className="flex items-start gap-3">
                    <Zap className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-medium">Predictable USDC gas</p>
                      <p className="text-xs text-muted-foreground mt-0.5">Arc's stable fee model means you can budget keeper costs exactly — no ETH price surprises.</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <CheckCircle2 className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-medium">No external dependency</p>
                      <p className="text-xs text-muted-foreground mt-0.5">Your server IS the keeper. No Chainlink, no Gelato subscription, no third-party trust.</p>
                    </div>
                  </div>
                </div>
                <div className="space-y-3">
                  <div className="flex items-start gap-3">
                    <Server className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-medium">Full observability</p>
                      <p className="text-xs text-muted-foreground mt-0.5">Every tick, failure, and release is logged via Pino — visible in your own infra, not a third-party dashboard.</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <RefreshCw className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-medium">Sub-second finality = fast releases</p>
                      <p className="text-xs text-muted-foreground mt-0.5">Arc's deterministic BFT consensus means autoRelease() confirms in &lt;1 second — the keeper can loop fast.</p>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-primary/20 bg-primary/5">
            <CardContent className="p-5 flex items-start gap-4">
              <div className="p-2 bg-primary/10 text-primary rounded-md shrink-0">
                <ExternalLink className="w-4 h-4" />
              </div>
              <div>
                <p className="font-medium text-sm">Submit to Arc Sample Applications</p>
                <p className="text-xs text-muted-foreground mt-1 mb-3">
                  This project is designed for listing alongside arc-escrow, arc-commerce, and arc-fintech on the Arc developer docs sample applications page.
                </p>
                <div className="flex flex-wrap gap-3">
                  <a href="https://docs.arc.io/arc/references/sample-applications" target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline flex items-center gap-1">
                    Arc Sample Apps ↗
                  </a>
                  <a href="https://github.com/circlefin" target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline flex items-center gap-1">
                    circlefin org ↗
                  </a>
                  <a href="https://docs.arc.io/build/ecommerce" target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline flex items-center gap-1">
                    eCommerce use case ↗
                  </a>
                  <a href="https://docs.arc.io/build/agentic-economy" target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline flex items-center gap-1">
                    Agentic Economy ↗
                  </a>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
