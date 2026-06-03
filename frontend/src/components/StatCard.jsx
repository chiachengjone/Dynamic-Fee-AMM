import { motion } from "framer-motion";
import { cn } from "../lib/cn.js";

const TONES = {
  sky:     "from-sky-500/20 text-sky-300 ring-sky-500/30",
  emerald: "from-emerald-500/20 text-emerald-300 ring-emerald-500/30",
  fuchsia: "from-fuchsia-500/20 text-fuchsia-300 ring-fuchsia-500/30",
  amber:   "from-amber-500/20 text-amber-300 ring-amber-500/30",
  yellow:  "from-yellow-500/20 text-yellow-300 ring-yellow-500/30",
  orange:  "from-orange-500/20 text-orange-300 ring-orange-500/30",
  red:     "from-red-500/20 text-red-300 ring-red-500/30",
  slate:   "from-slate-500/20 text-slate-300 ring-slate-500/30",
};

const cardVariants = {
  hidden: { opacity: 0, y: 16, scale: 0.97 },
  visible: { opacity: 1, y: 0, scale: 1, transition: { type: "spring", stiffness: 350, damping: 28 } },
};

export default function StatCard({ label, value, sub, Icon, tone = "slate" }) {
  const toneClasses = TONES[tone] ?? TONES.slate;

  return (
    <motion.div
      className="relative overflow-hidden rounded-2xl bg-card/80 backdrop-blur-xl border border-border/50 p-4 shadow-2xl"
      variants={cardVariants}
      whileHover={{ y: -2, scale: 1.01, transition: { type: "spring", stiffness: 400, damping: 25 } }}
    >
      {/* shimmer line */}
      <div className="pointer-events-none absolute inset-x-0 -top-px h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
      <div className="flex items-start justify-between">
        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        {Icon && (
          <motion.div
            className={cn("grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br to-transparent ring-1", toneClasses)}
            whileHover={{ scale: 1.15, rotate: 5, transition: { type: "spring", stiffness: 400 } }}
          >
            <Icon className="h-4 w-4" />
          </motion.div>
        )}
      </div>
      <div className="mt-3 flex items-baseline gap-1.5">
        <span className="text-2xl font-semibold tabular-nums tracking-tight text-foreground">
          {value}
        </span>
      </div>
      {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
    </motion.div>
  );
}
