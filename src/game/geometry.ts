import type { Direction, RelativeAction, Vec } from "./types";

/** Clockwise-on-screen order: north → east → south → west. */
const DIRECTIONS: readonly Direction[] = ["north", "east", "south", "west"];

export const DIRECTION_VECTORS: Record<Direction, Vec> = {
  north: { x: 0, y: -1 },
  east: { x: 1, y: 0 },
  south: { x: 0, y: 1 },
  west: { x: -1, y: 0 },
};

export const directionIndex = (d: Direction): number =>
  DIRECTIONS.indexOf(d);

/** Screen-space left turn = one step counter-clockwise. */
export function turnDirection(dir: Direction, action: RelativeAction): Direction {
  const i = directionIndex(dir);
  const next =
    action === "STRAIGHT" ? i : action === "RIGHT" ? (i + 1) % 4 : (i + 3) % 4;
  return DIRECTIONS[next];
}

export function addVec(a: Vec, b: Vec): Vec {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function targetCell(head: Vec, dir: Direction, action: RelativeAction): Vec {
  return addVec(head, DIRECTION_VECTORS[turnDirection(dir, action)]);
}

export function neighbors(c: Vec): Vec[] {
  return [
    { x: c.x + 1, y: c.y },
    { x: c.x - 1, y: c.y },
    { x: c.x, y: c.y + 1 },
    { x: c.x, y: c.y - 1 },
  ];
}
