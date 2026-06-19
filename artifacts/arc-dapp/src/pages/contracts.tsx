import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FileCode2, ExternalLink, CheckCircle2, Clock } from "lucide-react";
import { CONTRACT_ADDRESSES } from "../lib/contracts";

const contracts = [
  {
    name: "ConditionalEscrow.sol",
    address: CONTRACT_ADDRESSES.CONDITIONAL_ESCROW,
    chain: "Arc Testnet",
    type: "Time-based + dispute resolution escrow",
    description: "createEscrow · release · autoRelease · raiseDispute · resolveDispute",
    scanBase: "https://testnet.arcscan.app",
  },
  {
    name: "PayrollVesting.sol",
    address: CONTRACT_ADDRESSES.PAYROLL_VESTING,
    chain: "Arc Testnet",
    type: "Cliff + linear vesting in USDC / EURC",
    description: "createSchedule · claim · revoke · vestedAmount · claimableAmount",
    scanBase: "https://testnet.arcscan.app",
  },
  {
    name: "CrosschainEscrow.sol",
    address: CONTRACT_ADDRESSES.CROSSCHAIN_ESCROW,
    chain: "Arc Testnet",
    type: "CCTP v2 depositForBurnWithHook wrapper",
    description: "initiateConditionalTransfer · hookData · encodeHookData",
    scanBase: "https://testnet.arcscan.app",
  },
];

const timelockHooks = [
  {
    chain: "Ethereum Sepolia",
    address: "0x22f2ea9050a25da1c24caa76558a65aecc4adf4c",
    scanBase: "https://sepolia.etherscan.io",
    status: "live" as const,
  },
  {
    chain: "Arbitrum Sepolia",
    address: "0x0e250b6b417e5b31c7f4bcc8a00352d0672474ad",
    scanBase: "https://sepolia.arbiscan.io",
    status: "live" as const,
  },
  {
    chain: "Base Sepolia",
    address: null,
    scanBase: null,
    status: "pending" as const,
  },
];

const tokens = [
  { name: "USDC (native gas token)", address: CONTRACT_ADDRESSES.USDC, decimals: 6 },
  { name: "EURC",                     address: CONTRACT_ADDRESSES.EURC,  decimals: 6 },
];

const infra = [
  { name: "CCTP TokenMessengerV2",     address: CONTRACT_ADDRESSES.TOKEN_MESSENGER_V2 },
  { name: "Arc Testnet RPC",           address: "https://rpc.testnet.arc.network" },
  { name: "Circle IRIS API (sandbox)", address: "https://iris-api-sandbox.circle.com" },
];

export default function Contracts() {
  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Smart Contracts</h1>
        <p className="text-muted-foreground mt-1">All contracts across Arc Testnet and destination chains</p>
      </div>

      <div className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Core Contracts — Arc Testnet (Chain ID 5042002)</h2>
        {contracts.map(c => (
          <Card key={c.address} className="bg-card/50 border-border">
            <CardContent className="p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-4">
                  <div className="p-2.5 bg-primary/10 text-primary rounded-md mt-0.5">
                    <FileCode2 className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-semibold">{c.name}</h3>
                      <Badge variant="outline" className="text-xs">{c.chain}</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">{c.type}</p>
                    <p className="text-xs text-muted-foreground/70 mt-1 font-mono">{c.description}</p>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-2 shrink-0">
                  <code className="text-xs bg-muted/50 px-2 py-1 rounded border border-border font-mono">
                    {c.address}
                  </code>
                  <a href={`${c.scanBase}/address/${c.address}`} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline flex items-center gap-1">
                    View on Explorer <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">TimeLockHook.sol — CCTP v2 Destination Hooks</h2>
          <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 text-xs">First on Arc</Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          Deployed on destination chains. Receives CCTP-minted USDC and holds it until an unlock timestamp — called by <code className="bg-muted px-1 rounded">CrosschainEscrow.initiateConditionalTransfer()</code> on Arc.
        </p>
        {timelockHooks.map(h => (
          <Card key={h.chain} className="bg-card/50 border-border">
            <CardContent className="p-4">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-3">
                  {h.status === "live"
                    ? <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    : <Clock className="w-4 h-4 text-muted-foreground shrink-0" />}
                  <div>
                    <p className="font-medium text-sm">{h.chain}</p>
                    <p className="text-xs text-muted-foreground">TimeLockHook.sol · relay() · claim()</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {h.address
                    ? <>
                        <code className="text-xs bg-muted/50 px-2 py-1 rounded border border-border font-mono">{h.address}</code>
                        {h.scanBase && (
                          <a href={`${h.scanBase}/address/${h.address}`} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline flex items-center gap-1">
                            Explorer <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                      </>
                    : <span className="text-xs text-muted-foreground italic">Needs Base Sepolia ETH for deployment</span>}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Circle Stablecoin Tokens</h2>
        {tokens.map(t => (
          <Card key={t.address} className="bg-card/50 border-border">
            <CardContent className="p-4 flex items-center justify-between">
              <div>
                <p className="font-medium">{t.name}</p>
                <p className="text-xs text-muted-foreground">{t.decimals} decimals</p>
              </div>
              <div className="flex items-center gap-3">
                <code className="text-xs bg-muted/50 px-2 py-1 rounded border border-border font-mono">{t.address}</code>
                <a href={`https://testnet.arcscan.app/address/${t.address}`} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline">
                  ArcScan ↗
                </a>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Infrastructure</h2>
        {infra.map(i => (
          <Card key={i.name} className="bg-card/50 border-border">
            <CardContent className="p-4 flex items-center justify-between">
              <p className="font-medium text-sm">{i.name}</p>
              <code className="text-xs bg-muted/50 px-2 py-1 rounded border border-border font-mono">{i.address}</code>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
