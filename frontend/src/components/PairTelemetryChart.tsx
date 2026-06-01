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

// ─── Fee response curve ────────────────────────────────────────────────────────

function buildCurveData(state: PoolDataState) {
  const { reserve0, volatility, lastTimestamp, externalChaosMultiplier } = state;
  const timeElapsed = Math.max(0, Math.floor(Date.now() / 1000) - lastTimestamp);
  return Array.from({ length: 41 }, (_, i) => {
    const pct = i * 2; // 0 → 80 in steps of 2
    const amt = (reserve0 * BigInt(pct)) / 100n;
    const base   = calculateDynamicFee({ amountIn: amt, reserveIn: reserve0, volatility, timeElapsed, multiplier: 100 });
    const scaled = calculateDynamicFee({ amountIn: amt, reserveIn: reserve0, volatility, timeElapsed, multiplier: externalChaosMultiplier });
    return { size: pct, base: Number(base.feeBps), scaled: Number(scaled.feeBps) };
  });
}

// ─── Shared chart theme ────────────────────────────────────────────────────────

const AXIS = {
  tick: { fill: "#64748b", fontSize: 11 },
  tickLine: false as const,
  axisLine: { stroke: "#1e293b" },
};
const TT_STYLE = {
  contentStyle: {
    background: "#0f172a", border: "1px solid #1e293b",
    borderRadius: 12, fontSize: 12, color: "#e2e8f0",
  },
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function PairTelemetryChart({ state, feeHistory, baseToken, quoteToken }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>("history");

  const curveData = useMemo(
    () => buildCurveData(state),
    [state.reserve0, state.volatility, state.lastTimestamp, state.externalChaosMultiplier],
  );

  return (
    <div className="flex h-full flex-col rounded-2xl bg-slate-900/60 ring-1 ring-white/10 backdrop-blur">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/5 px-5 pt-5 pb-0">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-fuchsia-300" />
          <h2 className="text-sm font-semibold text-slate-200">
            {baseToken.symbol}
            <span className="mx-1 text-slate-500">/</span>
            {quoteToken.symbol}
            <span className="ml-2 text-slate-500 font-normal">Analytics</span>
          </h2>
        </div>
        <div className="flex gap-1 rounded-lg bg-slate-950/60 p-1">
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

// ─── Trade History ─────────────────────────────────────────────────────────────

function HistoryChart({
  feeHistory, baseToken, quoteToken,
}: { feeHistory: FeeHistoryPoint[]; baseToken: TokenConfig; quoteToken: TokenConfig }) {
  if (feeHistory.length === 0) {
    return (
      <div className="flex h-72 flex-col items-center justify-center gap-3 text-slate-500">
        <Activity className="h-8 w-8 opacity-30" />
        <p className="text-sm">
          No trades yet for {baseToken.symbol} / {quoteToken.symbol}.
        </p>
        <p className="text-xs">Simulate a swap to see fee and volatility telemetry.</p>
      </div>
    );
  }

  const maxVol   = Math.max(...feeHistory.map((p) => p.volatility), 1);
  const chartData = feeHistory.map((p) => ({
    ...p, volNorm: (p.volatility / maxVol) * 150,
  }));

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
              <stop offset="0%"   stopColor="#38bdf8" stopOpacity={0.25} />
              <stop offset="100%" stopColor="#38bdf8" stopOpacity={0}    />
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
          <Area type="monotone" dataKey="baseFeeBps" stroke="#38bdf8" strokeWidth={1.5} fill="url(#hBase)" dot={false} />
          <Area type="monotone" dataKey="feeBps"     stroke="#f59e0b" strokeWidth={2}   fill="url(#hFee)"  dot={false} />
          <Line type="monotone" dataKey="volNorm"    stroke="#d946ef" strokeWidth={1.5} strokeDasharray="4 3" dot={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── Fee Response Curve ────────────────────────────────────────────────────────

function CurveChart({ data, multiplier }: { data: { size: number; base: number; scaled: number }[]; multiplier: number }) {
  return (
    <div className="h-72 w-full">
      <div className="mb-2 flex justify-end">
        <span className="text-xs text-slate-500">base 1.0× vs current {(multiplier / 100).toFixed(2)}×</span>
      </div>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
          <defs>
            <linearGradient id="cScaled" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor="#d946ef" stopOpacity={0.35} />
              <stop offset="100%" stopColor="#d946ef" stopOpacity={0}    />
            </linearGradient>
            <linearGradient id="cBase" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor="#38bdf8" stopOpacity={0.25} />
              <stop offset="100%" stopColor="#38bdf8" stopOpacity={0}    />
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
          <Area type="monotone" dataKey="base"   stroke="#38bdf8" strokeWidth={2} fill="url(#cBase)"   dot={false} />
          <Area type="monotone" dataKey="scaled" stroke="#d946ef" strokeWidth={2} fill="url(#cScaled)" dot={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── Tab button ───────────────────────────────────────────────────────────────

function TabBtn({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-md px-3 py-1.5 text-xs font-medium transition",
        active ? "bg-slate-800 text-slate-100 shadow" : "text-slate-500 hover:text-slate-300",
      )}
    >
      {label}
    </button>
  );
}
