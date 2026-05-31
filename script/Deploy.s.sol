// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/PoolFactory.sol";

/// @notice Deployment entry-point for Phase 1 — deploys PoolFactory only.
///         Extend this script in Phase 2 to seed the first pool.
contract Deploy is Script {
    function run() external returns (PoolFactory factory) {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(deployerKey);

        factory = new PoolFactory();

        vm.stopBroadcast();
    }
}
