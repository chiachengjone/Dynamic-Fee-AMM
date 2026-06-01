// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/PoolFactory.sol";
import "../src/DynamicFeePool.sol";
import "../test/helpers/MockERC20.sol";

/**
 * Full testnet deployment script for the Dynamic-Fee-AMM.
 *
 * What this deploys
 * -----------------
 *   1. PoolFactory          — the protocol entry point
 *   2. Four mock ERC-20 tokens: ETH, USDC, WBTC, USDT (all 18 decimals)
 *   3. Two trading pools:
 *        - ETH / USDC  (spot ≈ $3,000 / ETH)
 *        - WBTC / USDT (spot ≈ $100,000 / BTC)
 *   4. Seeds both pools with initial liquidity from the deployer wallet.
 *
 * Prerequisites
 * -------------
 *   PRIVATE_KEY      — deployer private key (hex, with or without 0x)
 *   SEPOLIA_RPC_URL  — e.g. https://eth-sepolia.g.alchemy.com/v2/<key>
 *
 * Run
 * ---
 *   forge script script/Deploy.s.sol \
 *     --rpc-url sepolia --broadcast --verify -vvv
 *
 * The script prints every deployed address at the end — copy them into
 * frontend/.env, simulation/.env, and src/config/tokenRegistry.ts.
 */
contract Deploy is Script {

    // Initial liquidity (18-decimal wei). Ratios set opening spot prices:
    //   ETH/USDC  → 30 000 / 10     = $3 000 per ETH
    //   WBTC/USDT → 100 000 / 1     = $100 000 per WBTC
    uint256 constant ETH_LIQ   =     10 * 1e18;
    uint256 constant USDC_LIQ  = 30_000 * 1e18;
    uint256 constant WBTC_LIQ  =      1 * 1e18;
    uint256 constant USDT_LIQ  = 100_000 * 1e18;

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer    = vm.addr(deployerKey);

        vm.startBroadcast(deployerKey);

        // ── 1. Factory ────────────────────────────────────────────────────────
        PoolFactory factory = new PoolFactory();

        // ── 2. Mock tokens ────────────────────────────────────────────────────
        MockERC20 mockETH  = new MockERC20("Ether",           "ETH");
        MockERC20 mockUSDC = new MockERC20("USD Coin",        "USDC");
        MockERC20 mockWBTC = new MockERC20("Wrapped Bitcoin", "WBTC");
        MockERC20 mockUSDT = new MockERC20("Tether USD",      "USDT");

        // ── 3. Mint initial supply to deployer ────────────────────────────────
        mockETH.mint(deployer,  ETH_LIQ);
        mockUSDC.mint(deployer, USDC_LIQ);
        mockWBTC.mint(deployer, WBTC_LIQ);
        mockUSDT.mint(deployer, USDT_LIQ);

        // ── 4. Create pools ───────────────────────────────────────────────────
        address addrETH_USDC  = factory.createPool(address(mockETH),  address(mockUSDC));
        address addrWBTC_USDT = factory.createPool(address(mockWBTC), address(mockUSDT));

        // ── 5. Seed liquidity — order amounts to match the pool's token0/token1 sort ──
        _seedLiquidity(addrETH_USDC,  address(mockETH),  address(mockUSDC), ETH_LIQ,  USDC_LIQ);
        _seedLiquidity(addrWBTC_USDT, address(mockWBTC), address(mockUSDT), WBTC_LIQ, USDT_LIQ);

        vm.stopBroadcast();

        // ── 6. Print addresses ────────────────────────────────────────────────
        console.log("");
        console.log("====================================================");
        console.log("  Dynamic-Fee-AMM  |  Sepolia Deployment Complete");
        console.log("====================================================");
        console.log("");
        console.log("-- Copy into frontend/.env and simulation/.env -----");
        console.log("VITE_FACTORY_ADDRESS =", address(factory));
        console.log("VITE_RPC_URL         = <your Alchemy Sepolia URL>");
        console.log("");
        console.log("-- ETH/USDC pool ----");
        console.log("Pool address  :", addrETH_USDC);
        console.log("ETH  token    :", address(mockETH));
        console.log("USDC token    :", address(mockUSDC));
        console.log("");
        console.log("-- WBTC/USDT pool ---");
        console.log("Pool address  :", addrWBTC_USDT);
        console.log("WBTC token    :", address(mockWBTC));
        console.log("USDT token    :", address(mockUSDT));
        console.log("");
        console.log("-- Update tokenRegistry.ts --------------------------");
        console.log("ETH  contractAddress:", address(mockETH));
        console.log("WBTC contractAddress:", address(mockWBTC));
        console.log("USDC contractAddress:", address(mockUSDC));
        console.log("USDT contractAddress:", address(mockUSDT));
        console.log("====================================================");
    }

    // Approve both tokens and add liquidity in the correct token0/token1 order.
    function _seedLiquidity(
        address poolAddr,
        address tokenA,
        address tokenB,
        uint256 amountA,
        uint256 amountB
    ) internal {
        DynamicFeePool pool = DynamicFeePool(poolAddr);
        bool aIsToken0 = pool.token0() == tokenA;

        MockERC20(tokenA).approve(poolAddr, amountA);
        MockERC20(tokenB).approve(poolAddr, amountB);

        pool.addLiquidity(
            aIsToken0 ? amountA : amountB,
            aIsToken0 ? amountB : amountA
        );
    }
}
