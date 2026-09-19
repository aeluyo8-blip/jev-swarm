import { describe, expect, it } from "vitest";
import { SnakeWorld } from "../src/game/world";
import { computeActionFeatures } from "../src/game/features";
import { buildSharedState } from "../src/jev/state";
import type { ActionFeatures, RelativeAction } from "../src/game/types";

function makeWorld(n: number): SnakeWorld {
  return new SnakeWorld({
    width: 12,
    height: 12,
    snakeCount: n,
    initialLength: 3,
    foodTarget: 3,
    seed: 5,
  });
}

describe("shared state schema v2 (positions are public physics)", () => {
  it("includes own head/body and every other snake's head", () => {
    const world = makeWorld(3);
    const featuresById = new Map<string, Record<RelativeAction, ActionFeatures>>();
    for (const snake of world.aliveSnakes()) {
      featuresById.set(snake.id, computeActionFeatures(world, snake));
    }
    const state = buildSharedState(world, featuresById);

    const a1 = state.agents.snake_01;
    const head = world.snakeById("snake_01")!.cells[0];
    expect(a1.head).toEqual([head.x, head.y]);
    expect(a1.body[0]).toEqual(a1.head);
    expect(a1.length).toBe(3);

    expect(a1.others.map((o) => o.id)).toEqual(["snake_02", "snake_03"]);
    for (const other of a1.others) {
      expect(other.head).toHaveLength(2);
      expect(typeof other.direction).toBe("string");
      expect(other.length).toBeGreaterThan(0);
      const otherSnake = world.snakeById(other.id)!;
      expect(other.head).toEqual([otherSnake.cells[0].x, otherSnake.cells[0].y]);
    }

    // The tuned policy rides in team_goal (sent once, not per question).
    expect(state.world.team_goal).toContain("never eats");
    expect(state.world.team_goal).toContain("food_distance_after_move");
  });
});
