"""
Market data generator for the Dynamic-Fee-AMM Phase 4 backtest.

Produces 1,440 rows (one per minute, a full 24-hour trading day) across three
distinct market regimes designed to stress-test AMM fee models:

  Hours  0- 8  (rows    0-479): low-vol equilibrium, sideways price action
  Hours  8-16  (rows  480-959): high-vol crash, -30% drop, HFT density
  Hours 16-24  (rows 960-1439): choppy recovery, gradual upward consolidation
"""

import math
import numpy as np
import pandas as pd


def generate_market_data(seed: int = 42) -> pd.DataFrame:
    """
    Build a synthetic 24-hour market DataFrame with three regime blocks.

    Parameters
    ----------
    seed : int
        Random seed for full reproducibility.

    Returns
    -------
    pd.DataFrame with columns:
        minute        – row index 0-1439
        price         – exogenous market price in USDC/ETH (for HODL calc)
        amount_in_eth – trade size in ETH-equivalent units (always positive)
        delta_t       – seconds elapsed since the previous trade
        direction     – 1 = ETH→USDC (sell ETH), -1 = USDC→ETH (buy ETH)
        regime        – 'equilibrium' | 'crash' | 'recovery'
    """
    rng = np.random.default_rng(seed)
    N   = 1440

    # ------------------------------------------------------------------
    # Price simulation
    # Starting price: 3,000 USDC per ETH (approximately mid-2023 range)
    # ------------------------------------------------------------------
    prices = np.empty(N)
    p = 3_000.0

    # Regime 1 — equilibrium: tiny random walk, negligible drift
    for i in range(480):
        p *= math.exp(rng.normal(0.0, 0.001))
        prices[i] = p

    # Regime 2 — crash: log-normal drift targeting -30% over 480 steps
    # with high per-step noise to simulate panic/MEV-driven volatility
    crash_drift = math.log(0.70) / 480
    for i in range(480, 960):
        p *= math.exp(crash_drift + rng.normal(0.0, 0.008))
        p  = max(p, 50.0)   # price floor prevents degenerate reserves
        prices[i] = p

    # Regime 3 — recovery: sustained upward drift clawing back most of the crash,
    # with choppy noise. Lands the day roughly 10-15% below the open (a partial
    # V-shape), so the fee premium accumulated during the crash is what decides
    # whether an LP ends the day ahead.
    for i in range(960, 1440):
        p *= math.exp(rng.normal(0.0009, 0.005))
        prices[i] = p

    # ------------------------------------------------------------------
    # Trade sizes in ETH units
    # ------------------------------------------------------------------
    amount_in_eth = np.concatenate([
        rng.uniform(0.1, 1.0, 480),   # equilibrium: small retail orders
        rng.uniform(0.5, 5.0, 480),   # crash: large arb / MEV flows
        rng.uniform(0.2, 2.5, 480),   # recovery: medium-sized orders
    ])

    # ------------------------------------------------------------------
    # Inter-trade time gap in seconds
    # delta_t drops near zero during crash to simulate HFT block density
    # ------------------------------------------------------------------
    delta_t = np.concatenate([
        rng.uniform(30.0, 120.0, 480),   # equilibrium: relaxed cadence
        rng.uniform( 1.0,  15.0, 480),   # crash: high-frequency trading
        rng.uniform(20.0,  90.0, 480),   # recovery: moderate frequency
    ])
    delta_t[0] = 60.0   # safe default: no prior trade on the first row

    # ------------------------------------------------------------------
    # Trade direction
    # Crash skewed toward ETH sells (drives pool price down).
    # Recovery skewed toward ETH buys (pool price partially recovers).
    # ------------------------------------------------------------------
    direction = np.concatenate([
        rng.choice([1, -1], 480, p=[0.50, 0.50]),   # equilibrium: balanced
        rng.choice([1, -1], 480, p=[0.75, 0.25]),   # crash: mostly dump
        rng.choice([1, -1], 480, p=[0.35, 0.65]),   # recovery: mostly buy
    ])

    regimes = ['equilibrium'] * 480 + ['crash'] * 480 + ['recovery'] * 480

    return pd.DataFrame({
        'minute'        : np.arange(N),
        'price'         : prices,
        'amount_in_eth' : amount_in_eth,
        'delta_t'       : delta_t,
        'direction'     : direction,
        'regime'        : regimes,
    })
