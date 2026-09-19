import { describe, expect, it } from "vitest";
import { resolveJointAction, type ResolverAgentInput } from "../src/swarm/resolver";
import type { ActionFeaturesByAction, RelativeAction, Vec } from "../src/game/types";
import { RELATIVE_ACTIONS } from "../src/game/types";

function features(target: Vec, legal = true): ActionFeaturesByAction {
  const build = (t: Vec, isLegal: boolean): ActionFeaturesByAction[RelativeAction] => ({
    legal: isLegal,
    illegalReason: isLegal ? undefined : "body",
    foodDistanceAfterMove: 5,
    reachableFreeCells: 100,
    nearestOtherHead: 3,
    deadEndRisk: "low",
    headConflictCandidates: 0,
    wallDistance: 4,
    target: t,
  });
  return {
    LEFT: build({ x: target.x - 1, y: target.y }, true),
    STRAIGHT: build(target, legal),
    RIGHT: build({ x: target.x + 1, y: target.y }, true),
  };
}

interface AgentSpec {
  id: string;
  head: Vec;
  probs: Record<RelativeAction, number>;
  straightTarget: Vec;
  straightLegal?: boolean;
}

function makeAgent(spec: AgentSpec): ResolverAgentInput {
  return {
    id: spec.id,
    head: spec.head,
    probabilities: spec.probs,
    features: features(spec.straightTarget, spec.straightLegal ?? true),
  };
}

