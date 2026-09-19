import { describe, expect, it } from "vitest";
import { SnakeWorld } from "../src/game/world";
import { computeActionFeatures } from "../src/game/features";

function makeWorld(): SnakeWorld {
  return new SnakeWorld({
    width: 12,
    height: 12,
    snakeCount: 2,
    initialLength: 3,
    foodTarget: 3,
    seed: 11,
  });
}

describe("action features", () => {
  it("marks wall moves illegal", () => {
    const world = makeWorld();
    const s1 = world.snakeById("snake_01")!;
    s1.cells = [
      { x: 0, y: 6 },
      { x: 1, y: 6 },
      { x: 2, y: 6 },
    ];
    s1.direction = "west";
    const features = computeActionFeatures(world, s1);
    expect(features.STRAIGHT.legal).toBe(false); // target x = -1
    expect(features.STRAIGHT.illegalReason).toBe("wall");
    expect(features.LEFT.legal).toBe(true); // heading south
    expect(features.RIGHT.legal).toBe(true); // heading north
  });

  it("marks moves into snake bodies illegal", () => {
    const world = makeWorld();
    const s2 = world.snakeById("snake_02")!;
    s2.cells = [
      { x: 8, y: 8 },
      { x: 7, y: 8 },
      { x: 6, y: 8 },
    ];
    s2.direction = "east";
    const s1 = world.snakeById("snake_01")!;
    s1.cells = [
      { x: 6, y: 7 },
      { x: 6, y: 6 },
      { x: 6, y: 5 },
    ];
    s1.direction = "south";
    const features = computeActionFeatures(world, s1);
    expect(features.STRAIGHT.legal).toBe(false); // (6,8) is snake_02 body
    expect(features.STRAIGHT.illegalReason).toBe("body");
    expect(features.LEFT.legal).toBe(true); // (5,7)
    expect(features.RIGHT.legal).toBe(true); // (7,7)
  });

  it("computes BFS food distance through free space", () => {
    const world = makeWorld();
    const s1 = world.snakeById("snake_01")!;
    s1.cells = [
      { x: 5, y: 5 },
      { x: 5, y: 4 },
      { x: 5, y: 3 },
    ];
    s1.direction = "south";
    world.food = [{ x: 5, y: 9 }];
    const features = computeActionFeatures(world, s1);
    expect(features.STRAIGHT.target).toEqual({ x: 5, y: 6 });
    expect(features.STRAIGHT.foodDistanceAfterMove).toBe(3); // (5,6)→(5,9)
  });

  it("falls back to Manhattan when food is walled off by a body", () => {
    const world = makeWorld();
    const s2 = world.snakeById("snake_02")!;
    s2.cells = Array.from({ length: 12 }, (_, i) => ({ x: i, y: 8 })); // full wall
    s2.direction = "east";
    const s1 = world.snakeById("snake_01")!;
    s1.cells = [
      { x: 5, y: 5 },
      { x: 5, y: 4 },
      { x: 5, y: 3 },
    ];
    s1.direction = "south";
    world.food = [{ x: 5, y: 10 }];
    const features = computeActionFeatures(world, s1);
    expect(features.STRAIGHT.legal).toBe(true);
    // BFS cannot cross the wall → unreachable sentinel = max(w,h)*2, never a
    // straight-line distance that would compare unfairly with BFS values.
    expect(features.STRAIGHT.foodDistanceAfterMove).toBe(24);
    // Region above the wall: 96 cells minus own 3 body cells.
    expect(features.STRAIGHT.reachableFreeCells).toBe(93);
  });

  it("flags high dead-end risk when the reachable pocket is smaller than the body", () => {
    const world = makeWorld();
    const s2 = world.snakeById("snake_02")!;
    // Box around (6,8) with the entrance at (6,7).
    s2.cells = [
      { x: 5, y: 7 },
      { x: 5, y: 8 },
      { x: 5, y: 9 },
      { x: 6, y: 9 },
      { x: 7, y: 9 },
      { x: 7, y: 8 },
      { x: 7, y: 7 },
    ];
    s2.direction = "east";
    const s1 = world.snakeById("snake_01")!;
    s1.cells = [
      { x: 6, y: 6 },
      { x: 6, y: 5 },
      { x: 6, y: 4 },
    ];
    s1.direction = "south";
    const features = computeActionFeatures(world, s1);
    // STRAIGHT → (6,7): reachable pocket = {(6,7),(6,8)} = 2 cells < body 3 → high.
    // s2's head (5,7) is adjacent to the entrance and could move in → candidate.
    expect(features.STRAIGHT.legal).toBe(true);
    expect(features.STRAIGHT.reachableFreeCells).toBe(2);
    expect(features.STRAIGHT.deadEndRisk).toBe("high");
    expect(features.STRAIGHT.headConflictCandidates).toBe(1);
  });

  it("counts a third snake as conflict candidate even when the target is another snake's neck", () => {
    const world = new SnakeWorld({
      width: 12,
      height: 12,
      snakeCount: 3,
      initialLength: 3,
      foodTarget: 3,
      seed: 11,
    });
    const s2 = world.snakeById("snake_02")!;
    s2.cells = [
      { x: 6, y: 8 },
      { x: 6, y: 9 }, // snake_02's neck
      { x: 6, y: 10 },
    ];
    s2.direction = "north";
    const s3 = world.snakeById("snake_03")!;
    s3.cells = [
      { x: 7, y: 9 },
      { x: 8, y: 9 },
      { x: 9, y: 9 },
    ];
    s3.direction = "west";
    const s1 = world.snakeById("snake_01")!;
    s1.cells = [
      { x: 5, y: 9 },
      { x: 4, y: 9 },
      { x: 3, y: 9 },
    ];
    s1.direction = "east"; // STRAIGHT target (6,9) = snake_02's neck cell
    const features = computeActionFeatures(world, s1);
    // snake_02 cannot reverse into its own neck, but snake_03 (adjacent at
    // (7,9)) is a genuine contender and must still be counted.
    expect(features.STRAIGHT.headConflictCandidates).toBe(1);
  });

  it("counts head-conflict candidates among adjacent enemy heads", () => {
    const world = makeWorld();
    const s2 = world.snakeById("snake_02")!;
    s2.cells = [
      { x: 6, y: 8 },
      { x: 6, y: 9 },
      { x: 6, y: 10 },
    ];
    s2.direction = "north"; // STRAIGHT target would be (6,7)
    const s1 = world.snakeById("snake_01")!;
    s1.cells = [
      { x: 6, y: 5 },
      { x: 6, y: 4 },
      { x: 6, y: 3 },
    ];
    s1.direction = "south"; // STRAIGHT target (6,6)
    const features = computeActionFeatures(world, s1);
    // s2's head is at (6,8), two cells below s1's target (6,6): not adjacent.
    expect(features.STRAIGHT.headConflictCandidates).toBe(0);
    s1.cells = [
      { x: 6, y: 6 },
      { x: 6, y: 5 },
      { x: 6, y: 4 },
    ];
    const closer = computeActionFeatures(world, s1);
    // Now s1 target is (6,7), adjacent to s2 head (6,8) → candidate.
    expect(closer.STRAIGHT.headConflictCandidates).toBe(1);
  });
});
