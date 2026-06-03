import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { ethers } from "ethers";
import { ArrowDownUp, Zap, Info, Wallet, Droplet, ExternalLink, Loader2, CheckCircle2 } from "lucide-react";
import { cn } from "../lib/cn.js";
import { quoteSwap, toWei, fromWei, fmtAmount, bpsToPct, toBig } from "../lib/amm.js";
import type { PoolDataState } from "../hooks/usePairPoolState.js";
import { useWallet } from "../wallet/WalletContext.js";
import {
  readBalanceAndAllowance,
  approveToken,
  executeSwap,
  mintTestTokens,
  applySlippage,
} from "../lib/swapActions.js";

interface SwapPanelProps {
  state: PoolDataState;
  mode: "live" | "sandbox";
  onSimulate: (zeroForOne: boolean, amountInWei: bigint) => void;
  poolAddress: string | null;
  onSwapped: () => void;
  onRecordTrade: (feeBps: bigint, volatility: bigint, txHash: string) => void;
}

const ETHERSCAN_TX = "https://sepolia.etherscan.io/tx/";
const FAUCET_AMOUNT = 1000n * 10n ** 18n;
const SLIPPAGE_PRESETS = [10, 50, 100];

type TxStatus = "idle" | "minting" | "approving" | "swapping" | "success" | "error";

