/**
 * usePairPoolState — free-form token-pair state engine.
 *
 * Accepts any two tokens from TOKEN_REGISTRY rather than a fixed pair config.
 * The pairId (`${base.id}-${quote.id}`) keys all per-pair sandbox state and fee
 * history, so switching tokens never loses progress for previously simulated pairs.
 *
 * Live mode:
 *   Queries PoolFactory.getPool(base, quote) to discover the on-chain pool
 *   address dynamically. If no pool is deployed for the chosen combination the
 *   hook falls back to sandbox mode and surfaces an informative message.
 *   When base/quote changes the previous contract's event listeners are fully
 *   torn down (removeAllListeners + provider.destroy) before new ones start.
 *
 * Sandbox mode:
 *   Reserves are initialised via computeSandboxReserves — each token contributes
 *   its pre-sized $300 k liquidity bucket, giving a realistic opening spot price
 *   for any combination without per-pair configuration.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { ethers } from "ethers";
import type { TokenConfig } from "../config/tokenRegistry.js";
import { computeSandboxReserves, getPairId } from "../config/tokenRegistry.js";
import { POOL_ABI, ERC20_ABI, FACTORY_ABI } from "../lib/poolAbi.js";
import { quoteSwap, UINT112_MAX, toBig, spotPrice } from "../lib/amm.js";

// ─── Environment ──────────────────────────────────────────────────────────────

const RPC_URL         = import.meta.env.VITE_RPC_URL?.trim()         as string | undefined;
const FACTORY_ADDRESS = import.meta.env.VITE_FACTORY_ADDRESS?.trim() as string | undefined;
const POLL_INTERVAL_MS = Number(import.meta.env.VITE_POLL_INTERVAL_MS) || 8000;
const HAS_LIVE_CONFIG  = !!RPC_URL;

const MAX_HISTORY_POINTS = 120;

// ─── Public types ─────────────────────────────────────────────────────────────

export interface TokenInfo {
  address: string | null;
  symbol: string;
  decimals: number;
}

export interface PoolDataState {
  token0: TokenInfo;
  token1: TokenInfo;
  /** True when the user-chosen base token occupies the pool's token0 slot. */
  baseIsToken0: boolean;
  reserve0: bigint;
  reserve1: bigint;
  externalChaosMultiplier: number;
  volatility: bigint;
  lastTimestamp: number;
}

export interface FeeHistoryPoint {
  tradeIdx:   number;
  t:          number;  // unix seconds
  feeBps:     number;
  baseFeeBps: number;
  volatility: number;
  price:      number;  // base / quote spot
  txHash?:    string;  // on-chain swaps only — used to dedupe receipt vs event
}

export interface UsePairPoolStateResult {
  state:          PoolDataState;
  feeHistory:     FeeHistoryPoint[];
  mode:           "live" | "sandbox";
  error:          string | null;
  lastSync:       Date | null;
  connecting:     boolean;
  hasLiveConfig:  boolean;
  poolAddress:    string | null;
  refresh:        () => Promise<void>;
  applySwap:      (zeroForOne: boolean, amountInWei: bigint) => void;
  /** Record a confirmed on-chain swap immediately (from its tx receipt). */
  recordTrade:    (feeBps: bigint, volatility: bigint, txHash: string) => void;
  setMultiplier:  (value: number) => void;
  resetPair:      () => void;
}

// ─── Internal sandbox types ───────────────────────────────────────────────────

