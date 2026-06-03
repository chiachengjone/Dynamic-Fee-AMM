import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Activity, TrendingUp } from "lucide-react";
import { cn } from "../lib/cn.js";
import { calculateDynamicFee } from "../lib/amm.js";
import type { PoolDataState, FeeHistoryPoint } from "../hooks/usePairPoolState.js";
import type { TokenConfig } from "../config/tokenRegistry.js";

type Tab = "history" | "curve";

interface Props {
  state:      PoolDataState;
  feeHistory: FeeHistoryPoint[];
  baseToken:  TokenConfig;
  quoteToken: TokenConfig;
}

function buildCurveData(state: PoolDataState) {
  const { reserve0, volatility, lastTimestamp, externalChaosMultiplier } = state;
  const timeElapsed = Math.max(0, Math.floor(Date.now() / 1000) - lastTimestamp);
  return Array.from({ length: 41 }, (_, i) => {
    const pct = i * 2;
    const amt = (reserve0 * BigInt(pct)) / 100n;
    const base   = calculateDynamicFee({ amountIn: amt, reserveIn: reserve0, volatility, timeElapsed, multiplier: 100 });
    const scaled = calculateDynamicFee({ amountIn: amt, reserveIn: reserve0, volatility, timeElapsed, multiplier: externalChaosMultiplier });
    return { size: pct, base: Number(base.feeBps), scaled: Number(scaled.feeBps) };
  });
}

const AXIS = {
  tick: { fill: "#64748b", fontSize: 11 },
  tickLine: false as const,
  axisLine: { stroke: "#1e293b" },
};
const TT_STYLE = {
  contentStyle: {
    background: "#0f172a", border: "1px solid #334155",
    borderRadius: 12, fontSize: 12, color: "#e2e8f0",
  },
};

export default function PairTelemetryChart({ state, feeHistory, baseToken, quoteToken }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>("history");

  const curveData = useMemo(
    () => buildCurveData(state),
    [state.reserve0, state.volatility, state.lastTimestamp, state.externalChaosMultiplier],
  );

  return (
    <div className="flex h-full flex-col rounded-3xl bg-card/80 backdrop-blur-xl border border-border/50 shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/30 px-5 pt-5 pb-0">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 bg-gradient-to-r from-purple-500/20 to-fuchsia-500/20 border border-purple-500/30 rounded-lg flex items-center justify-center">
            <TrendingUp className="h-3.5 w-3.5 text-purple-300" />
          </div>
          <h2 className="text-sm font-semibold text-foreground">
            {baseToken.symbol}
            <span className="mx-1 text-muted-foreground">/</span>
            {quoteToken.symbol}
            <span className="ml-2 text-muted-foreground font-normal">Analytics</span>
          </h2>
        </div>
        <div className="flex gap-1 rounded-xl bg-muted/50 border border-border/30 p-1">
          <TabBtn active={activeTab === "history"} onClick={() => setActiveTab("history")} label="Trade History" />
          <TabBtn active={activeTab === "curve"}   onClick={() => setActiveTab("curve")}   label="Fee Curve"     />
        </div>
      </div>

      <div className="flex-1 p-5">
        {activeTab === "history"
          ? <HistoryChart feeHistory={feeHistory} baseToken={baseToken} quoteToken={quoteToken} />
          : <CurveChart   data={curveData} multiplier={state.externalChaosMultiplier} />
        }
      </div>
    </div>
  );
}

