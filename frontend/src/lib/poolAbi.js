// Human-readable ABI fragments consumed by ethers v6.

export const POOL_ABI = [
  "function getReserves() view returns (uint112 reserve0, uint112 reserve1)",
  "function externalChaosMultiplier() view returns (uint8)",
  "function cumulativeVolatilityTracker() view returns (uint112)",
  "function lastTransactionTimestamp() view returns (uint32)",
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function BASE_FEE() view returns (uint16)",
  "function MAX_FEE() view returns (uint16)",
  // Write path — used by the dashboard's live swap flow.
  "function swap(uint256 amountIn, address tokenIn, uint256 minAmountOut) returns (uint256 amountOut)",
  "event Swap(address indexed sender, address indexed tokenIn, uint256 amountIn, uint256 amountOut)",
  "event FeeUpdated(uint256 feeBps, uint256 volatilityAccumulator)",
  "event ExternalMultiplierUpdated(uint8 indexed newMultiplier, uint256 timestamp)",
];

export const ERC20_ABI = [
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  // MockERC20 faucet — permissionless mint, used by the "Mint test tokens" button.
  "function mint(address to, uint256 amount)",
];

// PoolFactory — used for live pool address discovery from a token pair.
export const FACTORY_ABI = [
  "function getPool(address tokenA, address tokenB) view returns (address)",
];
