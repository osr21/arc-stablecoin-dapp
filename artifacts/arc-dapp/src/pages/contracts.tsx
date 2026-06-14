import { Card, CardContent } from "@/components/ui/card";
import { FileCode2, ExternalLink } from "lucide-react";
import { CONTRACT_ADDRESSES } from "../lib/contracts";

const contracts = [
  {
    name: "ConditionalEscrow.sol",
    address: CONTRACT_ADDRESSES.CONDITIONAL_ESCROW,
    type: "Time-based + dispute resolution escrow",
    description: "createEscrow · release · autoRelease · raiseDispute · resolveDispute",
  },
  {
    name: "PayrollVesting.sol",
    address: CONTRACT_ADDRESSES.PAYROLL_VESTING,
    type: "Cliff + linear vesting in USDC / EURC",
    description: "createSchedule · claim · revoke · vestedAmount · claimableAmount",
  },
  {
    name: "CrosschainEscrow.sol",
    address: CONTRACT_ADDRESSES.CROSSCHAIN_ESCROW,
    type: "CCTP v2 depositForBurnWithHook wrapper",
    description: "initiateConditionalTransfer · hookData · encodeHookData",
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
        <p className="text-muted-foreground mt-1">Live on Arc Testnet (Chain ID: 5042002)</p>
      </div>

      <div className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Deployed Contracts</h2>
        {contracts.map(c => (
          <Card key={c.address} className="bg-card/50 border-border">
            <CardContent className="p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-4">
                  <div className="p-2.5 bg-primary/10 text-primary rounded-md mt-0.5">
                    <FileCode2 className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-semibold">{c.name}</h3>
                    <p className="text-sm text-muted-foreground">{c.type}</p>
                    <p className="text-xs text-muted-foreground/70 mt-1 font-mono">{c.description}</p>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-2 shrink-0">
                  <code className="text-xs bg-muted/50 px-2 py-1 rounded border border-border font-mono">
                    {c.address}
                  </code>
                  <a href={`https://testnet.arcscan.app/address/${c.address}`} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline flex items-center gap-1">
                    View on ArcScan <ExternalLink className="w-3 h-3" />
                  </a>
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
