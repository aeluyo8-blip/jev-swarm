import type { TickRecord, RunSummary } from "./metrics";

const CSV_COLUMNS: Array<keyof TickRecord> = [
  "tick",
  "mode",
  "agents",
  "seed",
  "tick_ms",
  "deadline_ms",
  "model",
  "started_at",
  "latencyMs",
  "questions",
  "input_tokens",
  "output_tokens",
  "deadline_missed",
  "stale",
  "fallback",
  "raw_conflicts",
  "collisions",
  "overrides",
  "alive",
  "food",
  "eats",
  "game_over",
];

const csvEscape = (value: string): string =>
  /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

export function recordsToCsv(records: TickRecord[]): string {
  const head = CSV_COLUMNS.join(",");
  const rows = records.map((r) =>
    CSV_COLUMNS.map((c) => csvEscape(String(r[c] ?? ""))).join(","),
  );
  return [head, ...rows].join("\n");
}

export function recordsToJsonl(records: TickRecord[]): string {
  return records.map((r) => JSON.stringify(r)).join("\n");
}

export function summariesToCsv(summaries: RunSummary[]): string {
  const head =
    "mode,agents,seed,ticks,tick_ms,deadline_ms,model,started_at,latency_p50_ms,latency_p95_ms,latency_max_ms,avg_input_tokens,avg_output_tokens,deadline_miss_rate,stale,fallback_ticks,avg_alive,total_food,food_per_minute,raw_conflicts,actual_collisions,death_causes,overrides,override_rate,avg_survival_ticks,generations";
  const rows = summaries.map((s) =>
    [
      s.meta.mode,
      s.meta.agents,
      s.meta.seed,
      s.ticks,
      s.meta.tickMs,
      s.meta.deadlineMs,
      s.meta.model,
      s.meta.startedAt,
      s.latencyP50Ms?.toFixed(1) ?? "",
      s.latencyP95Ms?.toFixed(1) ?? "",
      s.latencyMaxMs?.toFixed(1) ?? "",
      s.avgInputTokens?.toFixed(0) ?? "",
      s.avgOutputTokens?.toFixed(0) ?? "",
      s.deadlineMissRate.toFixed(3),
      s.staleCount,
      s.fallbackTicks,
      s.avgAlive.toFixed(2),
      s.totalFood,
      s.foodPerMinute.toFixed(2),
      s.rawConflicts,
      s.actualCollisions,
      JSON.stringify(s.deathCauses),
      s.overrides,
      s.overrideRate.toFixed(3),
      s.avgSurvivalTicks.toFixed(1),
      s.generations,
    ].map((v) => csvEscape(String(v))).join(","),
  );
  return [head, ...rows].join("\n");
}

export const timestampSlug = (): string =>
  new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