function HistoryChart({
  feeHistory, baseToken, quoteToken,
}: { feeHistory: FeeHistoryPoint[]; baseToken: TokenConfig; quoteToken: TokenConfig }) {
  if (feeHistory.length === 0) {
    return (
      <div className="flex h-72 flex-col items-center justify-center gap-3 text-muted-foreground">
        <Activity className="h-8 w-8 opacity-30" />
        <p className="text-sm">
          No trades yet for {baseToken.symbol} / {quoteToken.symbol}.
        </p>
        <p className="text-xs text-muted-foreground/60">Simulate a swap to see fee and volatility telemetry.</p>
      </div>
    );
  }

  const maxVol   = Math.max(...feeHistory.map((p) => p.volatility), 1);
  const chartData = feeHistory.map((p) => ({ ...p, volNorm: (p.volatility / maxVol) * 150 }));

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={chartData} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
          <defs>
            <linearGradient id="hFee"  x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor="#f59e0b" stopOpacity={0.35} />
              <stop offset="100%" stopColor="#f59e0b" stopOpacity={0}    />
            </linearGradient>
            <linearGradient id="hBase" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor="#3b82f6" stopOpacity={0.25} />
              <stop offset="100%" stopColor="#3b82f6" stopOpacity={0}    />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
          <XAxis dataKey="tradeIdx" {...AXIS} label={{ value: "Trade #", position: "insideBottomRight", offset: -4, fill: "#475569", fontSize: 10 }} />
          <YAxis domain={[0, 160]} {...AXIS} unit=" bps" width={56} />
          <Tooltip {...TT_STYLE} labelFormatter={(v) => `Trade #${v}`}
            formatter={(value: number, name: string) => {
              if (name === "feeBps")     return [`${value} bps`, "Scaled fee"];
              if (name === "baseFeeBps") return [`${value} bps`, "Base fee (1.0×)"];
              if (name === "volNorm")    return [value.toFixed(0), "Volatility (norm.)"];
              return [value, name];
            }}
          />
          <Legend verticalAlign="top" height={28} iconType="plainline"
            formatter={(n: string) =>
              n === "feeBps" ? "Scaled fee" : n === "baseFeeBps" ? "Base fee (1.0×)" : "Volatility (norm.)"
            }
            wrapperStyle={{ fontSize: 12, color: "#94a3b8" }}
          />
          <Area type="monotone" dataKey="baseFeeBps" stroke="#3b82f6" strokeWidth={1.5} fill="url(#hBase)" dot={false} />
          <Area type="monotone" dataKey="feeBps"     stroke="#f59e0b" strokeWidth={2}   fill="url(#hFee)"  dot={false} />
          <Line type="monotone" dataKey="volNorm"    stroke="#a855f7" strokeWidth={1.5} strokeDasharray="4 3" dot={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function CurveChart({ data, multiplier }: { data: { size: number; base: number; scaled: number }[]; multiplier: number }) {
  return (
    <div className="h-72 w-full">
      <div className="mb-2 flex justify-end">
        <span className="text-xs text-muted-foreground">base 1.0× vs current {(multiplier / 100).toFixed(2)}×</span>
      </div>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
          <defs>
            <linearGradient id="cScaled" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor="#a855f7" stopOpacity={0.35} />
              <stop offset="100%" stopColor="#a855f7" stopOpacity={0}    />
            </linearGradient>
            <linearGradient id="cBase" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor="#3b82f6" stopOpacity={0.25} />
              <stop offset="100%" stopColor="#3b82f6" stopOpacity={0}    />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
          <XAxis dataKey="size" {...AXIS} unit="%" />
          <YAxis domain={[0, 160]} {...AXIS} unit=" bps" width={56} />
          <Tooltip {...TT_STYLE}
            labelFormatter={(v) => `Trade size: ${v}% of reserve`}
            formatter={(value: number, name: string) => [
              `${value} bps`,
              name === "scaled" ? "Current (macro-scaled)" : "Base (1.0×)",
            ]}
          />
          <Legend verticalAlign="top" height={28} iconType="plainline"
            formatter={(n: string) => n === "scaled" ? "Current (macro-scaled)" : "Base (1.0×)"}
            wrapperStyle={{ fontSize: 12, color: "#94a3b8" }}
          />
          <Area type="monotone" dataKey="base"   stroke="#3b82f6" strokeWidth={2} fill="url(#cBase)"   dot={false} />
          <Area type="monotone" dataKey="scaled" stroke="#a855f7" strokeWidth={2} fill="url(#cScaled)" dot={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function TabBtn({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-lg px-3 py-1.5 text-xs font-medium transition",
        active
          ? "bg-gradient-to-r from-blue-500/20 to-purple-500/20 text-foreground border border-border/50 shadow"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
}
