import type { Rng } from "./rng";
import { rngInt } from "./rng";
import type { ActionFeaturesByAction, RelativeAction } from "./types";
import { RELATIVE_ACTIONS } from "./types";

export function legalActions(features: ActionFeaturesByAction): RelativeAction[] {
  return RELATIVE_ACTIONS.filter((a) => features[a].legal);
}

/** Lowest baseline: uniformly random among legal actions. */
export function randomAction(
  features: ActionFeaturesByAction,
  rng: Rng,
): RelativeAction {
  const legal = legalActions(features);
  if (legal.length === 0) return "STRAIGHT"; // doomed either way
  return legal[rngInt(rng, legal.length)];
}

/**
 * Non-AI baseline: survival is a hard precondition, then maximise food.
 *
 * Tiered survival filter — the safest non-empty tier wins:
 *   1. not high dead-end risk AND no snake could contest the target cell
 *   2. not high dead-end risk
 *   3. anything legal (doomed corner case)
 * Inside the winning tier the action closest to food takes the cell; ties
 * prefer more reachable space, then STRAIGHT before turns (deterministic).
 */
export function ruleAction(features: ActionFeaturesByAction): RelativeAction {
  const legal = legalActions(features);
  if (legal.length === 0) return "STRAIGHT";
  const safe = legal.filter(
    (a) => features[a].deadEndRisk !== "high" && features[a].headConflictCandidates === 0,
  );
  const cautious = legal.filter((a) => features[a].deadEndRisk !== "high");
  const pool = safe.length > 0 ? safe : cautious.length > 0 ? cautious : legal;
  const order: Record<RelativeAction, number> = { STRAIGHT: 0, LEFT: 1, RIGHT: 2 };
  return [...pool].sort(
    (a, b) =>
      features[a].foodDistanceAfterMove - features[b].foodDistanceAfterMove ||
      features[b].reachableFreeCells - features[a].reachableFreeCells ||
      order[a] - order[b],
  )[0];
}
