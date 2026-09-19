import type { DeathCause, Direction, RelativeAction, Vec } from "./types";
import { cellKey } from "./types";
import { targetCell, turnDirection } from "./geometry";

export interface Mover {
  id: string;
  head: Vec;
  direction: Direction;
  action: RelativeAction;
  target: Vec;
}

export interface DeathVerdict {
  /** agentId -> death cause, only for snakes that die this tick. */
  deaths: Map<string, { cause: DeathCause; detail?: string }>;
  /** Heads that entered the same free cell together. */
  sharedTargetGroups: Vec[][];
  /** Head-swap pairs (both die). */
  headSwapPairs: Array<[string, string]>;
}

/**
 * Cells blocked for heads entering this tick: every cell of every living
 * snake plus static obstacles. A snake's tail vacates only if that snake
 * actually moves this tick without growing — a snake that dies keeps its
 * whole body on the board (it never got the chance to advance).
 */
export function buildOccupancy(
  snakes: Array<{ cells: Vec[]; grows: boolean; moves: boolean }>,
  obstacles: readonly Vec[],
): Set<string> {
  const occupied = new Set<string>();
  for (const snake of snakes) {
    const last = snake.cells.length - 1;
    snake.cells.forEach((cell, i) => {
      if (i === last && snake.moves && !snake.grows) return; // tail vacates this tick
      occupied.add(cellKey(cell));
    });
  }
  for (const o of obstacles) occupied.add(cellKey(o));
  return occupied;
}

/**
 * Simultaneous-move resolution. All checks use the start-of-tick board; a
 * snake that dies this tick still blocks with its body for this tick.
 */
export function resolveDeaths(
  movers: Mover[],
  width: number,
  height: number,
  occupied: Set<string>,
  obstacles: ReadonlySet<string>,
): DeathVerdict {
  const deaths = new Map<string, { cause: DeathCause; detail?: string }>();
  const sharedTargetGroups: Vec[][] = [];
  const headSwapPairs: Array<[string, string]> = [];
  const priority: Record<DeathCause, number> = {
    wall: 0,
    obstacle: 0,
    body: 1,
    head_conflict: 2,
    head_swap: 3,
  };

  const kill = (id: string, cause: DeathCause, detail?: string) => {
    const existing = deaths.get(id);
    // Keep the most specific cause: explicit conflicts beat generic body hits.
    if (!existing || priority[cause] > priority[existing.cause]) {
      deaths.set(id, { cause, detail });
    }
  };

  for (const m of movers) {
    if (m.target.x < 0 || m.target.y < 0 || m.target.x >= width || m.target.y >= height) {
      kill(m.id, "wall");
      continue;
    }
    if (obstacles.has(cellKey(m.target))) {
      kill(m.id, "obstacle");
      continue;
    }
    if (occupied.has(cellKey(m.target))) {
      kill(m.id, "body");
    }
  }

  const survivors = movers.filter((m) => !deaths.has(m.id));
  const byTarget = new Map<string, Mover[]>();
  for (const m of survivors) {
    const list = byTarget.get(cellKey(m.target)) ?? [];
    list.push(m);
    byTarget.set(cellKey(m.target), list);
  }
  for (const group of byTarget.values()) {
    if (group.length >= 2) {
      sharedTargetGroups.push(group.map((m) => m.target));
      for (const m of group) kill(m.id, "head_conflict");
    }
  }

  // Head-swap runs over ALL movers: both snakes necessarily enter occupied
  // cells (each other's head), so the body check above already killed them —
  // relabel the cause to the more specific head_swap.
  for (let i = 0; i < movers.length; i++) {
    for (let j = i + 1; j < movers.length; j++) {
      const a = movers[i];
      const b = movers[j];
      if (cellKey(a.target) === cellKey(b.head) && cellKey(b.target) === cellKey(a.head)) {
        headSwapPairs.push([a.id, b.id]);
        kill(a.id, "head_swap", b.id);
        kill(b.id, "head_swap", a.id);
      }
    }
  }

  return { deaths, sharedTargetGroups, headSwapPairs };
}

export { targetCell, turnDirection };
