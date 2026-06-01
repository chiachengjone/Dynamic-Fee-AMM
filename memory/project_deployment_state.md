---
name: project-deployment-state
description: Which trading pairs and contracts are live on Sepolia vs. local-only
metadata:
  type: project
---

ETH/USDC and WBTC/USDT pools (plus PoolFactory and four mock ERC-20 tokens) are deployed and seeded on the Ethereum Sepolia testnet via Deploy.s.sol. All other token pairs supported by the frontend's tokenRegistry exist only in local sandbox/browser state.

**Why:** The deploy script provisions exactly two pools (ETH/USDC at ~$3,000 and WBTC/USDT at ~$100,000). No additional pairs have been deployed on-chain yet.

**How to apply:** When discussing live on-chain behavior, scope it to ETH/USDC and WBTC/USDT. Any other pair in the frontend is sandbox-only until explicitly deployed.
