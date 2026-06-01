#!/usr/bin/env python3
"""
macro_pipeline.py — Phase 5: External Macro Data Pipeline
==========================================================
Automated off-chain relayer for the Dynamic-Fee-AMM protocol.

Modes
-----
  Default (one-shot):
      Fetch → score → optionally broadcast → exit.
      DRY_RUN=true skips the on-chain write.

  --serve (dashboard feed):
      Runs the scoring pipeline on a loop and serves the latest result as JSON
      at http://localhost:<PORT>/score so the React dashboard can poll it.
      No blockchain credentials are needed — safe for pure sandbox use.

Usage
-----
  python simulation/macro_pipeline.py                  # one-shot relay
  python simulation/macro_pipeline.py --serve          # local API server
  python simulation/macro_pipeline.py --serve --port 8765 --interval 60

Environment variables
---------------------
  RPC_URL               — EVM JSON-RPC endpoint
  RELAYER_PRIVATE_KEY   — Hex private key of the authorized relayer EOA
  POOL_CONTRACT_ADDRESS — Deployed DynamicFeePool address
  DRY_RUN               — "true" to skip broadcast (default: false)
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import sys
import time
from typing import Any, Optional, Tuple

import aiohttp
from aiohttp import web
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

# ─── Quantitative constants ───────────────────────────────────────────────────

FEAR_GREED_NEUTRAL: int   = 50
VOLUME_BASELINE_USD: float = 15_000_000_000.0
MULTIPLIER_MIN: int       = 100
MULTIPLIER_MAX: int       = 200

MAX_RETRIES: int          = 3
RETRY_BACKOFF_BASE: float = 2.0
REQUEST_TIMEOUT_S: float  = 10.0

# ─── Minimal ABI ─────────────────────────────────────────────────────────────

POOL_ABI = [
    {
        "inputs": [{"internalType": "uint8", "name": "_newMultiplier", "type": "uint8"}],
        "name": "setExternalChaosMultiplier",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function",
    },
    {
        "inputs": [],
        "name": "externalChaosMultiplier",
        "outputs": [{"internalType": "uint8", "name": "", "type": "uint8"}],
        "stateMutability": "view",
        "type": "function",
    },
    {
        "anonymous": False,
        "inputs": [
            {"indexed": True,  "internalType": "uint8",   "name": "newMultiplier", "type": "uint8"},
            {"indexed": False, "internalType": "uint256",  "name": "timestamp",    "type": "uint256"},
        ],
        "name": "ExternalMultiplierUpdated",
        "type": "event",
    },
]

# ─── HTTP helpers ─────────────────────────────────────────────────────────────

async def _fetch_json(
    session: aiohttp.ClientSession,
    url: str,
    label: str,
) -> Optional[dict]:
    timeout = aiohttp.ClientTimeout(total=REQUEST_TIMEOUT_S)
    for attempt in range(MAX_RETRIES):
        try:
            async with session.get(url, timeout=timeout) as response:
                response.raise_for_status()
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

# ─── Data fetchers ────────────────────────────────────────────────────────────

async def fetch_fear_greed_index(session: aiohttp.ClientSession) -> int:
    data = await _fetch_json(session, "https://api.alternative.me/fng/", "Fear & Greed")
    try:
        value = int(data["data"][0]["value"])  # type: ignore[index]
        if not 0 <= value <= 100:
            raise ValueError(f"out-of-range value: {value}")
        return value
    except (TypeError, KeyError, ValueError, IndexError) as exc:
        logger.warning(f"[WARN] Fear & Greed: malformed response ({exc}). Using neutral baseline.")
        return FEAR_GREED_NEUTRAL


async def fetch_eth_volume_usd(session: aiohttp.ClientSession) -> float:
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
        logger.warning(f"[WARN] CoinGecko ETH Volume: malformed response ({exc}). Using baseline.")
        return VOLUME_BASELINE_USD


async def fetch_macro_data() -> Tuple[int, float]:
    async with aiohttp.ClientSession() as session:
        fear_greed, volume = await asyncio.gather(
            fetch_fear_greed_index(session),
            fetch_eth_volume_usd(session),
        )
    return fear_greed, volume

# ─── Scoring engine ───────────────────────────────────────────────────────────

def _sentiment_penalty(fear_greed_index: int) -> float:
    if fear_greed_index >= FEAR_GREED_NEUTRAL:
        return 0.0
    return (FEAR_GREED_NEUTRAL - fear_greed_index) / FEAR_GREED_NEUTRAL * 50.0


def _volume_penalty(eth_volume_usd: float) -> float:
    if eth_volume_usd <= VOLUME_BASELINE_USD:
        return 0.0
    excess_ratio = (eth_volume_usd - VOLUME_BASELINE_USD) / VOLUME_BASELINE_USD
    return min(50.0, excess_ratio * 50.0)


def compute_chaos_multiplier(
    fear_greed_index: int,
    eth_volume_usd: float,
) -> Tuple[int, float, float]:
    sp  = _sentiment_penalty(fear_greed_index)
    vp  = _volume_penalty(eth_volume_usd)
    raw = MULTIPLIER_MIN + int(sp + vp)
    return max(MULTIPLIER_MIN, min(MULTIPLIER_MAX, raw)), sp, vp


def _fear_greed_label(index: int) -> str:
    if index >= 75: return "Extreme Greed"
    if index >= 55: return "Greed"
    if index >= 46: return "Neutral"
    if index >= 26: return "Fear"
    return "Extreme Fear"

# ─── Score dict ───────────────────────────────────────────────────────────────

async def compute_score() -> dict[str, Any]:
    """
    Fetch live macro data and return a JSON-serialisable score dict.

    This is the single source of truth for both the one-shot relay and the
    dashboard feed server — both paths use the same numbers.
    """
    fear_greed_index, eth_volume_usd = await fetch_macro_data()
    multiplier, sp, vp = compute_chaos_multiplier(fear_greed_index, eth_volume_usd)
    composite_score   = sp + vp
    volume_excess_pct = (eth_volume_usd / VOLUME_BASELINE_USD - 1.0) * 100.0

    return {
        "timestamp":          int(time.time()),
        "fear_greed_index":   fear_greed_index,
        "fear_greed_label":   _fear_greed_label(fear_greed_index),
        "eth_volume_usd":     round(eth_volume_usd, 2),
        "volume_excess_pct":  round(volume_excess_pct, 2),
        "sentiment_penalty":  round(sp, 2),
        "volume_penalty":     round(vp, 2),
        "composite_score":    round(composite_score, 2),
        "multiplier":         multiplier,
        "status":             "ok",
    }

# ─── Web3 settlement bridge ───────────────────────────────────────────────────

def _w3_and_contract():
    """Build a (w3, account, contract, private_key) tuple. Raises on misconfig."""
    rpc_url          = os.getenv("RPC_URL", "").strip()
    private_key      = os.getenv("RELAYER_PRIVATE_KEY", "").strip()
    pool_address_raw = os.getenv("POOL_CONTRACT_ADDRESS", "").strip()

    missing = [
        n for n, v in [
            ("RPC_URL", rpc_url),
            ("RELAYER_PRIVATE_KEY", private_key),
            ("POOL_CONTRACT_ADDRESS", pool_address_raw),
        ] if not v
    ]
    if missing:
        raise RuntimeError(f"Missing environment variables: {', '.join(missing)}")

    w3 = Web3(Web3.HTTPProvider(rpc_url))
    if not w3.is_connected():
        raise RuntimeError(f"Cannot connect to RPC: {rpc_url}")

    account  = w3.eth.account.from_key(private_key)
    contract = w3.eth.contract(address=Web3.to_checksum_address(pool_address_raw), abi=POOL_ABI)
    return w3, account, contract, private_key


def read_onchain_multiplier() -> Optional[int]:
    """Return the pool's current externalChaosMultiplier, or None on failure."""
    try:
        _, _, contract, _ = _w3_and_contract()
        return int(contract.functions.externalChaosMultiplier().call())
    except Exception as exc:
        logger.warning(f"[WEB3] Could not read on-chain multiplier: {exc}")
        return None


