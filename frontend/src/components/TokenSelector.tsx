import { useEffect, useRef, useState } from "react";
import { ChevronDown, Check } from "lucide-react";
import { cn } from "../lib/cn.js";
import { TOKEN_REGISTRY, type TokenConfig } from "../config/tokenRegistry.js";

interface TokenSelectorProps {
  label: string;
  value: TokenConfig;
  /** The token selected on the other side — disabled to prevent same-token pairs. */
  exclude: TokenConfig;
  onChange: (token: TokenConfig) => void;
}

/**
 * Single-token dropdown.
 *
 * Lists every token from TOKEN_REGISTRY except the one selected on the other
 * side (to prevent invalid same-token pairs). Closes on outside-click and Escape.
 */
export default function TokenSelector({
  label,
  value,
  exclude,
  onChange,
}: TokenSelectorProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onMouse(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
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
      {/* Label */}
      <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-slate-500">
        {label}
      </p>

      {/* Trigger */}
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          "flex items-center gap-2.5 rounded-xl px-4 py-2.5 text-sm font-semibold",
          "bg-slate-800 text-slate-100 ring-1 ring-white/10",
          "transition hover:bg-slate-700 hover:ring-white/20 min-w-36",
          open && "ring-sky-500/50",
        )}
      >
        <span className="flex-1 text-left">{value.symbol}</span>
        <ChevronDown
          className={cn(
            "h-4 w-4 text-slate-400 transition-transform duration-200",
            open && "rotate-180",
          )}
        />
      </button>

      {/* Dropdown */}
      {open && (
        <ul
          role="listbox"
          className={cn(
            "absolute left-0 top-full z-50 mt-2 w-52 overflow-hidden",
            "rounded-2xl bg-slate-900 shadow-2xl shadow-black/60",
            "ring-1 ring-white/10",
          )}
        >
          {TOKEN_REGISTRY.map((token) => {
            const isSelected  = token.id === value.id;
            const isExcluded  = token.id === exclude.id;

            return (
              <li key={token.id}>
                <button
                  role="option"
                  aria-selected={isSelected}
                  disabled={isExcluded}
                  onClick={() => select(token)}
                  className={cn(
                    "flex w-full items-center gap-3 px-4 py-2.5 text-sm transition",
                    isExcluded
                      ? "cursor-not-allowed opacity-30"
                      : "hover:bg-white/5",
                    isSelected
                      ? "text-slate-100"
                      : "text-slate-400 hover:text-slate-100",
                  )}
                >
                  <span className="flex-1 text-left">
                    <span className="block font-semibold">{token.symbol}</span>
                    <span className="block text-xs text-slate-500">{token.name}</span>
                  </span>
                  {isSelected && (
                    <Check className="h-3.5 w-3.5 shrink-0 text-sky-400" />
                  )}
                  {isExcluded && (
                    <span className="text-[10px] text-slate-600">selected</span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
