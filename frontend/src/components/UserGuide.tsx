/**
 * UserGuide — an in-dashboard explainer for how the Dynamic-Fee-AMM works.
 *
 * Pulls the real protocol constants from lib/amm.js so the numbers shown here
 * stay in sync with the contract math (no hardcoded drift).
 */

import type { ReactNode } from "react";
import {
  BookOpen,
  Repeat,
  Activity,
  Percent,
  Cpu,
  Layers,
  Gauge,
  FlaskConical,
} from "lucide-react";
import {
  BASE_FEE,
  MAX_FEE,
  DECAY_HALFLIFE,
  VOLATILITY_ALPHA,
  VOLATILITY_SCALE,
  MULTIPLIER_MIN,
  MULTIPLIER_MAX,
} from "../lib/amm.js";

const baseFeePct = (Number(BASE_FEE) / 100).toFixed(2);
const maxFeePct  = (Number(MAX_FEE) / 100).toFixed(2);

export default function UserGuide() {
  return (
    <div className="mt-6 space-y-6">
      {/* Intro */}
      <Section icon={BookOpen} title="What this is" tone="sky">
        <p>
          A <Term>constant-product automated market maker</Term> (the same{" "}
          <Mono>x · y = k</Mono> core as Uniswap V2) with two features layered on
          top: a <Term>volatility-responsive fee</Term> that rises when trading
          gets aggressive, and an <Term>off-chain macro oracle</Term> that scales
          fees up during broader market stress. Liquidity providers deposit token
          pairs, traders swap against the pool, and every fee stays in the pool to
          reward LPs.
        </p>
        <p className="mt-2">
          The dashboard runs in two modes — <Term>Sandbox</Term> (a fully
          in-memory simulation, no blockchain needed) and <Term>Live</Term>{" "}
          (reading and writing to deployed contracts on Sepolia). Every number in
          the swap preview is computed with the exact integer math the contract
          uses, so the simulation and the chain never disagree.
        </p>
      </Section>

      {/* Swap math */}
      <Section icon={Repeat} title="How a swap is priced" tone="emerald">
        <p>
          The pool holds reserves of two tokens. Their product must stay constant
          across a trade (minus the fee), which is what defines the price:
        </p>
        <Formula>
          {`amountOut = (reserveOut · amountIn · feeMul)
            ───────────────────────────────────
            (reserveIn · 10000 + amountIn · feeMul)

where feeMul = 10000 − feeBps`}
        </Formula>
        <p className="mt-2">
          The bigger your trade is relative to the pool, the more the price moves
          against you — this is <Term>price impact</Term>, shown live as you type.
          The fee you pay is <Term>not fixed</Term>: it's computed fresh for every
          swap, as described below.
        </p>
      </Section>

      {/* Dynamic fee */}
      <Section icon={Activity} title="The dynamic fee engine" tone="amber">
        <p>
          The fee floats between a floor of <Term>{baseFeePct}%</Term> (calm
          market) and a hard ceiling of <Term>{maxFeePct}%</Term> (storm). It's
          driven by a <Term>volatility accumulator</Term> — an on-chain running
          measure of recent trading intensity.
        </p>
        <ul className="mt-3 space-y-2">
          <Bullet label="Price impact adds heat">
            Each swap's footprint (its size relative to the pool) is added to the
            accumulator. Bigger / more frequent trades push it higher.
          </Bullet>
          <Bullet label="Time cools it down">
            Between trades the accumulator decays exponentially, halving every{" "}
            <Mono>{Number(DECAY_HALFLIFE)}s</Mono> (its “half-life”). A quiet
            market quickly relaxes back toward the floor fee.
          </Bullet>
          <Bullet label="The fee is derived from it">
            <Formula inline>
              {`rawFee = ${Number(BASE_FEE)} + volatility · ${Number(
                VOLATILITY_ALPHA,
              )} / ${Number(VOLATILITY_SCALE)}
clamped to [${Number(BASE_FEE)}, ${Number(MAX_FEE)}] bps`}
            </Formula>
          </Bullet>
        </ul>
        <p className="mt-3">
          The effect: a calm pool charges {baseFeePct}%, but a burst of
          large/rapid swaps (the kind sandwich bots and panic sellers create)
          ramps the fee toward {maxFeePct}%, protecting LPs exactly when risk is
          highest. You can watch this live on the{" "}
          <Term>Fee Curve</Term> and <Term>Trade History</Term> charts.
        </p>
      </Section>

      {/* Resting fee */}
      <Section icon={Percent} title="The “Resting Fee” card" tone="amber">
        <p>
          The <Term>Resting Fee</Term> stat is the fee a tiny (dust-sized) trade
          would pay <em>right now</em> — i.e. the current decayed volatility,
          scaled by the chaos multiplier, with essentially zero new price impact.
        </p>
        <p className="mt-2">
          Think of it as the pool's <Term>idle / baseline fee</Term> at this
          instant. Just after a big swap it sits high; let the market sit quiet
          for a few half-lives and it drifts back to {baseFeePct}%. It's the
          cheapest a swap could possibly be at this moment — any real trade adds
          its own price impact on top.
        </p>
      </Section>

      {/* Chaos multiplier */}
      <Section icon={Cpu} title="The Chaos Multiplier (macro oracle)" tone="orange">
        <p>
          Everything above reacts to <em>this pool's</em> own activity. The{" "}
          <Term>Chaos Multiplier</Term> adds awareness of the{" "}
          <em>broader market</em>. An off-chain relayer reads two public signals
          and turns them into a single scalar between{" "}
          <Mono>{Number(MULTIPLIER_MIN)}</Mono> (1.0×, neutral) and{" "}
          <Mono>{Number(MULTIPLIER_MAX)}</Mono> (2.0×, maximum hazard):
        </p>
        <ul className="mt-3 space-y-2">
          <Bullet label="Factor 1 — Sentiment (Fear & Greed)">
            Below the neutral midpoint (50), fear scales a penalty up to 50
            points as the index approaches 0 (extreme fear).
            <Formula inline>{`sentiment = (50 − index) / 50 × 50`}</Formula>
          </Bullet>
          <Bullet label="Factor 2 — Volume shock">
            When 24h market volume exceeds its baseline, the excess scales a
            penalty up to another 50 points.
            <Formula inline>{`volume = min(50, excess_ratio × 50)`}</Formula>
          </Bullet>
          <Bullet label="Composite → multiplier">
            <Formula inline>{`multiplier = clamp(100 + (sentiment + volume), 100, 200)`}</Formula>
          </Bullet>
        </ul>
        <p className="mt-3">
          The final swap fee is the dynamic fee scaled by this multiplier, then
          re-clamped to the {maxFeePct}% ceiling:
        </p>
        <Formula>{`feeBps = min(${Number(MAX_FEE)}, dynamicFee · multiplier / 100)`}</Formula>
        <p className="mt-2 text-slate-400">
          So in a fearful, high-volume market a normally-{baseFeePct}% pool can be
          pushed toward {maxFeePct}% even on a small trade — a circuit-breaker for
          systemic stress, not just local activity.
        </p>
      </Section>

      {/* Full pipeline */}
      <Section icon={Layers} title="Putting it together" tone="fuchsia">
        <p>The full fee for any swap is computed in four steps:</p>
        <ol className="mt-3 space-y-1.5 text-slate-300">
          <Step n={1}>Decay the stored volatility by the time since the last trade.</Step>
          <Step n={2}>Add this trade's price impact to get current volatility.</Step>
          <Step n={3}>Convert to a base fee, clamped to [{baseFeePct}%, {maxFeePct}%].</Step>
          <Step n={4}>Multiply by the Chaos Multiplier and re-clamp to {maxFeePct}%.</Step>
        </ol>
      </Section>

      {/* Modes */}
      <Section icon={FlaskConical} title="Sandbox vs Live mode" tone="sky">
        <div className="grid gap-4 sm:grid-cols-2">
          <ModeCard title="Sandbox" tone="amber">
            In-memory pool, no chain required. “Simulate Swap” mutates the local
            reserves; the Chaos Multiplier sliders drive the fee directly so you
            can explore the mechanics. Each token pair keeps its own independent
            simulation.
          </ModeCard>
          <ModeCard title="Live" tone="emerald">
            Reads real reserves from a deployed pool on Sepolia and prices swaps
            against them. Connect a wallet to execute real on-chain swaps. The
            multiplier is set by the relayer; the sliders become a read-only
            “what-if” calculator.
          </ModeCard>
        </div>
      </Section>

      {/* Dashboard reference */}
      <Section icon={Gauge} title="Reading the dashboard" tone="slate">
        <dl className="space-y-2.5">
          <RefRow term="Reserve cards">
            How much of each token the pool currently holds. Their ratio sets the
            spot price.
          </RefRow>
          <RefRow term="Resting Fee">
            The pool's baseline fee right now (dust trade), in % and basis points,
            with the pre-multiplier base fee beside it.
          </RefRow>
          <RefRow term="Chaos Multiplier">
            The current macro scalar (1.00×–2.00×) and its hazard band.
          </RefRow>
          <RefRow term="Swap panel">
            Live quote — output, dynamic fee, price impact, and (in live mode)
            your wallet balance, slippage, and the execute flow.
          </RefRow>
          <RefRow term="Fee Curve">
            Fee vs trade size, comparing the raw 1.0× curve against the current
            macro-scaled curve.
          </RefRow>
          <RefRow term="Trade History">
            Per-trade fee and volatility over time, showing how each swap moves
            the accumulator.
          </RefRow>
        </dl>
      </Section>
    </div>
  );
}