export default function SwapPanel({ state, mode, onSimulate, poolAddress, onSwapped, onRecordTrade }: SwapPanelProps) {
  const {
    token0, token1,
    reserve0, reserve1,
    externalChaosMultiplier,
    volatility,
    lastTimestamp,
  } = state;

  const isLive = mode === "live";
  const wallet = useWallet();

  const [zeroForOne, setZeroForOne] = useState(true);
  const [amount, setAmount] = useState("");

  const tokenIn  = zeroForOne ? token0 : token1;
  const tokenOut = zeroForOne ? token1 : token0;
  const reserveIn  = zeroForOne ? reserve0 : reserve1;
  const reserveOut = zeroForOne ? reserve1 : reserve0;

  const amountInWei = useMemo(
    () => toWei(amount || "0", tokenIn.decimals),
    [amount, tokenIn.decimals],
  );

  const quote = useMemo(() => {
    const timeElapsed = Math.max(0, Math.floor(Date.now() / 1000) - lastTimestamp);
    return quoteSwap({ amountIn: amountInWei, reserveIn, reserveOut, volatility, timeElapsed, multiplier: externalChaosMultiplier });
  }, [amountInWei, reserveIn, reserveOut, volatility, lastTimestamp, externalChaosMultiplier]);

  const exceedsReserves = quote.amountOut >= toBig(reserveOut);
  const validTrade = amountInWei > 0n && quote.amountOut > 0n && !exceedsReserves;

  const execPrice = useMemo(() => {
    if (amountInWei <= 0n || quote.amountOut <= 0n) return null;
    const inFloat  = Number(amountInWei) / 10 ** tokenIn.decimals;
    const outFloat = Number(quote.amountOut) / 10 ** tokenOut.decimals;
    return inFloat > 0 ? outFloat / inFloat : null;
  }, [amountInWei, quote.amountOut, tokenIn.decimals, tokenOut.decimals]);

  const priceImpactPct = (Number(quote.priceImpact) / 100).toFixed(2);

  const [slippageBps, setSlippageBps] = useState(50);
  const [balance, setBalance]     = useState<bigint | null>(null);
  const [allowance, setAllowance] = useState<bigint>(0n);
  const [txStatus, setTxStatus]   = useState<TxStatus>("idle");
  const [txHash, setTxHash]       = useState<string | null>(null);
  const [txError, setTxError]     = useState<string | null>(null);
  const [txNonce, setTxNonce]     = useState(0);

  const canRead =
    isLive && !!wallet.account && wallet.isCorrectNetwork && !!tokenIn.address && !!poolAddress;

  useEffect(() => {
    if (!canRead || !window.ethereum) {
      setBalance(null);
      setAllowance(0n);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const provider = new ethers.BrowserProvider(window.ethereum!);
        const { balance, allowance } = await readBalanceAndAllowance(
          provider, tokenIn.address!, wallet.account!, poolAddress!,
        );
        if (cancelled) return;
        setBalance(balance);
        setAllowance(allowance);
      } catch {
        if (!cancelled) { setBalance(null); setAllowance(0n); }
      }
    })();
    return () => { cancelled = true; };
  }, [canRead, tokenIn.address, wallet.account, poolAddress, txNonce]);

  function handleAmountChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value;
    if (v === "" || /^\d*\.?\d*$/.test(v)) setAmount(v);
  }

  function handleFlip() {
    // Carry the current output over as the new input, and vice-versa.
    const outAmount = quote.amountOut > 0n ? fromWei(quote.amountOut, tokenOut.decimals) : "";
    setZeroForOne((v) => !v);
    setAmount(outAmount);
    setTxStatus("idle"); setTxHash(null); setTxError(null);
  }

  function handleSimulate() {
    if (!validTrade) return;
    onSimulate(zeroForOne, amountInWei);
    setAmount("");
  }

  const insufficientBalance = balance !== null && amountInWei > balance;
  const needsApproval = allowance < amountInWei;
  const busy = txStatus === "minting" || txStatus === "approving" || txStatus === "swapping";

  const runTx = useCallback(
    async (kind: "mint" | "approve" | "swap", fn: () => Promise<string>) => {
      setTxStatus(kind === "mint" ? "minting" : kind === "approve" ? "approving" : "swapping");
      setTxError(null);
      setTxHash(null);
      try {
        const hash = await fn();
        setTxHash(hash);
        setTxStatus("success");
        setTxNonce((n) => n + 1);
        if (kind === "swap") { setAmount(""); onSwapped(); }
      } catch (err: unknown) {
        const msg =
          (err as { shortMessage?: string })?.shortMessage ??
          (err as { reason?: string })?.reason ??
          (err as { message?: string })?.message ??
          "Transaction failed";
        setTxError(msg);
        setTxStatus("error");
      }
    },
    [onSwapped],
  );

  const handleMint = useCallback(async () => {
    if (!token0.address || !token1.address) return;
    const signer = await wallet.getSigner();
    await runTx("mint", () => mintTestTokens(signer, [token0.address!, token1.address!], FAUCET_AMOUNT));
  }, [wallet, token0.address, token1.address, runTx]);

  const handleApprove = useCallback(async () => {
    if (!tokenIn.address || !poolAddress) return;
    const signer = await wallet.getSigner();
    await runTx("approve", () => approveToken(signer, tokenIn.address!, poolAddress));
  }, [wallet, tokenIn.address, poolAddress, runTx]);

  const handleSwap = useCallback(async () => {
    if (!tokenIn.address || !poolAddress) return;
    const signer = await wallet.getSigner();
    const minOut = applySlippage(quote.amountOut, slippageBps);
    await runTx("swap", async () => {
      const res = await executeSwap(signer, poolAddress, amountInWei, tokenIn.address!, minOut);
      onRecordTrade(res.feeBps, res.volatility, res.hash);
      return res.hash;
    });
  }, [wallet, tokenIn.address, poolAddress, quote.amountOut, slippageBps, amountInWei, runTx, onRecordTrade]);

  return (
    <div className="rounded-3xl bg-card/80 backdrop-blur-xl border border-border/50 p-5 shadow-2xl">
      {/* Header */}
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 bg-gradient-to-r from-blue-500 to-purple-600 rounded-lg flex items-center justify-center">
          <Zap className="h-4 w-4 text-white" />
        </div>
        <h2 className="text-sm font-semibold text-foreground">
          {isLive ? "Swap" : "Swap Simulator"}
        </h2>
        <span className="ml-auto text-[11px] text-muted-foreground tabular-nums">
          {tokenIn.symbol} → {tokenOut.symbol}
        </span>
      </div>

      {/* Token In */}
      <div className="mt-4 rounded-2xl bg-muted/30 p-3 border border-border/30">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>You pay</span>
          {isLive && balance !== null ? (
            <button
              onClick={() => setAmount(fromWei(balance, tokenIn.decimals))}
              className="transition hover:text-foreground"
              title="Use max balance"
            >
              balance: {fmtAmount(balance, tokenIn.decimals, 4)} {tokenIn.symbol}
            </button>
          ) : (
            <span>pool: {fmtAmount(reserveIn, tokenIn.decimals, 4)} {tokenIn.symbol}</span>
          )}
        </div>
        <div className="mt-1 flex items-center gap-3">
          <input
            type="text" inputMode="decimal" value={amount}
            onChange={handleAmountChange} placeholder="0.0"
            className="w-full bg-transparent text-2xl font-semibold tabular-nums text-foreground outline-none placeholder:text-muted-foreground/50"
          />
          <TokenBadge symbol={tokenIn.symbol} />
        </div>
      </div>

      {/* Flip */}
      <div className="relative flex justify-center">
        <motion.button
          onClick={handleFlip}
          className="-my-3 z-10 grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-r from-blue-500 to-purple-600 text-white shadow-lg shadow-blue-500/20 ring-4 ring-background transition"
          whileHover={{ scale: 1.1, rotate: 180 }}
          whileTap={{ scale: 0.9 }}
          transition={{ type: "spring", stiffness: 300, damping: 25 }}
          aria-label="Flip swap direction"
        >
          <ArrowDownUp className="h-4 w-4" />
        </motion.button>
      </div>

      {/* Token Out */}
      <div className="rounded-2xl bg-muted/30 p-3 border border-border/30">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>You receive</span>
          <span>pool: {fmtAmount(reserveOut, tokenOut.decimals, 4)} {tokenOut.symbol}</span>
        </div>
        <div className="mt-1 flex items-center gap-3">
          <span className={cn("w-full text-2xl font-semibold tabular-nums", validTrade ? "text-emerald-300" : "text-muted-foreground/50")}>
            {fmtAmount(quote.amountOut, tokenOut.decimals, 6)}
          </span>
          <TokenBadge symbol={tokenOut.symbol} />
        </div>
      </div>

      {/* Quote breakdown */}
      <dl className="mt-4 space-y-2 text-xs rounded-xl bg-muted/20 p-3 border border-border/20">
        <QuoteRow label="Dynamic fee">
          <span className="font-medium text-amber-300">
            {bpsToPct(quote.feeBps)} <span className="text-muted-foreground">({Number(quote.feeBps)} bps)</span>
          </span>
        </QuoteRow>
        <QuoteRow label="Base fee (pre-multiplier)">
          <span className="text-foreground">
            {bpsToPct(quote.baseFeeBps)} <span className="text-muted-foreground">({Number(quote.baseFeeBps)} bps)</span>
          </span>
        </QuoteRow>
        <QuoteRow label="Price impact">
          <span className={cn(Number(priceImpactPct) > 5 ? "text-orange-300" : "text-foreground")}>{priceImpactPct}%</span>
        </QuoteRow>
        <QuoteRow label="Exec. price">
          <span className="text-foreground">
            {execPrice != null
              ? `1 ${tokenIn.symbol} ≈ ${execPrice.toLocaleString(undefined, { maximumFractionDigits: 6 })} ${tokenOut.symbol}`
              : "—"}
          </span>
        </QuoteRow>
        {isLive && validTrade && (
          <QuoteRow label="Min received">
            <span className="text-foreground">
              {fmtAmount(applySlippage(quote.amountOut, slippageBps), tokenOut.decimals, 6)} {tokenOut.symbol}
            </span>
          </QuoteRow>
        )}
      </dl>

      {exceedsReserves && amountInWei > 0n && (
        <p className="mt-3 flex items-center gap-1.5 text-xs text-red-300">
          <Info className="h-3.5 w-3.5" /> Trade size exceeds available liquidity.
        </p>
      )}

      {/* Action area */}
      {isLive ? (
        <LiveActions
          wallet={wallet}
          tokenInSymbol={tokenIn.symbol}
          validTrade={validTrade}
          insufficientBalance={insufficientBalance}
          needsApproval={needsApproval}
          busy={busy}
          txStatus={txStatus}
          txHash={txHash}
          txError={txError}
          slippageBps={slippageBps}
          setSlippageBps={setSlippageBps}
          onMint={handleMint}
          onApprove={handleApprove}
          onSwap={handleSwap}
          hasTokenAddrs={!!token0.address && !!token1.address}
        />
      ) : (
        <motion.button
          onClick={handleSimulate}
          disabled={!validTrade}
          className="mt-4 w-full rounded-2xl bg-gradient-to-r from-blue-500 to-purple-600 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-500/20 transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          whileHover={validTrade ? { scale: 1.02 } : {}}
          whileTap={validTrade ? { scale: 0.98 } : {}}
        >
          <div className="flex items-center justify-center gap-2">
            <Zap className="h-4 w-4" />
            Simulate Swap
          </div>
        </motion.button>
      )}
    </div>
  );
}

