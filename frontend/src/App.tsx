import { useState } from "react";
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
  // ── Root pair state ──────────────────────────────────────────────────────────
  // Changing either token causes usePairPoolState to:
  //   1. Tear down the previous pair's ethers listeners (removeAllListeners + provider.destroy)
  //   2. Immediately surface the new pair's persisted sandbox state
  //   3. Re-discover the pool address from the factory (live mode)
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
    <div className="min-h-full">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">

        {/* Header */}
        <Header
          mode={mode}
          connecting={connecting}
          lastSync={lastSync}
          hasLiveConfig={hasLiveConfig}
          poolAddress={poolAddress}
          onRefresh={refresh}
        />

        {/* Tab switcher */}
        <nav className="mt-6 flex gap-1 rounded-xl bg-slate-900/60 p-1 ring-1 ring-white/10 sm:w-fit">
          <TabButton active={view === "dashboard"} onClick={() => setView("dashboard")} Icon={LayoutDashboard} label="Dashboard" />
          <TabButton active={view === "guide"} onClick={() => setView("guide")} Icon={BookOpen} label="User Guide" />
        </nav>

        {/* Error banner (dashboard only) */}
        {view === "dashboard" && error && (
          <div className="mt-4 flex items-center gap-2 rounded-xl bg-amber-500/10 px-4 py-2.5 text-xs text-amber-200 ring-1 ring-amber-500/20">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        {view === "guide" && <UserGuide />}

        {view === "dashboard" && (
          <>
        {/* ── Pair builder ────────────────────────────────────────────────────── */}
        {/* Lives between the header and stats so it reads as "instrument selection"
            rather than being buried inside a component or the header. */}
        <div className="mt-6 flex items-center justify-between gap-4 rounded-2xl bg-slate-900/40 px-5 py-4 ring-1 ring-white/5">
          <PairBuilder
            baseToken={baseToken}
            quoteToken={quoteToken}
            onBaseChange={setBaseToken}
            onQuoteChange={setQuoteToken}
          />
          <p className="hidden text-[11px] text-slate-600 sm:block">
            {TOKEN_REGISTRY_SIZE} tokens · any combination
          </p>
        </div>

        {/* Stat cards */}
        <section className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label={`${token0.symbol} Reserve`}
            value={fmtAmount(reserve0, token0.decimals, 3)}
            sub={`${baseToken.name} pooled`}
            Icon={Droplets}
            tone="sky"
          />
          <StatCard
            label={`${token1.symbol} Reserve`}
            value={fmtAmount(reserve1, token1.decimals, 3)}
            sub={`${quoteToken.name} pooled`}
            Icon={Coins}
            tone="fuchsia"
          />
          <StatCard
            label="Resting Fee"
            value={bpsToPct(restingFee.feeBps)}
            sub={`${Number(restingFee.feeBps)} bps · base ${Number(restingFee.baseFeeBps)} bps`}
            Icon={Percent}
            tone="amber"
          />
          <StatCard
            label="Chaos Multiplier"
            value={`${(externalChaosMultiplier / 100).toFixed(2)}×`}
            sub={hazard.label}
            Icon={Waves}
            tone={hazard.tone as "emerald" | "yellow" | "orange" | "red"}
          />
        </section>

        {/* Main grid */}
        <section className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-5">
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
        </section>

        {/* Footer */}
        <section className="mt-6 flex flex-col items-start justify-between gap-3 rounded-2xl bg-slate-900/40 px-5 py-4 ring-1 ring-white/5 sm:flex-row sm:items-center">
          <div className="text-xs text-slate-400">
            <span className="text-slate-500">Spot price</span>{" "}
            <span className="font-medium text-slate-200">
              1 {token0.symbol} ≈{" "}
              {price
                ? price.toLocaleString(undefined, { maximumFractionDigits: 6 })
                : "—"}{" "}
              {token1.symbol}
            </span>
            <span className="mx-2 text-slate-700">·</span>
            <span className="text-slate-500">vol. accumulator</span>{" "}
            <span className="font-medium tabular-nums text-slate-200">
              {volatility.toString()}
            </span>
          </div>

          {mode === "sandbox" && (
            <button
              onClick={resetPair}
              className="flex items-center gap-1.5 rounded-lg bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-300 ring-1 ring-white/10 transition hover:bg-white/10"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Reset {baseToken.symbol} / {quoteToken.symbol}
            </button>
          )}
        </section>

        <p className="mt-6 text-center text-[11px] text-slate-600">
          Dynamic-Fee-AMM · Phase 6 Macro Console — pick any two tokens above.
          Sandbox state is preserved independently per pair.
        </p>
          </>
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
    <button
      onClick={onClick}
      className={cn(
        "flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition sm:flex-none",
        active
          ? "bg-slate-800 text-slate-100 shadow ring-1 ring-white/10"
          : "text-slate-400 hover:text-slate-200",
      )}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );
}

// Used in the pair builder caption without importing the full array.
import { TOKEN_REGISTRY } from "./config/tokenRegistry.js";
const TOKEN_REGISTRY_SIZE = TOKEN_REGISTRY.length;
