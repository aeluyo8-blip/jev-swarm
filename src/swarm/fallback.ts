import type { RelativeAction } from "../game/types";
import { RELATIVE_ACTIONS } from "../game/types";
import type { ActionFeaturesByAction } from "../game/types";

/**
 * Deterministic fallback (plan §8.2): safe but deliberately NOT smart.
 * Prefers STRAIGHT, then the action with the most reachable free space.
 * Never chases food, never coordinates — so API outages degrade the demo
 * without masking Jev's contribution.
 */
export function deterministicFallback(
  features: ActionFeaturesByAction,
): RelativeAction {
  if (features.STRAIGHT.legal) return "STRAIGHT";
  const legal = RELATIVE_ACTIONS.filter((a) => features[a].legal);
  if (legal.length === 0) return "STRAIGHT"; // doomed; keep heading
  return [...legal].sort(
    (a, b) =>
      features[b].reachableFreeCells - features[a].reachableFreeCells ||
      RELATIVE_ACTIONS.indexOf(a) - RELATIVE_ACTIONS.indexOf(b),
  )[0];
}
