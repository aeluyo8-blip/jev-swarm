import type { ActionFeaturesByAction, RelativeAction, Vec } from "../game/types";
import { cellKey } from "../game/types";
import { RELATIVE_ACTIONS } from "../game/types";

/**
 * Joint Action Resolver (plan §6): among all joint actions satisfying the
 * hard constraints, maximise Σ log P_i(a_i). The resolver only enforces
 * safety and respects the model's probability preferences — it never hunts
 * food or plans routes, otherwise it would mask Jev's contribution.
 */
export interface ResolverAgentInput {
  id: string;
  head: Vec;
  probabilities: Record<RelativeAction, number>;
  features: ActionFeaturesByAction;
}

export interface PerAgentResolution {
  proposed: RelativeAction;
  executed: RelativeAction;
  overrideReason: string | null;
  source: "model" | "model+fallback";
}

export interface ResolutionOutcome {
  joint: Record<string, RelativeAction>;
  perAgent: Record<string, PerAgentResolution>;
  score: number;
  method: "enumerate" | "beam";
  explored: number;
  /** Conflicts that WOULD have happened if every snake played its top-1. */
  rawConflicts: { sharedTarget: number; headSwap: number };
}

const EPS = 1e-8;
const ENUMERATION_LIMIT = 12; // 3^12 = 531k, still instant; beyond → beam search
const DEFAULT_BEAM_WIDTH = 256;

const logProb = (p: number): number => Math.log(Math.max(p, EPS));

const candidatesOf = (agent: ResolverAgentInput): RelativeAction[] =>
  RELATIVE_ACTIONS.filter((a) => agent.features[a].legal).sort(
    (a, b) =>
      agent.probabilities[b] - agent.probabilities[a] ||
      RELATIVE_ACTIONS.indexOf(a) - RELATIVE_ACTIONS.indexOf(b),
  );

const topAction = (agent: ResolverAgentInput): RelativeAction => {
  let best: RelativeAction = "STRAIGHT";
  let bestP = -Infinity;
  for (const a of RELATIVE_ACTIONS) {
    const p = agent.probabilities[a];
    if (p > bestP) {
      bestP = p;
      best = a;
    }
  }
  return best;
};

interface Assignment {
  id: string;
  target: Vec;
  head: Vec;
}

function violatesConstraints(
  candidate: { id: string; head: Vec; target: Vec },
  claimed: Map<string, string>,
  assigned: Assignment[],
): string | null {
  const key = cellKey(candidate.target);
  const holder = claimed.get(key);
  if (holder !== undefined && holder !== candidate.id) {
    return `conflict with ${holder}`;
  }
  for (const a of assigned) {
    if (
      cellKey(candidate.target) === cellKey(a.head) &&
      cellKey(a.target) === cellKey(candidate.head)
    ) {
      return `head-swap with ${a.id}`;
    }
  }
  return null;
}

/** Derive why the executed action differs from the model's top-1. */
function overrideReasonFor(
  agent: ResolverAgentInput,
  proposed: RelativeAction,
  joint: Record<string, RelativeAction>,
  agents: ResolverAgentInput[],
): string {
  const proposedFeatures = agent.features[proposed];
  if (!proposedFeatures.legal) {
    return `illegal (${proposedFeatures.illegalReason ?? "static"})`;
  }
  const myTarget = cellKey(proposedFeatures.target);
  for (const other of agents) {
    if (other.id === agent.id) continue;
    const otherAction = joint[other.id];
    if (!otherAction) continue;
    const otherTarget = cellKey(other.features[otherAction].target);
    if (otherTarget === myTarget) return `conflict with ${other.id}`;
    if (
      myTarget === cellKey(other.head) &&
      otherTarget === cellKey(agent.head)
    ) {
      return `head-swap with ${other.id}`;
    }
  }
  return "constraint";
}

