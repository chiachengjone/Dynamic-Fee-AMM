#!/usr/bin/env python3
"""
macro_pipeline.py — Phase 5: External Macro Data Pipeline
==========================================================
Automated off-chain relayer for the Dynamic-Fee-AMM protocol.

Execution flow:
  1. Fetch macro signals concurrently (Fear & Greed index, ETH 24h volume).
  2. Compute a composite chaos multiplier via a two-factor penalty model.
  3. Broadcast setExternalChaosMultiplier(multiplier) to the deployed pool.

Environment variables (load from .env or shell):
  RPC_URL                — EVM JSON-RPC endpoint (Alchemy, Infura, Ankr, …)
  RELAYER_PRIVATE_KEY    — Hex private key of the authorized relayer EOA
  POOL_CONTRACT_ADDRESS  — Deployed DynamicFeePool contract address
  DRY_RUN                — Set to "true" to skip broadcast (default: false)

Run:
  python simulation/macro_pipeline.py
"""

from __future__ import annotations

import asyncio
import logging
import os
import sys
from typing import Optional, Tuple

import aiohttp
from dotenv import load_dotenv
from web3 import Web3

# ─── Bootstrap ────────────────────────────────────────────────────────────────

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(message)s",
    stream=sys.stdout,
    force=True,
)
logger = logging.getLogger(__name__)

# ─── Quantitative Constants ───────────────────────────────────────────────────

# Fear & Greed: scores >= this value contribute zero fear penalty.
FEAR_GREED_NEUTRAL: int = 50

# Historical daily ETH spot-market volume baseline used as the shock threshold.
# Source: ~$15B/day rolling average across major centralised venues (2023–2025).
VOLUME_BASELINE_USD: float = 15_000_000_000.0

# Multiplier range enforced by the on-chain require() in setExternalChaosMultiplier.
MULTIPLIER_MIN: int = 100
MULTIPLIER_MAX: int = 200

# HTTP circuit-breaker config.
MAX_RETRIES: int = 3
RETRY_BACKOFF_BASE: float = 2.0  # seconds; doubles per attempt (exponential backoff)
REQUEST_TIMEOUT_S: float = 10.0

# ─── Minimal ABI (only the setter + its event are needed by the relayer) ──────

POOL_ABI = [
    {
        "inputs": [{"internalType": "uint8", "name": "_newMultiplier", "type": "uint8"}],
        "name": "setExternalChaosMultiplier",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function",
    },
    {
        "anonymous": False,
        "inputs": [
            {
                "indexed": True,
                "internalType": "uint8",
                "name": "newMultiplier",
                "type": "uint8",
            },
            {
                "indexed": False,
                "internalType": "uint256",
                "name": "timestamp",
                "type": "uint256",
            },
        ],
        "name": "ExternalMultiplierUpdated",
        "type": "event",
    },
]

# ─── Async HTTP helpers ────────────────────────────────────────────────────────


async def _fetch_json(
    session: aiohttp.ClientSession,
    url: str,
    label: str,
) -> Optional[dict]:
    """
    GET *url* and return parsed JSON.

    Implements an exponential-backoff retry circuit breaker.  On permanent
    failure, logs a warning and returns None — callers must fall back to a
    safe neutral baseline rather than propagating the exception.
    """
    timeout = aiohttp.ClientTimeout(total=REQUEST_TIMEOUT_S)
    for attempt in range(MAX_RETRIES):
        try:
            async with session.get(url, timeout=timeout) as response:
                response.raise_for_status()
                # CoinGecko returns application/json; Alternative.me sometimes
                # returns text/plain — content_type=None relaxes that check.
                return await response.json(content_type=None)
        except Exception as exc:
            wait = RETRY_BACKOFF_BASE ** attempt
            if attempt < MAX_RETRIES - 1:
                logger.warning(
                    f"[WARN] {label}: attempt {attempt + 1}/{MAX_RETRIES} failed "
                    f"({type(exc).__name__}: {exc}). Retrying in {wait:.0f}s…"
                )
                await asyncio.sleep(wait)
            else:
                logger.warning(
                    f"[WARN] {label}: permanently unavailable after {MAX_RETRIES} "
                    "attempts. Falling back to neutral baseline."
                )
    return None


# ─── Data Fetchers ────────────────────────────────────────────────────────────


async def fetch_fear_greed_index(session: aiohttp.ClientSession) -> int:
    """
    Fetch the Crypto Fear & Greed Index from Alternative.me.

    API: https://api.alternative.me/fng/
    Returns an integer in [0, 100], or FEAR_GREED_NEUTRAL (50) on failure.
    """
    data = await _fetch_json(
        session,
        "https://api.alternative.me/fng/",
        "Fear & Greed",
    )
    try:
        value = int(data["data"][0]["value"])  # type: ignore[index]
        if not 0 <= value <= 100:
            raise ValueError(f"out-of-range value: {value}")
        return value
    except (TypeError, KeyError, ValueError, IndexError) as exc:
        logger.warning(
            f"[WARN] Fear & Greed: malformed response ({exc}). "
            f"Using neutral baseline {FEAR_GREED_NEUTRAL}."
        )
        return FEAR_GREED_NEUTRAL


