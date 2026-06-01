// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./DynamicFeePool.sol";

/**
 * The entry point for creating new Dynamic-Fee-AMM trading pairs.
 *
 * Call createPool(tokenA, tokenB) to deploy a fresh DynamicFeePool for any
 * two ERC-20 tokens. The factory prevents duplicate pools and keeps a
 * bidirectional registry, so you can look up the same pool regardless of
 * which token you pass first.
 *
 * Phase 5: the factory owner is the protocol admin. When a pool is created,
 * the factory's current owner is baked in as that pool's authorized relayer
 * address (poolAdmin). The factory owner can therefore call
 * setExternalChaosMultiplier() on any pool it has deployed.
 */
contract PoolFactory is Ownable {
    // Look up a pool by its two tokens — order doesn't matter.
    // getPool[USDC][WETH] and getPool[WETH][USDC] both point to the same pool.
    mapping(address => mapping(address => address)) public getPool;

    // Every pool ever created, in deployment order.
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

    // The deployer of the factory becomes the protocol owner and is granted
    // poolAdmin rights on every pool created by this factory.
    constructor() Ownable(msg.sender) {}

    // Deploy a new pool for the given token pair.
    // Tokens are sorted internally so the registry is always consistent.
    // The factory's current owner is baked into the pool as its authorized relayer.
    function createPool(address tokenA, address tokenB) external returns (address pool) {
        if (tokenA == tokenB) revert IdenticalAddresses();
        if (tokenA == address(0) || tokenB == address(0)) revert ZeroAddress();

        (address token0, address token1) = tokenA < tokenB
            ? (tokenA, tokenB)
            : (tokenB, tokenA);

        if (getPool[token0][token1] != address(0)) revert PoolAlreadyExists(getPool[token0][token1]);

        pool = address(new DynamicFeePool(token0, token1, owner()));

        getPool[token0][token1] = pool;
        getPool[token1][token0] = pool;
        allPools.push(pool);

        emit PoolCreated(token0, token1, pool, allPools.length);
    }

    function allPoolsLength() external view returns (uint256) {
        return allPools.length;
    }
}