export function resolveJointAction(
  agents: ResolverAgentInput[],
  beamWidth: number = DEFAULT_BEAM_WIDTH,
): ResolutionOutcome {
  const perAgent: Record<string, PerAgentResolution> = {};
  const rawConflicts = computeRawConflicts(agents);

  for (const agent of agents) {
    const proposed = topAction(agent);
    perAgent[agent.id] = {
      proposed,
      executed: proposed,
      overrideReason: null,
      source: "model",
    };
  }

  if (agents.length === 0) {
    return {
      joint: {},
      perAgent,
      score: 0,
      method: "enumerate",
      explored: 0,
      rawConflicts,
    };
  }

  // Most-constrained first: fails fast and prunes harder. Snakes with no
  // legal action cannot participate in any feasible joint — resolve everyone
  // else jointly and let the doomed ones keep heading (their executed cell is
  // illegal for every other snake too, so it cannot collide with the joint).
  const ordered = [...agents].sort(
    (a, b) => candidatesOf(a).length - candidatesOf(b).length,
  );
  const resolvable = ordered.filter((a) => candidatesOf(a).length > 0);
  const doomed = ordered.filter((a) => candidatesOf(a).length === 0);
  const useBeam = resolvable.length > ENUMERATION_LIMIT;
  const best = resolvable.length
    ? useBeam
      ? beamSearch(resolvable, beamWidth)
      : enumerate(resolvable)
    : null;
  const explored = useBeam
    ? resolvable.length * beamWidth
    : countLeaves(resolvable);

  if (!best) {
    // No feasible joint action among the resolvable snakes: fall back per
    // snake (safe-but-dumb) instead of executing an impossible combination.
    const joint: Record<string, RelativeAction> = {};
    for (const agent of ordered) {
      const hasCandidates = candidatesOf(agent).length > 0;
      const executed = hasCandidates ? fallbackActionFor(agent) : "STRAIGHT";
      joint[agent.id] = executed;
      const proposed = perAgent[agent.id].proposed;
      perAgent[agent.id] = {
        proposed,
        executed,
        overrideReason:
          executed === proposed
            ? null
            : hasCandidates
              ? "no valid joint action — fallback"
              : "no legal action — doomed",
        source: "model+fallback",
      };
    }
    return {
      joint,
      perAgent,
      score: NaN,
      method: useBeam ? "beam" : "enumerate",
      explored,
      rawConflicts,
    };
  }

  const joint: Record<string, RelativeAction> = {};
  for (const [id, action] of best.choices) joint[id] = action;
  for (const agent of doomed) {
    joint[agent.id] = "STRAIGHT";
    const entry = perAgent[agent.id];
    if (entry.proposed !== "STRAIGHT") {
      perAgent[agent.id] = {
        ...entry,
        executed: "STRAIGHT",
        overrideReason: "no legal action — doomed",
        source: "model+fallback",
      };
    }
  }

  for (const agent of resolvable) {
    const entry = perAgent[agent.id];
    const executed = joint[agent.id];
    if (executed === entry.proposed) continue;
    perAgent[agent.id] = {
      ...entry,
      executed,
      overrideReason: overrideReasonFor(agent, entry.proposed, joint, agents),
    };
  }

  return {
    joint,
    perAgent,
    score: best.score,
    method: useBeam ? "beam" : "enumerate",
    explored,
    rawConflicts,
  };
}

// ---------------------------------------------------------------- engines

interface SearchState {
  choices: Map<string, RelativeAction>;
  claimed: Map<string, string>;
  assigned: Assignment[];
  score: number;
}