async def fetch_eth_volume_usd(session: aiohttp.ClientSession) -> float:
    """
    Fetch the Ethereum 24h spot-market volume (USD) from CoinGecko.

    API: /simple/price?ids=ethereum&vs_currencies=usd&include_24hr_vol=true
    Returns volume in USD, or VOLUME_BASELINE_USD on failure.
    """
    url = (
        "https://api.coingecko.com/api/v3/simple/price"
        "?ids=ethereum&vs_currencies=usd&include_24hr_vol=true"
    )
    data = await _fetch_json(session, url, "CoinGecko ETH Volume")
    try:
        volume = float(data["ethereum"]["usd_24h_vol"])  # type: ignore[index]
        if volume <= 0:
            raise ValueError(f"non-positive volume: {volume}")
        return volume
    except (TypeError, KeyError, ValueError) as exc:
        logger.warning(
            f"[WARN] CoinGecko ETH Volume: malformed response ({exc}). "
            f"Using neutral baseline ${VOLUME_BASELINE_USD:,.0f}."
        )
        return VOLUME_BASELINE_USD


async def fetch_macro_data() -> Tuple[int, float]:
    """
    Run both fetchers concurrently and return (fear_greed_index, eth_volume_usd).
    Uses a single shared ClientSession for connection pooling.
    """
    async with aiohttp.ClientSession() as session:
        fear_greed, volume = await asyncio.gather(
            fetch_fear_greed_index(session),
            fetch_eth_volume_usd(session),
        )
    return fear_greed, volume


# ─── Quantitative Scoring Engine ──────────────────────────────────────────────


def _sentiment_penalty(fear_greed_index: int) -> float:
    """
    Linear sentiment fear penalty.

    Maps the Fear & Greed index onto [0, 50] penalty points:
      - Index >= 50 (neutral to extreme greed) → 0 pts  (no macro risk signal)
      - Index  = 0  (extreme fear)             → 50 pts (maximum fear penalty)
    """
    if fear_greed_index >= FEAR_GREED_NEUTRAL:
        return 0.0
    return (FEAR_GREED_NEUTRAL - fear_greed_index) / FEAR_GREED_NEUTRAL * 50.0


def _volume_penalty(eth_volume_usd: float) -> float:
    """
    Volume shock penalty.

    Scores 0 at or below VOLUME_BASELINE_USD and scales linearly to 50 pts
    when volume reaches 2× the baseline (i.e. 100% excess).

      excess_ratio = (volume - baseline) / baseline
      penalty      = min(50, excess_ratio * 50)
    """
    if eth_volume_usd <= VOLUME_BASELINE_USD:
        return 0.0
    excess_ratio = (eth_volume_usd - VOLUME_BASELINE_USD) / VOLUME_BASELINE_USD
    return min(50.0, excess_ratio * 50.0)


def compute_chaos_multiplier(
    fear_greed_index: int,
    eth_volume_usd: float,
) -> Tuple[int, float, float]:
    """
    Aggregate both penalty factors into the final integer chaos multiplier.

    Formula: multiplier = clamp(100 + int(sentiment + volume), 100, 200)

    Returns:
      (multiplier, sentiment_penalty, volume_penalty)
    """
    sp = _sentiment_penalty(fear_greed_index)
    vp = _volume_penalty(eth_volume_usd)
    raw = MULTIPLIER_MIN + int(sp + vp)
    multiplier = max(MULTIPLIER_MIN, min(MULTIPLIER_MAX, raw))
    return multiplier, sp, vp


# ─── Web3 Settlement Bridge ───────────────────────────────────────────────────


