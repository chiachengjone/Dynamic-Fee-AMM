/**
 * swapActions.ts — on-chain write helpers for the live swap flow.
 *
 * Each function takes an ethers Signer (from WalletContext.getSigner) and
 * returns once the transaction is mined, exposing the tx hash. Reads use the
 * signer's provider so everything stays on the wallet's connected chain.
 *
 * The math (minAmountOut) mirrors the on-chain contract via lib/amm.js — no
 * floating point.
 */

import { ethers } from "ethers";
import { POOL_ABI, ERC20_ABI } from "./poolAbi.js";

export interface BalanceAllowance {
  balance: bigint;
  allowance: bigint;
}

/** Read the connected account's balance of `token` and its allowance to `spender`. */
export async function readBalanceAndAllowance(
  provider: ethers.Provider,
  token: string,
  owner: string,
  spender: string,
): Promise<BalanceAllowance> {
  const erc20 = new ethers.Contract(token, ERC20_ABI, provider);
  const [balance, allowance] = await Promise.all([
    erc20.balanceOf(owner) as Promise<bigint>,
    erc20.allowance(owner, spender) as Promise<bigint>,
  ]);
  return { balance, allowance };
}

/** Approve `spender` (the pool) to pull `token` from the signer. Approves max. */
export async function approveToken(
  signer: ethers.Signer,
  token: string,
  spender: string,
): Promise<string> {
  const erc20 = new ethers.Contract(token, ERC20_ABI, signer);
  const tx = await erc20.approve(spender, ethers.MaxUint256);
  await tx.wait();
  return tx.hash;
}

export interface SwapResult {
  hash: string;
  /** Fee charged for this swap, in bps (parsed from the FeeUpdated event). */
  feeBps: bigint;
  /** Volatility accumulator after the swap. */
  volatility: bigint;
}

/**
 * Execute swap(amountIn, tokenIn, minAmountOut) and pull the fee/volatility
 * straight from the transaction receipt's FeeUpdated event — so the caller can
 * update the UI immediately without waiting on event-listener polling.
 */
export async function executeSwap(
  signer: ethers.Signer,
  pool: string,
  amountIn: bigint,
  tokenIn: string,
  minAmountOut: bigint,
): Promise<SwapResult> {
  const contract = new ethers.Contract(pool, POOL_ABI, signer);
  const tx = await contract.swap(amountIn, tokenIn, minAmountOut);
  const receipt = await tx.wait();

  let feeBps = 0n;
  let volatility = 0n;
  for (const log of receipt?.logs ?? []) {
    try {
      const parsed = contract.interface.parseLog({
        topics: [...log.topics],
        data: log.data,
      });
      if (parsed?.name === "FeeUpdated") {
        feeBps = parsed.args[0] as bigint;
        volatility = parsed.args[1] as bigint;
        break;
      }
    } catch {
      /* log from another contract — ignore */
    }
  }
  return { hash: tx.hash, feeBps, volatility };
}

/**
 * Mint `amountPerToken` of each token in `tokenAddrs` to the connected account.
 * Returns the hash of the last mint. MockERC20.mint is permissionless.
 */
export async function mintTestTokens(
  signer: ethers.Signer,
  tokenAddrs: string[],
  amountPerToken: bigint,
): Promise<string> {
  const to = await signer.getAddress();
  let lastHash = "";
  for (const addr of tokenAddrs) {
    const erc20 = new ethers.Contract(addr, ERC20_ABI, signer);
    const tx = await erc20.mint(to, amountPerToken);
    await tx.wait();
    lastHash = tx.hash;
  }
  return lastHash;
}

/** minAmountOut = amountOut * (10000 - slippageBps) / 10000, in BigInt. */
export function applySlippage(amountOut: bigint, slippageBps: number): bigint {
  const bps = BigInt(Math.max(0, Math.min(10000, Math.round(slippageBps))));
  return (amountOut * (10000n - bps)) / 10000n;
}
