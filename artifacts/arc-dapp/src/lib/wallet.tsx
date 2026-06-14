import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { createWalletClient, createPublicClient, custom, http, type WalletClient, type PublicClient, type Address } from "viem";
import { ARC_TESTNET } from "./contracts";

interface WalletContextType {
  address: Address | null;
  isConnected: boolean;
  walletClient: WalletClient | null;
  publicClient: any;
  connect: () => Promise<void>;
  disconnect: () => void;
  isConnecting: boolean;
  chainId: number | null;
  isWrongNetwork: boolean;
  switchToArc: () => Promise<void>;
}

const publicClient = createPublicClient({
  chain: ARC_TESTNET as any,
  transport: http("https://rpc.testnet.arc.network"),
}) as any;

const WalletContext = createContext<WalletContextType | undefined>(undefined);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [address, setAddress]           = useState<Address | null>(null);
  const [walletClient, setWalletClient] = useState<WalletClient | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [chainId, setChainId]           = useState<number | null>(null);

  const isWrongNetwork = chainId !== null && chainId !== ARC_TESTNET.id;

  useEffect(() => {
    const eth = (window as any).ethereum;
    if (!eth) return;

    const onAccountsChanged = (accounts: string[]) => {
      if (accounts.length === 0) { setAddress(null); setWalletClient(null); }
      else setAddress(accounts[0] as Address);
    };
    const onChainChanged = (id: string) => setChainId(parseInt(id, 16));

    eth.on("accountsChanged", onAccountsChanged);
    eth.on("chainChanged", onChainChanged);

    eth.request({ method: "eth_accounts" }).then((accounts: string[]) => {
      if (accounts.length > 0) {
        setAddress(accounts[0] as Address);
        const wc = createWalletClient({ chain: ARC_TESTNET as any, transport: custom(eth) });
        setWalletClient(wc);
        eth.request({ method: "eth_chainId" }).then((id: string) => setChainId(parseInt(id, 16)));
      }
    });

    return () => {
      eth.removeListener("accountsChanged", onAccountsChanged);
      eth.removeListener("chainChanged", onChainChanged);
    };
  }, []);

  const connect = async () => {
    const eth = (window as any).ethereum;
    if (!eth) { alert("MetaMask not detected. Please install MetaMask."); return; }

    setIsConnecting(true);
    try {
      const accounts: string[] = await eth.request({ method: "eth_requestAccounts" });
      const id: string = await eth.request({ method: "eth_chainId" });
      setChainId(parseInt(id, 16));
      setAddress(accounts[0] as Address);
      const wc = createWalletClient({ chain: ARC_TESTNET as any, transport: custom(eth) });
      setWalletClient(wc);
    } catch (e) {
      console.error("Connect failed", e);
    } finally {
      setIsConnecting(false);
    }
  };

  const disconnect = () => {
    setAddress(null);
    setWalletClient(null);
    setChainId(null);
  };

  const switchToArc = async () => {
    const eth = (window as any).ethereum;
    if (!eth) return;
    try {
      await eth.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: `0x${ARC_TESTNET.id.toString(16)}` }],
      });
    } catch (switchErr: any) {
      if (switchErr.code === 4902) {
        await eth.request({
          method: "wallet_addEthereumChain",
          params: [{
            chainId: `0x${ARC_TESTNET.id.toString(16)}`,
            chainName: ARC_TESTNET.name,
            nativeCurrency: ARC_TESTNET.nativeCurrency,
            rpcUrls: [ARC_TESTNET.rpcUrls.default.http[0]],
            blockExplorerUrls: [ARC_TESTNET.blockExplorers.default.url],
          }],
        });
      }
    }
  };

  return (
    <WalletContext.Provider value={{ address, isConnected: !!address, walletClient, publicClient, connect, disconnect, isConnecting, chainId, isWrongNetwork, switchToArc }}>
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet() {
  const context = useContext(WalletContext);
  if (!context) throw new Error("useWallet must be used within WalletProvider");
  return context;
}
