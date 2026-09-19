import type { ActionFeatures, ActionFeaturesByAction, RelativeAction, Vec } from "./types";
import { cellKey, manhattan } from "./types";
import { neighbors, targetCell } from "./geometry";
import type { SnakeWorld, SnakeState } from "./world";
import { RELATIVE_ACTIONS } from "./types";

/**
 * Code computes deterministic facts; Jev only makes the contextual judgment.
 * Occupancy here is strictly static (current cells, tails included) — a
 * conservative legality model, so "legal" never underestimates danger.
 */
export function computeActionFeatures(
  world: SnakeWorld,
  snake: SnakeState,
): ActionFeaturesByAction {
  const blocked = new Set<string>();
  for (const other of world.snakes) {
    if (!other.alive) continue;
    for (const c of other.cells) blocked.add(cellKey(c));
  }
  for (const o of world.obstacles) blocked.add(cellKey(o));
  const obstacles = world.obstacleSet();
  const foodKeys = new Set(world.food.map(cellKey));
  const headInfos = world
    .aliveSnakes()
    .filter((s) => s.id !== snake.id)
    .map((s) => ({ head: s.cells[0], id: s.id, neck: s.cells.length > 1 ? cellKey(s.cells[1]) : null }));

  const result = {} as ActionFeaturesByAction;
  for (const action of RELATIVE_ACTIONS) {
    result[action] = computeOne(world, snake, action, blocked, obstacles, foodKeys, headInfos);
  }
  return result;
}

function computeOne(
  world: SnakeWorld,
  snake: SnakeState,
  action: RelativeAction,
  blocked: Set<string>,
  obstacles: ReadonlySet<string>,
  foodKeys: Set<string>,
  headInfos: Array<{ head: Vec; id: string; neck: string | null }>,
): ActionFeatures {
  const { width, height } = world.config;
  const target = targetCell(snake.cells[0], snake.direction, action);
  const inBounds = target.x >= 0 && target.y >= 0 && target.x < width && target.y < height;
  const key = cellKey(target);

  let illegalReason: ActionFeatures["illegalReason"];
  if (!inBounds) illegalReason = "wall";
  else if (obstacles.has(key)) illegalReason = "obstacle";
  else if (blocked.has(key)) illegalReason = "body";
  const legal = illegalReason === undefined;

  const wallDistance = inBounds
    ? Math.min(target.x, target.y, width - 1 - target.x, height - 1 - target.y)
    : 0;

  // BFS through free space for the nearest food. Unreachable food is marked
  // with a large sentinel (never a straight-line distance through walls) so
  // the values stay comparable across actions.
  const bfs = breadthFirstDistances(world, target, blocked, foodKeys);
  const foodDistanceAfterMove = bfs.foodDistance ?? Math.max(width, height) * 2;

  const reachableFreeCells = legal ? bfs.reachableFree : 0;
  const nearestOtherHead = headInfos.length
    ? Math.min(...headInfos.map((info) => manhattan(info.head, target)))
    : 999;

  const headConflictCandidates = inBounds
    ? headInfos.filter((info) => {
        // That snake cannot reverse into its own neck cell; everyone else can.
        if (info.neck !== null && info.neck === cellKey(target)) return false;
        return manhattan(info.head, target) === 1;
      }).length
    : 0;

  const exits = inBounds
    ? neighbors(target).filter((c) => {
        const k = cellKey(c);
        return (
          c.x >= 0 && c.y >= 0 && c.x < width && c.y < height &&
          !blocked.has(k)
        );
      }).length
    : 0;

  const deadEndRisk = riskFor(reachableFreeCells, exits, snake.cells.length, legal);

  return {
    legal,
    illegalReason,
    foodDistanceAfterMove,
    reachableFreeCells,
    nearestOtherHead,
    deadEndRisk,
    headConflictCandidates,
    wallDistance,
    target,
  };
}

function riskFor(
  free: number,
  exits: number,
  length: number,
  legal: boolean,
): ActionFeatures["deadEndRisk"] {
  if (!legal) return "high";
  if (free < length || exits === 0) return "high";
  if (free < 3 * length || exits === 1) return "medium";
  return "low";
}

/**
 * Flood fill + nearest-food BFS in one pass over free cells.
 * Food only ever sits on free cells (spawns are occupancy-checked and a
 * head entering food eats it), so food cells need no traversal override.
 */
function breadthFirstDistances(
  world: SnakeWorld,
  start: Vec,
  blocked: Set<string>,
  foodKeys: Set<string>,
): { reachableFree: number; foodDistance: number | null } {
  const { width, height } = world.config;
  if (start.x < 0 || start.y < 0 || start.x >= width || start.y >= height) {
    return { reachableFree: 0, foodDistance: null };
  }
  const startKey = cellKey(start);
  const isFood = foodKeys.has(startKey);
  if (blocked.has(startKey) && !isFood) return { reachableFree: 0, foodDistance: null };

  const dist = new Map<string, number>([[startKey, 0]]);
  const queue: Vec[] = [start];
  let reachableFree = isFood ? 0 : 1;
  let foodDistance: number | null = isFood ? 0 : null;

  for (let qi = 0; qi < queue.length; qi++) {
    const cur = queue[qi];
    const d = dist.get(cellKey(cur)) ?? 0;
    for (const nb of neighbors(cur)) {
      const k = cellKey(nb);
      if (nb.x < 0 || nb.y < 0 || nb.x >= width || nb.y >= height) continue;
      if (dist.has(k)) continue;
      if (blocked.has(k)) continue;
      dist.set(k, d + 1);
      queue.push(nb);
      if (foodKeys.has(k)) {
        if (foodDistance === null) foodDistance = d + 1;
      } else {
        reachableFree += 1;
      }
    }
  }
  return { reachableFree, foodDistance };
}
