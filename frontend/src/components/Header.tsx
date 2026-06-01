import { Activity, RefreshCw, Radio, FlaskConical, Wallet } from "lucide-react";
import { cn } from "../lib/cn.js";
import { useWallet } from "../wallet/WalletContext.js";

interface HeaderProps {
  mode:         "live" | "sandbox";
  connecting:   boolean;
  lastSync:     Date | null;
  hasLiveConfig: boolean;
  poolAddress:  string | null;
  onRefresh:    () => void;
}

function shortAddr(a: string | null) {
  if (!a) return null;
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

export default function Header({
  mode, connecting, lastSync, hasLiveConfig, poolAddress, onRefresh,
}: HeaderProps) {
  const isLive = mode === "live";
  const wallet = useWallet();

  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        <div className="grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br from-sky-500/20 to-fuchsia-500/20 ring-1 ring-white/10">
          <Activity className="h-6 w-6 text-sky-300" />
        </div>
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-slate-100">
            Dynamic-Fee-AMM <span className="text-slate-400">· Macro Console</span>
          </h1>
          <p className="text-xs text-slate-500">
            Volatility-responsive fees scaled by off-chain macro telemetry
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div
          className={cn(
            "flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium ring-1",
            isLive
              ? "bg-emerald-500/10 text-emerald-300 ring-emerald-500/30"
              : "bg-amber-500/10  text-amber-300  ring-amber-500/30",
          )}
          title={
            isLive
              ? `Polling pool ${poolAddress ?? ""} on-chain`
              : hasLiveConfig
                ? "Configured node unreachable — simulating locally"
                : "No VITE_RPC_URL set — simulating locally"
          }
        >
          {isLive
            ? <Radio       className="h-3.5 w-3.5" />
            : <FlaskConical className="h-3.5 w-3.5" />
          }
          {isLive
            ? `Live · ${shortAddr(poolAddress) ?? "connecting…"}`
            : "Sandbox"
          }
        </div>

        {hasLiveConfig && (
          <button
            onClick={onRefresh}
            disabled={connecting}
            className="flex items-center gap-2 rounded-full bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-300 ring-1 ring-white/10 transition hover:bg-white/10 disabled:opacity-50"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", connecting && "animate-spin")} />
            {connecting ? "Syncing" : "Refresh"}
          </button>
        )}

        {lastSync && (
          <span className="hidden text-[11px] text-slate-500 sm:inline">
            synced {lastSync.toLocaleTimeString()}
          </span>
        )}

        {/* Wallet — only relevant when connected to a live chain */}
        {hasLiveConfig && wallet.hasWallet && (
          wallet.account ? (
            <div
              className="flex items-center gap-2 rounded-full bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-200 ring-1 ring-white/10"
              title={
                wallet.isCorrectNetwork
                  ? `Connected · ${wallet.account}`
                  : "Wrong network — switch to Sepolia"
              }
            >
              <span
                className={cn(
                  "h-2 w-2 rounded-full",
                  wallet.isCorrectNetwork ? "bg-emerald-400" : "bg-amber-400",
                )}
              />
              {shortAddr(wallet.account)}
            </div>
          ) : (
            <button
              onClick={wallet.connect}
              disabled={wallet.connecting}
              className="flex items-center gap-2 rounded-full bg-sky-500/15 px-3 py-1.5 text-xs font-medium text-sky-300 ring-1 ring-sky-500/30 transition hover:bg-sky-500/25 disabled:opacity-50"
            >
              <Wallet className="h-3.5 w-3.5" />
              {wallet.connecting ? "Connecting…" : "Connect Wallet"}
            </button>
          )
        )}
      </div>
    </header>
  );
}
