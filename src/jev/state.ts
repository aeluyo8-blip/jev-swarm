import type { ActionFeatures, RelativeAction } from "../game/types";
import { SNAKE_TEAM_GOAL, type SnakeWorld } from "../game/world";

/**
 * Shared policy text travels ONCE inside `team_goal` instead of being
 * repeated in every question's instructions — per-question tokens must not
 * grow linearly with the agent count (plan §4.3), which would confound the
 * parallelism measurement (plan §13).
 */
const TEAM_POLICY =
  "Weigh both goals: a snake that only survives and never eats is a failure. " +
  "Prefer legal actions with a smaller food_distance_after_move when their dead_end_risk is low or medium; " +
  "treat dead_end_risk high and head_conflict_candidates as strong warnings, and only accept them when no safe food-seeking action exists. " +
  "Use only the provided action features.";

/**
 * Shared state sent to Jev (plan §4.2 + schema v2). Positions are public
 * physics — like the shared screen every player sees: each snake knows where
 * it is (head + body) and where every other snake's head is, while
 * intentions remain private. Facts only — no history, no raw grid.
 */
export interface SharedOtherView {
  id: string;
  head: [number, number];
  direction: string;
  length: number;
}

export interface SharedAgentView {
  head: [number, number];
  /** Own cells, head first (capped — the per-action features encode the rest). */
  body: Array<[number, number]>;
  length: number;
  current_direction: string;
  others: SharedOtherView[];
  left: SharedActionView;
  straight: SharedActionView;
  right: SharedActionView;
}

export interface SharedWorldState {
  world: {
    board: { width: number; height: number };
    food: Array<[number, number]>;
    obstacles: Array<[number, number]>;
    team_goal: string;
    tick: number;
  };
  agents: Record<string, SharedAgentView>;
}

export interface SharedActionView {
  legal: boolean;
  food_distance_after_move: number;
  reachable_free_cells: number;
  nearest_other_head: number;
  dead_end_risk: string;
  head_conflict_candidates: number;
  wall_distance: number;
}

function toActionView(f: ActionFeatures): SharedActionView {
  return {
    legal: f.legal,
    food_distance_after_move: f.foodDistanceAfterMove,
    reachable_free_cells: f.reachableFreeCells,
    nearest_other_head: f.nearestOtherHead,
    dead_end_risk: f.deadEndRisk,
    head_conflict_candidates: f.headConflictCandidates,
    wall_distance: f.wallDistance,
  };
}

export function buildSharedState(
  world: SnakeWorld,
  featuresById: Map<string, Record<RelativeAction, ActionFeatures>>,
): SharedWorldState {
  const alive = world.aliveSnakes();
  const agents: Record<string, SharedAgentView> = {};
  for (const snake of alive) {
    const f = featuresById.get(snake.id);
    if (!f) continue;
    agents[snake.id] = {
      head: [snake.cells[0].x, snake.cells[0].y],
      body: snake.cells.slice(0, 8).map((c) => [c.x, c.y] as [number, number]),
      length: snake.cells.length,
      current_direction: snake.direction,
      others: alive
        .filter((o) => o.id !== snake.id)
        .map((o) => ({
          id: o.id,
          head: [o.cells[0].x, o.cells[0].y] as [number, number],
          direction: o.direction,
          length: o.cells.length,
        })),
      left: toActionView(f.LEFT),
      straight: toActionView(f.STRAIGHT),
      right: toActionView(f.RIGHT),
    };
  }
  return {
    world: {
      board: { width: world.config.width, height: world.config.height },
      food: world.food.map((f) => [f.x, f.y] as [number, number]),
      obstacles: world.obstacles.map((o) => [o.x, o.y] as [number, number]),
      team_goal: `${SNAKE_TEAM_GOAL} ${TEAM_POLICY}`,
      tick: world.tick,
    },
    agents,
  };
}
