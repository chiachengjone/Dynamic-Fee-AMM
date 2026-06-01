// Type declarations for amm.js — allows TypeScript files to import it with full type safety.

export declare const BASE_FEE: bigint;
export declare const MAX_FEE: bigint;
export declare const DECAY_HALFLIFE: bigint;
export declare const VOLATILITY_ALPHA: bigint;
export declare const VOLATILITY_SCALE: bigint;
export declare const FEE_DENOMINATOR: bigint;
export declare const UINT112_MAX: bigint;
export declare const MULTIPLIER_MIN: bigint;
export declare const MULTIPLIER_MAX: bigint;

export interface FeeResult {
  feeBps: bigint;
  newVolatility: bigint;
  priceImpact: bigint;
  baseFeeBps: bigint;
}

export interface QuoteResult extends FeeResult {
  amountOut: bigint;
}

export declare function toBig(v: unknown): bigint;
export declare function clampMultiplier(m: number | bigint): bigint;

export declare function calculateDynamicFee(params: {
  amountIn: bigint;
  reserveIn: bigint;
  volatility?: bigint;
  timeElapsed?: number;
  multiplier?: number;
}): FeeResult;

export declare function getAmountOut(params: {
  amountIn: bigint;
  reserveIn: bigint;
  reserveOut: bigint;
  feeBps: bigint;
}): bigint;

export declare function quoteSwap(params: {
  amountIn: bigint;
  reserveIn: bigint;
  reserveOut: bigint;
  volatility?: bigint;
  timeElapsed?: number;
  multiplier?: number;
}): QuoteResult;

export declare function toWei(value: string | number, decimals?: number): bigint;
export declare function fromWei(value: bigint | string | number, decimals?: number): string;
export declare function fmtAmount(weiValue: bigint | string | number, decimals?: number, maxFrac?: number): string;
export declare function bpsToPct(feeBps: bigint | number, frac?: number): string;
export declare function spotPrice(reserve0: bigint, reserve1: bigint, dec0?: number, dec1?: number): number;
export declare function hazardLabel(multiplier: number | bigint): { label: string; tone: string };
