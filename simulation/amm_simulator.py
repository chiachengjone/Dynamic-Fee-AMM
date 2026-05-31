"""
Twin-engine AMM simulator for the Dynamic-Fee-AMM Phase 4 backtest.

Runs two parallel, isolated constant-product pools from identical starting
reserves and compares their LP economics over a full 24-hour stress scenario.

Model A — Static 0.3% fee  : flat 30 bps on every trade (Uniswap V2 baseline)
Model B — Dynamic-Fee AMM  : 30-150 bps fee driven by on-chain volatility EMA,
                              exact replica of Phase 3 Solidity calculateDynamicFee
"""

import math
import os

import matplotlib.pyplot as plt
import matplotlib.ticker as mticker
import numpy as np
import pandas as pd
import seaborn as sns


# ---------------------------------------------------------------------------
# Protocol constants — exact match to Phase 3 Solidity
# ---------------------------------------------------------------------------
X0              = 100.0       # initial ETH reserve
Y0              = 300_000.0   # initial USDC reserve
INITIAL_PRICE   = Y0 / X0    # 3,000 USDC/ETH
INITIAL_VALUE   = 2.0 * Y0   # 600,000 USDC  (pool value = 2*y at marginal price)

BASE_FEE_BPS     = 30         # 0.30% floor
MAX_FEE_BPS      = 150        # 1.50% ceiling
DECAY_HALFLIFE_S = 60         # seconds per EMA half-life
VOL_ALPHA        = 15         # fee sensitivity numerator   (30 + vol*15/1000)
VOL_SCALE        = 1_000      # fee sensitivity denominator

# ---------------------------------------------------------------------------
# Chart palette
# ---------------------------------------------------------------------------
NAVY    = '#1B2A4A'   # Model A static baseline
EMERALD = '#00A878'   # Model B dynamic protocol
GOLD    = '#F5A623'   # market price / HODL reference
GREY    = '#8C9EAD'   # secondary reference lines


# ---------------------------------------------------------------------------
# AMMSimulator
# ---------------------------------------------------------------------------

