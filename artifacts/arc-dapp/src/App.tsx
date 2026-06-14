import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { WalletProvider } from "./lib/wallet";
import { Layout } from "./components/layout";
import Dashboard from "./pages/dashboard";
import Escrow from "./pages/escrow";
import Vesting from "./pages/vesting";
import Crosschain from "./pages/crosschain";
import Contracts from "./pages/contracts";
import Architecture from "./pages/architecture";
import NotFound from "./pages/not-found";

const queryClient = new QueryClient();

function Router() {
  return (
    <Layout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/escrow" component={Escrow} />
        <Route path="/vesting" component={Vesting} />
        <Route path="/crosschain" component={Crosschain} />
        <Route path="/contracts" component={Contracts} />
        <Route path="/architecture" component={Architecture} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <WalletProvider>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </WalletProvider>
    </QueryClientProvider>
  );
}

export default App;