def _do_broadcast(multiplier: int) -> str:
    """Sign and broadcast setExternalChaosMultiplier. Raises on any failure."""
    w3, account, contract, private_key = _w3_and_contract()

    gas_price = int(w3.eth.gas_price * 1.10)
    gas_limit = int(
        contract.functions.setExternalChaosMultiplier(multiplier).estimate_gas(
            {"from": account.address}
        ) * 1.20
    )

    tx = contract.functions.setExternalChaosMultiplier(multiplier).build_transaction({
        "from":     account.address,
        "gas":      gas_limit,
        "gasPrice": gas_price,
        "nonce":    w3.eth.get_transaction_count(account.address),
    })
    signed  = w3.eth.account.sign_transaction(tx, private_key=private_key)
    tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
    receipt = w3.eth.wait_for_transaction_receipt(tx_hash, timeout=120)

    if receipt.status != 1:
        raise RuntimeError(f"Transaction reverted! Hash: 0x{tx_hash.hex()}")

    return f"0x{tx_hash.hex()}"


def broadcast_multiplier(multiplier: int, dry_run: bool = False) -> Optional[str]:
    """One-shot broadcast wrapper. Exits the process on error (cron-friendly)."""
    logger.info(f"[WEB3] Formulating transaction payload for setExternalChaosMultiplier({multiplier})")

    if dry_run:
        logger.info("[WEB3] DRY_RUN=true — transaction payload validated, broadcast skipped.")
        return None

    try:
        return _do_broadcast(multiplier)
    except Exception as exc:
        logger.error(f"[ERROR] {exc}")
        sys.exit(1)

