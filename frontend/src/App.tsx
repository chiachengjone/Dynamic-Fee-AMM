import { useState } from "react";
import { motion } from "framer-motion";
import { Coins, Droplets, Percent, Waves, RotateCcw, AlertTriangle, LayoutDashboard, BookOpen } from "lucide-react";
import { DEFAULT_BASE, DEFAULT_QUOTE, type TokenConfig } from "./config/tokenRegistry.js";
import { usePairPoolState } from "./hooks/usePairPoolState.js";
import { useMacroPipeline } from "./hooks/useMacroPipeline.js";
import { quoteSwap, fmtAmount, bpsToPct, spotPrice, hazardLabel } from "./lib/amm.js";
import { cn } from "./lib/cn.js";
import Header           from "./components/Header.js";
import PairBuilder      from "./components/PairBuilder.js";
import StatCard         from "./components/StatCard.jsx";
import SwapPanel        from "./components/SwapPanel.js";
import PairTelemetryChart from "./components/PairTelemetryChart.js";
import MultiplierControl from "./components/MultiplierControl.js";
import UserGuide        from "./components/UserGuide.js";
import { WalletProvider } from "./wallet/WalletContext.js";

type View = "dashboard" | "guide";

export default function App() {
  const [baseToken,  setBaseToken]  = useState<TokenConfig>(DEFAULT_BASE);
  const [quoteToken, setQuoteToken] = useState<TokenConfig>(DEFAULT_QUOTE);
  const [view, setView] = useState<View>("dashboard");

  const {
    score:     pipelineScore,
    connected: pipelineConnected,
    lastFetch: pipelineLastFetch,
  } = useMacroPipeline();

  const {
    state,
    feeHistory,
    mode,
    error,
    lastSync,
    connecting,
    hasLiveConfig,
    poolAddress,
    refresh,
    applySwap,
    recordTrade,
    setMultiplier,
    resetPair,
  } = usePairPoolState(baseToken, quoteToken);

  const {
    token0, token1,
    reserve0, reserve1,
    externalChaosMultiplier,
    volatility,
    lastTimestamp,
  } = state;

  const restingFee = quoteSwap({
    amountIn:    1n,
    reserveIn:   reserve0,
    reserveOut:  reserve1,
    volatility,
    timeElapsed: Math.max(0, Math.floor(Date.now() / 1000) - lastTimestamp),
    multiplier:  externalChaosMultiplier,
  });

  const price  = spotPrice(reserve0, reserve1, token0.decimals, token1.decimals);
  const hazard = hazardLabel(externalChaosMultiplier);

  return (
    <WalletProvider>
      <div className="min-h-full relative">

        {/* Animated background blobs */}
        <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
          <div className="absolute -top-60 -right-60 h-[500px] w-[500px] rounded-full bg-blue-500/8 blur-3xl" />
          <div className="absolute -bottom-60 -left-60 h-[500px] w-[500px] rounded-full bg-purple-500/8 blur-3xl" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-96 w-96 rounded-full bg-indigo-500/5 blur-3xl" />
        </div>

        <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">

          <Header
            mode={mode}
            connecting={connecting}
            lastSync={lastSync}
            hasLiveConfig={hasLiveConfig}
            poolAddress={poolAddress}
            onRefresh={refresh}
          />

          {/* Tab switcher */}
          <motion.nav
            className="mt-6 flex gap-1 rounded-2xl bg-card/80 backdrop-blur-xl border border-border/50 p-1 shadow-xl sm:w-fit"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1, type: "spring", stiffness: 300, damping: 30 }}
          >
            <TabButton active={view === "dashboard"} onClick={() => setView("dashboard")} Icon={LayoutDashboard} label="Dashboard" />
            <TabButton active={view === "guide"} onClick={() => setView("guide")} Icon={BookOpen} label="User Guide" />
          </motion.nav>

          {/* Error banner */}
          {view === "dashboard" && error && (
            <motion.div
              className="mt-4 flex items-center gap-2 rounded-xl bg-amber-500/10 px-4 py-2.5 text-xs text-amber-200 border border-amber-500/20"
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <AlertTriangle className="h-4 w-4 shrink-0" />
              {error}
            </motion.div>
          )}

          {view === "guide" && <UserGuide />}

          {view === "dashboard" && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.3 }}
            >
              {/* Pair builder — z-20 keeps the token-selector dropdown above the stat cards' backdrop-blur stacking contexts */}
              <motion.div
                className="mt-6 flex items-center justify-between gap-4 rounded-2xl bg-card/80 backdrop-blur-xl border border-border/50 px-5 py-4 shadow-xl relative z-20"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15, type: "spring", stiffness: 300, damping: 30 }}
              >
                <PairBuilder
                  baseToken={baseToken}
                  quoteToken={quoteToken}
                  onBaseChange={setBaseToken}
                  onQuoteChange={setQuoteToken}
                />
                <p className="hidden text-[11px] text-muted-foreground sm:block">
                  {TOKEN_REGISTRY_SIZE} tokens · any combination
                </p>
              </motion.div>

              {/* Stat cards */}
              <motion.section
                className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
                initial="hidden"
                animate="visible"
                variants={{ visible: { transition: { staggerChildren: 0.07, delayChildren: 0.2 } } }}
              >
                {[
                  { label: `${token0.symbol} Reserve`, value: fmtAmount(reserve0, token0.decimals, 3), sub: `${baseToken.name} pooled`, Icon: Droplets, tone: "sky" as const },
                  { label: `${token1.symbol} Reserve`, value: fmtAmount(reserve1, token1.decimals, 3), sub: `${quoteToken.name} pooled`, Icon: Coins, tone: "fuchsia" as const },
                  { label: "Resting Fee", value: bpsToPct(restingFee.feeBps), sub: `${Number(restingFee.feeBps)} bps · base ${Number(restingFee.baseFeeBps)} bps`, Icon: Percent, tone: "amber" as const },
                  { label: "Chaos Multiplier", value: `${(externalChaosMultiplier / 100).toFixed(2)}×`, sub: hazard.label, Icon: Waves, tone: hazard.tone as "emerald" | "yellow" | "orange" | "red" },
                ].map((card) => (
                  <StatCard key={card.label} {...card} />
                ))}
              </motion.section>

              {/* Main grid */}
              <motion.section
                className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-5"
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.35, type: "spring", stiffness: 250, damping: 30 }}
              >
                <div className="space-y-6 lg:col-span-2">
                  <SwapPanel
                    state={state}
                    mode={mode}
                    onSimulate={applySwap}
                    poolAddress={poolAddress}
                    onSwapped={refresh}
                    onRecordTrade={recordTrade}
                  />
                  <MultiplierControl
                    multiplier={externalChaosMultiplier}
                    mode={mode}
                    onChange={setMultiplier}
                    pipelineScore={pipelineScore}
                    pipelineConnected={pipelineConnected}
                    pipelineLastFetch={pipelineLastFetch}
                  />
                </div>
                <div className="lg:col-span-3">
                  <PairTelemetryChart
                    state={state}
                    feeHistory={feeHistory}
                    baseToken={baseToken}
                    quoteToken={quoteToken}
                  />
                </div>
              </motion.section>

              {/* Footer */}
              <motion.section
                className="mt-6 flex flex-col items-start justify-between gap-3 rounded-2xl bg-card/80 backdrop-blur-xl border border-border/50 px-5 py-4 shadow-xl sm:flex-row sm:items-center"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.45, type: "spring", stiffness: 250, damping: 30 }}
              >
                <div className="text-xs text-muted-foreground">
                  <span className="text-muted-foreground/60">Spot price</span>{" "}
                  <span className="font-medium text-foreground">
                    1 {token0.symbol} ≈{" "}
                    {price
                      ? price.toLocaleString(undefined, { maximumFractionDigits: 6 })
                      : "—"}{" "}
                    {token1.symbol}
                  </span>
                  <span className="mx-2 text-border">·</span>
                  <span className="text-muted-foreground/60">vol. accumulator</span>{" "}
                  <span className="font-medium tabular-nums text-foreground">
                    {volatility.toString()}
                  </span>
                </div>

                {mode === "sandbox" && (
                  <motion.button
                    onClick={resetPair}
                    className="flex items-center gap-1.5 rounded-lg bg-muted/50 border border-border/50 px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground"
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    Reset {baseToken.symbol} / {quoteToken.symbol}
                  </motion.button>
                )}
              </motion.section>

              <p className="mt-6 text-center text-[11px] text-muted-foreground/50">
                Dynamic-Fee-AMM · Phase 6 Macro Console — pick any two tokens above.
                Sandbox state is preserved independently per pair.
              </p>
            </motion.div>
          )}
        </div>
      </div>
    </WalletProvider>
  );
}

function TabButton({
  active, onClick, Icon, label,
}: {
  active: boolean;
  onClick: () => void;
  Icon: React.ComponentType<{ className?: string }>;
  label: string;
}) {
  return (
    <motion.button
      onClick={onClick}
      className={cn(
        "flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition sm:flex-none",
        active
          ? "bg-gradient-to-r from-blue-500 to-purple-600 text-white shadow"
          : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
      )}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
    >
      <Icon className="h-4 w-4" />
      {label}
    </motion.button>
  );
}

import { TOKEN_REGISTRY } from "./config/tokenRegistry.js";
const TOKEN_REGISTRY_SIZE = TOKEN_REGISTRY.length;
