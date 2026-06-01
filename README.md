# Dynamic-Fee-AMM

> A decentralized, non-custodial Constant Product Market Maker (CPMM) featuring an autonomous dual-factor internal volatility engine and a permissioned off-chain macro-telemetry defensive shield. Built end-to-end across EVM smart contracts, quantitative simulation, asynchronous Python ETL infrastructure, and a React/TypeScript analytics terminal.

---

## Table of Contents

1. [Protocol Identity & Mathematical Foundation](#1-protocol-identity--mathematical-foundation)
2. [Hybrid System Topology Map](#2-hybrid-system-topology-map)
3. [On-Chain Smart Contract Deep-Dive & Gas Optimizations](#3-on-chain-smart-contract-deep-dive--gas-optimizations)
4. [Off-Chain Engineering: Simulation, Scraping & Scoring](#4-off-chain-engineering-simulation-scraping--scoring)
5. [Definitive Verification & Deployment Execution Guide](#5-definitive-verification--deployment-execution-guide)

---

## 1. Protocol Identity & Mathematical Foundation

### The Core Invariant

Dynamic-Fee-AMM is a Constant Product Market Maker governed by the invariant:

```
x · y = k
```

where `x` and `y` are the pool's respective token reserves and `k` is a constant that is preserved across every swap. This geometric constraint guarantees deterministic, manipulation-resistant price discovery without any order book, oracle dependency, or central counterparty. The protocol is fully non-custodial: assets are held exclusively in the `DynamicFeePool` contract, and LP positions are represented as standard ERC-20 tokens that can be freely transferred, composited, or liquidated.

### The Problem: Structural LP Vulnerability Under Directional Markets

Traditional CPMM deployments, including the canonical Uniswap V2 implementation, apply a **static fee tier** — fixed at 30 basis points (0.30%) regardless of prevailing market conditions. This design creates two compounding sources of LP capital destruction:

**Impermanent Loss (IL)** is the well-documented divergence loss that manifests whenever the reserve ratio in the pool drifts away from the ratio at the time of deposit. For a pool initialized at price `P₀` that subsequently moves to `P₁`, the IL expressed as a fraction of the HODL value is:

```
IL = 2·√(P₁/P₀) / (1 + P₁/P₀) − 1
```

A 30% directional price crash produces approximately **8.3% IL** relative to simply holding the assets outside the pool. For large liquidity providers in volatile pairs, this is a structurally unacceptable cost.

**Loss-Versus-Rebalancing (LVR)** is a more precise and recent formalization of the same phenomenon, introduced by Milionis et al. (2022). LVR quantifies the continuous expected loss incurred by an LP when an arbitrageur rebalances the pool to track an exogenous reference price. Unlike IL, which is path-independent, LVR accumulates in real time with every arbitrage interaction. Its instantaneous rate is proportional to the pool's price variance and inversely proportional to the fee level:

```
LVR_rate ∝ σ² / (2 · fee)
```

This relationship reveals the central design flaw of static fee AMMs: **a 30 bps fee that is appropriate during low-volatility equilibrium provides negligible protection during a high-frequency arbitrage cascade or a macro-driven directional crash**. At the moment LPs are most exposed — when `σ²` spikes — the fee remains pinned at its floor, leaving arbitrageurs free to extract value at LP expense.

### The Solution: A Dual-Factor Adaptive Fee Engine

Dynamic-Fee-AMM addresses this vulnerability with a two-layer fee architecture:

**Layer 1 — On-Chain EMA Volatility Oracle.** The protocol maintains a continuous Exponential Moving Average (EMA) of trading intensity directly in contract storage. Each swap contributes its price impact to the accumulator, and the accumulator decays by 50% every 60 seconds via a bit-shift approximation of the half-life decay function. The resulting fee is clamped within the range **[30 bps, 150 bps]** (0.30% → 1.50%), automatically rising during HFT cascades and falling back to the floor during equilibrium.

**Layer 2 — Off-Chain Macro Telemetry Shield.** A permissioned relayer pipeline ingests real-world macroeconomic signals — the Crypto Fear & Greed Index and exchange-wide 24-hour volume shocks — and pushes a scalar multiplier into the contract. This multiplier ranges from **1.00× to 2.00×**, applying a second-order amplification to the already-adaptive fee during detected macro stress events, providing a preemptive shield against the most damaging categories of adversarial flow before they reach the reserves.

The combined fee model means that a whale trade during a macro panic can trigger a fee as high as **150 bps** — five times the Uniswap V2 baseline — making toxic arbitrage extraction significantly less profitable and routing the surplus fee revenue directly back to LPs.

---

## 2. Hybrid System Topology Map

```
╔══════════════════════════════════════════════════════════════════════════╗
║          DYNAMIC-FEE-AMM  ·  END-TO-END SYSTEM ARCHITECTURE             ║
╚══════════════════════════════════════════════════════════════════════════╝

  ┌─────────────────────────────────────────────────────────────────────┐
  │            REAL-WORLD WEB2 DATA ENDPOINTS  (Layer 0)                │
  │                                                                     │
  │   Alternative.me  ──────────────  Fear & Greed Index  [0–100]       │
  │   CoinGecko API   ──────────────  ETH 24h CEX Volume  [USD]         │
  └─────────────────────────────┬───────────────────────────────────────┘
                                │  asyncio.gather() — concurrent HTTP
                                ▼  aiohttp + exponential-backoff retry
  ┌─────────────────────────────────────────────────────────────────────┐
  │       ASYNC PYTHON INGESTION & Z-SCORE SCORING ENGINE  (Layer 1)   │
  │                                                                     │
  │   Sentiment Penalty  =  max(0,  (50 − F&G) / 50  ×  50)            │
  │   Volume Penalty     =  min(50, (Vol − $15B) / $15B  ×  50)        │
  │   Composite Score    =  sentiment_penalty + volume_penalty          │
  │   Chaos Multiplier   =  clamp(100 + score, 100, 200)  →  uint8     │
  └─────────────────────────────┬───────────────────────────────────────┘
                                │  web3.py — sign & broadcast tx
                                ▼  setExternalChaosMultiplier(uint8)
  ┌─────────────────────────────────────────────────────────────────────┐
  │       EVM SMART CONTRACT STATE UPDATE  (Layer 2)                   │
  │                                                                     │
  │   PoolFactory  (Ownable)                                            │
  │     └──▶  DynamicFeePool  (ReentrancyGuard)                         │
  │               ├── poolAdmin  [immutable]  — authorized relayer      │
  │               ├── externalChaosMultiplier  [uint8, 100–200]         │
  │               ├── reserve0 / reserve1  [uint112, single slot]       │
  │               ├── cumulativeVolatilityTracker  [uint112 EMA]        │
  │               └── LPToken  (ERC-20, pool-owned mint/burn)           │
  └─────────────────────────────┬───────────────────────────────────────┘
                                │  on-chain: calculateDynamicFee()
                                ▼  Two-factor: EMA volatility × chaos multiplier
  ┌─────────────────────────────────────────────────────────────────────┐
  │   DYNAMICFEEPOOL SWAP EXECUTION & PREEMPTIVE LP SHIELD  (Layer 3)  │
  │                                                                     │
  │   fee_bps  =  clamp(BASE_FEE + vol × 15/1000, 30, 150)             │
  │   scaled   =  clamp(fee_bps × multiplier / 100, 30, 150)           │
  │   amountOut = reserveOut × amountIn × (10000 − fee_bps)            │
  │              ──────────────────────────────────────────             │
  │              reserveIn × 10000  +  amountIn × (10000 − fee_bps)    │
  └──────────────────────────────▲──────────────────────────────────────┘
                                 │  ethers.js v6 — JsonRpcProvider
                                 │  real-time SLOAD polling + event subscriptions
                                 │  (Swap, FeeUpdated, ExternalMultiplierUpdated)
  ┌─────────────────────────────────────────────────────────────────────┐
  │        REACT / TYPESCRIPT ANALYTICS WEB TERMINAL  (Layer 4)        │
  │                                                                     │
  │   usePairPoolState  ──── live pool state (reserves, vol, fee, mux) │
  │   useMacroPipeline  ──── polls macro_pipeline.py /score endpoint   │
  │   PairTelemetryChart ─── real-time fee & reserve time-series        │
  │   SwapPanel          ─── sandbox simulation + live tx execution     │
  │   MultiplierControl  ─── admin panel for chaos multiplier writes    │
  │   Dual-mode: sandbox (local state) ↔ live (Sepolia testnet)        │
  └─────────────────────────────────────────────────────────────────────┘
```

---

## 3. On-Chain Smart Contract Deep-Dive & Gas Optimizations

### 3.1 Architecture: The Hierarchical Trust Matrix

The protocol is organized as a three-contract hierarchy with a strict, non-upgradeable trust model:

```
PoolFactory  (OpenZeppelin Ownable)
    │
    │  createPool(tokenA, tokenB)
    │  • sorts tokens by address → canonical (token0, token1) pair
    │  • deploys a new DynamicFeePool, passing owner() as poolAdmin
    │  • registers pool in bidirectional mapping getPool[a][b] = getPool[b][a]
    │
    ▼
DynamicFeePool  (ReentrancyGuard)
    │
    │  addLiquidity / removeLiquidity / swap / setExternalChaosMultiplier
    │
    ▼
LPToken  (OpenZeppelin ERC-20)
    • owner = address(pool) — set in constructor, never changeable
    • mint() and burn() gated to onlyOwner
```

**`PoolFactory`** is the sole entry point for pair creation. It inherits OpenZeppelin `Ownable` and enforces three creation-time invariants via custom errors: identical token addresses (`IdenticalAddresses`), zero addresses (`ZeroAddress`), and duplicate pairs (`PoolAlreadyExists`). The factory's current owner is atomically baked into each new pool as its immutable `poolAdmin`, creating a cryptographic chain of custody that requires no runtime storage lookups to enforce.

**`DynamicFeePool`** is the core execution engine. It is `nonReentrant` on all state-mutating external functions. The pool holds no upgradeability proxy and has no owner-privileged escape hatches over LP funds — the only admin action exposed is `setExternalChaosMultiplier`, which cannot affect reserves or LP token supply.

**`LPToken`** is a minimal ERC-20 that hard-binds mint/burn authority to the single address that constructed it (always the pool). There is no multi-sig, no timelock, and no delegated minting — LP share issuance is a pure function of the pool's internal liquidity math.

### 3.2 Gas Engineering: Storage Slot Compression

The most gas-intensive operation in any AMM is the swap path, which requires reading and writing both pool reserves. The critical optimization is inherited directly from Uniswap V2's storage layout:

```solidity
// Both reserves packed into a single 256-bit storage slot:
//   [uint112 reserve0][uint112 reserve1][uint32 padding]
uint112 private reserve0;
uint112 private reserve1;
```

By constraining each reserve to `uint112` (a value space up to ~5.19 × 10³³), both reserves fit within a single 32-byte EVM storage word. This means every swap that reads and subsequently writes both reserves incurs **exactly one cold `SLOAD` (2,100 gas) and one `SSTORE` to a warm slot** rather than two cold SLOADs — a saving of 2,100 gas units on every swap that touches a previously-unread slot, which in practice means the first swap of a block.

The `poolAdmin` relayer address is declared `immutable`:

```solidity
address public immutable poolAdmin;
```

Solidity `immutable` variables are resolved at construction time and baked directly into the contract's deployed bytecode. At runtime, reading `poolAdmin` inside `onlyFactoryOwner` requires zero storage reads — the EVM accesses the value as a bytecode constant (equivalent to a `PUSH` opcode), costing 3 gas instead of the 100–2,100 gas of an `SLOAD`. The same pattern applies to `token0`, `token1`, and `lpToken`, eliminating storage overhead from the hot path of every swap.

The Foundry configuration enables the Solidity optimizer with **200 runs**, calibrated to minimize deployment cost while still optimizing the hot swap path that will be called frequently in production:

```toml
optimizer      = true
optimizer_runs = 200
```

### 3.3 The Two-Factor Fee Model: On-Chain Implementation

The fee calculation is entirely `internal view` with no external calls, no storage writes, and no branching on token identity — it is a pure arithmetic pipeline executed synchronously within the swap transaction:

**Step 1 — Temporal Decay via Bit-Shift Approximation**

```solidity
uint32  timeElapsed       = uint32(block.timestamp) - lastTransactionTimestamp;
uint256 shift             = uint256(timeElapsed / DECAY_HALFLIFE);   // DECAY_HALFLIFE = 60
uint256 decayedVolatility = shift >= 112
    ? 0
    : uint256(cumulativeVolatilityTracker) >> shift;
```

Each 60-second interval halves the accumulated volatility via a right bit-shift (`>> n ≈ / 2ⁿ`). The guard `shift >= 112` prevents undefined behavior when more than 112 half-lives have elapsed (at which point the `uint112` tracker would have decayed to exactly zero). This is a gas-efficient approximation of the continuous half-life decay `V(t) = V₀ · e^(−λt)`, avoiding any floating-point or exponential opcode.

**Step 2 — Price Impact Accumulation**

```solidity
uint256 priceImpact = (amountIn * 10000) / reserveIn;
uint256 newVolatility = decayedVolatility + priceImpact;
```

The current swap's price footprint is expressed in basis points of the input reserve and added directly to the decayed EMA, producing the combined volatility reading.

**Step 3 — Raw Fee Computation & Hard Clamp**

```solidity
// VOLATILITY_ALPHA = 15, VOLATILITY_SCALE = 1000
uint256 rawFee        = uint256(BASE_FEE) + (newVolatility * VOLATILITY_ALPHA / VOLATILITY_SCALE);
uint256 currentFeeBps = Math.max(Math.min(rawFee, uint256(MAX_FEE)), uint256(BASE_FEE));
```

The sensitivity constants were calibrated so that an 80% whale trade (priceImpact = 8,000) hits `MAX_FEE` exactly: `30 + 8000 × 15 / 1000 = 150`. The double-clamp ensures the fee can never breach the structural ceiling nor fall below the floor regardless of the volatility accumulator's value.

**Step 4 — Macro Multiplier Scaling & Final Re-Clamp**

```solidity
uint256 scaledFee = (currentFeeBps * externalChaosMultiplier) / 100;
feeBps = Math.min(uint256(MAX_FEE), scaledFee);
```

The chaos multiplier (stored as a `uint8` in basis points of 100 — i.e., 150 represents 1.50×) is applied as a final scalar before the result is re-clamped to `MAX_FEE`. This ensures that even a 2.00× multiplier cannot cause the fee to breach the protocol's structural ceiling.

### 3.4 Access Controls & Custom Error Architecture

The protocol uses custom Solidity errors (EIP-838) throughout, which are both more gas-efficient than `require` string reverts and more developer-friendly for programmatic error handling:

| Error | Trigger Condition |
|---|---|
| `Unauthorized()` | `msg.sender != poolAdmin` on `setExternalChaosMultiplier` |
| `MultiplierOutOfRange(uint8)` | Multiplier value outside `[100, 200]` |
| `InvalidToken(address)` | `tokenIn` is neither `token0` nor `token1` |
| `InsufficientOutputAmount(uint256, uint256)` | `amountOut < minAmountOut` (slippage protection) |
| `InsufficientLiquidity()` | Zero-reserve pool or zero-amount withdrawal |
| `ZeroLiquidity()` | Zero LP shares computed on deposit |
| `IdenticalAddresses()` | Both tokens are the same address (factory) |
| `PoolAlreadyExists(address)` | Duplicate pair registration attempt (factory) |

The `onlyFactoryOwner` modifier cryptographically enforces the relayer access boundary:

```solidity
modifier onlyFactoryOwner() {
    if (msg.sender != poolAdmin) revert Unauthorized();
    _;
}
```

Because `poolAdmin` is `immutable`, this check is a bytecode-level constant comparison — no delegate-call attack surface, no storage slot manipulation vector, and no admin key rotation possible post-deployment.

The clamping constraint on `setExternalChaosMultiplier` enforces a strict integer domain `[100, 200]`:

- **100** is the neutral baseline (1.00× — no amplification). The relayer may write exactly 100 to execute mean reversion, resetting the multiplier after macro stress subsides.
- **200** is the structural 2.00× hard cap, preventing any runaway fee amplification that could render the pool economically untradeables.
- Values of 99 or below, and 201 or above, revert unconditionally.

---

## 4. Off-Chain Engineering: Simulation, Scraping & Scoring

### 4.1 The Quantitative Simulator: 24-Hour Stress Backtest

The Python simulation suite (`simulation/`) runs a 1,440-minute (one-per-minute) parallel backtest comparing two independent, isolated AMM engines across three synthetic market regimes:

| Regime | Time Window | Characteristics |
|---|---|---|
| Equilibrium | Hours 0–8 (rows 0–479) | Sideways price action, σ ≈ 0.001 per tick, low trade density |
| Crash | Hours 8–16 (rows 480–959) | −30% directional crash, σ ≈ 0.008 per tick, HFT density spike |
| Recovery | Hours 16–24 (rows 960–1439) | Choppy upward consolidation, partial mean reversion |

**Model A** applies a flat 30 bps fee on every trade — the Uniswap V2 static baseline.

**Model B** applies the exact Python replica of the Solidity `calculateDynamicFee` function, with the same `DECAY_HALFLIFE`, `VOLATILITY_ALPHA`, `VOLATILITY_SCALE`, `BASE_FEE`, and `MAX_FEE` constants, ensuring the simulation output is directly comparable to on-chain behavior.

#### The Algorithmic Arbitrage Anchor

A critical design decision in the backtest is the inclusion of an **Algorithmic Target-Reserve Matching Arbitrage Anchor**. Without it, the simulated pool would diverge from any exogenous market price over time, making comparisons economically vacuous — the pool would have a different implied price than the market, meaning there would be no rational basis for trader direction or sizing. The anchor corrects for this by injecting a synthetic arbitrage trade at the start of each minute that rebalances the pool's implied price to match the exogenous market price `Pₘ`:

```
Δx = √(k / Pₘ) − x_current
```

where:
- `k = x_current × y_current` is the current constant product
- `Pₘ` is the exogenous market price in `y/x` units (USDC per ETH)
- `√(k / Pₘ)` is the x-reserve that would make the pool's marginal price equal to `Pₘ`
- `Δx` is the net ETH input (positive) or output (negative) required to achieve that price

This formula ensures that at the start of each simulation tick, the pool price exactly tracks the exogenous market — mimicking the real-world behavior of MEV bots and statistical arbitrageurs who maintain price parity across venues. Without this anchor, the backtest would be running in an economic vacuum; with it, the IL and fee accumulation statistics are directly comparable to what an LP would experience on a live deployment.

### 4.2 The Asynchronous ETL Relayer: `macro_pipeline.py`

The pipeline is built on Python `asyncio` and `aiohttp`, executing both Web2 data fetches **concurrently** within a single event loop iteration:

```python
fear_greed, volume = await asyncio.gather(
    fetch_fear_greed_index(session),
    fetch_eth_volume_usd(session),
)
```

`asyncio.gather` runs both coroutines concurrently with no thread overhead. Wall-clock latency is determined by the slower of the two network calls rather than their sum.

#### Exponential-Backoff Retry Circuit Breaker

Each individual HTTP fetch is wrapped in a retry loop with exponential backoff to gracefully handle transient API failures:

```python
for attempt in range(MAX_RETRIES):     # MAX_RETRIES = 3
    try:
        async with session.get(url, timeout=timeout) as response:
            response.raise_for_status()
            return await response.json(content_type=None)
    except Exception as exc:
        wait = RETRY_BACKOFF_BASE ** attempt   # 1s, 2s, 4s
        if attempt < MAX_RETRIES - 1:
            await asyncio.sleep(wait)
        # else: fall through to neutral baseline
```

Wait intervals follow the sequence `{1s, 2s, 4s}` (powers of `RETRY_BACKOFF_BASE = 2.0`). After three consecutive failures, the function falls through to a hardcoded neutral baseline (`FEAR_GREED_NEUTRAL = 50`, `VOLUME_BASELINE_USD = $15B`) rather than propagating an exception. This fail-safe design ensures the pipeline never pushes a malformed value to the contract and never crashes the relayer process due to an upstream API outage.

#### Dashboard Feed Server Mode

In `--serve` mode the pipeline exposes a CORS-enabled HTTP endpoint (`GET /score`) that the React dashboard polls every 60 seconds. The aiohttp server runs on a background `asyncio` task while the foreground event loop remains alive indefinitely:

```
python simulation/macro_pipeline.py --serve --port 8765 --interval 60
```

The `--broadcast` flag additionally activates on-chain writes from within the serve loop, but **only when the computed multiplier differs from the last broadcast value** — preventing redundant gas spend on no-op transactions:

```python
if m == last_broadcast:
    logger.info("Multiplier unchanged — no broadcast needed.")
else:
    tx = await asyncio.to_thread(_do_broadcast, m)
    last_broadcast = m
```

### 4.3 The Scoring Engine: Normalization Mechanics

The scoring function maps two heterogeneous real-valued signals into a single on-chain-ready `uint8` integer via additive normalization:

**Sentiment Penalty** — derived from the Alternative.me Fear & Greed Index (range 0–100):

```
sentiment_penalty = max(0, (50 − fear_greed_index) / 50 × 50)
```

- Index ≥ 50 (Neutral, Greed, Extreme Greed): penalty = 0. No fee amplification.
- Index = 0 (Extreme Fear): penalty = 50. Maximum sentiment contribution to the multiplier.
- The mapping is linear, symmetric around the neutral midpoint of 50.

**Volume Penalty** — derived from the CoinGecko ETH 24-hour volume against a $15B baseline:

```
volume_penalty = min(50, max(0, (volume − $15B) / $15B × 50))
```

- Volume ≤ $15B (baseline): penalty = 0. No amplification.
- Volume = $30B (2× baseline): penalty = 50. Maximum volume contribution.
- The mapping is linear, capped at 50 to prevent any single signal from monopolizing the composite.

**Composite Multiplier:**

```
multiplier = clamp(100 + int(sentiment_penalty + volume_penalty), 100, 200)
```

The two penalty scores are additive, jointly capped at 100 aggregate points (50 per signal), which maps cleanly to the `[100, 200]` on-chain domain. A scenario of Extreme Fear (`index = 0`) coinciding with a 2× volume shock produces the maximum `multiplier = 200`, triggering the full 2.00× fee amplification.

### 4.4 Web3 Settlement Bridge

On-chain writes are handled by `web3.py` with conservative gas safety margins to avoid dropped transactions during network congestion:

```python
gas_price = int(w3.eth.gas_price * 1.10)   # 10% tip above current base
gas_limit = int(estimate_gas(...) * 1.20)   # 20% buffer above estimate
```

The pipeline builds, signs, broadcasts, and awaits receipt confirmation in a single synchronous blocking call (wrapped in `asyncio.to_thread` from the serve-mode event loop). A receipt `status != 1` is treated as a hard error and raised to the caller — the pipeline never silently swallows a reverted transaction.

---

## 5. Definitive Verification & Deployment Execution Guide

### Prerequisites

| Dependency | Version | Purpose |
|---|---|---|
| [Foundry](https://getfoundry.sh) | latest | Smart contract compilation, testing, deployment |
| Python | 3.11+ | Simulation engine & async ETL relayer |
| Node.js | 18+ | React/TypeScript analytics dashboard |

---

### 5.1 Smart Contract Verification: Clone → Build → Test

```bash
# Clone the repository
git clone https://github.com/jone/Dynamic-Fee-AMM.git
cd Dynamic-Fee-AMM

# Install Foundry submodule dependencies
# (OpenZeppelin Contracts v5, forge-std)
forge install

# Compile all contracts with optimizer=200 runs
forge build

# Run the full 12-test matrix with maximum verbosity
# Prints gas usage, event logs, and stack traces for every test
forge test -vvv
```

**Expected output** — all 12 test assertions green:

```
[PASS] test_EquilibriumFeeFloor()           — fee returns to 30 bps after 60 half-lives
[PASS] test_HighFrequencyCascadingSpike()   — monotonic fee escalation under same-block HFT
[PASS] test_MathematicalFeeCapEnforcement() — 80% whale trade clamped exactly at 150 bps
[PASS] test_AsymmetricVolatilityDecay()     — accumulator halves after one DECAY_HALFLIFE
[PASS] test_OnlyOwnerCanSetMultiplier()     — Unauthorized() revert on rogue caller
[PASS] test_MultiplierClampingMath()        — 1.5× multiplier yields 45 bps on quiet market
[PASS] test_MultiplierCanRevertToNeutral()  — relayer can reset to baseline 100
[PASS] test_MultiplierRejectsOutOfRange()   — 99 and 201 both revert
...

Test result: ok. 12 passed; 0 failed; finished in Xs
```

To generate detailed gas reports for every public function across all three contracts:

```bash
forge test --gas-report
```

---

### 5.2 Data Simulation Run: Python Backtest

```bash
# Navigate to the simulation directory
cd simulation

# Create and activate an isolated virtual environment
python3 -m venv .venv
source .venv/bin/activate          # macOS/Linux
# .venv\Scripts\activate           # Windows

# Install all Python dependencies
pip install -r requirements.txt

# Launch Jupyter and open the backtest notebook
jupyter notebook backtest.ipynb
```

The notebook executes the full 1,440-minute stress backtest. Cell execution produces:

1. A synthetic 24-hour market DataFrame (`market_sim.py` engine) across three regimes: equilibrium, −30% crash, and choppy recovery.
2. Side-by-side simulation runs of **Model A** (static 30 bps) and **Model B** (dynamic 30–150 bps) via the `AMMSimulator` class.
3. Comparative output plots saved to `simulation/plots/`:
   - Fee trajectory over the 24-hour window (bps vs. time)
   - Cumulative LP fee revenue: Model A vs. Model B
   - Remaining reserve ratio vs. HODL benchmark
   - Impermanent Loss differential: static vs. dynamic

Alternatively, run the simulator as a standalone script:

```bash
python amm_simulator.py
```

---

### 5.3 Live Testnet Pipeline Execution: Sepolia Deployment & Relayer

#### Step 1 — Configure Environment Credentials

Copy the example environment template and populate it with live credentials:

```bash
# From the repository root
cp .env.example .env
```

Edit `.env`:

```bash
# Deployer wallet — use a dedicated throwaway key, never your main account
PRIVATE_KEY=0xYOUR_PRIVATE_KEY_HERE

# Alchemy or Infura Sepolia RPC endpoint (free tier is sufficient)
SEPOLIA_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/YOUR_ALCHEMY_KEY

# Etherscan API key for source verification (optional)
ETHERSCAN_API_KEY=YOUR_ETHERSCAN_API_KEY
```

#### Step 2 — Deploy the Protocol to Sepolia

```bash
forge script script/Deploy.s.sol \
  --rpc-url sepolia \
  --broadcast \
  --verify \
  -vvv
```

The script deploys:
1. `PoolFactory` — the protocol entry point
2. Four mock ERC-20 tokens: ETH, USDC, WBTC, USDT (all 18 decimals)
3. Two seeded trading pairs: **ETH/USDC** (spot ≈ $3,000) and **WBTC/USDT** (spot ≈ $100,000)

On completion the script prints all deployed contract addresses. Copy these into `frontend/.env` and `simulation/.env`.

#### Step 3 — Configure the Simulation Relayer

```bash
cd simulation
cp .env.example .env  # or create simulation/.env manually
```

Edit `simulation/.env`:

```bash
# EVM JSON-RPC endpoint (same Alchemy key, or a dedicated one)
RPC_URL=https://eth-sepolia.g.alchemy.com/v2/YOUR_ALCHEMY_KEY

# The authorized poolAdmin EOA — must match the factory owner private key
RELAYER_PRIVATE_KEY=0xYOUR_PRIVATE_KEY_HERE

# The DynamicFeePool address output by the deploy script
POOL_CONTRACT_ADDRESS=0xYOUR_POOL_ADDRESS_HERE

# Set to "false" to execute real on-chain transactions
# Set to "true" for a dry run that validates the payload without broadcasting
DRY_RUN=false
```

#### Step 4 — Run the Macro Relayer Pipeline

**One-shot mode** — fetch, score, and broadcast a single `setExternalChaosMultiplier` transaction:

```bash
python simulation/macro_pipeline.py
```

**Dashboard feed server mode** — start a local scoring API that the React frontend polls:

```bash
python simulation/macro_pipeline.py --serve --port 8765 --interval 60
```

**Combined mode** — serve the dashboard API and auto-broadcast on-chain on every multiplier change:

```bash
python simulation/macro_pipeline.py --serve --broadcast --interval 300
```

#### Step 5 — Launch the Analytics Dashboard

```bash
cd frontend
npm install

# Standard dashboard only (polls the pipeline server if it's running)
npm run dev

# Full stack: dashboard + pipeline server in parallel (requires simulation/.env)
npm run dev:all

# Full stack with live on-chain broadcasting (requires configured simulation/.env)
npm run dev:live
```

The dashboard is served at `http://localhost:5173`. It operates in **sandbox mode** by default — all swaps are simulated locally with persistent state per token pair. When `frontend/.env` contains a valid `VITE_FACTORY_ADDRESS` and `VITE_RPC_URL`, it auto-connects to the live Sepolia deployment via `ethers.js` and polls real contract state in real time.

---

## Repository Structure

```
Dynamic-Fee-AMM/
├── src/
│   ├── DynamicFeePool.sol     # Core AMM: CPMM + dual-factor fee engine
│   ├── LPToken.sol            # Pool-owned ERC-20 LP share token
│   └── PoolFactory.sol        # Pair registry & deployment factory
├── test/
│   └── DynamicFeePool.t.sol   # 12-test Foundry suite (phases 3 & 5)
├── script/
│   ├── Deploy.s.sol           # Sepolia deployment: factory + 2 pairs + seed liquidity
│   └── Redeploy.s.sol         # Incremental redeployment utility
├── simulation/
│   ├── market_sim.py          # Synthetic 24h market data generator (3 regimes)
│   ├── amm_simulator.py       # Parallel AMM backtest engine (Model A vs. Model B)
│   ├── macro_pipeline.py      # Async ETL relayer + scoring engine + dashboard server
│   ├── backtest.ipynb         # Self-contained Jupyter notebook (full backtest)
│   ├── requirements.txt       # Python dependencies
│   └── plots/                 # Generated backtest output charts
├── frontend/
│   ├── src/
│   │   ├── App.tsx                    # Root component — pair state & view routing
│   │   ├── components/                # StatCard, SwapPanel, PairTelemetryChart, etc.
│   │   ├── hooks/
│   │   │   ├── usePairPoolState.ts    # ethers.js v6 live pool state + event subs
│   │   │   └── useMacroPipeline.ts    # Polling hook for pipeline /score endpoint
│   │   ├── config/tokenRegistry.ts    # Token pair definitions & contract addresses
│   │   └── lib/amm.ts                 # Client-side fee math mirror (TypeScript)
│   ├── package.json
│   └── vite.config.js
├── foundry.toml               # Compiler, optimizer, gas report, fuzz config
├── .env.example               # Environment variable template
└── remappings.txt             # Foundry import remappings
```

---

## License

MIT
