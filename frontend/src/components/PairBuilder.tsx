import { motion } from "framer-motion";
import { ArrowLeftRight } from "lucide-react";
import TokenSelector from "./TokenSelector.js";
import type { TokenConfig } from "../config/tokenRegistry.js";

interface PairBuilderProps {
  baseToken:     TokenConfig;
  quoteToken:    TokenConfig;
  onBaseChange:  (token: TokenConfig) => void;
  onQuoteChange: (token: TokenConfig) => void;
}

export default function PairBuilder({ baseToken, quoteToken, onBaseChange, onQuoteChange }: PairBuilderProps) {
  function swapDirection() {
    onBaseChange(quoteToken);
    onQuoteChange(baseToken);
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <TokenSelector label="Base token" value={baseToken} exclude={quoteToken} onChange={onBaseChange} />

      <span className="mb-3 text-xl font-light text-muted-foreground/40 select-none">/</span>

      <TokenSelector label="Quote token" value={quoteToken} exclude={baseToken} onChange={onQuoteChange} />

      <motion.button
        onClick={swapDirection}
        title="Swap base ↔ quote"
        className="mb-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-r from-blue-500/10 to-purple-500/10 border border-border/50 text-muted-foreground transition hover:from-blue-500/20 hover:to-purple-500/20 hover:text-blue-300"
        aria-label="Swap base and quote tokens"
        whileHover={{ scale: 1.05, rotate: 180 }}
        whileTap={{ scale: 0.95 }}
        transition={{ type: "spring", stiffness: 300, damping: 25 }}
      >
        <ArrowLeftRight className="h-4 w-4" />
      </motion.button>
    </div>
  );
}
