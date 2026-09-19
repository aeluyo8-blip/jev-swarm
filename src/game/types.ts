// Core shared types for the multi-agent arena.
// Snake-specific types live here too, but the MultiAgentWorld contract in
// world.ts is deliberately world-agnostic so other worlds can be swapped in.

export type Direction = "north" | "east" | "south" | "west";

/** Relative steering actions available to every agent. */
export type RelativeAction = "LEFT" | "STRAIGHT" | "RIGHT";

export const RELATIVE_ACTIONS: readonly RelativeAction[] = [
  "LEFT",
  "STRAIGHT",
  "RIGHT",
] as const;

export interface Vec {
  x: number;
  y: number;
}

export interface AgentInfo {
  id: string;
  index: number;
  alive: boolean;
  length: number;
  direction: Direction;
  head: Vec;
}

export type DeadEndRisk = "low" | "medium" | "high";

export type DeathCause =
  | "wall"
  | "body"
  | "obstacle"
  | "head_conflict"
  | "head_swap";

/** Deterministic facts computed by code, never by the model. */
export interface ActionFeatures {
  /** Violates an immediate static rule (wall / obstacle / occupied cell). */
  legal: boolean;
  illegalReason?: Exclude<DeathCause, "head_conflict" | "head_swap">;
  /** BFS distance from the post-move head to the nearest food (Manhattan fallback when unreachable). */
  foodDistanceAfterMove: number;
  /** Flood-fill count of free cells reachable from the post-move head. */
  reachableFreeCells: number;
  /** Min Manhattan distance from the post-move head to any other living snake head. */
  nearestOtherHead: number;
  /** Trap heuristic derived from reachable space, body length and exits. */
  deadEndRisk: DeadEndRisk;
  /** Number of other snakes that could move into the target cell next tick. */
  headConflictCandidates: number;
  /** Distance from target cell to the nearest wall. */
  wallDistance: number;
  /** Absolute target cell (internal, stripped before sending to the model). */
  target: Vec;
}

export type ActionFeaturesByAction = Record<RelativeAction, ActionFeatures>;

export interface DeathEvent {
  agentId: string;
  tick: number;
  cause: DeathCause;
  detail?: string;
}

export interface EatEvent {
  agentId: string;
  tick: number;
  cell: Vec;
}

export const cellKey = (c: Vec): string => `${c.x},${c.y}`;

export const manhattan = (a: Vec, b: Vec): number =>
  Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
