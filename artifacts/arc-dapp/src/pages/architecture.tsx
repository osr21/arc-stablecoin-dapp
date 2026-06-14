import { Card } from "@/components/ui/card";

export default function Architecture() {
  return (
    <div className="space-y-8 animate-in fade-in duration-500 h-full flex flex-col">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">System Architecture</h1>
        <p className="text-muted-foreground mt-1">How Arc DApp interacts with onchain modules and CCTP</p>
      </div>

      <Card className="bg-card/50 border-border p-8 flex-1 min-h-[500px] flex items-center justify-center">
        <svg viewBox="0 0 800 500" className="w-full h-full max-w-4xl text-foreground font-mono">
          <defs>
            <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" opacity="0.5" />
            </marker>
          </defs>
          
          <rect x="50" y="200" width="140" height="60" rx="6" fill="hsl(var(--card))" stroke="currentColor" strokeOpacity="0.2" />
          <text x="120" y="235" textAnchor="middle" fontSize="14" fill="currentColor">Frontend</text>

          <rect x="300" y="100" width="140" height="60" rx="6" fill="hsl(var(--card))" stroke="currentColor" strokeOpacity="0.2" />
          <text x="370" y="135" textAnchor="middle" fontSize="14" fill="currentColor">Express API</text>

          <rect x="550" y="100" width="140" height="60" rx="6" fill="hsl(var(--card))" stroke="currentColor" strokeOpacity="0.2" />
          <text x="620" y="135" textAnchor="middle" fontSize="14" fill="currentColor">PostgreSQL</text>

          <rect x="300" y="300" width="390" height="150" rx="6" fill="none" stroke="currentColor" strokeOpacity="0.2" strokeDasharray="4" />
          <text x="320" y="325" fontSize="12" fill="currentColor" opacity="0.5">Arc Testnet Contracts</text>

          <rect x="320" y="350" width="100" height="40" rx="4" fill="hsl(var(--primary)/0.1)" stroke="hsl(var(--primary))" strokeOpacity="0.5" />
          <text x="370" y="375" textAnchor="middle" fontSize="10" fill="currentColor">Escrow</text>

          <rect x="440" y="350" width="100" height="40" rx="4" fill="hsl(var(--primary)/0.1)" stroke="hsl(var(--primary))" strokeOpacity="0.5" />
          <text x="490" y="375" textAnchor="middle" fontSize="10" fill="currentColor">Vesting</text>

          <rect x="560" y="350" width="100" height="40" rx="4" fill="hsl(var(--primary)/0.1)" stroke="hsl(var(--primary))" strokeOpacity="0.5" />
          <text x="610" y="375" textAnchor="middle" fontSize="10" fill="currentColor">Crosschain</text>

          <path d="M 120 200 L 120 130 L 300 130" fill="none" stroke="currentColor" strokeOpacity="0.5" markerEnd="url(#arrow)" />
          <path d="M 440 130 L 550 130" fill="none" stroke="currentColor" strokeOpacity="0.5" markerEnd="url(#arrow)" />
          <path d="M 120 260 L 120 370 L 320 370" fill="none" stroke="currentColor" strokeOpacity="0.5" markerEnd="url(#arrow)" />
        </svg>
      </Card>
    </div>
  );
}
