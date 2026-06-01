import { cn } from "../lib/cn.js";

const TONES = {
  sky: "from-sky-500/10 text-sky-300 ring-sky-500/20",
  emerald: "from-emerald-500/10 text-emerald-300 ring-emerald-500/20",
  fuchsia: "from-fuchsia-500/10 text-fuchsia-300 ring-fuchsia-500/20",
  amber: "from-amber-500/10 text-amber-300 ring-amber-500/20",
  yellow: "from-yellow-500/10 text-yellow-300 ring-yellow-500/20",
  orange: "from-orange-500/10 text-orange-300 ring-orange-500/20",
  red: "from-red-500/10 text-red-300 ring-red-500/20",
  slate: "from-slate-500/10 text-slate-300 ring-slate-500/20",
};

/**
 * A single live metric tile. `value` is rendered prominently; `Icon` is a
 * lucide-react component. The whole card animates subtly when values change
 * (via the key-driven CSS transition on the value span).
 */
export default function StatCard({ label, value, sub, Icon, tone = "slate" }) {
  const toneClasses = TONES[tone] ?? TONES.slate;

  return (
    <div className="relative overflow-hidden rounded-2xl bg-slate-900/60 p-4 ring-1 ring-white/10 backdrop-blur">
      <div
        className={cn(
          "pointer-events-none absolute inset-x-0 -top-px h-px bg-gradient-to-r from-transparent via-white/20 to-transparent"
        )}
      />
      <div className="flex items-start justify-between">
        <span className="text-[11px] font-medium uppercase tracking-wider text-slate-400">
          {label}
        </span>
        {Icon && (
          <div
            className={cn(
              "grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br to-transparent ring-1",
              toneClasses
            )}
          >
            <Icon className="h-4 w-4" />
          </div>
        )}
      </div>
      <div className="mt-3 flex items-baseline gap-1.5">
        <span className="text-2xl font-semibold tabular-nums tracking-tight text-slate-100">
          {value}
        </span>
      </div>
      {sub && <p className="mt-1 text-xs text-slate-500">{sub}</p>}
    </div>
  );
}
