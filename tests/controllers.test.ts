import { describe, expect, it } from "vitest";
import { ruleAction } from "../src/game/controllers";
import type { ActionFeatures, ActionFeaturesByAction, RelativeAction, Vec } from "../src/game/types";
import { RELATIVE_ACTIONS } from "../src/game/types";

interface ActionSpec {
  target: Vec;
  foodDistance?: number;
  freeCells?: number;
  risk?: ActionFeatures["deadEndRisk"];
  conflicts?: number;
  legal?: boolean;
}

function makeFeatures(specs: Record<RelativeAction, ActionSpec>): ActionFeaturesByAction {
  const build = (s: ActionSpec): ActionFeatures => ({
    legal: s.legal ?? true,
    illegalReason: (s.legal ?? true) ? undefined : "body",
    foodDistanceAfterMove: s.foodDistance ?? 5,
    reachableFreeCells: s.freeCells ?? 100,
    nearestOtherHead: 3,
    deadEndRisk: s.risk ?? "low",
    headConflictCandidates: s.conflicts ?? 0,
    wallDistance: 4,
    target: s.target,
  });
  return {
    LEFT: build(specs.LEFT),
    STRAIGHT: build(specs.STRAIGHT),
    RIGHT: build(specs.RIGHT),
  };
}

describe("rule baseline (survival first, then max food)", () => {
  it("takes the safe action closest to food", () => {
    const f = makeFeatures({
      LEFT: { target: { x: 4, y: 5 }, foodDistance: 5 },
      STRAIGHT: { target: { x: 5, y: 6 }, foodDistance: 2 },
      RIGHT: { target: { x: 6, y: 5 }, foodDistance: 5 },
    });
    expect(ruleAction(f)).toBe("STRAIGHT");
  });

  it("avoids a contested cell even when it is closer to food", () => {
    const f = makeFeatures({
      LEFT: { target: { x: 4, y: 5 }, foodDistance: 4 },
      STRAIGHT: { target: { x: 5, y: 6 }, foodDistance: 1, conflicts: 1 },
      RIGHT: { target: { x: 6, y: 5 }, foodDistance: 7 },
    });
    expect(ruleAction(f)).toBe("LEFT");
  });

  it("avoids high dead-end risk even when it is the only food direction", () => {
    const f = makeFeatures({
      LEFT: { target: { x: 4, y: 5 }, foodDistance: 1, risk: "high" },
      STRAIGHT: { target: { x: 5, y: 6 }, foodDistance: 9 },
      RIGHT: { target: { x: 6, y: 5 }, foodDistance: 6 },
    });
    expect(ruleAction(f)).toBe("RIGHT");
  });

  it("prefers more reachable space on a food-distance tie", () => {
    const f = makeFeatures({
      LEFT: { target: { x: 4, y: 5 }, foodDistance: 3, freeCells: 40 },
      STRAIGHT: { target: { x: 5, y: 6 }, foodDistance: 3, freeCells: 90 },
      RIGHT: { target: { x: 6, y: 5 }, foodDistance: 3, freeCells: 10 },
    });
    expect(ruleAction(f)).toBe("STRAIGHT");
  });

  it("falls back to a contested action when it is the only survivor", () => {
    const f = makeFeatures({
      LEFT: { target: { x: 4, y: 5 }, legal: false },
      STRAIGHT: { target: { x: 5, y: 6 }, conflicts: 1, risk: "medium" },
      RIGHT: { target: { x: 6, y: 5 }, legal: false },
    });
    expect(ruleAction(f)).toBe("STRAIGHT");
  });

  it("keeps heading when doomed (no legal action)", () => {
    const f = makeFeatures({
      LEFT: { target: { x: 4, y: 5 }, legal: false },
      STRAIGHT: { target: { x: 5, y: 6 }, legal: false },
      RIGHT: { target: { x: 6, y: 5 }, legal: false },
    });
    expect(ruleAction(f)).toBe("STRAIGHT");
  });

  it("is deterministic across the full action set", () => {
    const f = makeFeatures({
      LEFT: { target: { x: 4, y: 5 } },
      STRAIGHT: { target: { x: 5, y: 6 } },
      RIGHT: { target: { x: 6, y: 5 } },
    });
    const results = RELATIVE_ACTIONS.map(() => ruleAction(f));
    expect(new Set(results).size).toBe(1);
  });
});
