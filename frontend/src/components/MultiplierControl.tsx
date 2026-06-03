import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Cpu, Lock, WifiOff, ArrowDownToLine } from "lucide-react";
import { cn } from "../lib/cn.js";
import { hazardLabel } from "../lib/amm.js";
import type { PipelineScore } from "../hooks/useMacroPipeline.js";

function sentimentPenalty(fg: number): number {
  if (fg >= 50) return 0;
  return ((50 - fg) / 50) * 50;
}

function volumePenalty(shockPct: number): number {
  return Math.min(50, (Math.max(0, shockPct) / 100) * 50);
}

function deriveMultiplier(fg: number, volPct: number): number {
  return Math.max(100, Math.min(200, 100 + Math.trunc(sentimentPenalty(fg) + volumePenalty(volPct))));
}

function fgLabel(i: number) {
  if (i >= 75) return "Extreme Greed";
  if (i >= 55) return "Greed";
  if (i >= 46) return "Neutral";
  if (i >= 26) return "Fear";
  return "Extreme Fear";
}

const TONE_TEXT: Record<string, string> = {
  emerald: "text-emerald-300",
  yellow:  "text-yellow-300",
  orange:  "text-orange-300",
  red:     "text-red-300",
};
const TONE_FILL: Record<string, string> = {
  emerald: "bg-gradient-to-r from-blue-400 to-emerald-400",
  yellow:  "bg-gradient-to-r from-blue-500 to-yellow-400",
  orange:  "bg-gradient-to-r from-blue-500 via-purple-500 to-orange-400",
  red:     "bg-gradient-to-r from-blue-500 via-purple-500 to-red-500",
};

interface MultiplierControlProps {
  multiplier:        number;
  mode:              "live" | "sandbox";
  onChange:          (value: number) => void;
  pipelineScore:     PipelineScore | null;
  pipelineConnected: boolean;
  pipelineLastFetch: Date | null;
}

