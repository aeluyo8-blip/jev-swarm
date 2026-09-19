import type { ActionFeaturesByAction, DeathEvent, RelativeAction, Vec } from "../game/types";
import { cellKey, RELATIVE_ACTIONS } from "../game/types";
import { mulberry32, type Rng } from "../game/rng";
import { SnakeWorld } from "../game/world";
import { computeActionFeatures } from "../game/features";
import { randomAction, ruleAction } from "../game/controllers";
import { buildSharedState, type SharedWorldState } from "../jev/state";
import { buildQuestions, moveQuestionId } from "../jev/questions";
import type { ChoiceAnswer, ModelDecision, ModelUsage, QuestionSpec } from "../jev/types";
import { resolveJointAction, type ResolverAgentInput } from "../swarm/resolver";
import { deterministicFallback } from "../swarm/fallback";

export type ArenaMode = "random" | "rule" | "jev_raw" | "jev_joint";

export interface ArenaConfig {
  mode: ArenaMode;
  agents: number;
  seed: number;
  tickMs: number;
  deadlineMs: number;
  model: string;
}

export const DEFAULT_ARENA_CONFIG: ArenaConfig = {
  mode: "jev_joint",
  agents: 10,
  seed: 42,
  tickMs: 250,
  // Measured TypeSafe round trip is ~1s from typical networks; 220ms was
  // aspirational and made every tick fall back. The tick loop still targets
  // tickMs pacing and simply runs slower when a decision takes longer.
  deadlineMs: 1500,
  model: "jev-latest",
};

export interface TickContext {
  tick: number;
  /** Revision used for stale-response detection. */
  revision: number;
  featuresById: Map<string, ActionFeaturesByAction>;
  sharedState: SharedWorldState | null;
  questions: QuestionSpec[] | null;
}

export type DecisionOutcome =
  | { kind: "local"; policy: "random" | "rule" }
  | {
      kind: "model";
      decision: ModelDecision | null;
      stale: boolean;
      deadlineMissed: boolean;
      error?: string;
    };

export type TelemetrySource =
  | "random"
  | "rule"
  | "model"
  | "model+resolver"
  | "fallback";

export interface AgentTelemetry {
  agentId: string;
  source: TelemetrySource;
  probabilities: Record<RelativeAction, number> | null;
  confidence: number | null;
  proposed: RelativeAction | null;
  executed: RelativeAction;
  overrideReason: string | null;
  features: ActionFeaturesByAction;
}

export interface TickResult {
  tick: number;
  telemetry: AgentTelemetry[];
  latencyMs: number | null;
  usage: ModelUsage | null;
  questionsPerCall: number;
  deadlineMissed: boolean;
  stale: boolean;
  error: string | null;
  fallbackUsed: boolean;
  /** Conflicts among the model's top-1 picks, before any resolution. */
  rawTop1Conflicts: { sharedTarget: number; headSwap: number } | null;
  /** Conflicts actually executed this tick. */
  executionConflicts: { sharedTarget: number; headSwap: number };
  deaths: DeathEvent[];
  eats: number;
  overrides: number;
  alive: number;
  food: number;
  gameOver: boolean;
  resolverMethod: "enumerate" | "beam" | null;
}

/**
 * Ties the deterministic world, the state analyzer and a decision source
 * into one tickable unit. The tick loop itself (deadline handling, stale
 * checks) lives with the driver — browser for the demo, runner for benchmarks.
 */
export class ArenaSimulation {
  readonly world: SnakeWorld;
  config: ArenaConfig;
  private policyRng: Rng;

  constructor(config: Partial<ArenaConfig> = {}) {
    this.config = { ...DEFAULT_ARENA_CONFIG, ...config };
    this.world = new SnakeWorld({
      width: 30,
      height: 30,
      snakeCount: this.config.agents,
      initialLength: 3,
      foodTarget: 8,
      seed: this.config.seed,
    });
    this.policyRng = mulberry32(this.config.seed ^ 0x9e3779b9);
  }

  isJevMode(): boolean {
    return this.config.mode === "jev_raw" || this.config.mode === "jev_joint";
  }

  prepare(): TickContext | null {
    if (this.world.status === "game_over") return null;
    const featuresById = new Map<string, ActionFeaturesByAction>();
    for (const snake of this.world.aliveSnakes()) {
      featuresById.set(snake.id, computeActionFeatures(this.world, snake));
    }
    const jev = this.isJevMode();
    return {
      tick: this.world.tick,
      revision: this.world.tick,
      featuresById,
      sharedState: jev ? buildSharedState(this.world, featuresById) : null,
      questions: jev ? buildQuestions(this.world, featuresById) : null,
    };
  }

