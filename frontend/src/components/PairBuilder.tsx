import { ArrowLeftRight } from "lucide-react";
import TokenSelector from "./TokenSelector.js";
import type { TokenConfig } from "../config/tokenRegistry.js";

interface PairBuilderProps {
  baseToken:        TokenConfig;
  quoteToken:       TokenConfig;
  onBaseChange:     (token: TokenConfig) => void;
  onQuoteChange:    (token: TokenConfig) => void;
}

/**
 * Inline pair builder — two independent TokenSelector dropdowns with a swap
 * button between them. Lives directly on the dashboard layout (not inside the
 * header) so it's the first thing users interact with when exploring pairs.
 *
 * Changing either dropdown immediately updates App root state, which triggers
 * usePairPoolState to tear down the previous pair's listeners and initialise
 * the new pair. The ⇄ button inverts base and quote in one click.
 */
export default function PairBuilder({
  baseToken,
  quoteToken,
  onBaseChange,
  onQuoteChange,
}: PairBuilderProps) {
  function swapDirection() {
    // Swap base ↔ quote; each sandbox store entry remains keyed by its own
    // directional pairId, so the inverted pair initialises fresh.
    onBaseChange(quoteToken);
    onQuoteChange(baseToken);
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <TokenSelector
        label="Base token"
        value={baseToken}
        exclude={quoteToken}
        onChange={onBaseChange}
      />

      {/* Divider slash */}
      <span className="mb-3 text-xl font-light text-slate-600 select-none">/</span>

      <TokenSelector
        label="Quote token"
        value={quoteToken}
        exclude={baseToken}
        onChange={onQuoteChange}
      />

      {/* Swap direction */}
      <button
        onClick={swapDirection}
        title="Swap base ↔ quote"
        className="mb-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-800 text-slate-400 ring-1 ring-white/10 transition hover:bg-slate-700 hover:text-slate-200"
        aria-label="Swap base and quote tokens"
      >
        <ArrowLeftRight className="h-4 w-4" />
      </button>
    </div>
  );
}
