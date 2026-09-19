import { describe, expect, it } from "vitest";
import { SnakeWorld } from "../src/game/world";
import type { JointAction } from "../src/game/world";

/** Small 12x12 board, 2 snakes, no food randomness interference for layout. */
function makeWorld(snakeCount = 2, seed = 7): SnakeWorld {
  return new SnakeWorld({
    width: 12,
    height: 12,
    snakeCount,
    initialLength: 3,
    foodTarget: 3,
    seed,
  });
}

const dirVec = { north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0] } as const;

function setHead(world: SnakeWorld, id: string, x: number, y: number, dir: "north" | "east" | "south" | "west") {
  const snake = world.snakeById(id)!;
  const [dx, dy] = dirVec[dir];
  snake.cells = [
    { x, y },
    { x: x - dx, y: y - dy },
    { x: x - 2 * dx, y: y - 2 * dy },
  ];
  snake.direction = dir;
  snake.alive = true;
  snake.diedAtTick = null;
}

describe("SnakeWorld collisions", () => {
  it("kills a snake that runs into a wall (STRAIGHT into border)", () => {
    const world = makeWorld();
    // snake_01 head on the left border column facing west → target x = -1.
    setHead(world, "snake_01", 0, 5, "west");
    world.step({ snake_01: "STRAIGHT", snake_02: "LEFT" });
    const s1 = world.snakeById("snake_01")!;
    expect(s1.alive).toBe(false);
    expect(world.lastEvents.deaths.find((d) => d.agentId === "snake_01")?.cause).toBe("wall");
  });

  it("kills a snake that enters another snake's occupied cell", () => {
    const world = makeWorld();
    // snake_02 head at (8,6) heading east; snake_01 dives south into (8,6).
    setHead(world, "snake_02", 8, 6, "east"); // body (7,6), (6,6)
    setHead(world, "snake_01", 8, 5, "south"); // body (8,4), (8,3)
    world.step({ snake_01: "STRAIGHT", snake_02: "STRAIGHT" });
    expect(world.snakeById("snake_01")!.alive).toBe(false);
    expect(world.lastEvents.deaths.find((d) => d.agentId === "snake_01")?.cause).toBe("body");
  });

  it("allows following a snake into its vacating tail cell", () => {
    const world = makeWorld();
    setHead(world, "snake_02", 8, 6, "east"); // cells (8,6) (7,6) (6,6)
    setHead(world, "snake_01", 6, 4, "south"); // above the tail cell (6,6)
    // snake_01 STRAIGHT into (6,5) then (6,6) while snake_02 moves east,
    // vacating (6,6) tail each tick (no food there).
    world.step({ snake_01: "STRAIGHT", snake_02: "STRAIGHT" });
    expect(world.snakeById("snake_01")!.alive).toBe(true);
    world.step({ snake_01: "STRAIGHT", snake_02: "STRAIGHT" });
    expect(world.snakeById("snake_01")!.alive).toBe(true);
    expect(world.snakeById("snake_01")!.cells[0]).toEqual({ x: 6, y: 6 });
  });

  it("kills both snakes on a shared-target head conflict", () => {
    const world = makeWorld();
    setHead(world, "snake_01", 5, 4, "south"); // target (5,5) when STRAIGHT
    setHead(world, "snake_02", 5, 6, "north"); // target (5,5) when STRAIGHT
    world.step({ snake_01: "STRAIGHT", snake_02: "STRAIGHT" });
    expect(world.snakeById("snake_01")!.alive).toBe(false);
    expect(world.snakeById("snake_02")!.alive).toBe(false);
    expect(world.lastEvents.deaths.map((d) => d.cause)).toEqual(["head_conflict", "head_conflict"]);
    expect(world.lastEvents.rawConflicts.sharedTarget).toBe(2);
  });

  it("kills both snakes on a head-swap", () => {
    const world = makeWorld();
    setHead(world, "snake_01", 5, 4, "south");
    setHead(world, "snake_02", 5, 5, "north");
    // snake_01 STRAIGHT → (5,5) = snake_02 head; snake_02 STRAIGHT → (5,4) = snake_01 head.
    world.step({ snake_01: "STRAIGHT", snake_02: "STRAIGHT" });
    expect(world.snakeById("snake_01")!.alive).toBe(false);
    expect(world.snakeById("snake_02")!.alive).toBe(false);
    const causes = world.lastEvents.deaths.map((d) => d.cause).sort();
    expect(causes).toEqual(["head_swap", "head_swap"]);
    expect(world.lastEvents.rawConflicts.headSwap).toBe(2);
  });

  it("grows a snake when it eats food and replenishes the food supply", () => {
    const world = makeWorld();
    const s1 = world.snakeById("snake_01")!;
    setHead(world, "snake_01", 6, 6, "east");
    world.food = [{ x: 7, y: 6 }];
    world.step({ snake_01: "STRAIGHT", snake_02: "LEFT" });
    expect(s1.cells.length).toBe(4);
    expect(s1.cells[0]).toEqual({ x: 7, y: 6 });
    expect(world.food.length).toBe(world.config.foodTarget); // refilled
  });

  it("ends the game when every snake is dead", () => {
    const world = makeWorld();
    setHead(world, "snake_01", 0, 5, "west");
    setHead(world, "snake_02", 11, 5, "east");
    world.step({ snake_01: "STRAIGHT", snake_02: "STRAIGHT" });
    expect(world.status).toBe("game_over");
    expect(world.step({} as JointAction)).toBeUndefined(); // no-op after game over
  });

  it("keeps a dying snake's whole body blocking (its tail cannot vacate)", () => {
    const world = makeWorld();
    // snake_01 heads into the west wall (dies); its tail sits at (2,5).
    setHead(world, "snake_01", 0, 5, "west");
    // snake_02 dives into that tail cell in the very same tick.
    setHead(world, "snake_02", 2, 4, "south");
    world.food = []; // keep growth out of the picture
    world.step({ snake_01: "STRAIGHT", snake_02: "STRAIGHT" });
    expect(world.snakeById("snake_01")!.alive).toBe(false);
    // The corpse never advanced, so its tail still blocks: snake_02 dies too.
    expect(world.snakeById("snake_02")!.alive).toBe(false);
    expect(world.lastEvents.deaths.find((d) => d.agentId === "snake_02")?.cause).toBe("body");
  });

  it("tolerates a nearly full board when replenishing food (no hang)", () => {
    const world = new SnakeWorld({
      width: 12,
      height: 12,
      snakeCount: 2,
      initialLength: 3,
      foodTarget: 140, // more food than free cells will remain mid-game
      seed: 3,
    });
    const s1 = world.snakeById("snake_01")!;
    setHead(world, "snake_01", 6, 6, "east");
    world.food = [{ x: 7, y: 6 }];
    // The capped refill must return even when the board cannot fit more food.
    expect(() => world.step({ snake_01: "STRAIGHT", snake_02: "LEFT" })).not.toThrow();
    expect(s1.cells.length).toBe(4);
    expect(world.food.length).toBeLessThanOrEqual(140);
  });

  it("is deterministic for a fixed seed", () => {
    const a = makeWorld(2, 123);
    const b = makeWorld(2, 123);
    for (let i = 0; i < 20; i++) {
      a.step({ snake_01: "STRAIGHT", snake_02: i % 2 ? "LEFT" : "RIGHT" });
      b.step({ snake_01: "STRAIGHT", snake_02: i % 2 ? "LEFT" : "RIGHT" });
    }
    expect(a.snakes.map((s) => s.cells)).toEqual(b.snakes.map((s) => s.cells));
    expect(a.food).toEqual(b.food);
  });
});