  applyDecision(ctx: TickContext, outcome: DecisionOutcome): TickResult {
    const telemetry: AgentTelemetry[] = [];
    const joint: Record<string, RelativeAction> = {};
    let latencyMs: number | null = null;
    let usage: ModelUsage | null = null;
    let questionsPerCall = 0;
    let deadlineMissed = false;
    let stale = false;
    let error: string | null = null;
    let fallbackUsed = false;
    let rawTop1Conflicts: TickResult["rawTop1Conflicts"] = null;
    let overrides = 0;
    let resolverMethod: TickResult["resolverMethod"] = null;

    if (outcome.kind === "local") {
      for (const [agentId, features] of ctx.featuresById) {
        const executed =
          outcome.policy === "random"
            ? randomAction(features, this.policyRng)
            : ruleAction(features);
        joint[agentId] = executed;
        telemetry.push({
          agentId,
          source: outcome.policy,
          probabilities: null,
          confidence: null,
          proposed: null,
          executed,
          overrideReason: null,
          features,
        });
      }
    } else {
      latencyMs = outcome.decision?.latencyMs ?? null;
      usage = outcome.decision?.usage ?? null;
      questionsPerCall = ctx.questions?.length ?? 0;
      deadlineMissed = outcome.deadlineMissed;
      stale = outcome.stale;
      error = outcome.error ?? null;

      if (!outcome.decision) {
        // Timeout / API error: deterministic fallback for everyone.
        fallbackUsed = true;
        for (const [agentId, features] of ctx.featuresById) {
          const executed = deterministicFallback(features);
          joint[agentId] = executed;
          telemetry.push({
            agentId,
            source: "fallback",
            probabilities: null,
            confidence: null,
            proposed: null,
            executed,
            overrideReason: "model unavailable — fallback",
            features,
          });
        }
      } else if (this.config.mode === "jev_raw") {
        for (const [agentId, features] of ctx.featuresById) {
          const answer = outcome.decision.answers[moveQuestionId(agentId)];
          const probabilities = probabilitiesOf(answer);
          const proposed = topOf(probabilities);
          joint[agentId] = proposed; // raw = no legality filter, no resolver
          telemetry.push({
            agentId,
            source: "model",
            probabilities,
            confidence: answer?.confidence ?? null,
            proposed,
            executed: proposed,
            overrideReason: null,
            features,
          });
        }
        rawTop1Conflicts = conflictsFromPicks(
          telemetry.map((tel) => ({
            head: this.world.snakeById(tel.agentId)!.cells[0],
            target: tel.features[tel.proposed!].target,
          })),
        );
      } else {
        const inputs: ResolverAgentInput[] = [];
        for (const [agentId, features] of ctx.featuresById) {
          const answer = outcome.decision.answers[moveQuestionId(agentId)];
          inputs.push({
            id: agentId,
            head: this.world.snakeById(agentId)!.cells[0],
            probabilities: probabilitiesOf(answer),
            features,
          });
        }
        const resolution = resolveJointAction(inputs);
        resolverMethod = resolution.method;
        rawTop1Conflicts = resolution.rawConflicts;
        for (const input of inputs) {
          const per = resolution.perAgent[input.id];
          joint[input.id] = per.executed;
          if (per.executed !== per.proposed) overrides += 1;
          telemetry.push({
            agentId: input.id,
            source: "model+resolver",
            probabilities: input.probabilities,
            confidence: outcome.decision.answers[moveQuestionId(input.id)]?.confidence ?? null,
            proposed: per.proposed,
            executed: per.executed,
            overrideReason: per.overrideReason,
            features: input.features,
          });
        }
      }
    }

    this.world.step(joint);

    return {
      tick: ctx.tick,
      telemetry,
      latencyMs,
      usage,
      questionsPerCall,
      deadlineMissed,
      stale,
      error,
      fallbackUsed,
      rawTop1Conflicts,
      executionConflicts: this.world.lastEvents.rawConflicts,
      deaths: this.world.lastEvents.deaths,
      eats: this.world.lastEvents.eats.length,
      overrides,
      alive: this.world.aliveSnakes().length,
      food: this.world.food.length,
      gameOver: this.world.status === "game_over",
      resolverMethod,
    };
  }

  chaos(): void {
    this.world.chaos();
  }

  reset(): void {
    this.world.reset();
    this.policyRng = mulberry32(this.config.seed ^ 0x9e3779b9);
  }
}

function probabilitiesOf(answer: ChoiceAnswer | undefined): Record<RelativeAction, number> {
  if (!answer) return { LEFT: 1 / 3, STRAIGHT: 1 / 3, RIGHT: 1 / 3 };
  return {
    LEFT: answer.probabilities.LEFT ?? 0,
    STRAIGHT: answer.probabilities.STRAIGHT ?? 0,
    RIGHT: answer.probabilities.RIGHT ?? 0,
  };
}

function topOf(probabilities: Record<RelativeAction, number>): RelativeAction {
  let best: RelativeAction = "STRAIGHT";
  for (const a of RELATIVE_ACTIONS) {
    if (probabilities[a] > probabilities[best]) best = a;
  }
  return best;
}

function conflictsFromPicks(
  picks: Array<{ head: Vec; target: Vec }>,
): TickResult["rawTop1Conflicts"] {
  const byTarget = new Map<string, number>();
  for (const p of picks) {
    const key = cellKey(p.target);
    byTarget.set(key, (byTarget.get(key) ?? 0) + 1);
  }
  let sharedTarget = 0;
  for (const count of byTarget.values()) {
    if (count >= 2) sharedTarget += count;
  }
  let headSwap = 0;
  for (const a of picks) {
    for (const b of picks) {
      if (a === b) continue;
      if (cellKey(a.target) === cellKey(b.head) && cellKey(b.target) === cellKey(a.head)) {
        headSwap += 1; // each pair is seen from both sides, so a pair adds 2
      }
    }
  }
  return { sharedTarget, headSwap };
}
