import type { ArenaMode, TickResult } from "../sim/simulation";
import type { DeathCause } from "../game/types";

export interface RunMeta {
  mode: ArenaMode;
  agents: number;
  seed: number;
  tickMs: number;
  deadlineMs: number;
  model: string;
  startedAt: string;
  /** Real wall-clock duration of the run, set by the runner on finish. */
  wallMs?: number;
}

export interface TickRecord {
  tick: number;
  mode: ArenaMode;
  agents: number;
  seed: number;
  tick_ms: number;
  deadline_ms: number;
  model: string;
  started_at: string;
  latencyMs: number | null;
  questions: number;
  input_tokens: number | null;
  output_tokens: number | null;
  deadline_missed: boolean;
  stale: boolean;
  fallback: boolean;
  raw_conflicts: number;
  collisions: number;
  overrides: number;
  alive: number;
  food: number;
  eats: number;
  game_over: boolean;
}

export interface RunSummary {
  meta: RunMeta;
  ticks: number;
  latencyP50Ms: number | null;
  latencyP95Ms: number | null;
  latencyMaxMs: number | null;
  avgInputTokens: number | null;
  avgOutputTokens: number | null;
  deadlineMissRate: number;
  staleCount: number;
  fallbackTicks: number;
  avgAlive: number;
  totalFood: number;
  foodPerMinute: number;
  rawConflicts: number;
  actualCollisions: number;
  deathCauses: Record<DeathCause, number>;
  overrides: number;
  overrideRate: number;
  avgSurvivalTicks: number;
  generations: number;
}

const percentiles = (values: number[], p: number): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
};

export class MetricsRecorder {
  readonly meta: RunMeta;
  readonly records: TickRecord[] = [];
  private deathCauses: Record<DeathCause, number> = {
    wall: 0,
    body: 0,
    obstacle: 0,
    head_conflict: 0,
    head_swap: 0,
  };
  private generationSurvivals: number[] = [];
  private ticksInCurrentGeneration = 0;
  /** Sum of alive snakes across ticks where the model actually decided. */
  private aliveOnModelTicks = 0;
  private wallMs: number | null = null;

  constructor(meta: RunMeta) {
    this.meta = meta;
  }

  /** Called by the runner when the run ends, with the real elapsed time. */
  finish(wallMs: number): void {
    this.wallMs = wallMs;
  }

  add(result: TickResult): void {
    this.ticksInCurrentGeneration += 1;
    for (const death of result.deaths) this.deathCauses[death.cause] += 1;
    if (!result.fallbackUsed) this.aliveOnModelTicks += result.alive;
    if (result.gameOver) {
      this.generationSurvivals.push(this.ticksInCurrentGeneration);
      this.ticksInCurrentGeneration = 0;
    }
    this.records.push({
      tick: result.tick,
      mode: this.meta.mode,
      agents: this.meta.agents,
      seed: this.meta.seed,
      tick_ms: this.meta.tickMs,
      deadline_ms: this.meta.deadlineMs,
      model: this.meta.model,
      started_at: this.meta.startedAt,
      latencyMs: result.latencyMs,
      questions: result.questionsPerCall,
      input_tokens: result.usage?.input_tokens ?? null,
      output_tokens: result.usage?.output_tokens ?? null,
      deadline_missed: result.deadlineMissed,
      stale: result.stale,
      fallback: result.fallbackUsed,
      raw_conflicts: result.rawTop1Conflicts
        ? result.rawTop1Conflicts.sharedTarget + result.rawTop1Conflicts.headSwap
        : 0,
      collisions: result.deaths.length,
      overrides: result.overrides,
      alive: result.alive,
      food: result.food,
      eats: result.eats,
      game_over: result.gameOver,
    });
  }

  summary(): RunSummary {
    const records = this.records;
    const latencies = records
      .map((r) => r.latencyMs)
      .filter((v): v is number => v !== null);
    const inputs = records
      .map((r) => r.input_tokens)
      .filter((v): v is number => v !== null);
    const outputs = records
      .map((r) => r.output_tokens)
      .filter((v): v is number => v !== null);
    const totalTicks = records.length || 1;
    const avg = (arr: number[]): number | null =>
      arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
    // Real wall clock when the runner provides it; nominal tick pacing only
    // as a fallback (the live demo paces itself, headless runs do not).
    const elapsedMs = this.wallMs ?? totalTicks * this.meta.tickMs;
    const foodPerMinute =
      (records.reduce((acc, r) => acc + r.eats, 0) * 60000) / elapsedMs;
    const overrides = records.reduce((acc, r) => acc + r.overrides, 0);

    // Include the still-running tail generation so survival reflects the
    // whole run; without it, long final generations would be invisible.
    const generations = [...this.generationSurvivals];
    if (this.ticksInCurrentGeneration > 0) {
      generations.push(this.ticksInCurrentGeneration);
    }

    return {
      meta: this.meta,
      ticks: records.length,
      latencyP50Ms: percentiles(latencies, 50),
      latencyP95Ms: percentiles(latencies, 95),
      latencyMaxMs: latencies.length ? Math.max(...latencies) : null,
      avgInputTokens: avg(inputs),
      avgOutputTokens: avg(outputs),
      deadlineMissRate: records.filter((r) => r.deadline_missed).length / totalTicks,
      staleCount: records.filter((r) => r.stale).length,
      fallbackTicks: records.filter((r) => r.fallback).length,
      avgAlive: avg(records.map((r) => r.alive)) ?? 0,
      totalFood: records.reduce((acc, r) => acc + r.eats, 0),
      foodPerMinute,
      rawConflicts: records.reduce((acc, r) => acc + r.raw_conflicts, 0),
      actualCollisions: records.reduce((acc, r) => acc + r.collisions, 0),
      deathCauses: { ...this.deathCauses },
      overrides,
      // Per DECISION made by the model, not per configured agent — dead
      // snakes make no decisions and would dilute the diagnostic.
      overrideRate: overrides / (this.aliveOnModelTicks || 1),
      avgSurvivalTicks: generations.length ? avg(generations)! : totalTicks,
      generations: generations.length,
    };
  }
}
