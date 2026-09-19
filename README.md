# Jev Swarm — 10-Snake Arena

**One world. Ten agents. Ten judgments. One Jev call.**

A browser-based multi-agent snake experiment built to test [TypeSafe AI's Jev](https://docs.typesafe.ai) (a "System-One" model) as a **parallel decision engine**: every logic tick sends **one** API request containing a Choice question per snake, receives N full probability distributions over `LEFT / STRAIGHT / RIGHT` in parallel, and a deterministic **Joint Action Resolver** turns them into a collision-free joint action.

> Built from the development plan in `docs/plan.md` (Jev_Swarm_10_Snake_Arena_开发方案).

## Quick start

```bash
npm install
cp .env.example .env        # paste your TYPESAFE_API_KEY from console.typesafe.ai/keys
npm run dev                 # starts proxy (:8799) + web app (:5173)
```

Open **http://localhost:5173**.

- Without an API key the app still runs — Random / Rule modes are fully local, and the Jev mode options stay locked in the UI until a key is configured (paste it in the API Key section, or keep `.env`).
- `npm test` — 32 unit tests (collision, resolver, features, controllers, state schema).
- `npm run build` — type-check + production build.

## Architecture (plan §3)

```
SnakeWorld (deterministic engine, seeded RNG)
   │ snapshot
State Analyzer (code computes FACTS: legality, BFS food distance, flood-fill space, risks)
   │ shared state + N Choice questions
Jev  ────────────── ONE request / tick → N parallel probability distributions
   │ probability matrix
Joint Action Resolver (argmax Σ log P_i(a_i) subject to hard constraints)
   │ joint action
Execute → advance world
```

- **Facts vs judgment**: the model never computes distances, flood fill, collisions or legal moves (plan §4). It only makes contextual judgments over precomputed per-action features. Positions are public physics (schema v2): each snake sees its own head/body plus every other snake's head, direction and length — while intentions stay private.
- **One call per tick**: all snakes' questions ride in a single `POST /v1/systemone` (plan §5). The decision policy travels once in the shared `team_goal`; per-question instructions stay minimal so tokens don't grow linearly with the agent count.
- **Resolver (plan §6)**: enumerates all `3^N` joint actions (N ≤ 12) pruning illegal/conflicting ones, maximising `Σ log P`; beam search (width 256) for N > 12. Snakes with no legal action are excluded from the joint (they keep heading and die) instead of disabling resolution for everyone. It enforces hard constraints only — it never hunts food — so it cannot mask Jev's contribution. Every proposed→executed divergence is recorded with an `override_reason`.
- **Deadline & stale handling (plan §8)**: the tick awaits the model at most `deadlineMs` (default 1500 ms — the measured TypeSafe round trip is ~0.4s p50 / ~1.2s p95 from typical networks; the plan's original 220 ms made every tick fall back). On timeout/error every snake executes the deterministic fallback (prefer STRAIGHT, else max free space). Responses carry a `revision` echoed by the proxy; mismatches are counted as stale and discarded.
- **Benchmark (plan §7)**: scaling (1/2/5/10/20 agents) and mode comparison (Random / Rule / Jev Raw / Jev Joint) runners with per-tick CSV/JSONL export. The **override rate** is displayed front and center — a high rate means the resolver, not Jev, is playing the game (plan §7.2, Go/No-Go §13).

## Controls

| Control | Effect |
|---|---|
| Mode | Random / Rule / **Jev Raw** (top-1, no conflict fixing) / **Jev Joint** (probabilities + resolver) |
| Agents | 1 / 2 / 5 / 10 / 20 |
| Safety | Toggles the Joint Resolver on/off (Jev modes only) |
| Chaos | Relocates all food and drops an obstacle cluster |
| Seed / Tick ms / Deadline ms | Reproducible runs, tick rate, decision deadline |
| Benchmark | Scaling or 4-mode comparison runs, CSV/JSONL export |
| Click a snake | Decision Lens: full probability bars, proposed vs executed, override reason, per-action features |
| 中 / EN | UI language toggle (Chinese by default, persisted in localStorage) |
| API Key | Paste your `TYPESAFE_API_KEY` in the UI — stored in the local proxy's process memory only (never persisted, never returned in full); takes effect on the next tick without a server restart. Alternatively keep `.env` |

## Layout

```
src/game/      deterministic engine: world.ts, collision.ts, features.ts, controllers.ts
src/jev/       state.ts (shared state schema), questions.ts (Choice template), types.ts
src/swarm/     resolver.ts (joint optimizer), fallback.ts
src/sim/       simulation.ts (ArenaSimulation: prepare → decide → applyDecision)
src/benchmark/ metrics.ts (recorder + summary), runner.ts, export.ts
src/ui/        Board, ControlPanel, MetricsPanel, DecisionLens, useArena (tick loop)
server/api.ts  express proxy — hides TYPESAFE_API_KEY, one systemOne call per request
tests/         collision.test.ts, resolver.test.ts, feature.test.ts
```

The `MultiAgentWorld` contract (`src/game/world.ts`) keeps the resolver and model client world-agnostic — snake is only the first world (plan §3.1, §14).

## Configuration

| Env / field | Default | Meaning |
|---|---|---|
| `TYPESAFE_API_KEY` | — | required for Jev modes ([console.typesafe.ai/keys](https://console.typesafe.ai/keys)) |
| `PORT` | `8799` | proxy port (Vite proxies `/api` to it) |
| model | `jev-latest` | TypeSafe System-One model |