function enumerate(ordered: ResolverAgentInput[]): SearchState | null {
  const candidateLists = ordered.map(candidatesOf);
  const suffixMax = new Array<number>(ordered.length + 1).fill(0);
  for (let i = ordered.length - 1; i >= 0; i--) {
    const maxP = candidateLists[i].length
      ? Math.max(...candidateLists[i].map((a) => logProb(ordered[i].probabilities[a])))
      : 0;
    suffixMax[i] = suffixMax[i + 1] + maxP;
  }

  let best: SearchState | null = null;
  let bestScore = -Infinity;
  const root: SearchState = {
    choices: new Map(),
    claimed: new Map(),
    assigned: [],
    score: 0,
  };

  const dfs = (i: number, state: SearchState): void => {
    if (state.score + suffixMax[i] <= bestScore) return; // cannot beat best
    if (i === ordered.length) {
      bestScore = state.score;
      best = { choices: new Map(state.choices), claimed: new Map(), assigned: [], score: state.score };
      return;
    }
    const agent = ordered[i];
    for (const action of candidateLists[i]) {
      const target = agent.features[action].target;
      const violation = violatesConstraints(
        { id: agent.id, head: agent.head, target },
        state.claimed,
        state.assigned,
      );
      if (violation) continue;
      state.choices.set(agent.id, action);
      state.claimed.set(cellKey(target), agent.id);
      state.assigned.push({ id: agent.id, target, head: agent.head });
      state.score += logProb(agent.probabilities[action]);
      dfs(i + 1, state);
      state.score -= logProb(agent.probabilities[action]);
      state.assigned.pop();
      state.claimed.delete(cellKey(target));
      state.choices.delete(agent.id);
    }
  };

  dfs(0, root);
  return best;
}

function beamSearch(ordered: ResolverAgentInput[], width: number): SearchState | null {
  let beam: SearchState[] = [
    { choices: new Map(), claimed: new Map(), assigned: [], score: 0 },
  ];
  for (const agent of ordered) {
    const next: SearchState[] = [];
    for (const state of beam) {
      for (const action of candidatesOf(agent)) {
        const target = agent.features[action].target;
        const violation = violatesConstraints(
          { id: agent.id, head: agent.head, target },
          state.claimed,
          state.assigned,
        );
        if (violation) continue;
        next.push({
          choices: new Map([...state.choices, [agent.id, action]]),
          claimed: new Map([...state.claimed, [cellKey(target), agent.id]]),
          assigned: [...state.assigned, { id: agent.id, target, head: agent.head }],
          score: state.score + logProb(agent.probabilities[action]),
        });
      }
    }
    if (next.length === 0) return null;
    next.sort((a, b) => b.score - a.score);
    beam = next.slice(0, width);
  }
  return beam[0] ?? null;
}

// ---------------------------------------------------------------- helpers

function fallbackActionFor(agent: ResolverAgentInput): RelativeAction {
  const legal = RELATIVE_ACTIONS.filter((a) => agent.features[a].legal);
  if (legal.length === 0) return "STRAIGHT";
  return [...legal].sort(
    (a, b) =>
      agent.features[b].reachableFreeCells - agent.features[a].reachableFreeCells ||
      RELATIVE_ACTIONS.indexOf(a) - RELATIVE_ACTIONS.indexOf(b),
  )[0];
}

function computeRawConflicts(agents: ResolverAgentInput[]): ResolutionOutcome["rawConflicts"] {
  const byTarget = new Map<string, string[]>();
  for (const agent of agents) {
    const key = cellKey(agent.features[topAction(agent)].target);
    byTarget.set(key, [...(byTarget.get(key) ?? []), agent.id]);
  }
  let sharedTarget = 0;
  let headSwap = 0;
  for (const group of byTarget.values()) {
    if (group.length >= 2) sharedTarget += group.length;
  }
  for (const a of agents) {
    for (const b of agents) {
      if (a.id >= b.id) continue;
      const aTarget = cellKey(a.features[topAction(a)].target);
      const bTarget = cellKey(b.features[topAction(b)].target);
      if (aTarget === cellKey(b.head) && bTarget === cellKey(a.head)) headSwap += 2;
    }
  }
  return { sharedTarget, headSwap };
}

function countLeaves(ordered: ResolverAgentInput[]): number {
  return ordered.reduce(
    (acc, agent) => acc * Math.max(1, candidatesOf(agent).length),
    1,
  );
}
