// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/PoolFactory.sol";
import "../src/DynamicFeePool.sol";
import "../test/helpers/MockERC20.sol";

/**
 * Redeploys a fresh PoolFactory + pools using the EXISTING mock tokens, after
 * the contract upgrade (ReentrancyGuard + inclusive [100,200] multiplier bound).
 *
 * Reuses the already-deployed tokens, so the frontend tokenRegistry addresses
 * stay the same — only the factory + pool addresses change.
 *
 * Usage:
 *   ETH_ADDRESS=0x.. USDC_ADDRESS=0x.. WBTC_ADDRESS=0x.. USDT_ADDRESS=0x.. \
 *   forge script script/Redeploy.s.sol --rpc-url sepolia --broadcast -vvv
 */
contract Redeploy is Script {
    uint256 constant ETH_LIQ  =     10 * 1e18;
    uint256 constant USDC_LIQ = 30_000 * 1e18;
    uint256 constant WBTC_LIQ =      1 * 1e18;
    uint256 constant USDT_LIQ = 100_000 * 1e18;

    function run() external {
        uint256 key      = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(key);
        address eth      = vm.envAddress("ETH_ADDRESS");
        address usdc     = vm.envAddress("USDC_ADDRESS");
        address wbtc     = vm.envAddress("WBTC_ADDRESS");
        address usdt     = vm.envAddress("USDT_ADDRESS");

        vm.startBroadcast(key);

        PoolFactory factory = new PoolFactory();
        address p1 = factory.createPool(eth,  usdc);
        address p2 = factory.createPool(wbtc, usdt);

        _seed(deployer, p1, eth,  usdc, ETH_LIQ,  USDC_LIQ);
        _seed(deployer, p2, wbtc, usdt, WBTC_LIQ, USDT_LIQ);

        vm.stopBroadcast();

        console.log("====================================================");
        console.log("  Redeploy complete (upgraded contracts)");
        console.log("====================================================");
        console.log("VITE_FACTORY_ADDRESS  =", address(factory));
        console.log("ETH/USDC  pool (relayer POOL_CONTRACT_ADDRESS):", p1);
        console.log("WBTC/USDT pool                                 :", p2);
        console.log("Tokens unchanged - tokenRegistry.ts stays as-is.");
    }

    function _seed(
        address deployer,
        address pool,
        address a,
        address b,
        uint256 amtA,
        uint256 amtB
    ) internal {
        MockERC20(a).mint(deployer, amtA);
        MockERC20(b).mint(deployer, amtB);

        DynamicFeePool p = DynamicFeePool(pool);
        bool aIsToken0 = p.token0() == a;

        MockERC20(a).approve(pool, amtA);
        MockERC20(b).approve(pool, amtB);
        p.addLiquidity(aIsToken0 ? amtA : amtB, aIsToken0 ? amtB : amtA);
    }
}