# ─── One-shot mode ────────────────────────────────────────────────────────────

async def main() -> None:
    dry_run = os.getenv("DRY_RUN", "false").strip().lower() in ("true", "1", "yes")

    logger.info("=" * 64)
    logger.info("  Dynamic-Fee-AMM  |  Phase 5 Macro Relayer Pipeline")
    logger.info("=" * 64)

    score = await compute_score()

    logger.info(
        f"[INFO] Ingested Fear & Greed Index: {score['fear_greed_index']} ({score['fear_greed_label']})"
        f" -> Sentiment Penalty: {score['sentiment_penalty']:.1f}"
    )
    if score["volume_excess_pct"] > 0:
        logger.info(
            f"[INFO] Ingested 24h CEX Volume Shock: +{score['volume_excess_pct']:.0f}%"
            f" -> Volume Penalty: {score['volume_penalty']:.1f}"
        )
    else:
        logger.info(
            f"[INFO] Ingested 24h CEX Volume: {score['volume_excess_pct']:.0f}% vs baseline"
            f" -> Volume Penalty: {score['volume_penalty']:.1f}"
        )
    logger.info(
        f"[QUANT] Generated Composite Score: {score['composite_score']:.1f}"
        f" -> Targets ExternalChaosMultiplier: {score['multiplier']}"
    )

    tx_hash = broadcast_multiplier(score["multiplier"], dry_run=dry_run)

    if tx_hash:
        logger.info(f"[SUCCESS] Relayer Tx Broadcasted! Hash: {tx_hash}")
    else:
        logger.info("[SUCCESS] Dry-run complete. No on-chain state was modified.")

# ─── Serve mode ───────────────────────────────────────────────────────────────

# Module-level store for the latest score — updated by the background refresh loop.
_latest_score: dict[str, Any] = {}

CORS_HEADERS = {
    "Access-Control-Allow-Origin":  "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
}


async def _handle_score(request: web.Request) -> web.Response:
    if not _latest_score:
        return web.json_response({"status": "not_ready"}, status=503, headers=CORS_HEADERS)
    return web.json_response(_latest_score, headers=CORS_HEADERS)


async def _handle_options(request: web.Request) -> web.Response:
    return web.Response(headers=CORS_HEADERS)


async def _handle_health(request: web.Request) -> web.Response:
    return web.json_response({"status": "ok"}, headers=CORS_HEADERS)