class AMMSimulator:
    """
    Processes a 1,440-row market DataFrame through two independent AMM engines.

    Usage
    -----
    sim = AMMSimulator()
    df_a, df_b = sim.run(market_df)
    """

    def __init__(self):
        # Model A state
        self.a_x             = X0
        self.a_y             = Y0
        self.a_cum_fees_usdc = 0.0

        # Model B state
        self.b_x             = X0
        self.b_y             = Y0
        self.b_cum_fees_usdc = 0.0
        self.b_vol_tracker   = 0.0   # EMA volatility accumulator
        self.b_last_ts       = 0.0   # wall-clock timestamp of last swap

    # ------------------------------------------------------------------
    # Static math helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _calc_amount_out(amount_in, reserve_in, reserve_out, fee_bps):
        """
        Constant-product output formula — exact Python replica of Solidity getAmountOut.

            fee_mul   = 10,000 - fee_bps
            amountOut = (reserveOut * amountIn * fee_mul)
                        / (reserveIn * 10,000 + amountIn * fee_mul)
        """
        fee_mul = 10_000.0 - fee_bps
        num = reserve_out * amount_in * fee_mul
        den = reserve_in  * 10_000.0 + amount_in * fee_mul
        return num / den

    def _calc_dynamic_fee(self, eth_equiv_size, reserve_eth, current_ts):
        """
        Replica of Phase 3 Solidity calculateDynamicFee.

        Step 1 — Decay: integer-floor shift mirrors the on-chain >> operator.
                 timeElapsed // DECAY_HALFLIFE is integer, so gaps shorter than
                 one half-life (e.g. 8 s during the crash) produce shift = 0 and
                 NO decay — the accumulator compounds and the fee races to the cap.
        Step 2 — Impact: price_impact = size * 10,000 / reserveIn, where size is
                 the trade's ETH-equivalent (USDC legs are converted at pool price).
        Step 3 — Fee: clamp BASE_FEE + vol*ALPHA/SCALE to [BASE, MAX].
        """
        time_elapsed = current_ts - self.b_last_ts
        shift        = int(time_elapsed // DECAY_HALFLIFE_S)   # integer division = >> n

        # Decay the accumulator (bit-shift on-chain → divide by 2^shift off-chain)
        if shift >= 112:
            decayed_vol = 0.0
        else:
            decayed_vol = self.b_vol_tracker / (2 ** shift)

        # Volume price impact: trade size as a fraction of the ETH reserve, in bps
        price_impact = (eth_equiv_size * 10_000.0) / reserve_eth

        new_vol = decayed_vol + price_impact
        raw_fee = float(BASE_FEE_BPS) + (new_vol * VOL_ALPHA / VOL_SCALE)
        fee_bps = max(float(BASE_FEE_BPS), min(float(MAX_FEE_BPS), raw_fee))

        return fee_bps, new_vol

    @staticmethod
    def _arb_size(x, y, target_price):
        """
        Compute the arbitrage trade that re-pegs the pool to the market price.

        An arbitrageur trades until the pool's marginal price equals the external
        market price. For a constant-product pool (k = x*y) the post-arb reserves
        that satisfy y'/x' = target_price are:

            x' = sqrt(k / target_price)      y' = sqrt(k * target_price)

        Trade direction follows the price move:
          • market below pool price  → arb SELLS ETH into the pool  (x rises)
          • market above pool price  → arb BUYS  ETH from the pool  (x falls)

        Returns (direction, amount_in_native, eth_equiv_size) where native is ETH
        for direction +1 and USDC for direction -1. Fees are ignored when sizing
        (they only shift the no-arb band by a few bps); they ARE charged on execution.
        """
        k = x * y
        x_target = math.sqrt(k / target_price)

        if x_target >= x:
            # Pool ETH is overpriced relative to market → sell ETH into the pool
            amount_in_eth = x_target - x
            return 1, amount_in_eth, amount_in_eth
        else:
            # Pool ETH is underpriced → buy ETH out of the pool with USDC
            y_target       = math.sqrt(k * target_price)
            amount_in_usdc = y_target - y
            eth_equiv      = amount_in_usdc / target_price
            return -1, amount_in_usdc, eth_equiv

    def _execute_swap(self, x, y, amount_in_native, direction, fee_bps):
        """
        Execute one swap on the provided reserves.

        direction =  1 → amount_in_native is ETH  (ETH in, USDC out)
        direction = -1 → amount_in_native is USDC (USDC in, ETH out)

        The full input (fee included) stays in the pool, so the constant product k
        grows by the fee — exactly how Uniswap V2 pays LPs. fee_usdc is the USDC
        value of that retained fee, logged separately for the revenue metric.
        Returns (new_x, new_y, fee_value_in_usdc).
        """
        if x <= 1e-9 or y <= 1e-9:
            return x, y, 0.0

        pool_price = y / x

        if direction == 1:
            amount_out = self._calc_amount_out(amount_in_native, x, y, fee_bps)
            fee_usdc   = amount_in_native * (fee_bps / 10_000.0) * pool_price
            new_x      = x + amount_in_native
            new_y      = y - amount_out
        else:
            amount_out = self._calc_amount_out(amount_in_native, y, x, fee_bps)
            fee_usdc   = amount_in_native * (fee_bps / 10_000.0)
            new_x      = x - amount_out
            new_y      = y + amount_in_native

        if new_x <= 1e-9 or new_y <= 1e-9:
            return x, y, 0.0

        return new_x, new_y, fee_usdc

    # ------------------------------------------------------------------
    # Core simulation loop
    # ------------------------------------------------------------------

    def run(self, df):
        """
        Process all 1,440 minutes through both engines.

        Each minute the pool is re-pegged to the exogenous market price by an
        arbitrage trade. The trade is large when the price has moved a lot (the
        crash) and tiny when it is calm (equilibrium). Model A charges a flat
        30 bps on that flow; Model B charges the volatility-scaled dynamic fee.
        The retained fees compound into k, so the pool that captures more fee
        ends the day with a higher mark-to-market value.

        Returns
        -------
        df_a, df_b : pd.DataFrame
            Per-step financial metrics for Model A (static) and Model B (dynamic).
        """
        records_a = []
        records_b = []
        ts = 0.0   # cumulative simulated time in seconds (sum of delta_t)

        for i, row in df.iterrows():
            ts          += float(row['delta_t'])
            market_price = float(row['price'])

            # === MODEL A — Static 30 bps ===========================
            dir_a, amt_a, _ = self._arb_size(self.a_x, self.a_y, market_price)
            self.a_x, self.a_y, fee_usdc_a = self._execute_swap(
                self.a_x, self.a_y, amt_a, dir_a, float(BASE_FEE_BPS)
            )
            self.a_cum_fees_usdc += fee_usdc_a

            # === MODEL B — Dynamic fee ==============================
            dir_b, amt_b, eth_equiv = self._arb_size(self.b_x, self.b_y, market_price)
            b_fee_bps, b_new_vol = self._calc_dynamic_fee(eth_equiv, self.b_x, ts)
            self.b_x, self.b_y, fee_usdc_b = self._execute_swap(
                self.b_x, self.b_y, amt_b, dir_b, b_fee_bps
            )
            self.b_cum_fees_usdc += fee_usdc_b
            # Persist oracle state after the swap (matches Solidity ordering)
            self.b_vol_tracker = b_new_vol
            self.b_last_ts     = ts

            # === Financial metrics for both models ==================
            hodl_value = X0 * market_price + Y0   # initial tokens at market price

            def _metrics(px, py, cum_fees, fee_used):
                pool_price    = py / px
                # Mark the LP position to the external market price
                pool_value    = px * market_price + py
                # Standard IL formula: P = pool_price / initial_price
                # IL = 2*sqrt(P)/(1+P) - 1   (always <= 0; zero means no price change)
                P             = pool_price / INITIAL_PRICE
                il_pct        = 2.0 * math.sqrt(P) / (1.0 + P) - 1.0
                il_usdc       = il_pct * hodl_value
                # Net LP return = fees earned minus the IL drag (il_usdc is negative)
                net_lp_return = cum_fees + il_usdc
                return {
                    'minute'             : i,
                    'regime'             : row['regime'],
                    'pool_x'             : px,
                    'pool_y'             : py,
                    'pool_price'         : pool_price,
                    'pool_value_usdc'    : pool_value,
                    'hodl_value_usdc'    : hodl_value,
                    'cum_fees_usdc'      : cum_fees,
                    'fee_bps'            : fee_used,
                    'il_pct'             : il_pct,
                    'il_usdc'            : il_usdc,
                    'net_lp_return_usdc' : net_lp_return,
                }

            records_a.append(_metrics(
                self.a_x, self.a_y, self.a_cum_fees_usdc, float(BASE_FEE_BPS)
            ))
            records_b.append(_metrics(
                self.b_x, self.b_y, self.b_cum_fees_usdc, b_fee_bps
            ))

        return pd.DataFrame(records_a), pd.DataFrame(records_b)


# ---------------------------------------------------------------------------
# Terminal summary
# ---------------------------------------------------------------------------

def print_summary(df_a, df_b):
    """Print the protocol alpha-capture summary to stdout."""
    a_fees  = df_a['cum_fees_usdc'].iloc[-1]
    a_il    = df_a['il_usdc'].min()                       # most negative = peak IL
    a_net   = df_a['net_lp_return_usdc'].iloc[-1]
    a_label = 'Capital Preserved' if a_net >= 0 else 'Capital Impaired'

    b_fees  = df_b['cum_fees_usdc'].iloc[-1]
    b_il    = df_b['il_usdc'].min()
    b_net   = df_b['net_lp_return_usdc'].iloc[-1]
    b_label = 'Capital Preserved via Volatility Premium' if b_net >= 0 else 'Capital Impaired'

    alpha   = b_net - a_net
    sign    = '+' if alpha >= 0 else ''

    print('=' * 62)
    print('        BACKTEST SIMULATION COMPLETE')
    print('=' * 62)
    print(f'  Initial Pool Value    : {INITIAL_VALUE:>12,.2f} USDC')
    print()
    print('  [MODEL A — STATIC 0.3% POOL]')
    print(f'  Final Cumulative Fees : +{a_fees:>10,.2f} USDC')
    print(f'  Max IL Suffered       :  {a_il:>10,.2f} USDC')
    print(f'  Net LP Return         :  {a_net:>+10,.2f} USDC  ({a_label})')
    print()
    print('  [MODEL B — DYNAMIC AMM PROTOCOL]')
    print(f'  Final Cumulative Fees : +{b_fees:>10,.2f} USDC')
    print(f'  Max IL Suffered       :  {b_il:>10,.2f} USDC')
    print(f'  Net LP Return         :  {b_net:>+10,.2f} USDC  ({b_label})')
    print()
    print(f'  PROTOCOL ALPHA CAPTURE: {sign}{alpha:>10,.2f} USDC outperformance.')
    print('=' * 62)


# ---------------------------------------------------------------------------
# Chart helpers
# ---------------------------------------------------------------------------

def _shade_regimes(ax):
    """Overlay translucent regime bands on any axes object."""
    ax.axvspan(480,  960,  color='red',   alpha=0.10, zorder=0, label='Crash Regime')
    ax.axvspan(960, 1440,  color='green', alpha=0.06, zorder=0, label='Recovery Regime')


def plot_fee_elasticity(df, df_b, out_dir='plots'):
    """
    Chart 1 — Fee Elasticity vs. Market Volatility (dual-axis).
    Left axis: exogenous market price.  Right axis: dynamic fee in bps.
    """
    sns.set_style('darkgrid')
    fig, ax1 = plt.subplots(figsize=(14, 6))
    _shade_regimes(ax1)

    ax1.plot(df['minute'], df['price'], color=GOLD, lw=1.5, label='ETH Market Price')
    ax1.set_xlabel('Time (minutes)', fontsize=12)
    ax1.set_ylabel('ETH Price (USDC)', color=GOLD, fontsize=12)
    ax1.tick_params(axis='y', labelcolor=GOLD)
    ax1.yaxis.set_major_formatter(mticker.FuncFormatter(lambda v, _: f'${v:,.0f}'))

    ax2 = ax1.twinx()
    ax2.plot(df_b['minute'], df_b['fee_bps'],
             color=EMERALD, lw=1.2, alpha=0.85, label='Dynamic Fee (bps)')
    ax2.axhline(BASE_FEE_BPS, color=EMERALD, lw=0.8, ls='--', alpha=0.6,
                label=f'Floor {BASE_FEE_BPS} bps')
    ax2.axhline(MAX_FEE_BPS, color='salmon', lw=0.8, ls='--', alpha=0.7,
                label=f'Ceiling {MAX_FEE_BPS} bps')
    ax2.set_ylabel('Dynamic Fee (bps)', color=EMERALD, fontsize=12)
    ax2.tick_params(axis='y', labelcolor=EMERALD)
    ax2.set_ylim(0, MAX_FEE_BPS * 1.3)

    lines1, labels1 = ax1.get_legend_handles_labels()
    lines2, labels2 = ax2.get_legend_handles_labels()
    ax1.legend(lines1 + lines2, labels1 + labels2, loc='lower left', fontsize=9)
    plt.title('Fee Elasticity vs. Market Volatility', fontsize=14, fontweight='bold', pad=12)
    plt.tight_layout()

    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, 'chart1_fee_elasticity.png')
    plt.savefig(path, dpi=150, bbox_inches='tight')
    plt.show()
    print(f'  Saved → {path}')