// ─── Presentational helpers ───────────────────────────────────────────────────

const TONE_RING: Record<string, string> = {
  sky:     "from-sky-500/10 text-sky-300 ring-sky-500/20",
  emerald: "from-emerald-500/10 text-emerald-300 ring-emerald-500/20",
  amber:   "from-amber-500/10 text-amber-300 ring-amber-500/20",
  orange:  "from-orange-500/10 text-orange-300 ring-orange-500/20",
  fuchsia: "from-fuchsia-500/10 text-fuchsia-300 ring-fuchsia-500/20",
  slate:   "from-slate-500/10 text-slate-300 ring-slate-500/20",
};

function Section({
  icon: Icon, title, tone, children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  tone: keyof typeof TONE_RING;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl bg-slate-900/60 p-5 ring-1 ring-white/10 backdrop-blur sm:p-6">
      <div className="flex items-center gap-3">
        <div className={`grid h-9 w-9 place-items-center rounded-lg bg-gradient-to-br to-transparent ring-1 ${TONE_RING[tone]}`}>
          <Icon className="h-4.5 w-4.5" />
        </div>
        <h2 className="text-base font-semibold text-slate-100">{title}</h2>
      </div>
      <div className="mt-4 text-sm leading-relaxed text-slate-300">{children}</div>
    </section>
  );
}

