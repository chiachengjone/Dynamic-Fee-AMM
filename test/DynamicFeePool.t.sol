// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/PoolFactory.sol";
import "../src/DynamicFeePool.sol";
import "../src/LPToken.sol";
import "./helpers/MockERC20.sol";

/**
 * Backtesting suite for DynamicFeePool — the core AMM contract.
 *
 * Each test targets one specific behaviour: initial liquidity, proportional
 * withdrawal, the constant-product swap formula, and slippage protection.
 * Together they prove the math is correct before Phase 3 adds dynamic fees.
 */
contract DynamicFeePoolTest is Test {
    PoolFactory    public factory;
    DynamicFeePool public pool;
    LPToken        public lpToken;
    MockERC20      public token0;
    MockERC20      public token1;

    uint256 constant INITIAL_MINT = 1_000 * 1e18;

    // Local copy of the pool's swap formula so tests can compute expected values
    // independently without relying on the contract under test to produce them.
    function _getAmountOut(
        uint256 amountIn,
        uint256 reserveIn,
        uint256 reserveOut
    ) internal pure returns (uint256) {
        uint256 amountInWithFee = amountIn * 9970;
        return (reserveOut * amountInWithFee) / (reserveIn * 10000 + amountInWithFee);
    }

    function setUp() public {
        // Deploy two mock tokens and sort them so our variables match the pool's
        // internal token0/token1 (the factory always sorts by address).
        MockERC20 tA = new MockERC20("Token A", "TKA");
        MockERC20 tB = new MockERC20("Token B", "TKB");
        (token0, token1) = address(tA) < address(tB) ? (tA, tB) : (tB, tA);

        factory = new PoolFactory();
        pool    = DynamicFeePool(factory.createPool(address(token0), address(token1)));
        lpToken = pool.lpToken();

        // Give this test contract plenty of tokens and pre-approve the pool.
        token0.mint(address(this), INITIAL_MINT);
        token1.mint(address(this), INITIAL_MINT);
        token0.approve(address(pool), type(uint256).max);
        token1.approve(address(pool), type(uint256).max);
    }

    // -------------------------------------------------------------------------
    // Test 1 — Initial liquidity provision
    // -------------------------------------------------------------------------

    // Depositing 100 of each token should mint exactly 100 LP tokens.
    // LP amount = sqrt(100e18 * 100e18) = 100e18. Reserves must match the deposit.
    function test_InitialLiquidityProvision() public {
        uint256 deposit   = 100 * 1e18;
        uint256 liquidity = pool.addLiquidity(deposit, deposit);

        assertEq(liquidity, deposit, "wrong LP minted");
        assertEq(lpToken.balanceOf(address(this)), deposit, "LP balance mismatch");

        (uint112 r0, uint112 r1) = pool.getReserves();
        assertEq(uint256(r0), deposit, "reserve0 mismatch");
        assertEq(uint256(r1), deposit, "reserve1 mismatch");
    }

    // -------------------------------------------------------------------------
    // Test 2 — Proportional withdrawal
    // -------------------------------------------------------------------------

    // Burning 50% of the LP supply should return exactly 50% of both reserves.
    function test_ProportionalWithdrawal() public {
        uint256 deposit = 100 * 1e18;
        pool.addLiquidity(deposit, deposit);

        uint256 half = deposit / 2;
        (uint256 out0, uint256 out1) = pool.removeLiquidity(half);

        assertEq(out0, half, "amount0 returned is not 50%");
        assertEq(out1, half, "amount1 returned is not 50%");
        assertEq(lpToken.totalSupply(), half, "LP totalSupply did not halve");

        (uint112 r0, uint112 r1) = pool.getReserves();
        assertEq(uint256(r0), half, "reserve0 did not halve");
        assertEq(uint256(r1), half, "reserve1 did not halve");
    }

    // -------------------------------------------------------------------------
    // Test 3 — Constant-product swap + k invariant
    // -------------------------------------------------------------------------

    // Swap 10 token0 into a 100/100 pool.
    // The output must match our formula exactly, and the pool's k value
    // (x * y) must be >= the pre-swap k — proof that the 0.3% fee accrued.
    function test_MathematicalInvariantSwap() public {
        uint256 deposit   = 100 * 1e18;
        uint256 amountIn  = 10  * 1e18;
        pool.addLiquidity(deposit, deposit);

        uint256 expectedOut = _getAmountOut(amountIn, deposit, deposit);
        uint256 k_before    = deposit * deposit;

        uint256 amountOut = pool.swap(amountIn, address(token0), 1);

        assertEq(amountOut, expectedOut, "amountOut deviates from constant-product formula");

        (uint112 r0, uint112 r1) = pool.getReserves();
        assertGe(uint256(r0) * uint256(r1), k_before, "k invariant violated: fee did not accrue");
    }

    // -------------------------------------------------------------------------
    // Test 4 — Slippage protection
    // -------------------------------------------------------------------------

    // If the pool can only give you ~9.066 tokens but you demand 10, it should revert.
    // This proves the minAmountOut guard is actually enforced.
    function test_SlippageProtectionTrigger() public {
        uint256 deposit      = 100 * 1e18;
        uint256 amountIn     = 10  * 1e18;
        pool.addLiquidity(deposit, deposit);

        uint256 actualOut     = _getAmountOut(amountIn, deposit, deposit);
        uint256 impossibleMin = actualOut + 1; // one wei above what's possible

        vm.expectRevert(
            abi.encodeWithSelector(
                DynamicFeePool.InsufficientOutputAmount.selector,
                actualOut,
                impossibleMin
            )
        );
        pool.swap(amountIn, address(token0), impossibleMin);
    }
}