// ─── Live action area ─────────────────────────────────────────────────────────

interface LiveActionsProps {
  wallet: ReturnType<typeof useWallet>;
  tokenInSymbol: string;
  validTrade: boolean;
  insufficientBalance: boolean;
  needsApproval: boolean;
  busy: boolean;
  txStatus: TxStatus;
  txHash: string | null;
  txError: string | null;
  slippageBps: number;
  setSlippageBps: (v: number) => void;
  onMint: () => void;
  onApprove: () => void;
  onSwap: () => void;
  hasTokenAddrs: boolean;
}

function LiveActions(p: LiveActionsProps) {
  const { wallet } = p;

  if (!wallet.hasWallet) {
    return (
      <div className="mt-4 flex items-center gap-2 rounded-xl bg-muted/30 px-3 py-2.5 text-xs text-muted-foreground border border-border/30">
        <Info className="h-3.5 w-3.5 shrink-0" />
        No wallet detected. Install MetaMask to trade live.
      </div>
    );
  }

  if (!wallet.account) {
    return (
      <motion.button
        onClick={wallet.connect}
        disabled={wallet.connecting}
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-blue-500 to-purple-600 py-2.5 text-sm font-semibold text-white shadow-lg shadow-blue-500/20 transition hover:opacity-90 disabled:opacity-50"
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
      >
        <Wallet className="h-4 w-4" />
        {wallet.connecting ? "Connecting…" : "Connect Wallet"}
      </motion.button>
    );
  }

  if (!wallet.isCorrectNetwork) {
    return (
      <motion.button
        onClick={wallet.switchNetwork}
        className="mt-4 w-full rounded-2xl bg-amber-500/20 py-2.5 text-sm font-semibold text-amber-200 border border-amber-500/30 transition hover:bg-amber-500/30"
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
      >
        Switch to Sepolia
      </motion.button>
    );
  }

  const actionLabel = p.insufficientBalance
    ? `Insufficient ${p.tokenInSymbol}`
    : p.needsApproval
      ? `Approve ${p.tokenInSymbol}`
      : "Swap";

  const actionDisabled = !p.validTrade || p.insufficientBalance || p.busy;
  const onAction = p.needsApproval ? p.onApprove : p.onSwap;

  return (
    <div className="mt-4 space-y-3">
      {/* Slippage selector */}
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">Slippage tolerance</span>
        <div className="flex items-center gap-1">
          {SLIPPAGE_PRESETS.map((bps) => (
            <motion.button
              key={bps}
              onClick={() => p.setSlippageBps(bps)}
              className={cn(
                "rounded-md px-2 py-0.5 text-[11px] font-medium tabular-nums transition",
                p.slippageBps === bps
                  ? "bg-blue-500/20 text-blue-300 ring-1 ring-blue-500/30"
                  : "text-muted-foreground hover:text-foreground",
              )}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              {(bps / 100).toFixed(bps < 100 ? 1 : 0)}%
            </motion.button>
          ))}
          <input
            type="number" min={0} max={100} step={0.1}
            value={(p.slippageBps / 100).toString()}
            onChange={(e) => p.setSlippageBps(Math.round(Number(e.target.value) * 100))}
            className="w-12 rounded-md bg-muted/50 px-1.5 py-0.5 text-right text-[11px] text-foreground border border-border/30 outline-none"
            aria-label="Custom slippage percent"
          />
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex gap-2">
        <motion.button
          onClick={p.onMint}
          disabled={p.busy || !p.hasTokenAddrs}
          title="Mint test tokens to your wallet"
          className="flex shrink-0 items-center justify-center gap-1.5 rounded-xl bg-muted/50 border border-border/50 px-3 py-2.5 text-xs font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-50"
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
        >
          {p.txStatus === "minting" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Droplet className="h-4 w-4" />}
          Faucet
        </motion.button>
        <motion.button
          onClick={onAction}
          disabled={actionDisabled}
          className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-blue-500 to-purple-600 py-2.5 text-sm font-semibold text-white shadow-lg shadow-blue-500/20 transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          whileHover={!actionDisabled ? { scale: 1.02 } : {}}
          whileTap={!actionDisabled ? { scale: 0.98 } : {}}
        >
          {(p.txStatus === "approving" || p.txStatus === "swapping") && (
            <Loader2 className="h-4 w-4 animate-spin" />
          )}
          {p.txStatus === "approving" ? "Approving…" : p.txStatus === "swapping" ? "Swapping…" : actionLabel}
        </motion.button>
      </div>

      {p.txStatus === "success" && p.txHash && (
        <a
          href={`${ETHERSCAN_TX}${p.txHash}`}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1.5 text-xs text-emerald-300 transition hover:text-emerald-200"
        >
          <CheckCircle2 className="h-3.5 w-3.5" />
          Confirmed — view on Etherscan
          <ExternalLink className="h-3 w-3" />
        </a>
      )}
      {p.txStatus === "error" && p.txError && (
        <p className="flex items-start gap-1.5 text-xs text-red-300">
          <Info className="h-3.5 w-3.5 shrink-0" />
          <span className="break-words">{p.txError}</span>
        </p>
      )}
    </div>
  );
}

function TokenBadge({ symbol }: { symbol: string }) {
  return (
    <span className="flex shrink-0 items-center gap-1.5 rounded-lg bg-muted border border-border/50 px-3 py-1.5 text-sm font-semibold text-foreground">
      {symbol}
    </span>
  );
}

function QuoteRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tabular-nums">{children}</dd>
    </div>
  );
}
