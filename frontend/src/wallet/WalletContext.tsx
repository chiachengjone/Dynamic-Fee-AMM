/**
 * WalletContext — MetaMask (EIP-1193) connection state shared across the app.
 *
 * Provides the connected account, chain id, network correctness, and a signer
 * factory for write transactions. Deliberately minimal: MetaMask only, single
 * account, with graceful no-ops when no wallet is installed.
 *
 * The target chain defaults to Sepolia (11155111) and can be overridden with
 * VITE_CHAIN_ID. switchNetwork() asks the wallet to switch, adding the chain
 * if the wallet doesn't know it yet (error 4902).
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { ethers } from "ethers";

const TARGET_CHAIN_ID = Number(import.meta.env.VITE_CHAIN_ID) || 11155111; // Sepolia
const TARGET_CHAIN_HEX = "0x" + TARGET_CHAIN_ID.toString(16);

// Parameters used to register Sepolia if the wallet doesn't have it.
const SEPOLIA_PARAMS = {
  chainId: "0xaa36a7",
  chainName: "Sepolia",
  nativeCurrency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: ["https://rpc.sepolia.org"],
  blockExplorerUrls: ["https://sepolia.etherscan.io"],
};

interface WalletState {
  /** Connected account address, or null. */
  account: string | null;
  /** Current wallet chain id (decimal), or null. */
  chainId: number | null;
  /** True when the wallet is on the target chain. */
  isCorrectNetwork: boolean;
  /** True while a connect/switch request is in flight. */
  connecting: boolean;
  /** True if a wallet provider is detected in the page. */
  hasWallet: boolean;
  error: string | null;
  targetChainId: number;
  connect: () => Promise<void>;
  switchNetwork: () => Promise<void>;
  /** Returns an ethers signer for the connected account. */
  getSigner: () => Promise<ethers.JsonRpcSigner>;
}

const WalletCtx = createContext<WalletState | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const hasWallet = typeof window !== "undefined" && !!window.ethereum;

  const [account, setAccount]     = useState<string | null>(null);
  const [chainId, setChainId]     = useState<number | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError]         = useState<string | null>(null);

  // ── Provider helper ───────────────────────────────────────────────────────
  const getBrowserProvider = useCallback(() => {
    if (!window.ethereum) throw new Error("No wallet detected");
    return new ethers.BrowserProvider(window.ethereum);
  }, []);

  const getSigner = useCallback(async () => {
    const provider = getBrowserProvider();
    return provider.getSigner();
  }, [getBrowserProvider]);

  // ── Read current account + chain on mount (without prompting) ─────────────
  useEffect(() => {
    if (!hasWallet) return;
    let cancelled = false;

    (async () => {
      try {
        const provider = getBrowserProvider();
        const accounts = (await window.ethereum!.request({
          method: "eth_accounts",
        })) as string[];
        const net = await provider.getNetwork();
        if (cancelled) return;
        setAccount(accounts[0] ?? null);
        setChainId(Number(net.chainId));
      } catch {
        /* wallet present but not yet authorized — fine */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [hasWallet, getBrowserProvider]);

  // ── Subscribe to wallet events ────────────────────────────────────────────
  useEffect(() => {
    const eth = window.ethereum;
    if (!eth?.on || !eth.removeListener) return;

    const onAccounts = (...args: unknown[]) => {
      const accounts = args[0] as string[];
      setAccount(accounts?.[0] ?? null);
    };
    const onChain = (...args: unknown[]) => {
      const hexId = args[0] as string;
      setChainId(Number.parseInt(hexId, 16));
    };

    eth.on("accountsChanged", onAccounts);
    eth.on("chainChanged", onChain);
    return () => {
      eth.removeListener?.("accountsChanged", onAccounts);
      eth.removeListener?.("chainChanged", onChain);
    };
  }, [hasWallet]);

  // ── Connect ───────────────────────────────────────────────────────────────
  const connect = useCallback(async () => {
    if (!hasWallet) {
      setError("No wallet detected. Install MetaMask to trade live.");
      return;
    }
    setConnecting(true);
    setError(null);
    try {
      const accounts = (await window.ethereum!.request({
        method: "eth_requestAccounts",
      })) as string[];
      const provider = getBrowserProvider();
      const net = await provider.getNetwork();
      setAccount(accounts[0] ?? null);
      setChainId(Number(net.chainId));
    } catch (err: unknown) {
      setError((err as { message?: string })?.message ?? "Connection rejected");
    } finally {
      setConnecting(false);
    }
  }, [hasWallet, getBrowserProvider]);

  // ── Switch / add network ──────────────────────────────────────────────────
  const switchNetwork = useCallback(async () => {
    if (!hasWallet) return;
    setError(null);
    try {
      await window.ethereum!.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: TARGET_CHAIN_HEX }],
      });
    } catch (err: unknown) {
      // 4902 = chain not added to the wallet yet.
      if ((err as { code?: number })?.code === 4902 && TARGET_CHAIN_ID === 11155111) {
        try {
          await window.ethereum!.request({
            method: "wallet_addEthereumChain",
            params: [SEPOLIA_PARAMS],
          });
        } catch (addErr: unknown) {
          setError((addErr as { message?: string })?.message ?? "Could not add network");
        }
      } else {
        setError((err as { message?: string })?.message ?? "Could not switch network");
      }
    }
  }, [hasWallet]);

  const value = useMemo<WalletState>(
    () => ({
      account,
      chainId,
      isCorrectNetwork: chainId === TARGET_CHAIN_ID,
      connecting,
      hasWallet,
      error,
      targetChainId: TARGET_CHAIN_ID,
      connect,
      switchNetwork,
      getSigner,
    }),
    [account, chainId, connecting, hasWallet, error, connect, switchNetwork, getSigner],
  );

  return <WalletCtx.Provider value={value}>{children}</WalletCtx.Provider>;
}

export function useWallet(): WalletState {
  const ctx = useContext(WalletCtx);
  if (!ctx) throw new Error("useWallet must be used within a WalletProvider");
  return ctx;
}