interface SandboxPoolState {
  reserve0:               bigint;
  reserve1:               bigint;
  externalChaosMultiplier: number;
  volatility:             bigint;
  lastTimestamp:          number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeSandboxPoolState(
  base:  TokenConfig,
  quote: TokenConfig,
): SandboxPoolState {
  const { reserveBase, reserveQuote } = computeSandboxReserves(base, quote);
  return {
    reserve0:                reserveBase,
    reserve1:                reserveQuote,
    externalChaosMultiplier: 100,
    volatility:              0n,
    lastTimestamp:           Math.floor(Date.now() / 1000),
  };
}

function toDisplayState(
  base:  TokenConfig,
  quote: TokenConfig,
  s:     SandboxPoolState,
): PoolDataState {
  return {
    token0:                  { address: null, symbol: base.symbol,  decimals: 18 },
    token1:                  { address: null, symbol: quote.symbol, decimals: 18 },
    baseIsToken0:            true,
    reserve0:                s.reserve0,
    reserve1:                s.reserve1,
    externalChaosMultiplier: s.externalChaosMultiplier,
    volatility:              s.volatility,
    lastTimestamp:           s.lastTimestamp,
  };
}

async function resolvePoolAddress(
  provider: ethers.JsonRpcProvider,
  base:     TokenConfig,
  quote:    TokenConfig,
): Promise<string | null> {
  if (!FACTORY_ADDRESS) return null;
  try {
    const factory = new ethers.Contract(FACTORY_ADDRESS, FACTORY_ABI, provider);
    const addr = await factory.getPool(base.contractAddress, quote.contractAddress) as string;
    return addr === ethers.ZeroAddress ? null : addr;
  } catch {
    return null;
  }
}

async function readOnChain(
  provider:       ethers.JsonRpcProvider,
  contract:       ethers.Contract,
  metaCache:      Record<string, { symbol: string; decimals: number }>,
): Promise<{
  addr0: string; addr1: string;
  dec0: number;  dec1: number;
  r0: bigint;    r1: bigint;
  multiplier: number;
  volatility: bigint;
  lastTs: number;
}> {
  const [reserves, multiplier, vol, lastTs, addr0, addr1] = await Promise.all([
    contract.getReserves(),
    contract.externalChaosMultiplier(),
    contract.cumulativeVolatilityTracker(),
    contract.lastTransactionTimestamp(),
    contract.token0(),
    contract.token1(),
  ]);

  async function meta(addr: string, fallback: string) {
    if (metaCache[addr]) return metaCache[addr];
    let symbol = fallback; let decimals = 18;
    try {
      const erc20 = new ethers.Contract(addr, ERC20_ABI, provider);
      [symbol, decimals] = await Promise.all([erc20.symbol(), erc20.decimals()]);
      decimals = Number(decimals);
    } catch { /* non-standard token */ }
    const m = { symbol, decimals };
    metaCache[addr] = m;
    return m;
  }

  const [m0, m1] = await Promise.all([
    meta(addr0 as string, "T0"),
    meta(addr1 as string, "T1"),
  ]);

  return {
    addr0: addr0 as string, addr1: addr1 as string,
    dec0: m0.decimals,      dec1: m1.decimals,
    r0: toBig(reserves[0]), r1: toBig(reserves[1]),
    multiplier: Number(multiplier),
    volatility: toBig(vol),
    lastTs: Number(lastTs),
  };
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function usePairPoolState(
  baseToken:  TokenConfig,
  quoteToken: TokenConfig,
): UsePairPoolStateResult {

  // Stable mutable refs — never trigger re-renders on their own.
  const sandboxStoreRef = useRef<Record<string, SandboxPoolState>>({});
  const historyRef      = useRef<Record<string, FeeHistoryPoint[]>>({});
  // Per-pair set of recorded tx hashes — dedupes a swap that arrives via both
  // its receipt (immediate) and the FeeUpdated event listener (delayed).
  const seenTxRef       = useRef<Record<string, Set<string>>>({});
  const metaCacheRef    = useRef<Record<string, { symbol: string; decimals: number }>>({});
  // Tracks the active pairId inside async callbacks without stale closure risk.
  const activePairIdRef = useRef(getPairId(baseToken, quoteToken));

  function ensureSandbox(b: TokenConfig, q: TokenConfig): SandboxPoolState {
    const pid = getPairId(b, q);
    if (!sandboxStoreRef.current[pid]) {
      sandboxStoreRef.current[pid] = makeSandboxPoolState(b, q);
    }
    return sandboxStoreRef.current[pid];
  }

  function getHistory(pid: string): FeeHistoryPoint[] {
    return historyRef.current[pid] ?? [];
  }

  function appendHistory(pid: string, point: FeeHistoryPoint) {
    // Dedupe on-chain swaps that surface twice (receipt + event).
    if (point.txHash) {
      const seen = seenTxRef.current[pid] ?? (seenTxRef.current[pid] = new Set());
      if (seen.has(point.txHash)) return;
      seen.add(point.txHash);
    }
    const next = [...getHistory(pid), point].slice(-MAX_HISTORY_POINTS);
    historyRef.current[pid] = next;
    if (pid === activePairIdRef.current) setFeeHistory(next);
  }

  // ── React state ──────────────────────────────────────────────────────────────
  const [state, setState]         = useState<PoolDataState>(() =>
    toDisplayState(baseToken, quoteToken, ensureSandbox(baseToken, quoteToken)),
  );
  const [feeHistory,  setFeeHistory]  = useState<FeeHistoryPoint[]>([]);
  const [mode,        setMode]        = useState<"live" | "sandbox">(
    HAS_LIVE_CONFIG ? "live" : "sandbox",
  );
  const [error,       setError]       = useState<string | null>(null);
  const [lastSync,    setLastSync]    = useState<Date | null>(null);
  const [connecting,  setConnecting]  = useState(HAS_LIVE_CONFIG);
  const [poolAddress, setPoolAddress] = useState<string | null>(null);

  // ── Main effect — re-runs whenever base OR quote token changes ───────────────
  useEffect(() => {
    const pairId = getPairId(baseToken, quoteToken);
    activePairIdRef.current = pairId;

    // Snapshot the tokens for safe use inside async closures.
    const base  = baseToken;
    const quote = quoteToken;

    // Immediate: render this pair's persisted sandbox state right away so the
    // UI never shows stale data from the previous pair while (re)connecting.
    const sandbox = ensureSandbox(base, quote);
    setState(toDisplayState(base, quote, sandbox));
    setFeeHistory(getHistory(pairId));
    setPoolAddress(null);

    if (!HAS_LIVE_CONFIG) {
      setMode("sandbox");
      setConnecting(false);
      return;
    }

    // ── Live setup ───────────────────────────────────────────────────────────
    setConnecting(true);
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    let contract: ethers.Contract | null = null;
    let cancelled   = false;
    let pollTimer:  ReturnType<typeof setInterval> | null = null;

    async function tick() {
      if (cancelled || !contract) return;
      try {
        const snap = await readOnChain(provider, contract, metaCacheRef.current);
        if (cancelled || pairId !== activePairIdRef.current) return;

        const baseIsToken0 =
          snap.addr0.toLowerCase() === base.contractAddress.toLowerCase();

        const next: PoolDataState = {
          token0: {
            address:  snap.addr0,
            symbol:   baseIsToken0 ? base.symbol  : quote.symbol,
            decimals: snap.dec0,
          },
          token1: {
            address:  snap.addr1,
            symbol:   baseIsToken0 ? quote.symbol : base.symbol,
            decimals: snap.dec1,
          },
          baseIsToken0,
          reserve0:                snap.r0,
          reserve1:                snap.r1,
          externalChaosMultiplier: snap.multiplier,
          volatility:              snap.volatility,
          lastTimestamp:           snap.lastTs,
        };

        setState(next);
        setMode("live");
        setError(null);
        setLastSync(new Date());
      } catch (err: unknown) {
        if (cancelled) return;
        const msg =
          (err as { shortMessage?: string })?.shortMessage ??
          (err as { message?: string })?.message ??
          "unknown error";
        setMode("sandbox");
        setError(`RPC unreachable (${msg}). Running in sandbox mode.`);
      } finally {
        if (!cancelled) setConnecting(false);
      }
    }

    // FeeUpdated → record history point without a full re-read. Best-effort
    // catch for swaps from OTHER actors; the user's own swaps are recorded
    // immediately from their receipt (recordTrade) and deduped by tx hash.
    function onFeeUpdated(feeBpsRaw: bigint, volRaw: bigint, payload?: unknown) {
      if (cancelled || pairId !== activePairIdRef.current) return;
      const txHash = (payload as { log?: { transactionHash?: string } })?.log?.transactionHash;
      setState((cur) => {
        const price = spotPrice(
          cur.reserve0, cur.reserve1,
          cur.token0.decimals, cur.token1.decimals,
        );
        const feeBpsNum  = Number(feeBpsRaw);
        const baseFeeBpsNum = Math.round(feeBpsNum * 100 / cur.externalChaosMultiplier);
        const volNum =
          volRaw > BigInt(Number.MAX_SAFE_INTEGER)
            ? Number.MAX_SAFE_INTEGER
            : Number(volRaw);

        appendHistory(pairId, {
          tradeIdx:   getHistory(pairId).length,
          t:          Math.floor(Date.now() / 1000),
          feeBps:     feeBpsNum,
          baseFeeBps: baseFeeBpsNum,
          volatility: volNum,
          price,
          txHash,
        });
        return cur; // state is updated via tick() that follows Swap
      });
    }

    // Discover pool address from factory, then wire listeners.
    async function setup() {
      const addr = await resolvePoolAddress(provider, base, quote);
      if (cancelled || pairId !== activePairIdRef.current) return;

      if (!addr) {
        setMode("sandbox");
        setConnecting(false);
        if (FACTORY_ADDRESS) {
          setError(
            `No pool deployed for ${base.symbol}/${quote.symbol}. ` +
            "Running in sandbox mode. Deploy a pool and restart to enable live data."
          );
        }
        return;
      }

      setPoolAddress(addr);
      contract = new ethers.Contract(addr, POOL_ABI, provider);
      contract.on("Swap",       () => { if (!cancelled) tick(); });
      contract.on("FeeUpdated", onFeeUpdated);

      tick();
      pollTimer = setInterval(tick, POLL_INTERVAL_MS);
    }

    setup().catch(() => {
      if (!cancelled) {
        setMode("sandbox");
        setConnecting(false);
      }
    });

    // ── Cleanup: runs when base/quote changes or component unmounts ──────────
    return () => {
      cancelled = true;
      if (pollTimer)  clearInterval(pollTimer);
      if (contract)   contract.removeAllListeners();
      provider.destroy();
    };
  }, [baseToken.id, quoteToken.id]);   // Re-run only when a token selection changes.

  // ── Manual refresh ───────────────────────────────────────────────────────────
  const refresh = useCallback(async () => {
    if (!HAS_LIVE_CONFIG || !poolAddress) return;
    setConnecting(true);
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const contract = new ethers.Contract(poolAddress, POOL_ABI, provider);
    try {
      const snap = await readOnChain(provider, contract, metaCacheRef.current);
      const baseIsToken0 =
        snap.addr0.toLowerCase() === baseToken.contractAddress.toLowerCase();
      setState({
        token0: { address: snap.addr0, symbol: baseIsToken0 ? baseToken.symbol  : quoteToken.symbol,  decimals: snap.dec0 },
        token1: { address: snap.addr1, symbol: baseIsToken0 ? quoteToken.symbol : baseToken.symbol,  decimals: snap.dec1 },
        baseIsToken0,
        reserve0: snap.r0, reserve1: snap.r1,
        externalChaosMultiplier: snap.multiplier,
        volatility: snap.volatility,
        lastTimestamp: snap.lastTs,
      });
      setMode("live");
      setError(null);
      setLastSync(new Date());
    } catch (err: unknown) {
      const msg = (err as { shortMessage?: string })?.shortMessage ?? (err as { message?: string })?.message ?? "error";
      setMode("sandbox");
      setError(`RPC unreachable (${msg}). Running in sandbox mode.`);
    } finally {
      setConnecting(false);
      provider.destroy();
    }
  }, [baseToken, quoteToken, poolAddress]);

  // ── Sandbox mutators ─────────────────────────────────────────────────────────

  const applySwap = useCallback(
    (zeroForOne: boolean, amountInWei: bigint) => {
      const pairId = getPairId(baseToken, quoteToken);

      setState((prev) => {
        const amountIn  = toBig(amountInWei);
        if (amountIn <= 0n) return prev;

        const reserveIn  = zeroForOne ? prev.reserve0 : prev.reserve1;
        const reserveOut = zeroForOne ? prev.reserve1 : prev.reserve0;
        const now        = Math.floor(Date.now() / 1000);

        const result = quoteSwap({
          amountIn, reserveIn, reserveOut,
          volatility:  prev.volatility,
          timeElapsed: now - prev.lastTimestamp,
          multiplier:  prev.externalChaosMultiplier,
        });

        if (result.amountOut <= 0n || result.amountOut >= reserveOut) return prev;

        const clampedVol = result.newVolatility > UINT112_MAX
          ? UINT112_MAX
          : result.newVolatility;

        const newR0 = zeroForOne ? prev.reserve0 + amountIn        : prev.reserve0 - result.amountOut;
        const newR1 = zeroForOne ? prev.reserve1 - result.amountOut : prev.reserve1 + amountIn;

        const next: PoolDataState = {
          ...prev, reserve0: newR0, reserve1: newR1,
          volatility: clampedVol, lastTimestamp: now,
        };

        // Persist to per-pair sandbox store.
        sandboxStoreRef.current[pairId] = {
          reserve0: newR0, reserve1: newR1,
          externalChaosMultiplier: next.externalChaosMultiplier,
          volatility: clampedVol, lastTimestamp: now,
        };

        // Record fee history point.
        appendHistory(pairId, {
          tradeIdx:   getHistory(pairId).length,
          t:          now,
          feeBps:     Number(result.feeBps),
          baseFeeBps: Number(result.baseFeeBps),
          volatility: Number(clampedVol > BigInt(Number.MAX_SAFE_INTEGER)
            ? BigInt(Number.MAX_SAFE_INTEGER)
            : clampedVol),
          price: spotPrice(newR0, newR1, prev.token0.decimals, prev.token1.decimals),
        });

        return next;
      });
    },
    [baseToken.id, quoteToken.id],
  );

  // Record a confirmed on-chain swap immediately from its receipt, so the
  // Trade History chart updates the instant the tx mines — instead of waiting
  // on the FeeUpdated event listener's RPC polling (which can lag or miss).
  const recordTrade = useCallback(
    (feeBps: bigint, volatility: bigint, txHash: string) => {
      const pairId = getPairId(baseToken, quoteToken);
      setState((cur) => {
        const feeBpsNum = Number(feeBps);
        const baseFeeBpsNum = Math.round(feeBpsNum * 100 / cur.externalChaosMultiplier);
        const volNum =
          volatility > BigInt(Number.MAX_SAFE_INTEGER)
            ? Number.MAX_SAFE_INTEGER
            : Number(volatility);
        appendHistory(pairId, {
          tradeIdx:   getHistory(pairId).length,
          t:          Math.floor(Date.now() / 1000),
          feeBps:     feeBpsNum,
          baseFeeBps: baseFeeBpsNum,
          volatility: volNum,
          price:      spotPrice(cur.reserve0, cur.reserve1, cur.token0.decimals, cur.token1.decimals),
          txHash,
        });
        return cur;
      });
    },
    [baseToken.id, quoteToken.id],
  );

  const setMultiplier = useCallback(
    (value: number) => {
      const pairId = getPairId(baseToken, quoteToken);
      setState((prev) => {
        const next = { ...prev, externalChaosMultiplier: value };
        if (sandboxStoreRef.current[pairId]) {
          sandboxStoreRef.current[pairId].externalChaosMultiplier = value;
        }
        return next;
      });
    },
    [baseToken.id, quoteToken.id],
  );

  const resetPair = useCallback(() => {
    const pairId = getPairId(baseToken, quoteToken);
    delete sandboxStoreRef.current[pairId];
    delete historyRef.current[pairId];
    delete seenTxRef.current[pairId];
    const fresh = ensureSandbox(baseToken, quoteToken);
    setState(toDisplayState(baseToken, quoteToken, fresh));
    setFeeHistory([]);
  }, [baseToken.id, quoteToken.id]);

  return {
    state, feeHistory, mode, error,
    lastSync, connecting, hasLiveConfig: HAS_LIVE_CONFIG,
    poolAddress, refresh,
    applySwap, recordTrade, setMultiplier, resetPair,
  };
}
