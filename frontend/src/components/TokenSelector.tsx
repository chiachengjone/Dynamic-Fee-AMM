import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, Check } from "lucide-react";
import { cn } from "../lib/cn.js";
import { TOKEN_REGISTRY, type TokenConfig } from "../config/tokenRegistry.js";

interface TokenSelectorProps {
  label: string;
  value: TokenConfig;
  exclude: TokenConfig;
  onChange: (token: TokenConfig) => void;
}

export default function TokenSelector({ label, value, exclude, onChange }: TokenSelectorProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onMouse(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onMouse);
    document.addEventListener("keydown",   onKey);
    return () => {
      document.removeEventListener("mousedown", onMouse);
      document.removeEventListener("keydown",   onKey);
    };
  }, [open]);

  function select(token: TokenConfig) {
    if (token.id === exclude.id) return;
    onChange(token);
    setOpen(false);
  }

  return (
    <div ref={containerRef} className="relative">
      <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </p>

      <motion.button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          "flex items-center gap-2.5 rounded-xl px-4 py-2.5 text-sm font-semibold min-w-36",
          "bg-card/80 backdrop-blur-xl border text-foreground transition",
          open
            ? "border-blue-500/50 ring-2 ring-blue-500/20"
            : "border-border/50 hover:border-border",
        )}
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
      >
        <span className="flex-1 text-left">{value.symbol}</span>
        <ChevronDown
          className={cn("h-4 w-4 text-muted-foreground transition-transform duration-200", open && "rotate-180")}
        />
      </motion.button>

      <AnimatePresence>
        {open && (
          <motion.ul
            role="listbox"
            className="absolute left-0 top-full z-50 mt-2 w-52 overflow-hidden rounded-2xl bg-card backdrop-blur-xl border border-border/50 shadow-2xl shadow-black/60"
            initial={{ opacity: 0, y: -8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.97 }}
            transition={{ type: "spring", stiffness: 350, damping: 30 }}
          >
            {TOKEN_REGISTRY.map((token, i) => {
              const isSelected = token.id === value.id;
              const isExcluded = token.id === exclude.id;

              return (
                <motion.li
                  key={token.id}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.03 }}
                >
                  <button
                    role="option"
                    aria-selected={isSelected}
                    disabled={isExcluded}
                    onClick={() => select(token)}
                    className={cn(
                      "flex w-full items-center gap-3 px-4 py-2.5 text-sm transition",
                      isExcluded
                        ? "cursor-not-allowed opacity-30"
                        : "hover:bg-muted/50",
                      isSelected ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <span className="flex-1 text-left">
                      <span className="block font-semibold">{token.symbol}</span>
                      <span className="block text-xs text-muted-foreground/70">{token.name}</span>
                    </span>
                    {isSelected && <Check className="h-3.5 w-3.5 shrink-0 text-blue-400" />}
                    {isExcluded && <span className="text-[10px] text-muted-foreground/50">selected</span>}
                  </button>
                </motion.li>
              );
            })}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}
