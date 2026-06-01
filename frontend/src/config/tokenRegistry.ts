/**
 * tokenRegistry.ts — flat token catalogue.
 *
 * Each entry describes one ERC-20 token independently of any specific pair.
 * Pairs are composed on-the-fly by the user selecting two tokens, so N tokens
 * automatically yield N×(N-1) directional combinations without listing them.
 *
 * `sandboxLiquidity` sizes each token's reserve to roughly $300 k USD of
 * notional depth, using round-number prices as of 2025. The sandbox spot price
 * for any base/quote combination is implicitly:
 *
 *   price  =  quoteToken.sandboxLiquidity / baseToken.sandboxLiquidity
 *
 * Examples:
 *   ETH/USDC  → 300 000 / 100    = 3 000   (~$3k / ETH)
 *   WBTC/USDC → 300 000 / 3      = 100 000 (~$100k / BTC)
 *   WBTC/ETH  → 100 / 3          ~ 33.3    (~33 ETH / BTC)
 *   LINK/USDC → 300 000 / 20 000 = 15      (~$15 / LINK)
 *
 * All reserves use 18 decimals (matching MockERC20). In live mode actual
 * decimals are read from the token contract and override this.
 *
 * `contractAddress` is a placeholder — replace with your Foundry broadcast
 * addresses before enabling live mode.
 */

const SCALE = 10n ** 18n;

export interface TokenConfig {
  /** Stable identifier — used as React key and sandbox-store key. */
  id: string;
  symbol: string;
  name: string;
  /** CoinGecko id — reserved for Phase 7 price-feed integration. */
  coingeckoId: string;
  /** Local mock contract address. Replace after `forge script … --broadcast`. */
  contractAddress: string;
  /**
   * Pre-sized 18-decimal reserve for sandbox initialisation.
   * Sized so that any two tokens give a realistic opening spot price.
   */
  sandboxLiquidity: bigint;
}

export const TOKEN_REGISTRY: TokenConfig[] = [
  {
    id:               "eth",
    symbol:           "ETH",
    name:             "Ethereum",
    coingeckoId:      "ethereum",
    contractAddress:  "0x51Ab625213BD6289d4a516876Ec3F835277202B1",
    sandboxLiquidity: 100n * SCALE,          // 100 ETH  ≈ $300 k at $3 k/ETH
  },
  {
    id:               "wbtc",
    symbol:           "WBTC",
    name:             "Wrapped Bitcoin",
    coingeckoId:      "wrapped-bitcoin",
    contractAddress:  "0x91E1fE91e206C66e3eC53b5aD058e0b7Aac25dE9",
    sandboxLiquidity: 3n * SCALE,            // 3 WBTC   ≈ $300 k at $100 k/BTC
  },
  {
    id:               "usdc",
    symbol:           "USDC",
    name:             "USD Coin",
    coingeckoId:      "usd-coin",
    contractAddress:  "0xB8503056625beFace8eD158751DB8d871257B7c3",
    sandboxLiquidity: 300_000n * SCALE,      // 300 k USDC ≈ $300 k at $1/USDC
  },
  {
    id:               "usdt",
    symbol:           "USDT",
    name:             "Tether",
    coingeckoId:      "tether",
    contractAddress:  "0xdf1F7b5596Fff54Dd692b2C44FaE55630518F500",
    sandboxLiquidity: 300_000n * SCALE,      // 300 k USDT ≈ $300 k at $1/USDT
  },
  {
    id:               "dai",
    symbol:           "DAI",
    name:             "Dai Stablecoin",
    coingeckoId:      "dai",
    contractAddress:  "0xEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE",
    sandboxLiquidity: 300_000n * SCALE,      // 300 k DAI  ≈ $300 k at $1/DAI
  },
  {
    id:               "link",
    symbol:           "LINK",
    name:             "Chainlink",
    coingeckoId:      "chainlink",
    contractAddress:  "0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF",
    sandboxLiquidity: 20_000n * SCALE,       // 20 k LINK  ≈ $300 k at $15/LINK
  },
];

/** Default opening pair shown on first load. */
export const DEFAULT_BASE  = TOKEN_REGISTRY[0]; // ETH
export const DEFAULT_QUOTE = TOKEN_REGISTRY[2]; // USDC

/**
 * Sandbox reserves for any two tokens.
 * Each side is independently sized to ~$300 k, so the opening spot price
 * mirrors real-world rates without any per-pair configuration.
 */
export function computeSandboxReserves(
  base:  TokenConfig,
  quote: TokenConfig,
): { reserveBase: bigint; reserveQuote: bigint } {
  return {
    reserveBase:  base.sandboxLiquidity,
    reserveQuote: quote.sandboxLiquidity,
  };
}

/** Stable, directional pair identifier used as a store key. */
export function getPairId(base: TokenConfig, quote: TokenConfig): string {
  return `${base.id}-${quote.id}`;
}

export function getTokenById(id: string): TokenConfig | undefined {
  return TOKEN_REGISTRY.find((t) => t.id === id);
}
