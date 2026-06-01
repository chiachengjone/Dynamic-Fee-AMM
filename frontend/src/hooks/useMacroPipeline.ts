/**
 * useMacroPipeline — polls the local macro_pipeline.py --serve API.
 *
 * When the Python server is running the hook surfaces its latest score so the
 * dashboard can display real Fear & Greed and volume data and offer a one-click
 * "Apply to sandbox" path.  When the server is not running (the common default)
 * the hook returns `score: null` and `connected: false` — nothing breaks.
 *
 * Default endpoint: http://localhost:8765/score
 * Override with VITE_PIPELINE_URL in your .env file.
 * Override poll interval with VITE_PIPELINE_POLL_MS (default 15 000 ms).
 */

import { useEffect, useState } from "react";

const BASE_URL      = (import.meta.env.VITE_PIPELINE_URL as string | undefined)?.trim() ?? "http://localhost:8765";
const POLL_INTERVAL = Number(import.meta.env.VITE_PIPELINE_POLL_MS) || 15_000;

export interface PipelineScore {
  /** Unix timestamp of the last successful fetch. */
  timestamp:         number;
  fear_greed_index:  number;
  fear_greed_label:  string;
  eth_volume_usd:    number;
  /** Percentage above (positive) or below (negative) the $15B baseline. */
  volume_excess_pct: number;
  sentiment_penalty: number;
  volume_penalty:    number;
  composite_score:   number;
  multiplier:        number;
  /** "ok" when the last fetch succeeded; "stale" if a refresh failed. */
  status:            "ok" | "stale" | "not_ready";
}

export interface UseMacroPipelineResult {
  /** Latest score from the pipeline server, or null if unreachable. */
  score:     PipelineScore | null;
  /** True while the server responds on /score. */
  connected: boolean;
  /** When the last successful poll completed. */
  lastFetch: Date | null;
}

export function useMacroPipeline(): UseMacroPipelineResult {
  const [score,     setScore]     = useState<PipelineScore | null>(null);
  const [connected, setConnected] = useState(false);
  const [lastFetch, setLastFetch] = useState<Date | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const res = await fetch(`${BASE_URL}/score`, {
          signal: AbortSignal.timeout(5_000),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as PipelineScore;
        if (cancelled) return;
        setScore(data);
        setConnected(true);
        setLastFetch(new Date());
      } catch {
        if (cancelled) return;
        // Server not running — silent degradation; UI handles null gracefully.
        setConnected(false);
      }
    }

    poll();
    const timer = setInterval(poll, POLL_INTERVAL);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []); // runs once; the interval handles refreshes

  return { score, connected, lastFetch };
}