describe("Joint Action Resolver", () => {
  it("executes every top-1 when there is no conflict", () => {
    const agents = [
      makeAgent({
        id: "snake_01",
        head: { x: 5, y: 2 },
        probs: { LEFT: 0.1, STRAIGHT: 0.8, RIGHT: 0.1 },
        straightTarget: { x: 5, y: 3 },
      }),
      makeAgent({
        id: "snake_02",
        head: { x: 15, y: 2 },
        probs: { LEFT: 0.2, STRAIGHT: 0.5, RIGHT: 0.3 },
        straightTarget: { x: 15, y: 3 },
      }),
    ];
    const result = resolveJointAction(agents);
    expect(result.joint.snake_01).toBe("STRAIGHT");
    expect(result.joint.snake_02).toBe("STRAIGHT");
    expect(result.perAgent.snake_01.overrideReason).toBeNull();
    expect(result.method).toBe("enumerate");
  });

  it("falls back to next-best probability on a shared target and records the override", () => {
    const agents = [
      makeAgent({
        id: "snake_01",
        head: { x: 5, y: 2 },
        probs: { LEFT: 0.1, STRAIGHT: 0.7, RIGHT: 0.2 },
        straightTarget: { x: 5, y: 3 }, // both want (5,3)
      }),
      makeAgent({
        id: "snake_02",
        head: { x: 5, y: 4 },
        probs: { LEFT: 0.1, STRAIGHT: 0.6, RIGHT: 0.3 },
        straightTarget: { x: 5, y: 3 },
      }),
    ];
    const result = resolveJointAction(agents);
    // Best joint: snake_01 keeps STRAIGHT (0.7); snake_02 takes RIGHT (0.3)
    // because 0.3 > 0.1 LEFT; swap case gives 0.6*... no: joint log scores —
    // (0.7, RIGHT 0.3): ln0.7+ln0.3 = -1.56; (LEFT 0.1... snake_01 LEFT target
    // (4,2)... but LEFT of snake_01 is free so (0.1, 0.6): ln0.1+ln0.6=-2.81;
    // (0.7, 0.6) is invalid. So expect snake_01 STRAIGHT, snake_02 RIGHT.
    expect(result.joint.snake_01).toBe("STRAIGHT");
    expect(result.joint.snake_02).toBe("RIGHT");
    expect(result.perAgent.snake_02.overrideReason).toBe("conflict with snake_01");
    expect(result.rawConflicts.sharedTarget).toBe(2);
  });

  it("treats head-swap as a hard constraint (defensive even for legal moves)", () => {
    // Give both snakes legal LEFT/RIGHT that avoid each other, but top-1s
    // would swap heads — the resolver must not pick the swap.
    const a = makeAgent({
      id: "snake_01",
      head: { x: 5, y: 4 },
      probs: { LEFT: 0.05, STRAIGHT: 0.9, RIGHT: 0.05 },
      straightTarget: { x: 5, y: 5 },
    });
    const b = makeAgent({
      id: "snake_02",
      head: { x: 5, y: 5 },
      probs: { LEFT: 0.05, STRAIGHT: 0.9, RIGHT: 0.05 },
      straightTarget: { x: 5, y: 4 },
    });
    const result = resolveJointAction([a, b]);
    const executed = [result.joint.snake_01, result.joint.snake_02];
    // STRAIGHT/STRAIGHT is the swap — must not be chosen.
    expect(executed).not.toEqual(["STRAIGHT", "STRAIGHT"]);
  });

  it("overrides an illegal proposed action with a legal one", () => {
    const agent = makeAgent({
      id: "snake_01",
      head: { x: 5, y: 2 },
      probs: { LEFT: 0.05, STRAIGHT: 0.9, RIGHT: 0.05 },
      straightTarget: { x: 5, y: 3 },
      straightLegal: false, // wall ahead
    });
    const result = resolveJointAction([agent]);
    expect(result.joint.snake_01).not.toBe("STRAIGHT");
    expect(result.perAgent.snake_01.overrideReason).toBe("illegal (body)");
  });

  it("falls back per snake when no valid joint action exists", () => {
    const agent = makeAgent({
      id: "snake_01",
      head: { x: 5, y: 2 },
      probs: { LEFT: 0.3, STRAIGHT: 0.4, RIGHT: 0.3 },
      straightTarget: { x: 5, y: 3 },
      straightLegal: false,
    });
    // Force all actions illegal.
    for (const a of RELATIVE_ACTIONS) agent.features[a].legal = false;
    const result = resolveJointAction([agent]);
    expect(result.joint.snake_01).toBe("STRAIGHT"); // doomed: keep heading
    expect(result.perAgent.snake_01.source).toBe("model+fallback");
  });

  it("still resolves the healthy snakes jointly when another snake is doomed", () => {
    const doomed = makeAgent({
      id: "snake_03",
      head: { x: 20, y: 20 },
      probs: { LEFT: 0.5, STRAIGHT: 0.3, RIGHT: 0.2 },
      straightTarget: { x: 20, y: 21 },
      straightLegal: false,
    });
    for (const a of RELATIVE_ACTIONS) doomed.features[a].legal = false;
    const agents = [
      makeAgent({
        id: "snake_01",
        head: { x: 5, y: 2 },
        probs: { LEFT: 0.1, STRAIGHT: 0.7, RIGHT: 0.2 },
        straightTarget: { x: 5, y: 3 },
      }),
      makeAgent({
        id: "snake_02",
        head: { x: 5, y: 4 },
        probs: { LEFT: 0.1, STRAIGHT: 0.6, RIGHT: 0.3 },
        straightTarget: { x: 5, y: 3 },
      }),
      doomed,
    ];
    const result = resolveJointAction(agents);
    // The doomed snake must not disable joint resolution for everyone else.
    expect(result.joint.snake_01).toBe("STRAIGHT");
    expect(result.joint.snake_02).toBe("RIGHT");
    expect(result.perAgent.snake_02.overrideReason).toBe("conflict with snake_01");
    // Doomed snake keeps heading toward its (illegal) top-1: it dies either way.
    expect(result.joint.snake_03).toBe("STRAIGHT");
    expect(result.perAgent.snake_03.source).toBe("model+fallback");
  });

  it("beam search matches enumeration on a small conflict scenario", () => {
    const agents = [
      makeAgent({
        id: "snake_01",
        head: { x: 5, y: 2 },
        probs: { LEFT: 0.1, STRAIGHT: 0.7, RIGHT: 0.2 },
        straightTarget: { x: 5, y: 3 },
      }),
      makeAgent({
        id: "snake_02",
        head: { x: 5, y: 4 },
        probs: { LEFT: 0.1, STRAIGHT: 0.6, RIGHT: 0.3 },
        straightTarget: { x: 5, y: 3 },
      }),
      makeAgent({
        id: "snake_03",
        head: { x: 20, y: 20 },
        probs: { LEFT: 0.4, STRAIGHT: 0.35, RIGHT: 0.25 },
        straightTarget: { x: 21, y: 20 },
      }),
    ];
    const full = resolveJointAction(agents, 256);
    const beam = resolveJointAction(agents, 1);
    expect(full.joint).toEqual(beam.joint); // width 1 still optimal here
    expect(full.joint.snake_01).toBe("STRAIGHT");
    expect(full.joint.snake_02).toBe("RIGHT");
    expect(full.joint.snake_03).toBe("LEFT");
  });
});
