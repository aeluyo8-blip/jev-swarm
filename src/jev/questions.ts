import type { ActionFeatures, RelativeAction } from "../game/types";
import { turnDirection } from "../game/geometry";
import type { SnakeWorld } from "../game/world";
import type { QuestionSpec } from "./types";

/**
 * One identical instruction template for every snake; only the agent id is
 * substituted (plan §5.2). Questions in a single request are independent
 * judgments — no question may reference another question's answer.
 *
 * The policy text lives in the shared `team_goal` (see state.ts) and is sent
 * once per request, so per-question instructions stay minimal — question
 * tokens must not grow linearly with the agent count (plan §4.3), which
 * would confound the parallelism measurement (plan §13).
 *
 * Prompt A/B lesson (verified against the live API): a survival-only template
 * produced snakes that never ate. The balanced policy in team_goal fixed it
 * (0 → 6-8 eats per 25 ticks with 4 snakes, confidence 0.42 → 0.8+).
 */
const instructionFor = (agentId: string): string =>
  `Choose the best immediate move for ${agentId} to serve the team goal stated in the shared world state. Return a Choice over LEFT / STRAIGHT / RIGHT.`;

function criteriaFor(direction: string): Record<string, string> {
  const left = turnDirection(direction as never, "LEFT");
  const right = turnDirection(direction as never, "RIGHT");
  return {
    LEFT: `Turn left: heading ${direction} changes to ${left}.`,
    STRAIGHT: `Keep heading ${direction}.`,
    RIGHT: `Turn right: heading ${direction} changes to ${right}.`,
  };
}

export const moveQuestionId = (agentId: string): string => `${agentId}_move`;

export function buildQuestions(
  world: SnakeWorld,
  featuresById: Map<string, Record<RelativeAction, ActionFeatures>>,
): QuestionSpec[] {
  return world.aliveSnakes()
    .filter((s) => featuresById.has(s.id))
    .map((snake) => ({
      id: moveQuestionId(snake.id),
      type: "choice" as const,
      instructions: instructionFor(snake.id),
      criteria: criteriaFor(snake.direction),
    }));
}
