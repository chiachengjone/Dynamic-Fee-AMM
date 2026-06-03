import { motion } from "framer-motion";
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
    <motion.header
      className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"
      initial={{ opacity: 0, y: -16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
    >
      <div className="flex items-center gap-3">
        <motion.div
          className="grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br from-blue-500/20 to-purple-500/20 border border-border/50"
          whileHover={{ scale: 1.1, rotate: 5 }}
          transition={{ type: "spring", stiffness: 400, damping: 25 }}
        >
          <Activity className="h-6 w-6 text-blue-300" />
        </motion.div>
        <div>
          <h1 className="text-lg font-bold tracking-tight text-foreground">
            Dynamic-Fee-AMM <span className="text-muted-foreground font-normal">· Macro Console</span>
          </h1>
          <p className="text-xs text-muted-foreground">
            Volatility-responsive fees scaled by off-chain macro telemetry
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div
          className={cn(
            "flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium border",
            isLive
              ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/30"
              : "bg-amber-500/10  text-amber-300  border-amber-500/30",
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
          <motion.button
            onClick={onRefresh}
            disabled={connecting}
            className="flex items-center gap-2 rounded-full bg-muted/50 border border-border/50 px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-50"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            <RefreshCw className={cn("h-3.5 w-3.5", connecting && "animate-spin")} />
            {connecting ? "Syncing" : "Refresh"}
          </motion.button>
        )}

        {lastSync && (
          <span className="hidden text-[11px] text-muted-foreground sm:inline">
            synced {lastSync.toLocaleTimeString()}
          </span>
        )}

        {hasLiveConfig && wallet.hasWallet && (
          wallet.account ? (
            <div
              className="flex items-center gap-2 rounded-full bg-muted/50 border border-border/50 px-3 py-1.5 text-xs font-medium text-foreground"
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
            <motion.button
              onClick={wallet.connect}
              disabled={wallet.connecting}
              className="flex items-center gap-2 rounded-full bg-gradient-to-r from-blue-500/20 to-purple-500/20 border border-blue-500/30 px-3 py-1.5 text-xs font-medium text-blue-300 transition hover:from-blue-500/30 hover:to-purple-500/30 disabled:opacity-50"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              <Wallet className="h-3.5 w-3.5" />
              {wallet.connecting ? "Connecting…" : "Connect Wallet"}
            </motion.button>
          )
        )}
      </div>
    </motion.header>
  );
}
