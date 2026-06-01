// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/PoolFactory.sol";
import "../src/DynamicFeePool.sol";
import "../src/LPToken.sol";
import "./helpers/MockERC20.sol";

/**
 * Backtesting suite for DynamicFeePool's volatility fee engine and Phase 5
 * macro telemetry access-control layer.
 *
 * Phase 3 tests (1–4):
 *   1. Full volatility decay → fee returns to BASE_FEE floor
 *   2. Same-block HFT cascades → fee escalates monotonically
 *   3. 80% whale trade → fee is clamped precisely at MAX_FEE ceiling
 *   4. One half-life elapsed → accumulator decays by exactly 50%
 *
 * Phase 5 tests (5–6):
 *   5. Unauthorized actor cannot alter the chaos multiplier
 *   6. 1.5× multiplier proportionally scales the quiet-market fee
 */
contract DynamicFeePoolTest is Test {
    PoolFactory    public factory;
    DynamicFeePool public pool;
    LPToken        public lpToken;
    MockERC20      public token0;
    MockERC20      public token1;

    uint256 constant INITIAL_MINT = 1_000 * 1e18;

    // keccak256 selector for FeeUpdated(uint256,uint256) — used to filter vm.recordLogs output.
    bytes32 constant FEE_UPDATED_SIG = keccak256("FeeUpdated(uint256,uint256)");

    // Local mirror of the pool's swap formula for computing expected outputs independently.
    function _getAmountOut(
        uint256 amountIn,
        uint256 reserveIn,
        uint256 reserveOut,
        uint256 feeMul
    ) internal pure returns (uint256) {
        uint256 amountInWithFee = amountIn * feeMul;
        return (reserveOut * amountInWithFee) / (reserveIn * 10000 + amountInWithFee);
    }

    // Scan recorded logs for the most recent FeeUpdated emission and decode it.
    function _captureFeeUpdated() internal view returns (uint256 feeBps, uint256 vol) {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i = logs.length; i > 0; i--) {
            if (logs[i - 1].topics[0] == FEE_UPDATED_SIG) {
                (feeBps, vol) = abi.decode(logs[i - 1].data, (uint256, uint256));
                return (feeBps, vol);
            }
        }
        revert("FeeUpdated event not found");
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

        // Seed the pool with 100 of each token.
        pool.addLiquidity(100 * 1e18, 100 * 1e18);
    }

    // -------------------------------------------------------------------------
    // Test 1 — Equilibrium fee floor after full decay
    // -------------------------------------------------------------------------

    // Spike the volatility accumulator with a real trade, then warp 1 hour.
    // After 3600 s = 60 half-lives, any realistic accumulator value right-shifts
    // to zero. A subsequent dust swap (priceImpact rounds to 0 in integer math)
    // must therefore charge exactly BASE_FEE.
    function test_EquilibriumFeeFloor() public {
        // Trade 1: spike the volatility tracker.
        pool.swap(10 * 1e18, address(token0), 1);

        // 3600 s = 60 × DECAY_HALFLIFE → accumulator >> 60 = 0.
        vm.warp(block.timestamp + 3600);

        // Dust swap: amountIn * 10000 < reserveIn, so priceImpact rounds to 0.
        // After the spike trade reserve0 ≈ 110e18; 1e12 * 10000 / 110e18 = 0.
        vm.recordLogs();
        pool.swap(1e12, address(token0), 0);

        (uint256 feeBps,) = _captureFeeUpdated();
        assertEq(feeBps, uint256(pool.BASE_FEE()), "fee must equal BASE_FEE after full decay");
    }

    // -------------------------------------------------------------------------
    // Test 2 — High-frequency cascading fee spike
    // -------------------------------------------------------------------------

    // Three same-block swaps (timeElapsed = 0 between each) mean zero decay.
    // Each trade's priceImpact stacks directly onto the accumulator, so the fee
    // paid by each successive trader must be strictly higher than the last.
    function test_HighFrequencyCascadingSpike() public {
        // Trade 1
        vm.recordLogs();
        pool.swap(10 * 1e18, address(token0), 1);
        (uint256 fee1,) = _captureFeeUpdated();

        // Trade 2 — same block, no time elapsed, full accumulator carries forward.
        vm.recordLogs();
        pool.swap(10 * 1e18, address(token0), 1);
        (uint256 fee2,) = _captureFeeUpdated();

        // Trade 3 — same block again.
        vm.recordLogs();
        pool.swap(10 * 1e18, address(token0), 1);
        (uint256 fee3,) = _captureFeeUpdated();

        assertGt(fee2, fee1, "fee must escalate on trade 2");
        assertGt(fee3, fee2, "fee must escalate on trade 3");
    }

    // -------------------------------------------------------------------------
    // Test 3 — Fee cap enforcement for an 80% whale trade
    // -------------------------------------------------------------------------

    // Swapping 80% of the pool reserve produces priceImpact = 8000.
    // rawFee = BASE_FEE + 8000 * 15 / 1000 = 150 = MAX_FEE exactly.
    // The clamping logic must return MAX_FEE — no overflow, no breach.
    function test_MathematicalFeeCapEnforcement() public {
        // 80% of the current 100e18 reserve.
        vm.recordLogs();
        pool.swap(80 * 1e18, address(token0), 1);

        (uint256 feeBps,) = _captureFeeUpdated();
        assertEq(feeBps, uint256(pool.MAX_FEE()), "fee must be clamped at MAX_FEE");
    }

    // -------------------------------------------------------------------------
    // Test 4 — Asymmetric half-life volatility decay
    // -------------------------------------------------------------------------

    // A trade spikes the accumulator to V. After exactly one DECAY_HALFLIFE (60 s),
    // the next swap sees decayedVolatility = V >> 1 = V / 2. A negligible dust trade
    // adds ~0 new priceImpact, so the captured accumulator should be within 2 of V/2.
    function test_AsymmetricVolatilityDecay() public {
        // Trade 1: priceImpact = (10e18 * 10000) / 100e18 = 1000 → tracker = 1000.
        vm.recordLogs();
        pool.swap(10 * 1e18, address(token0), 1);
        (, uint256 vol1) = _captureFeeUpdated();

        // Advance exactly one half-life.
        vm.warp(block.timestamp + pool.DECAY_HALFLIFE());

        // Dust swap: 1e12 in ~110e18 reserve → priceImpact = 0, vol2 ≈ vol1 / 2.
        vm.recordLogs();
        pool.swap(1e12, address(token0), 0);
        (, uint256 vol2) = _captureFeeUpdated();

        // vol1 >> 1 = vol1 / 2; allow ±2 for any dust priceImpact rounding.
        assertApproxEqAbs(vol2, vol1 / 2, 2, "volatility must halve after one DECAY_HALFLIFE");
    }

    // =========================================================================
    // Phase 5 — Macro telemetry access control & fee scaling
    // =========================================================================

    // -------------------------------------------------------------------------
    // Test 5 — Unauthorized actor is rejected by the onlyFactoryOwner modifier
    // -------------------------------------------------------------------------

    // The pool's poolAdmin is the factory owner (address(this) in tests).
    // Any other address — even a realistic-looking EOA — must be strictly rejected.
    // This confirms the access-control modifier guards the entire setter path.
    function test_OnlyOwnerCanSetMultiplier() public {
        address rogue = address(0xBAD);

        // Rogue call must revert with the Unauthorized() custom error.
        vm.prank(rogue);
        vm.expectRevert(DynamicFeePool.Unauthorized.selector);
        pool.setExternalChaosMultiplier(150);

        // Confirm state was not modified by the rejected call.
        assertEq(pool.externalChaosMultiplier(), 100, "multiplier must remain at neutral baseline");

        // The test contract is the factory owner and must succeed.
        pool.setExternalChaosMultiplier(150);
        assertEq(pool.externalChaosMultiplier(), 150, "authorized owner must be able to set multiplier");
    }

    // -------------------------------------------------------------------------
    // Test 6 — 1.5× chaos multiplier proportionally amplifies the quiet-market fee
    // -------------------------------------------------------------------------

    // Under neutral market conditions (no prior swaps → zero volatility accumulator),
    // the base fee is exactly BASE_FEE (30 bps). Applying a 1.5× chaos multiplier
    // must yield 30 * 150 / 100 = 45 bps — no more, no less.
    //
    // This verifies: (a) the multiplier is read inside calculateDynamicFee,
    //                (b) the integer division is exact for the 150 case,
    //                (c) the result stays below MAX_FEE and is not over-clamped.
    function test_MultiplierClampingMath() public {
        // Set the chaos multiplier to 1.5× as the authorized owner.
        pool.setExternalChaosMultiplier(150);

        // Fresh pool: cumulativeVolatilityTracker == 0 and lastTransactionTimestamp == 0.
        // timeElapsed >> DECAY_HALFLIFE → decayedVolatility = 0. Dust priceImpact = 0.
        // rawFee = BASE_FEE = 30. scaledFee = 30 * 150 / 100 = 45.
        vm.recordLogs();
        pool.swap(1e12, address(token0), 0);

        (uint256 feeBps,) = _captureFeeUpdated();
        assertEq(feeBps, 45, "1.5x multiplier on quiet market must yield 45 bps (BASE_FEE * 1.5)");
    }
}
