import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Activity, RefreshCw, Radio, FlaskConical, Wallet, ChevronDown, LogOut, ArrowLeftRight } from "lucide-react";
import { cn } from "../lib/cn.js";
import { useWallet } from "../wallet/WalletContext.js";

interface HeaderProps {
  mode:          "live" | "sandbox";
  connecting:    boolean;
  lastSync:      Date | null;
  hasLiveConfig: boolean;
  poolAddress:   string | null;
  onRefresh:     () => void;
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

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!menuOpen) return;
    function handle(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [menuOpen]);

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
        {/* Live / Sandbox badge */}
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
            ? <Radio        className="h-3.5 w-3.5" />
            : <FlaskConical className="h-3.5 w-3.5" />
          }
          {isLive
            ? `Live · ${shortAddr(poolAddress) ?? "connecting…"}`
            : "Sandbox"
          }
        </div>

        {/* Refresh */}
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

        {/* Last sync timestamp */}
        {lastSync && (
          <span className="hidden text-[11px] text-muted-foreground sm:inline">
            synced {lastSync.toLocaleTimeString()}
          </span>
        )}

        {/* Wallet section — only relevant in live mode */}
        {hasLiveConfig && wallet.hasWallet && (
          wallet.account ? (
            /* ── Connected: address button + switch/disconnect dropdown ── */
            <div ref={menuRef} className="relative">
              <motion.button
                onClick={() => setMenuOpen((v) => !v)}
                className={cn(
                  "flex items-center gap-2 rounded-full bg-muted/50 border px-3 py-1.5 text-xs font-medium text-foreground transition",
                  menuOpen
                    ? "border-blue-500/50 bg-muted"
                    : "border-border/50 hover:bg-muted",
                )}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
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
                <ChevronDown
                  className={cn(
                    "h-3 w-3 text-muted-foreground transition-transform duration-200",
                    menuOpen && "rotate-180",
                  )}
                />
              </motion.button>

              <AnimatePresence>
                {menuOpen && (
                  <motion.div
                    className="absolute right-0 top-full z-50 mt-2 w-44 overflow-hidden rounded-xl border border-border/50 bg-card shadow-2xl shadow-black/40"
                    initial={{ opacity: 0, y: -6, scale: 0.97 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -6, scale: 0.97 }}
                    transition={{ type: "spring", stiffness: 380, damping: 30 }}
                  >
                    {/* Account info */}
                    <div className="border-b border-border/30 px-4 py-2.5">
                      <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                        Connected
                      </p>
                      <p className="mt-0.5 font-mono text-xs text-foreground">
                        {shortAddr(wallet.account)}
                      </p>
                    </div>

                    {/* Switch account */}
                    <motion.button
                      onClick={() => { setMenuOpen(false); wallet.switchAccount(); }}
                      disabled={wallet.connecting}
                      className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm text-muted-foreground transition hover:bg-muted/50 hover:text-foreground disabled:opacity-50"
                      whileHover={{ x: 2 }}
                    >
                      <ArrowLeftRight className="h-3.5 w-3.5 shrink-0" />
                      Switch Account
                    </motion.button>

                    <div className="border-t border-border/30" />

                    {/* Disconnect */}
                    <motion.button
                      onClick={() => { setMenuOpen(false); wallet.disconnect(); }}
                      className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm text-red-400 transition hover:bg-red-500/10 hover:text-red-300"
                      whileHover={{ x: 2 }}
                    >
                      <LogOut className="h-3.5 w-3.5 shrink-0" />
                      Disconnect
                    </motion.button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ) : (
            /* ── Not connected ── */
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