def plot_fee_divergence(df_a, df_b, out_dir='plots'):
    """
    Chart 2 — Cumulative fee revenue divergence.
    Shows Model B pulling ahead of Model A during the crash block.
    """
    sns.set_style('darkgrid')
    fig, ax = plt.subplots(figsize=(14, 6))
    _shade_regimes(ax)

    ax.plot(df_a['minute'], df_a['cum_fees_usdc'],
            color=NAVY,    lw=2.0, label='Model A — Static 0.3%')
    ax.plot(df_b['minute'], df_b['cum_fees_usdc'],
            color=EMERALD, lw=2.0, label='Model B — Dynamic Fee')

    # Annotate the divergence point
    ax.axvline(480, color=GREY, lw=1.0, ls='--', alpha=0.8)
    ax.text(484, df_b['cum_fees_usdc'].iloc[480] * 1.05,
            'Crash begins →', fontsize=8, color=GREY)

    ax.set_xlabel('Time (minutes)', fontsize=12)
    ax.set_ylabel('Cumulative Fees Captured (USDC)', fontsize=12)
    ax.yaxis.set_major_formatter(mticker.FuncFormatter(lambda v, _: f'${v:,.0f}'))
    ax.legend(fontsize=10)
    plt.title('Cumulative Fee Revenue: Static vs. Dynamic Protocol',
              fontsize=14, fontweight='bold', pad=12)
    plt.tight_layout()

    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, 'chart2_fee_divergence.png')
    plt.savefig(path, dpi=150, bbox_inches='tight')
    plt.show()
    print(f'  Saved → {path}')


