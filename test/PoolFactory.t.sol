// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "../src/PoolFactory.sol";
import "../src/DynamicFeePool.sol";

// ─── Minimal mock token ───────────────────────────────────────────────────────

contract MockERC20 is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

// ─── Test suite ───────────────────────────────────────────────────────────────

contract PoolFactoryTest is Test {
    PoolFactory public factory;
    MockERC20   public tokenA;
    MockERC20   public tokenB;

    // ── Helpers ──────────────────────────────────────────────────────────────

    /// @dev Returns (token0, token1) in canonical sorted order, mirroring the factory logic.
    function _sorted(address a, address b) internal pure returns (address t0, address t1) {
        (t0, t1) = a < b ? (a, b) : (b, a);
    }

    // ── Setup ─────────────────────────────────────────────────────────────────

    function setUp() public {
        factory = new PoolFactory();
        tokenA  = new MockERC20("Token A", "TKA");
        tokenB  = new MockERC20("Token B", "TKB");
    }

    // ── Phase 1 validation tests ──────────────────────────────────────────────

    /// @notice Happy-path: factory deploys a pool and registry is consistent.
    function test_CreatePool() public {
        address poolAddress = factory.createPool(address(tokenA), address(tokenB));

        // 1. Pool address must be a live contract, not zero
        assertTrue(poolAddress != address(0), "pool address is zero");
        assertTrue(poolAddress.code.length > 0, "pool has no bytecode");

        // 2. Registry stores the pool in both token-order directions
        assertEq(
            factory.getPool(address(tokenA), address(tokenB)),
            poolAddress,
            "getPool(A,B) incorrect"
        );
        assertEq(
            factory.getPool(address(tokenB), address(tokenA)),
            poolAddress,
            "getPool(B,A) incorrect"
        );

        // 3. allPools length incremented
        assertEq(factory.allPoolsLength(), 1, "allPools length should be 1");

        // 4. Pool's token references match canonical sorted order
        DynamicFeePool pool = DynamicFeePool(poolAddress);
        (address t0, address t1) = _sorted(address(tokenA), address(tokenB));

        assertEq(pool.token0(), t0, "pool.token0() mismatch");
        assertEq(pool.token1(), t1, "pool.token1() mismatch");
    }

    /// @notice Argument order must not matter — pool is the same either way.
    function test_CreatePool_TokenOrderIsNormalized() public {
        address pool1 = factory.createPool(address(tokenA), address(tokenB));

        // Deploy a second factory to test reverse order independently
        PoolFactory factory2 = new PoolFactory();
        address pool2 = factory2.createPool(address(tokenB), address(tokenA));

        DynamicFeePool p1 = DynamicFeePool(pool1);
        DynamicFeePool p2 = DynamicFeePool(pool2);

        assertEq(p1.token0(), p2.token0(), "token0 differs when args are reversed");
        assertEq(p1.token1(), p2.token1(), "token1 differs when args are reversed");
    }

    /// @notice Deploying the same pair twice must revert.
    function test_CreatePool_Revert_DuplicatePool() public {
        factory.createPool(address(tokenA), address(tokenB));
        vm.expectRevert(
            abi.encodeWithSelector(
                PoolFactory.PoolAlreadyExists.selector,
                factory.getPool(address(tokenA), address(tokenB))
            )
        );
        factory.createPool(address(tokenA), address(tokenB));
    }

    /// @notice Identical token addresses must revert.
    function test_CreatePool_Revert_IdenticalAddresses() public {
        vm.expectRevert(PoolFactory.IdenticalAddresses.selector);
        factory.createPool(address(tokenA), address(tokenA));
    }

    /// @notice Zero address for either token must revert.
    function test_CreatePool_Revert_ZeroAddress_Token0() public {
        vm.expectRevert(PoolFactory.ZeroAddress.selector);
        factory.createPool(address(0), address(tokenB));
    }

    function test_CreatePool_Revert_ZeroAddress_Token1() public {
        vm.expectRevert(PoolFactory.ZeroAddress.selector);
        factory.createPool(address(tokenA), address(0));
    }
}
