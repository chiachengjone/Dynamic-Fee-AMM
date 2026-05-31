// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "./LPToken.sol";

/**
 * The core liquidity pool for the Dynamic-Fee-AMM.
 *
 * This is a constant-product AMM (x * y = k) with a volatility-responsive fee.
 * Liquidity providers deposit pairs of tokens, traders swap one for the other,
 * and the fee stays in the pool to reward LPs.
 *
 * Phase 2 shipped a static 0.30% fee. Phase 3 replaces it with a dynamic fee
 * that scales from 0.30% (calm market) to 1.50% (high-frequency storm) based
 * on an on-chain exponential moving average of trading intensity. This protects
 * LPs from impermanent loss and MEV extraction during volatile periods.
 */
contract DynamicFeePool {
    using SafeERC20 for IERC20;

    // The two tokens this pool trades between. Set once at deploy, never changed.
    address public immutable token0;
    address public immutable token1;

    // The LP token issued to liquidity providers. This pool is its sole minter/burner.
    LPToken public immutable lpToken;

    // Stored as uint112 to match Uniswap V2's storage layout — packing both
    // reserves into a single slot saves a cold SLOAD on every swap.
    uint112 private reserve0;
    uint112 private reserve1;

    // -------------------------------------------------------------------------
    // Dynamic fee constants
    // -------------------------------------------------------------------------

    // Fee denominator — all fee math is in basis points (1 bps = 0.01%).
    uint256 private constant FEE_DENOMINATOR = 10000;

    // Fee floor and ceiling, in basis points.
    uint16 public constant BASE_FEE = 30;    // 0.30% — charged during market equilibrium
    uint16 public constant MAX_FEE  = 150;   // 1.50% — hard cap during high-frequency periods

    // One EMA half-life: accumulated volatility decays by 50% every 60 seconds.
    uint32 public constant DECAY_HALFLIFE = 60;

    // Fee sensitivity: fee premium = volatility * ALPHA / SCALE.
    // Calibrated so an 80% whale trade (priceImpact = 8000) hits MAX_FEE exactly:
    //   30 + 8000 * 15 / 1000 = 150
    uint256 private constant VOLATILITY_ALPHA = 15;
    uint256 private constant VOLATILITY_SCALE = 1000;

    // -------------------------------------------------------------------------
    // Volatility oracle state
    // -------------------------------------------------------------------------

    // Block timestamp of the last swap. Used to compute EMA time decay.
    uint32  public lastTransactionTimestamp;

    // EMA-style accumulator tracking recent trading intensity.
    // Updated at the end of every swap; decays exponentially between swaps.
    uint112 public cumulativeVolatilityTracker;

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------

    event LiquidityAdded(address indexed provider, uint256 amount0, uint256 amount1, uint256 liquidity);
    event LiquidityRemoved(address indexed provider, uint256 amount0, uint256 amount1, uint256 liquidity);
    event Swap(address indexed sender, address indexed tokenIn, uint256 amountIn, uint256 amountOut);
    event FeeUpdated(uint256 feeBps, uint256 volatilityAccumulator);

    // -------------------------------------------------------------------------
    // Errors
    // -------------------------------------------------------------------------

    error InvalidToken(address provided);
    error InsufficientOutputAmount(uint256 actual, uint256 minimum);
    error InsufficientLiquidity();
    error ZeroLiquidity();

    constructor(address _token0, address _token1) {
        token0  = _token0;
        token1  = _token1;
        lpToken = new LPToken("Dynamic-Fee-AMM LP", "DFLP");
    }

    // -------------------------------------------------------------------------
    // Liquidity
    // -------------------------------------------------------------------------

    /**
     * Deposit tokens into the pool and receive LP tokens in return.
     *
     * First deposit: you set the initial price. LP tokens minted = sqrt(amount0 * amount1),
     * which is the geometric mean — a standard way to avoid gaming the first deposit.
     *
     * Subsequent deposits: the pool ratio is fixed, so amount1 is calculated from
     * amount0Desired to keep the price unchanged. You get LP tokens proportional
     * to your share of the total liquidity.
     *
     * You must approve this contract to spend your tokens before calling this.
     */
    function addLiquidity(
        uint256 amount0Desired,
        uint256 amount1Desired
    ) external returns (uint256 liquidity) {
        uint256 r0 = uint256(reserve0);
        uint256 r1 = uint256(reserve1);

        uint256 amount0;
        uint256 amount1;

        if (r0 == 0 && r1 == 0) {
            // First deposit — use the geometric mean so neither token is favoured.
            liquidity = Math.sqrt(amount0Desired * amount1Desired);
            if (liquidity == 0) revert ZeroLiquidity();

            amount0 = amount0Desired;
            amount1 = amount1Desired;
        } else {
            // Subsequent deposit — derive amount1 from the current pool ratio
            // so the price doesn't move. amount1Desired is ignored here; only
            // amount0Desired drives how much liquidity you're adding.
            amount1 = (amount0Desired * r1) / r0;
            if (amount1 == 0) revert ZeroLiquidity();

            uint256 totalSupply = lpToken.totalSupply();
            liquidity = (amount0Desired * totalSupply) / r0;
            if (liquidity == 0) revert ZeroLiquidity();

            amount0 = amount0Desired;
        }

        IERC20(token0).safeTransferFrom(msg.sender, address(this), amount0);
        IERC20(token1).safeTransferFrom(msg.sender, address(this), amount1);

        lpToken.mint(msg.sender, liquidity);

        reserve0 = uint112(r0 + amount0);
        reserve1 = uint112(r1 + amount1);

        emit LiquidityAdded(msg.sender, amount0, amount1, liquidity);
    }

    /**
     * Burn your LP tokens and get your share of the pool back.
     *
     * You receive token0 and token1 in proportion to the LP tokens you burn
     * relative to the total supply. If you hold 10% of all LP tokens, you get
     * 10% of both reserves.
     *
     * Note: the pool burns directly from your balance — no approve() needed.
     */
    function removeLiquidity(
        uint256 lpTokenAmount
    ) external returns (uint256 amount0, uint256 amount1) {
        if (lpTokenAmount == 0) revert ZeroLiquidity();

        uint256 totalSupply = lpToken.totalSupply();
        if (totalSupply == 0) revert InsufficientLiquidity();

        uint256 r0 = uint256(reserve0);
        uint256 r1 = uint256(reserve1);

        amount0 = (lpTokenAmount * r0) / totalSupply;
        amount1 = (lpTokenAmount * r1) / totalSupply;

        if (amount0 == 0 || amount1 == 0) revert InsufficientLiquidity();

        // The pool is LPToken's owner, so it can burn from any address directly.
        lpToken.burn(msg.sender, lpTokenAmount);

        IERC20(token0).safeTransfer(msg.sender, amount0);
        IERC20(token1).safeTransfer(msg.sender, amount1);

        reserve0 = uint112(r0 - amount0);
        reserve1 = uint112(r1 - amount1);

        emit LiquidityRemoved(msg.sender, amount0, amount1, lpTokenAmount);
    }

    // -------------------------------------------------------------------------
    // Swap
    // -------------------------------------------------------------------------

    /**
     * Swap an exact amount of one token for as many of the other as the pool allows.
     *
     * The fee charged is dynamic — it starts at 0.30% during calm conditions and
     * rises towards 1.50% as same-block trading frequency increases. This discourages
     * high-frequency sandwiching while keeping costs low for ordinary traders.
     *
     * Pass minAmountOut to protect yourself from slippage — the transaction reverts
     * if the pool can't give you at least that much.
     *
     * You must approve this contract to spend your input token before calling this.
     */
    function swap(
        uint256 amountIn,
        address tokenIn,
        uint256 minAmountOut
    ) external returns (uint256 amountOut) {
        bool zeroForOne = (tokenIn == token0);
        if (!zeroForOne && tokenIn != token1) revert InvalidToken(tokenIn);

        uint256 r0 = uint256(reserve0);
        uint256 r1 = uint256(reserve1);

        (uint256 reserveIn, uint256 reserveOut) = zeroForOne ? (r0, r1) : (r1, r0);
        address tokenOut = zeroForOne ? token1 : token0;

        // Compute the volatility-adjusted fee before any state changes.
        (uint256 feeBps, uint256 newVolatility) = calculateDynamicFee(amountIn, reserveIn);
        uint256 feeMul = FEE_DENOMINATOR - feeBps;

        amountOut = getAmountOut(amountIn, reserveIn, reserveOut, feeMul);

        if (amountOut < minAmountOut) revert InsufficientOutputAmount(amountOut, minAmountOut);

        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        IERC20(tokenOut).safeTransfer(msg.sender, amountOut);

        if (zeroForOne) {
            reserve0 = uint112(r0 + amountIn);
            reserve1 = uint112(r1 - amountOut);
        } else {
            reserve1 = uint112(r1 + amountIn);
            reserve0 = uint112(r0 - amountOut);
        }

        // Persist volatility state after the swap is complete.
        cumulativeVolatilityTracker = uint112(Math.min(newVolatility, type(uint112).max));
        lastTransactionTimestamp    = uint32(block.timestamp);

        emit Swap(msg.sender, tokenIn, amountIn, amountOut);
        emit FeeUpdated(feeBps, newVolatility);
    }

    // -------------------------------------------------------------------------
    // Internal math
    // -------------------------------------------------------------------------

    /**
     * Compute the current fee in basis points using a two-factor volatility model.
     *
     * Step 1 — Time decay: historical volatility decays by 50% every DECAY_HALFLIFE
     * seconds via a right-bit-shift approximation (x >> n ≈ x / 2^n).
     *
     * Step 2 — Price impact: the current trade's footprint (amountIn as a fraction
     * of the pool) is added to the decayed baseline.
     *
     * Step 3 — Fee: BASE_FEE plus a scaled fraction of the combined volatility,
     * clamped strictly between BASE_FEE and MAX_FEE.
     */
    function calculateDynamicFee(
        uint256 amountIn,
        uint256 reserveIn
    ) internal view returns (uint256 feeBps, uint256 newVolatility) {
        uint32  timeElapsed      = uint32(block.timestamp) - lastTransactionTimestamp;
        uint256 shift            = uint256(timeElapsed / DECAY_HALFLIFE);
        // Guard: shifting a uint112 by >= 112 bits is always 0.
        uint256 decayedVolatility = shift >= 112
            ? 0
            : uint256(cumulativeVolatilityTracker) >> shift;

        uint256 priceImpact = (amountIn * 10000) / reserveIn;
        newVolatility       = decayedVolatility + priceImpact;

        uint256 rawFee = uint256(BASE_FEE) + (newVolatility * VOLATILITY_ALPHA / VOLATILITY_SCALE);
        feeBps = Math.max(Math.min(rawFee, uint256(MAX_FEE)), uint256(BASE_FEE));
    }

    /**
     * How many output tokens does the pool owe for a given input?
     *
     * This is the rearranged constant-product formula with the caller-supplied fee applied:
     *
     *   amountOut = (reserveOut * amountIn * feeMul) / (reserveIn * 10000 + amountIn * feeMul)
     *
     * feeMul = 10000 - feeBps, so the "missing" fee fraction stays in the pool,
     * growing the reserves and rewarding LPs.
     */
    function getAmountOut(
        uint256 amountIn,
        uint256 reserveIn,
        uint256 reserveOut,
        uint256 feeMul
    ) internal pure returns (uint256 amountOut) {
        uint256 amountInWithFee = amountIn * feeMul;
        amountOut = (reserveOut * amountInWithFee) / (reserveIn * FEE_DENOMINATOR + amountInWithFee);
    }

    // -------------------------------------------------------------------------
    // View
    // -------------------------------------------------------------------------

    // Current token reserves held by this pool.
    function getReserves() external view returns (uint112 _reserve0, uint112 _reserve1) {
        _reserve0 = reserve0;
        _reserve1 = reserve1;
    }
}