export default function MultiplierControl({
  multiplier, mode, onChange, pipelineScore, pipelineConnected, pipelineLastFetch,
}: MultiplierControlProps) {
  const isLive = mode === "live";

  const [fgIndex,        setFgIndex]        = useState(50);
  const [volumeShockPct, setVolumeShockPct] = useState(0);

  const sp             = sentimentPenalty(fgIndex);
  const vp             = volumePenalty(volumeShockPct);
  const compositeScore = sp + vp;
  const derivedMult    = deriveMultiplier(fgIndex, volumeShockPct);

  useEffect(() => {
    if (!isLive) onChange(derivedMult);
  }, [derivedMult, isLive, onChange]);

  const activeMultiplier = isLive ? multiplier : derivedMult;
  const { label: hazardTxt, tone } = hazardLabel(activeMultiplier);
  const barPct = ((activeMultiplier - 100) / 100) * 100;

  function applyPipeline() {
    if (!pipelineScore) return;
    setFgIndex(pipelineScore.fear_greed_index);
    setVolumeShockPct(Math.max(0, Math.round(pipelineScore.volume_excess_pct)));
  }

  return (
    <div className="rounded-3xl bg-card/80 backdrop-blur-xl border border-border/50 p-5 shadow-2xl">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-gradient-to-r from-amber-500/20 to-orange-500/20 border border-amber-500/30 rounded-lg flex items-center justify-center">
            <Cpu className="h-4 w-4 text-amber-300" />
          </div>
          <h2 className="text-sm font-semibold text-foreground">Chaos Multiplier</h2>
        </div>
        {isLive && (
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <Lock className="h-3 w-3" /> relayer-controlled
          </span>
        )}
      </div>

      {/* Active readout */}
      <div className="mt-4 flex items-end justify-between">
        <div className="flex items-baseline gap-2">
          <span className="text-4xl font-semibold tabular-nums text-foreground">
            {(activeMultiplier / 100).toFixed(2)}×
          </span>
          <span className="text-sm text-muted-foreground">({activeMultiplier})</span>
        </div>
        <span className={cn("text-sm font-medium", TONE_TEXT[tone])}>{hazardTxt}</span>
      </div>

      {/* Hazard bar */}
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted/50">
        <motion.div
          className={cn("h-full rounded-full", TONE_FILL[tone])}
          initial={{ width: 0 }}
          animate={{ width: `${Math.max(2, Math.min(100, barPct))}%` }}
          transition={{ type: "spring", stiffness: 200, damping: 30 }}
        />
      </div>

      {isLive ? (
        <div className="mt-5">
          <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Relayer Algorithm — Live Market Inputs
          </p>
          {pipelineConnected && pipelineScore ? (
            <PipelineFeedCard
              score={pipelineScore}
              lastFetch={pipelineLastFetch}
              showApply={false}
              onChainMultiplier={multiplier}
            />
          ) : (
            <PipelineDisconnected
              command="npm run dev:live"
              note="The on-chain value above is the last pushed by the relayer."
            />
          )}
        </div>
      ) : (
        <>
          <div className="mt-5">
            {pipelineConnected && pipelineScore ? (
              <PipelineFeedCard
                score={pipelineScore}
                lastFetch={pipelineLastFetch}
                showApply
                onApply={applyPipeline}
              />
            ) : (
              <PipelineDisconnected command="python macro_pipeline.py --serve" />
            )}
          </div>

          <div className="mt-5 space-y-4">
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Relayer Algorithm — Interactive
            </p>

            {/* Factor 1 — Sentiment */}
            <div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">
                  Fear &amp; Greed Index
                  <span className="ml-2 font-medium tabular-nums text-foreground">{fgIndex}</span>
                  <span className="ml-1.5 text-muted-foreground">({fgLabel(fgIndex)})</span>
                </span>
                <span className={cn("tabular-nums font-medium", sp > 0 ? "text-orange-300" : "text-muted-foreground")}>
                  {sp > 0 ? `+${sp.toFixed(1)} pts` : "0 pts"}
                </span>
              </div>
              <input
                type="range" min={0} max={100} step={1} value={fgIndex}
                onChange={(e) => setFgIndex(Number(e.target.value))}
                className="mt-1.5 w-full cursor-pointer"
                aria-label="Fear and Greed index"
                style={{ accentColor: sp > 0 ? "#f97316" : "#475569" }}
              />
              <div className="mt-0.5 flex justify-between text-[10px] text-muted-foreground/50">
                <span>0 — Extreme Fear (+50 pts)</span>
                <span>100 — Extreme Greed (0 pts)</span>
              </div>
              {sp > 0
                ? <p className="mt-1 font-mono text-[11px] text-muted-foreground">(50 − {fgIndex}) / 50 × 50 = <span className="text-orange-400">{sp.toFixed(1)}</span></p>
                : <p className="mt-1 font-mono text-[11px] text-muted-foreground/50">index ≥ 50 → penalty = 0</p>
              }
            </div>

            <div className="border-t border-border/30" />

            {/* Factor 2 — Volume */}
            <div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">
                  24h Volume Shock
                  <span className="ml-2 font-medium tabular-nums text-foreground">
                    {volumeShockPct > 0 ? `+${volumeShockPct}%` : `${volumeShockPct}%`}
                  </span>
                  <span className="ml-1.5 text-muted-foreground">above baseline</span>
                </span>
                <span className={cn("tabular-nums font-medium", vp > 0 ? "text-sky-300" : "text-muted-foreground")}>
                  {vp > 0 ? `+${vp.toFixed(1)} pts` : "0 pts"}
                </span>
              </div>
              <input
                type="range" min={0} max={100} step={1} value={volumeShockPct}
                onChange={(e) => setVolumeShockPct(Number(e.target.value))}
                className="mt-1.5 w-full cursor-pointer"
                aria-label="Volume shock percentage"
                style={{ accentColor: vp > 0 ? "#38bdf8" : "#475569" }}
              />
              <div className="mt-0.5 flex justify-between text-[10px] text-muted-foreground/50">
                <span>0% — at baseline (0 pts)</span>
                <span>+100% — 2× baseline (+50 pts)</span>
              </div>
              {vp > 0
                ? <p className="mt-1 font-mono text-[11px] text-muted-foreground">min(50, {(volumeShockPct / 100).toFixed(2)} × 50) = <span className="text-sky-400">{vp.toFixed(1)}</span></p>
                : <p className="mt-1 font-mono text-[11px] text-muted-foreground/50">volume ≤ baseline → penalty = 0</p>
              }
            </div>

            {/* Composite result */}
            <div className="rounded-xl bg-muted/30 px-4 py-3 border border-border/30">
              <div className="space-y-1 font-mono text-xs">
                <div className="flex justify-between text-muted-foreground">
                  <span>Composite score</span>
                  <span className="text-foreground tabular-nums">
                    {sp.toFixed(1)} + {vp.toFixed(1)} ={" "}
                    <span className="font-semibold text-amber-300">{compositeScore.toFixed(1)}</span>
                  </span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>Multiplier</span>
                  <span className="tabular-nums text-foreground">
                    100 + int({compositeScore.toFixed(1)}) ={" "}
                    <span className={cn("font-semibold", TONE_TEXT[tone])}>{derivedMult}</span>
                  </span>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function PipelineFeedCard({
  score, lastFetch, showApply, onApply, onChainMultiplier,
}: {
  score: PipelineScore;
  lastFetch: Date | null;
  showApply: boolean;
  onApply?: () => void;
  onChainMultiplier?: number;
}) {
  const pendingSync =
    onChainMultiplier !== undefined &&
    score.multiplier >= 100 &&
    score.multiplier !== onChainMultiplier;

  return (
    <div className="rounded-xl bg-muted/30 border border-border/30 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/30">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
          </span>
          <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Live Pipeline Feed
          </span>
          {score.status === "stale" && (
            <span className="text-[10px] text-amber-500">(stale)</span>
          )}
        </div>
        {lastFetch && (
          <span className="text-[10px] text-muted-foreground/50">{lastFetch.toLocaleTimeString()}</span>
        )}
      </div>

      <div className="px-4 py-3 space-y-1.5 text-xs">
        <FeedRow
          label="Fear & Greed"
          value={`${score.fear_greed_index} — ${score.fear_greed_label}`}
          penalty={score.sentiment_penalty > 0 ? `+${score.sentiment_penalty.toFixed(1)} pts` : "0 pts"}
          penaltyTone={score.sentiment_penalty > 0 ? "text-orange-300" : "text-muted-foreground"}
        />
        <FeedRow
          label="Volume shock"
          value={`${score.volume_excess_pct >= 0 ? "+" : ""}${score.volume_excess_pct.toFixed(0)}% vs baseline`}
          penalty={score.volume_penalty > 0 ? `+${score.volume_penalty.toFixed(1)} pts` : "0 pts"}
          penaltyTone={score.volume_penalty > 0 ? "text-sky-300" : "text-muted-foreground"}
        />

        <div className="border-t border-border/30 pt-1.5 flex items-center justify-between">
          <span className="font-mono text-muted-foreground">
            {score.sentiment_penalty.toFixed(1)} + {score.volume_penalty.toFixed(1)} ={" "}
            <span className="text-amber-300 font-semibold">{score.composite_score.toFixed(1)}</span>
            {" → "}
            <span className="text-foreground font-semibold">{score.multiplier}</span>
          </span>
          {showApply && (
            <motion.button
              onClick={onApply}
              title="Apply to sandbox"
              className="flex items-center gap-1.5 rounded-lg bg-blue-500/10 border border-blue-500/20 px-2.5 py-1 text-[11px] font-medium text-blue-300 transition hover:bg-blue-500/20"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              <ArrowDownToLine className="h-3 w-3" />
              Apply
            </motion.button>
          )}
        </div>

        {pendingSync && (
          <p className="pt-0.5 text-[11px] text-muted-foreground">
            On-chain: <span className="text-foreground">{onChainMultiplier}</span> · syncs to{" "}
            <span className="text-foreground">{score.multiplier}</span> on the next relayer broadcast.
          </p>
        )}
      </div>
    </div>
  );
}

function FeedRow({ label, value, penalty, penaltyTone }: {
  label: string; value: string; penalty: string; penaltyTone: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className="text-foreground truncate">{value}</span>
      <span className={cn("shrink-0 tabular-nums font-medium", penaltyTone)}>{penalty}</span>
    </div>
  );
}

function PipelineDisconnected({ command, note }: { command: string; note?: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-dashed border-border/30 px-4 py-3">
      <WifiOff className="h-4 w-4 shrink-0 text-muted-foreground/50" />
      <div>
        <p className="text-[11px] text-muted-foreground">Pipeline server not running.</p>
        <p className="mt-0.5 font-mono text-[10px] text-muted-foreground/50">{command}</p>
        {note && <p className="mt-1 text-[11px] text-muted-foreground/50">{note}</p>}
      </div>
    </div>
  );
}
