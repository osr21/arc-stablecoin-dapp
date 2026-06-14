import { Link, useLocation } from "wouter";
import { Activity, ShieldCheck, Clock, ArrowLeftRight, FileCode2, LayoutDashboard, Wallet, Component, AlertTriangle } from "lucide-react";
import { useWallet } from "../lib/wallet";
import { Button } from "./ui/button";

const navItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/escrow", label: "Escrow", icon: ShieldCheck },
  { href: "/vesting", label: "Vesting", icon: Clock },
  { href: "/crosschain", label: "Cross-chain", icon: ArrowLeftRight },
  { href: "/contracts", label: "Contracts", icon: FileCode2 },
  { href: "/architecture", label: "Architecture", icon: Component },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { address, isConnected, connect, disconnect, isConnecting, isWrongNetwork, switchToArc } = useWallet();

  const truncateAddress = (addr: string) => `${addr.slice(0, 6)}...${addr.slice(-4)}`;

  return (
    <div className="min-h-screen bg-background text-foreground flex font-sans selection:bg-primary/30">
      {/* Sidebar */}
      <aside className="w-64 border-r border-border bg-card flex flex-col hidden md:flex">
        <div className="h-16 flex items-center px-6 border-b border-border">
          <div className="flex items-center gap-2 text-primary">
            <Activity className="w-6 h-6" />
            <span className="font-bold tracking-tight text-lg">Arc Console</span>
          </div>
        </div>
        <nav className="flex-1 px-4 py-6 space-y-1">
          {navItems.map((item) => {
            const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href));
            return (
              <Link key={item.href} href={item.href} className={`flex items-center gap-3 px-3 py-2.5 rounded-md transition-colors ${isActive ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:bg-accent hover:text-foreground"}`}>
                <item.icon className="w-4 h-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="p-4 border-t border-border">
          <div className="text-xs font-mono text-muted-foreground mb-3 px-2">NETWORK</div>
          <div className="bg-background rounded-md p-3 border border-border">
            <div className="flex justify-between items-center mb-1">
              <span className="text-xs text-muted-foreground">Chain ID</span>
              <span className="text-xs font-mono">5042002</span>
            </div>
            <div className="flex justify-between items-center mb-1">
              <span className="text-xs text-muted-foreground">Status</span>
              <span className="text-xs text-emerald-400 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span> Online
              </span>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0">
        <header className="h-16 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 flex items-center justify-between px-8 sticky top-0 z-10">
          <div className="flex items-center gap-4">
            <h1 className="text-sm font-medium text-muted-foreground">
              {navItems.find(i => location === i.href || (i.href !== "/" && location.startsWith(i.href)))?.label || "Arc Testnet"}
            </h1>
          </div>
          <div className="flex items-center gap-3">
            {isConnected && isWrongNetwork && (
              <Button variant="destructive" size="sm" onClick={switchToArc} className="text-xs gap-1">
                <AlertTriangle className="w-3 h-3" /> Wrong Network
              </Button>
            )}
            {isConnected ? (
              <Button variant="outline" size="sm" onClick={disconnect} className="font-mono text-xs font-normal">
                <Wallet className="w-3 h-3 mr-2" />
                {truncateAddress(address!)}
              </Button>
            ) : (
              <Button size="sm" onClick={connect} disabled={isConnecting} className="font-mono text-xs">
                {isConnecting ? "Connecting..." : "Connect Wallet"}
              </Button>
            )}
          </div>
        </header>
        <div className="flex-1 p-8 overflow-auto">
          <div className="max-w-6xl mx-auto">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