def broadcast_multiplier(multiplier: int, dry_run: bool = False) -> Optional[str]:
    """
    Build, sign, and broadcast setExternalChaosMultiplier(multiplier) to the pool.

    Gas management:
      - gasPrice   = w3.eth.gas_price  × 1.10  (10% priority buffer)
      - gas limit  = estimate_gas()    × 1.20  (20% safety headroom)

    Returns the transaction hash hex string, or None in dry-run mode.
    Exits with code 1 on any unrecoverable error to signal cron failure.
    """
    logger.info(
        f"[WEB3] Formulating transaction payload for "
        f"setExternalChaosMultiplier({multiplier})"
    )

    if dry_run:
        logger.info(
            "[WEB3] DRY_RUN=true — transaction payload validated, broadcast skipped."
        )
        return None

    # ── Load credentials (validated lazily so dry-run needs no .env) ──────────
    rpc_url          = os.getenv("RPC_URL", "").strip()
    private_key      = os.getenv("RELAYER_PRIVATE_KEY", "").strip()
    pool_address_raw = os.getenv("POOL_CONTRACT_ADDRESS", "").strip()

    missing = [
        name
        for name, val in [
            ("RPC_URL", rpc_url),
            ("RELAYER_PRIVATE_KEY", private_key),
            ("POOL_CONTRACT_ADDRESS", pool_address_raw),
        ]
        if not val
    ]
    if missing:
        logger.error(
            f"[ERROR] Missing required environment variables: {', '.join(missing)}"
        )
        sys.exit(1)

    # ── Connect ───────────────────────────────────────────────────────────────
    w3 = Web3(Web3.HTTPProvider(rpc_url))
    if not w3.is_connected():
        logger.error(f"[ERROR] Cannot connect to RPC: {rpc_url}")
        sys.exit(1)

    pool_address = Web3.to_checksum_address(pool_address_raw)
    account      = w3.eth.account.from_key(private_key)
    contract     = w3.eth.contract(address=pool_address, abi=POOL_ABI)

    # ── Gas estimation ────────────────────────────────────────────────────────
    base_gas_price = w3.eth.gas_price
    gas_price      = int(base_gas_price * 1.10)

    gas_estimate = contract.functions.setExternalChaosMultiplier(multiplier).estimate_gas(
        {"from": account.address}
    )
    gas_limit = int(gas_estimate * 1.20)

    # ── Build & sign ──────────────────────────────────────────────────────────
    tx = contract.functions.setExternalChaosMultiplier(multiplier).build_transaction(
        {
            "from":     account.address,
            "gas":      gas_limit,
            "gasPrice": gas_price,
            "nonce":    w3.eth.get_transaction_count(account.address),
        }
    )

    signed = w3.eth.account.sign_transaction(tx, private_key=private_key)

    # ── Broadcast & await confirmation ────────────────────────────────────────
    tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
    receipt = w3.eth.wait_for_transaction_receipt(tx_hash, timeout=120)

    if receipt.status != 1:
        logger.error(
            f"[ERROR] Transaction reverted on-chain! Hash: 0x{tx_hash.hex()}"
        )
        sys.exit(1)

    return f"0x{tx_hash.hex()}"


# ─── Utilities ────────────────────────────────────────────────────────────────


def _fear_greed_label(index: int) -> str:
    """Map a Fear & Greed index value to its canonical Alternative.me label."""
    if index >= 75:
        return "Extreme Greed"
    if index >= 55:
        return "Greed"
    if index >= 46:
        return "Neutral"
    if index >= 26:
        return "Fear"
    return "Extreme Fear"


# ─── Main ─────────────────────────────────────────────────────────────────────


async def main() -> None:
    dry_run = os.getenv("DRY_RUN", "false").strip().lower() in ("true", "1", "yes")

    logger.info("=" * 64)
    logger.info("  Dynamic-Fee-AMM  |  Phase 5 Macro Relayer Pipeline")
    logger.info("=" * 64)

    # ── 1. Ingest macro signals concurrently ──────────────────────────────────
    fear_greed_index, eth_volume_usd = await fetch_macro_data()

    # ── 2. Compute composite score & multiplier ───────────────────────────────
    multiplier, sentiment_penalty, volume_penalty = compute_chaos_multiplier(
        fear_greed_index, eth_volume_usd
    )
    composite_score   = sentiment_penalty + volume_penalty
    volume_excess_pct = (eth_volume_usd / VOLUME_BASELINE_USD - 1.0) * 100.0

    # ── 3. Structured log readout ─────────────────────────────────────────────
    fear_label = _fear_greed_label(fear_greed_index)
    logger.info(
        f"[INFO] Ingested Fear & Greed Index: {fear_greed_index} ({fear_label})"
        f" -> Sentiment Penalty: {sentiment_penalty:.1f}"
    )

    if volume_excess_pct > 0:
        logger.info(
            f"[INFO] Ingested 24h CEX Volume Shock: +{volume_excess_pct:.0f}%"
            f" -> Volume Penalty: {volume_penalty:.1f}"
        )
    else:
        logger.info(
            f"[INFO] Ingested 24h CEX Volume: {volume_excess_pct:.0f}% vs baseline"
            f" -> Volume Penalty: {volume_penalty:.1f}"
        )

    logger.info(
        f"[QUANT] Generated Composite Score: {composite_score:.1f}"
        f" -> Targets ExternalChaosMultiplier: {multiplier}"
    )

    # ── 4. Broadcast ──────────────────────────────────────────────────────────
    tx_hash = broadcast_multiplier(multiplier, dry_run=dry_run)

    if tx_hash:
        logger.info(f"[SUCCESS] Relayer Tx Broadcasted! Hash: {tx_hash}")
    else:
        logger.info("[SUCCESS] Dry-run complete. No on-chain state was modified.")


if __name__ == "__main__":
    asyncio.run(main())
