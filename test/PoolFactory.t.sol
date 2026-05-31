// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/PoolFactory.sol";
import "../src/DynamicFeePool.sol";
import "./helpers/MockERC20.sol";

/**
 * Tests for PoolFactory — the registry that deploys and tracks all pools.
 *
 * These tests cover the factory's job: deploying a valid pool, ensuring the
 * bidirectional registry is correct, and rejecting bad input (duplicate pairs,
 * identical tokens, zero addresses).
 */
contract PoolFactoryTest is Test {
    PoolFactory public factory;
    MockERC20   public tokenA;
    MockERC20   public tokenB;

    // Returns the two addresses in canonical sorted order, same as the factory does internally.
    function _sorted(address a, address b) internal pure returns (address t0, address t1) {
        (t0, t1) = a < b ? (a, b) : (b, a);
    }

    function setUp() public {
        factory = new PoolFactory();
        tokenA  = new MockERC20("Token A", "TKA");
        tokenB  = new MockERC20("Token B", "TKB");
    }

    // Happy path — deploy a pool and check the registry is wired up correctly.
    function test_CreatePool() public {
        address poolAddress = factory.createPool(address(tokenA), address(tokenB));

        assertTrue(poolAddress != address(0), "pool address is zero");
        assertTrue(poolAddress.code.length > 0, "pool has no bytecode");

        // Both token orderings should resolve to the same pool address.
        assertEq(factory.getPool(address(tokenA), address(tokenB)), poolAddress, "getPool(A,B) incorrect");
        assertEq(factory.getPool(address(tokenB), address(tokenA)), poolAddress, "getPool(B,A) incorrect");

        assertEq(factory.allPoolsLength(), 1, "allPools length should be 1");

        // The pool should store tokens in sorted order regardless of the input order.
        DynamicFeePool pool = DynamicFeePool(poolAddress);
        (address t0, address t1) = _sorted(address(tokenA), address(tokenB));
        assertEq(pool.token0(), t0, "pool.token0() mismatch");
        assertEq(pool.token1(), t1, "pool.token1() mismatch");
    }

    // Passing tokens in reverse order should produce a pool with the same token0/token1.
    function test_CreatePool_TokenOrderIsNormalized() public {
        address pool1 = factory.createPool(address(tokenA), address(tokenB));

        PoolFactory factory2 = new PoolFactory();
        address pool2 = factory2.createPool(address(tokenB), address(tokenA));

        assertEq(DynamicFeePool(pool1).token0(), DynamicFeePool(pool2).token0(), "token0 differs when args are reversed");
        assertEq(DynamicFeePool(pool1).token1(), DynamicFeePool(pool2).token1(), "token1 differs when args are reversed");
    }

    // Can't create two pools for the same token pair.
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

    // A pool can't trade a token against itself.
    function test_CreatePool_Revert_IdenticalAddresses() public {
        vm.expectRevert(PoolFactory.IdenticalAddresses.selector);
        factory.createPool(address(tokenA), address(tokenA));
    }

    // Zero address is not a valid token.
    function test_CreatePool_Revert_ZeroAddress_Token0() public {
        vm.expectRevert(PoolFactory.ZeroAddress.selector);
        factory.createPool(address(0), address(tokenB));
    }

    function test_CreatePool_Revert_ZeroAddress_Token1() public {
        vm.expectRevert(PoolFactory.ZeroAddress.selector);
        factory.createPool(address(tokenA), address(0));
    }
}
