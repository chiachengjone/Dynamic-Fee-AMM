import { useCallback, useEffect, useMemo, useState } from "react";
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
  /** Record the on-chain swap in Trade History immediately (from its receipt). */
  onRecordTrade: (feeBps: bigint, volatility: bigint, txHash: string) => void;
}

const ETHERSCAN_TX = "https://sepolia.etherscan.io/tx/";
// Faucet mints this many of each pair token (18-decimal mocks).
const FAUCET_AMOUNT = 1000n * 10n ** 18n;
const SLIPPAGE_PRESETS = [10, 50, 100]; // bps → 0.1%, 0.5%, 1%

type TxStatus = "idle" | "minting" | "approving" | "swapping" | "success" | "error";

/**
 * Pair-aware swap panel.
 *
 * Sandbox mode: "Simulate Swap" mutates in-memory reserves (unchanged).
 * Live mode: a real MetaMask flow — connect → switch network → mint test
 * tokens → approve → swap — settling on the deployed pool. After a swap the
 * parent's onSwapped() refreshes reserves; the pool's Swap/FeeUpdated events
 * also populate the Trade History chart automatically.
 *
 * The output quote uses the same BigInt constant-product math as the contract.
 */
export default function SwapPanel({ state, mode, onSimulate, poolAddress, onSwapped, onRecordTrade }: SwapPanelProps) {
  const {
    token0,
    token1,
    reserve0,
    reserve1,
    externalChaosMultiplier,
    volatility,
    lastTimestamp,
  } = state;

  const isLive = mode === "live";
  const wallet = useWallet();

  // true = sell token0, false = sell token1
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
    return quoteSwap({
      amountIn: amountInWei,
      reserveIn,
      reserveOut,
      volatility,
      timeElapsed,
      multiplier: externalChaosMultiplier,
    });
  }, [amountInWei, reserveIn, reserveOut, volatility, lastTimestamp, externalChaosMultiplier]);

  const exceedsReserves = quote.amountOut >= toBig(reserveOut);
  const validTrade = amountInWei > 0n && quote.amountOut > 0n && !exceedsReserves;

  const execPrice = useMemo(() => {
    if (amountInWei <= 0n || quote.amountOut <= 0n) return null;
    const inFloat = Number(amountInWei) / 10 ** tokenIn.decimals;
    const outFloat = Number(quote.amountOut) / 10 ** tokenOut.decimals;
    return inFloat > 0 ? outFloat / inFloat : null;
  }, [amountInWei, quote.amountOut, tokenIn.decimals, tokenOut.decimals]);

  const priceImpactPct = (Number(quote.priceImpact) / 100).toFixed(2);

  // ── Live wallet state ──────────────────────────────────────────────────────
  const [slippageBps, setSlippageBps] = useState(50);
  const [balance, setBalance]     = useState<bigint | null>(null);
  const [allowance, setAllowance] = useState<bigint>(0n);
  const [txStatus, setTxStatus]   = useState<TxStatus>("idle");
  const [txHash, setTxHash]       = useState<string | null>(null);
  const [txError, setTxError]     = useState<string | null>(null);
  const [txNonce, setTxNonce]     = useState(0); // bump to re-read balance/allowance

  const canRead =
    isLive && !!wallet.account && wallet.isCorrectNetwork && !!tokenIn.address && !!poolAddress;

  // Fetch balance + allowance for the active input token.
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
    setZeroForOne((v) => !v);
    setAmount("");
    setTxStatus("idle"); setTxHash(null); setTxError(null);
  }

  function handleSimulate() {
    if (!validTrade) return;
    onSimulate(zeroForOne, amountInWei);
    setAmount("");
  }

  // ── Live actions ───────────────────────────────────────────────────────────
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
        if (kind === "swap") {
          setAmount("");
          onSwapped();
        }
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
      // Append to Trade History immediately from the receipt (no event-poll lag).
      onRecordTrade(res.feeBps, res.volatility, res.hash);
      return res.hash;
    });
  }, [wallet, tokenIn.address, poolAddress, quote.amountOut, slippageBps, amountInWei, runTx, onRecordTrade]);

  return (
    <div className="rounded-2xl bg-slate-900/60 p-5 ring-1 ring-white/10 backdrop-blur">
      <div className="flex items-center gap-2">
        <Zap className="h-4 w-4 text-sky-300" />
        <h2 className="text-sm font-semibold text-slate-200">
          {isLive ? "Swap" : "Swap Simulator"}
        </h2>
        <span className="ml-auto text-[11px] text-slate-500 tabular-nums">
          {tokenIn.symbol} → {tokenOut.symbol}
        </span>
      </div>

      {/* Token In */}
      <div className="mt-4 rounded-xl bg-slate-950/60 p-3 ring-1 ring-white/5">
        <div className="flex items-center justify-between text-xs text-slate-500">
          <span>You pay</span>
          {isLive && balance !== null ? (
            <button
              onClick={() => setAmount(fromWei(balance, tokenIn.decimals))}
              className="transition hover:text-slate-300"
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
            type="text"
            inputMode="decimal"
            value={amount}
            onChange={handleAmountChange}
            placeholder="0.0"
            className="w-full bg-transparent text-2xl font-semibold tabular-nums text-slate-100 outline-none placeholder:text-slate-600"
          />
          <TokenBadge symbol={tokenIn.symbol} />
        </div>
      </div>

      {/* Flip */}
      <div className="relative flex justify-center">
        <button
          onClick={handleFlip}
          className="-my-3 z-10 grid h-9 w-9 place-items-center rounded-xl bg-slate-800 text-slate-300 ring-4 ring-slate-900 transition hover:bg-slate-700"
          aria-label="Flip swap direction"
        >
          <ArrowDownUp className="h-4 w-4" />
        </button>
      </div>

      {/* Token Out */}
      <div className="rounded-xl bg-slate-950/60 p-3 ring-1 ring-white/5">
        <div className="flex items-center justify-between text-xs text-slate-500">
          <span>You receive</span>
          <span>pool: {fmtAmount(reserveOut, tokenOut.decimals, 4)} {tokenOut.symbol}</span>
        </div>
        <div className="mt-1 flex items-center gap-3">
          <span className={cn("w-full text-2xl font-semibold tabular-nums", validTrade ? "text-emerald-300" : "text-slate-600")}>
            {fmtAmount(quote.amountOut, tokenOut.decimals, 6)}
          </span>
          <TokenBadge symbol={tokenOut.symbol} />
        </div>
      </div>

      {/* Quote breakdown */}
      <dl className="mt-4 space-y-2 text-xs">
        <QuoteRow label="Dynamic fee">
          <span className="font-medium text-amber-300">
            {bpsToPct(quote.feeBps)} <span className="text-slate-500">({Number(quote.feeBps)} bps)</span>
          </span>
        </QuoteRow>
        <QuoteRow label="Base fee (pre-multiplier)">
          <span className="text-slate-300">
            {bpsToPct(quote.baseFeeBps)} <span className="text-slate-500">({Number(quote.baseFeeBps)} bps)</span>
          </span>
        </QuoteRow>
        <QuoteRow label="Price impact">
          <span className={cn(Number(priceImpactPct) > 5 ? "text-orange-300" : "text-slate-300")}>{priceImpactPct}%</span>
        </QuoteRow>
        <QuoteRow label="Exec. price">
          <span className="text-slate-300">
            {execPrice != null
              ? `1 ${tokenIn.symbol} ≈ ${execPrice.toLocaleString(undefined, { maximumFractionDigits: 6 })} ${tokenOut.symbol}`
              : "—"}
          </span>
        </QuoteRow>
        {isLive && validTrade && (
          <QuoteRow label="Min received">
            <span className="text-slate-300">
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
        <button
          onClick={handleSimulate}
          disabled={!validTrade}
          className="mt-4 w-full rounded-xl bg-gradient-to-r from-sky-500 to-fuchsia-500 py-2.5 text-sm font-semibold text-white shadow-lg shadow-sky-500/20 transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Simulate Swap
        </button>
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

  // 1. No wallet installed
  if (!wallet.hasWallet) {
    return (
      <div className="mt-4 flex items-center gap-2 rounded-xl bg-slate-950/60 px-3 py-2.5 text-xs text-slate-400 ring-1 ring-white/5">
        <Info className="h-3.5 w-3.5 shrink-0" />
        No wallet detected. Install MetaMask to trade live.
      </div>
    );
  }

  // 2. Not connected
  if (!wallet.account) {
    return (
      <button
        onClick={wallet.connect}
        disabled={wallet.connecting}
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-sky-500 to-fuchsia-500 py-2.5 text-sm font-semibold text-white shadow-lg shadow-sky-500/20 transition hover:opacity-90 disabled:opacity-50"
      >
        <Wallet className="h-4 w-4" />
        {wallet.connecting ? "Connecting…" : "Connect Wallet"}
      </button>
    );
  }

  // 3. Wrong network
  if (!wallet.isCorrectNetwork) {
    return (
      <button
        onClick={wallet.switchNetwork}
        className="mt-4 w-full rounded-xl bg-amber-500/20 py-2.5 text-sm font-semibold text-amber-200 ring-1 ring-amber-500/30 transition hover:bg-amber-500/30"
      >
        Switch to Sepolia
      </button>
    );
  }

  // 4. Connected + correct network → faucet, slippage, staged action
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
        <span className="text-slate-500">Slippage tolerance</span>
        <div className="flex items-center gap-1">
          {SLIPPAGE_PRESETS.map((bps) => (
            <button
              key={bps}
              onClick={() => p.setSlippageBps(bps)}
              className={cn(
                "rounded-md px-2 py-0.5 text-[11px] font-medium tabular-nums transition",
                p.slippageBps === bps
                  ? "bg-sky-500/20 text-sky-300 ring-1 ring-sky-500/30"
                  : "text-slate-400 hover:text-slate-200",
              )}
            >
              {(bps / 100).toFixed(bps < 100 ? 1 : 0)}%
            </button>
          ))}
          <input
            type="number"
            min={0}
            max={100}
            step={0.1}
            value={(p.slippageBps / 100).toString()}
            onChange={(e) => p.setSlippageBps(Math.round(Number(e.target.value) * 100))}
            className="w-12 rounded-md bg-slate-950/60 px-1.5 py-0.5 text-right text-[11px] text-slate-200 ring-1 ring-white/10 outline-none"
            aria-label="Custom slippage percent"
          />
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex gap-2">
        <button
          onClick={p.onMint}
          disabled={p.busy || !p.hasTokenAddrs}
          title="Mint test tokens to your wallet"
          className="flex shrink-0 items-center justify-center gap-1.5 rounded-xl bg-white/5 px-3 py-2.5 text-xs font-medium text-slate-300 ring-1 ring-white/10 transition hover:bg-white/10 disabled:opacity-50"
        >
          {p.txStatus === "minting" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Droplet className="h-4 w-4" />}
          Faucet
        </button>
        <button
          onClick={onAction}
          disabled={actionDisabled}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-sky-500 to-fuchsia-500 py-2.5 text-sm font-semibold text-white shadow-lg shadow-sky-500/20 transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {(p.txStatus === "approving" || p.txStatus === "swapping") && (
            <Loader2 className="h-4 w-4 animate-spin" />
          )}
          {p.txStatus === "approving" ? "Approving…" : p.txStatus === "swapping" ? "Swapping…" : actionLabel}
        </button>
      </div>

      {/* Tx feedback */}
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
    <span className="flex shrink-0 items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-1.5 text-sm font-semibold text-slate-200">
      {symbol}
    </span>
  );
}

function QuoteRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-slate-500">{label}</dt>
      <dd className="tabular-nums">{children}</dd>
    </div>
  );
}