function Term({ children }: { children: ReactNode }) {
  return <span className="font-medium text-slate-100">{children}</span>;
}

function Mono({ children }: { children: ReactNode }) {
  return <code className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[0.85em] text-slate-200">{children}</code>;
}

function Formula({ children, inline }: { children: string; inline?: boolean }) {
  return (
    <pre
      className={`overflow-x-auto rounded-xl bg-slate-950/70 px-4 py-3 font-mono text-[12px] leading-relaxed text-emerald-200/90 ring-1 ring-white/5 ${inline ? "mt-2" : "mt-3"}`}
    >
      {children}
    </pre>
  );
}

function Bullet({ label, children }: { label: string; children: ReactNode }) {
  return (
    <li className="rounded-xl bg-slate-950/40 px-4 py-3 ring-1 ring-white/5">
      <span className="font-medium text-slate-100">{label}</span>
      <div className="mt-1 text-slate-300">{children}</div>
    </li>
  );
}

function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-fuchsia-500/15 text-[11px] font-semibold text-fuchsia-300 ring-1 ring-fuchsia-500/30">
        {n}
      </span>
      <span>{children}</span>
    </li>
  );
}

function ModeCard({ title, tone, children }: { title: string; tone: "amber" | "emerald"; children: ReactNode }) {
  const ring = tone === "amber" ? "ring-amber-500/30 text-amber-300" : "ring-emerald-500/30 text-emerald-300";
  return (
    <div className="rounded-xl bg-slate-950/40 p-4 ring-1 ring-white/5">
      <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${ring}`}>{title}</span>
      <p className="mt-2 text-slate-300">{children}</p>
    </div>
  );
}

function RefRow({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 border-t border-white/5 pt-2.5 first:border-t-0 first:pt-0 sm:flex-row sm:gap-4">
      <dt className="shrink-0 font-medium text-slate-100 sm:w-40">{term}</dt>
      <dd className="text-slate-400">{children}</dd>
    </div>
  );
}