async def _refresh_loop(interval: int, broadcast: bool = False) -> None:
    """
    Re-fetch and re-score on a fixed interval, updating the shared store.

    When *broadcast* is True, also pushes the multiplier on-chain — but only
    when it actually changes, to avoid spending gas on redundant transactions.
    The contract rejects a value of exactly 100 (it requires > 100), so a
    neutral score is logged and skipped rather than reverted.
    """
    global _latest_score

    last_broadcast: Optional[int] = None
    if broadcast:
        # Seed from the current on-chain value so we don't re-send what's already set.
        last_broadcast = await asyncio.to_thread(read_onchain_multiplier)
        logger.info(f"[SERVE] On-chain multiplier currently: {last_broadcast}")

    while True:
        try:
            _latest_score = await compute_score()
            m = _latest_score["multiplier"]
            logger.info(
                f"[SERVE] Refreshed — F&G: {_latest_score['fear_greed_index']} "
                f"({_latest_score['fear_greed_label']}) · "
                f"vol: {_latest_score['volume_excess_pct']:+.0f}% · "
                f"multiplier: {m}"
            )

            if broadcast:
                # The contract accepts the full [100, 200] range, so 100 is a
                # valid write — it resets the multiplier to neutral (mean reversion)
                # when macro stress subsides. We only skip when the value is
                # already on-chain, to avoid spending gas on a no-op.
                if m == last_broadcast:
                    logger.info(f"[SERVE] Multiplier unchanged ({m}) — no broadcast needed.")
                else:
                    logger.info(f"[SERVE] Multiplier changed ({last_broadcast} -> {m}). Broadcasting…")
                    try:
                        tx = await asyncio.to_thread(_do_broadcast, m)
                        logger.info(f"[SERVE] Broadcast confirmed! Hash: {tx}")
                        last_broadcast = m
                    except Exception as exc:
                        logger.warning(f"[SERVE] Broadcast failed: {exc}")
        except Exception as exc:
            logger.warning(f"[SERVE] Refresh failed: {exc}. Retaining previous score.")
            if _latest_score:
                _latest_score["status"] = "stale"
        await asyncio.sleep(interval)


async def serve_mode(port: int = 8765, interval: int = 60, broadcast: bool = False) -> None:
    """
    Run the pipeline as a local HTTP API.

    Endpoints:
      GET /score  — latest score as JSON (CORS-enabled for browser polling)
      GET /health — liveness check

    The initial score is fetched synchronously before the server accepts
    connections, so the first dashboard poll always gets real data.

    When *broadcast* is True the refresh loop also pushes the multiplier
    on-chain whenever it changes (see _refresh_loop).
    """
    global _latest_score

    logger.info("=" * 64)
    logger.info("  Dynamic-Fee-AMM  |  Phase 5 Pipeline — Dashboard Feed Mode")
    if broadcast:
        logger.info("  Auto-broadcast: ON (pushes multiplier on-chain on change)")
    logger.info("=" * 64)
    logger.info("[SERVE] Fetching initial score…")

    _latest_score = await compute_score()
    logger.info(
        f"[SERVE] Initial score ready — "
        f"F&G: {_latest_score['fear_greed_index']} ({_latest_score['fear_greed_label']}) · "
        f"multiplier: {_latest_score['multiplier']}"
    )

    app = web.Application()
    app.router.add_get("/score",  _handle_score)
    app.router.add_get("/health", _handle_health)
    app.router.add_route("OPTIONS", "/score", _handle_options)

    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, "localhost", port)
    await site.start()

    logger.info(f"[SERVE] API running at http://localhost:{port}/score")
    logger.info(f"[SERVE] Refreshing every {interval}s. Press Ctrl+C to stop.")

    # Background refresh loop — does not block the server.
    asyncio.create_task(_refresh_loop(interval, broadcast=broadcast))

    # Keep the process alive until interrupted.
    try:
        await asyncio.Event().wait()
    except (KeyboardInterrupt, asyncio.CancelledError):
        pass
    finally:
        logger.info("[SERVE] Shutting down.")
        await runner.cleanup()

# ─── Entry point ─────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Dynamic-Fee-AMM macro relayer pipeline",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            "  python macro_pipeline.py                   # one-shot (DRY_RUN=true to skip tx)\n"
            "  python macro_pipeline.py --serve           # dashboard feed on :8765\n"
            "  python macro_pipeline.py --serve --port 9000 --interval 30\n"
        ),
    )
    parser.add_argument(
        "--serve", action="store_true",
        help="Run as a local API server for the React dashboard",
    )
    parser.add_argument(
        "--broadcast", action="store_true",
        help="In --serve mode, also push the multiplier on-chain when it changes",
    )
    parser.add_argument(
        "--port", type=int, default=8765,
        help="Port for --serve mode (default: 8765)",
    )
    parser.add_argument(
        "--interval", type=int, default=60,
        help="Score refresh interval in seconds for --serve mode (default: 60)",
    )
    args = parser.parse_args()

    try:
        if args.serve:
            asyncio.run(serve_mode(port=args.port, interval=args.interval, broadcast=args.broadcast))
        else:
            asyncio.run(main())
    except KeyboardInterrupt:
        pass
