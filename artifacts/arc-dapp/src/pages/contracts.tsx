import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FileCode2, ExternalLink } from "lucide-react";

export default function Contracts() {
  const contracts = [
    { name: "ConditionalEscrow.sol", address: "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a", type: "Core Module" },
    { name: "PayrollVesting.sol", address: "0x3600000000000000000000000000000000000000", type: "Core Module" },
    { name: "CrosschainEscrow.sol", address: "0x77cd6303cec089b5f319d72a89b50855aa3be2f6", type: "CCTP Extension" },
  ];

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Smart Contracts</h1>
        <p className="text-muted-foreground mt-1">Arc Testnet deployed modules reference</p>
      </div>

      <div className="grid gap-4">
        {contracts.map(c => (
          <Card key={c.address} className="bg-card/50 border-border">
            <CardContent className="p-6 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-primary/10 text-primary rounded-md">
                  <FileCode2 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-medium text-lg">{c.name}</h3>
                  <p className="text-sm text-muted-foreground">{c.type}</p>
                </div>
              </div>
              <div className="flex flex-col items-end gap-2">
                <code className="text-sm bg-muted/50 px-2 py-1 rounded border border-border">
                  {c.address}
                </code>
                <a href={`https://testnet.arcscan.app/address/${c.address}`} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline flex items-center gap-1">
                  View on ArcScan <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