def plot_lp_equity(df_a, df_b, out_dir='plots'):
    """
    Chart 3 — Net LP equity comparison.
    Three lines: HODL baseline, static-fee LP, dynamic-fee LP.
    Visually proves dynamic fee protects capital during the crash.
    """
    sns.set_style('darkgrid')
    fig, ax = plt.subplots(figsize=(14, 6))
    _shade_regimes(ax)

    ax.plot(df_a['minute'], df_a['hodl_value_usdc'],
            color=GOLD,    lw=1.8, ls='--', label='HODL Baseline (initial tokens at market price)')
    ax.plot(df_a['minute'], df_a['pool_value_usdc'],
            color=NAVY,    lw=2.0,           label='Model A — Static-Fee LP')
    ax.plot(df_b['minute'], df_b['pool_value_usdc'],
            color=EMERALD, lw=2.0,           label='Model B — Dynamic-Fee LP')
    ax.axhline(INITIAL_VALUE, color='white', lw=0.8, ls=':',
               alpha=0.4, label=f'Initial Value ${INITIAL_VALUE:,.0f}')

    ax.set_xlabel('Time (minutes)', fontsize=12)
    ax.set_ylabel('Position Value (USDC)', fontsize=12)
    ax.yaxis.set_major_formatter(mticker.FuncFormatter(lambda v, _: f'${v:,.0f}'))
    ax.legend(fontsize=9)
    plt.title('Net LP Equity: Dynamic Fee Outperforms Under Stress',
              fontsize=14, fontweight='bold', pad=12)
    plt.tight_layout()

    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, 'chart3_lp_equity.png')
    plt.savefig(path, dpi=150, bbox_inches='tight')
    plt.show()
    print(f'  Saved → {path}')
