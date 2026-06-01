/**
 * amm.js — Client-side mirror of DynamicFeePool's on-chain math.
 *
 * Every value that touches reserves or trade amounts is handled as a BigInt and
 * follows Solidity's exact integer-division and bit-shift semantics. This keeps
 * the dashboard's swap preview bit-for-bit consistent with the contract and
 * eliminates the floating-point rounding drift you'd get from doing AMM math in
 * JS `Number`s (which overflow MAX_SAFE_INTEGER well before 1e18 wei).
 *
 * The functions below intentionally use the same names and structure as the
 * Solidity so the two can be diffed side by side:
 *   - calculateDynamicFee(...)  ⇆  DynamicFeePool.calculateDynamicFee
 *   - getAmountOut(...)         ⇆  DynamicFeePool.getAmountOut
 */

import { parseUnits, formatUnits } from "ethers";

// ─── Protocol constants (mirror the contract) ────────────────────────────────
export const BASE_FEE = 30n; // 0.30% floor, in bps
export const MAX_FEE = 150n; // 1.50% structural ceiling, in bps
export const DECAY_HALFLIFE = 60n; // seconds per EMA half-life
export const VOLATILITY_ALPHA = 15n;
export const VOLATILITY_SCALE = 1000n;
export const FEE_DENOMINATOR = 10000n;
export const UINT112_MAX = (1n << 112n) - 1n;

export const MULTIPLIER_MIN = 100n; // 1.0× neutral baseline
export const MULTIPLIER_MAX = 200n; // 2.0× max macro hazard

// ─── BigInt helpers ───────────────────────────────────────────────────────────
const bmin = (a, b) => (a < b ? a : b);
const bmax = (a, b) => (a > b ? a : b);

export function toBig(v) {
  if (typeof v === "bigint") return v;
  if (v === null || v === undefined || v === "") return 0n;
  return BigInt(v);
}

/** Clamp any incoming multiplier into the on-chain-enforced [100, 200] range. */
export function clampMultiplier(m) {
  let v = toBig(typeof m === "number" ? Math.trunc(m) : m);
  if (v < MULTIPLIER_MIN) v = MULTIPLIER_MIN;
  if (v > MULTIPLIER_MAX) v = MULTIPLIER_MAX;
  return v;
}

/**
 * Mirror of DynamicFeePool.calculateDynamicFee.
 *
 * @returns {{ feeBps: bigint, newVolatility: bigint, priceImpact: bigint, baseFeeBps: bigint }}
 *   feeBps      — final macro-scaled fee, clamped to MAX_FEE
 *   baseFeeBps  — the pre-multiplier dynamic fee (clamped to [BASE_FEE, MAX_FEE])
 */
export function calculateDynamicFee({
  amountIn,
  reserveIn,
  volatility = 0n,
  timeElapsed = 0,
  multiplier = 100,
}) {
  const amt = toBig(amountIn);
  const rIn = toBig(reserveIn);
  const vol = toBig(volatility);
  const te = BigInt(Math.max(0, Math.trunc(Number(timeElapsed) || 0)));
  const mult = clampMultiplier(multiplier);

  // Step 1 — time decay via right shift (x >> n ≈ x / 2^n).
  const shift = te / DECAY_HALFLIFE;
  const decayedVolatility = shift >= 112n ? 0n : vol >> shift;

  // Step 2 — current trade's price impact (guard against div-by-zero).
  const priceImpact = rIn === 0n ? 0n : (amt * 10000n) / rIn;
  const newVolatility = decayedVolatility + priceImpact;

  // Step 3 — base dynamic fee, clamped to [BASE_FEE, MAX_FEE].
  const rawFee = BASE_FEE + (newVolatility * VOLATILITY_ALPHA) / VOLATILITY_SCALE;
  const baseFeeBps = bmax(bmin(rawFee, MAX_FEE), BASE_FEE);

  // Step 4 — macro scaling, re-clamped to the structural ceiling.
  const scaledFee = (baseFeeBps * mult) / 100n;
  const feeBps = bmin(MAX_FEE, scaledFee);

  return { feeBps, newVolatility, priceImpact, baseFeeBps };
}

/** Mirror of DynamicFeePool.getAmountOut (constant-product with fee). */
export function getAmountOut({ amountIn, reserveIn, reserveOut, feeBps }) {
  const amt = toBig(amountIn);
  const rIn = toBig(reserveIn);
  const rOut = toBig(reserveOut);
  const fee = toBig(feeBps);
  if (amt <= 0n || rIn <= 0n || rOut <= 0n) return 0n;

  const feeMul = FEE_DENOMINATOR - fee;
  const amountInWithFee = amt * feeMul;
  return (rOut * amountInWithFee) / (rIn * FEE_DENOMINATOR + amountInWithFee);
}

/**
 * Full swap quote: fee + output in one call, exactly as the on-chain swap()
 * would compute it for the given pool state.
 */
export function quoteSwap({
  amountIn,
  reserveIn,
  reserveOut,
  volatility = 0n,
  timeElapsed = 0,
  multiplier = 100,
}) {
  const fee = calculateDynamicFee({ amountIn, reserveIn, volatility, timeElapsed, multiplier });
  const amountOut = getAmountOut({ amountIn, reserveIn, reserveOut, feeBps: fee.feeBps });
  return { ...fee, amountOut };
}

// ─── Formatting helpers (display only — never feed these back into math) ──────

/** Parse a human decimal string ("10.5") into wei BigInt. Never throws. */
export function toWei(value, decimals = 18) {
  try {
    return parseUnits(String(value ?? "0").trim() || "0", decimals);
  } catch {
    return 0n;
  }
}

/** Exact wei → decimal string conversion. */
export function fromWei(value, decimals = 18) {
  return formatUnits(toBig(value), decimals);
}

/** Pretty token amount with bounded fraction digits. */
export function fmtAmount(weiValue, decimals = 18, maxFrac = 6) {
  const s = formatUnits(toBig(weiValue), decimals);
  const n = Number(s);
  if (!Number.isFinite(n)) return s;
  return n.toLocaleString(undefined, { maximumFractionDigits: maxFrac });
}

/** bps (BigInt) → percentage string, e.g. 45n → "0.45%". */
export function bpsToPct(feeBps, frac = 2) {
  return `${(Number(toBig(feeBps)) / 100).toFixed(frac)}%`;
}

/** Spot price of token0 denominated in token1 (display float). */
export function spotPrice(reserve0, reserve1, dec0 = 18, dec1 = 18) {
  const r0 = Number(formatUnits(toBig(reserve0), dec0));
  const r1 = Number(formatUnits(toBig(reserve1), dec1));
  if (!r0) return 0;
  return r1 / r0;
}

/**
 * Multiplier → human macro-hazard label. Mirrors the spirit of the Phase 5
 * Python relayer's penalty banding so the on-chain value reads intuitively.
 */
export function hazardLabel(multiplier) {
  const m = Number(clampMultiplier(multiplier));
  if (m <= 105) return { label: "Neutral", tone: "emerald" };
  if (m <= 130) return { label: "Elevated", tone: "yellow" };
  if (m <= 160) return { label: "Stressed", tone: "orange" };
  return { label: "Extreme Hazard", tone: "red" };
}
