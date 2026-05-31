// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./DynamicFeePool.sol";

/// @notice Canonical registry — deploys and indexes every DynamicFeePool instance.
contract PoolFactory {
    /// @notice getPool[token0][token1] == getPool[token1][token0] == pool address.
    mapping(address => mapping(address => address)) public getPool;

    address[] public allPools;

    event PoolCreated(
        address indexed token0,
        address indexed token1,
        address pool,
        uint256 poolCount
    );

    error IdenticalAddresses();
    error ZeroAddress();
    error PoolAlreadyExists(address pool);

    /// @notice Deploys a new DynamicFeePool for the given token pair.
    /// @dev    Tokens are sorted so getPool[A][B] === getPool[B][A].
    /// @param  tokenA  One token of the pair (order-independent).
    /// @param  tokenB  The other token of the pair.
    /// @return pool    Address of the newly deployed DynamicFeePool.
    function createPool(address tokenA, address tokenB) external returns (address pool) {
        if (tokenA == tokenB) revert IdenticalAddresses();
        if (tokenA == address(0) || tokenB == address(0)) revert ZeroAddress();

        // Canonical ordering: lower address is always token0
        (address token0, address token1) = tokenA < tokenB
            ? (tokenA, tokenB)
            : (tokenB, tokenA);

        if (getPool[token0][token1] != address(0)) revert PoolAlreadyExists(getPool[token0][token1]);

        pool = address(new DynamicFeePool(token0, token1));

        // Bidirectional index so callers need not pre-sort
        getPool[token0][token1] = pool;
        getPool[token1][token0] = pool;
        allPools.push(pool);

        emit PoolCreated(token0, token1, pool, allPools.length);
    }

    /// @notice Returns the total number of deployed pools.
    function allPoolsLength() external view returns (uint256) {
        return allPools.length;
    }
}
