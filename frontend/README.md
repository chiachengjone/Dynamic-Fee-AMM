# Dynamic-Fee-AMM · Phase 6 Macro Console

A React + Vite dashboard for the Dynamic-Fee-AMM protocol. It mirrors the pool's
volatility-responsive fee engine and the Phase 5 external chaos multiplier, with
a live swap simulator whose math is bit-for-bit identical to the on-chain
contract (all BigInt, no floating-point drift).

## Stack

- **Vite 5** + **React 18**
- **Tailwind CSS v4** (CSS-first, via `@tailwindcss/vite`)
- **ethers v6** — on-chain reads
- **Recharts** — fee response curve
- **lucide-react** — icons · **clsx** + **tailwind-merge** — class composition

## Run

```bash
cd frontend
npm install
npm run dev
```

Then open the printed localhost URL (default http://localhost:5173).

## Live vs Sandbox mode

The dashboard works with **no chain running**. It picks a mode automatically:

| Mode        | When                                                              | Behaviour                                                                                   |
| ----------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| **Sandbox** | No `.env`, or the RPC is unreachable                             | Fully in-memory pool (100/100). "Simulate Swap" mutates reserves; a slider emulates the relayer. |
| **Live**    | `VITE_RPC_URL` + `VITE_POOL_ADDRESS` set and the node is up      | Polls the contract every `VITE_POLL_INTERVAL_MS`. Reflects Foundry trades and relayer writes. |

To connect to a chain:

```bash
cp .env.example .env
# edit VITE_RPC_URL and VITE_POOL_ADDRESS
```

For a local Foundry node:

```bash
# in the repo root
anvil
# deploy your pool, then set VITE_POOL_ADDRESS to its address
```

## Verification checklist (Phase 6)

1. **State syncing** — In sandbox, click *Simulate Swap*: the reserve, fee, and
   spot-price cards update immediately. Move the multiplier slider: the Chaos
   Multiplier card and the fuchsia curve shift in real time. In live mode, a
   Foundry swap or a `macro_pipeline.py` run appears on the next poll.
2. **Pricing invariant preview** — Type in *You pay*: the estimated output, fee,
   and price impact recompute on every keystroke with no lag and no fractional
   precision errors (BigInt math throughout).
3. **Chart responsiveness** — Scale the browser window: the Recharts panel
   resizes via `ResponsiveContainer` without breaking the grid.
