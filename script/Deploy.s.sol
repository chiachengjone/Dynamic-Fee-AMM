// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/PoolFactory.sol";

/**
 * Deployment script for the Dynamic-Fee-AMM.
 *
 * Deploys the PoolFactory, which is the single entry point for creating
 * new trading pairs. Once deployed, call factory.createPool(tokenA, tokenB)
 * to spin up a pool for any ERC-20 pair.
 *
 * Usage:
 *   forge script script/Deploy.s.sol --rpc-url <RPC_URL> --broadcast
 *
 * Set PRIVATE_KEY in your .env file before running.
 */
contract Deploy is Script {
    function run() external returns (PoolFactory factory) {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(deployerKey);

        factory = new PoolFactory();

        vm.stopBroadcast();
    }
}
