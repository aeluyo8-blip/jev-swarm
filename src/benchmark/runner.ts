import { ArenaSimulation, DEFAULT_ARENA_CONFIG, type ArenaConfig, type DecisionOutcome, type TickContext } from "../sim/simulation";
import { MetricsRecorder, type RunMeta, type RunSummary, type TickRecord } from "./metrics";

export interface BenchmarkSpec {
  mode: ArenaMode;
  agents: number;
  ticks: number;
  seed: number;
}

type ArenaMode = ArenaConfig["mode"];

export interface BenchmarkRunResult {
  spec: BenchmarkSpec;
  summary: RunSummary;
  records: TickRecord[];
}

export interface BenchmarkReport {
  runs: BenchmarkRunResult[];
  startedAt: string;
  finishedAt: string;
}

export interface BenchmarkDeps {
  /** Build a decision source for one simulation (browser wires Jev here). */
  decide: (sim: ArenaSimulation, ctx: TickContext, deadlineMs: number) => Promise<DecisionOutcome>;
  onProgress?: (done: number, total: number, label: string) => void;
}

/**
 * Headless-capable benchmark runner (plan §7): fixed seed per spec, fixed
 * tick budget, automatic generation restarts on game over.
 */
export async function runBenchmark(
  specs: BenchmarkSpec[],
  deps: BenchmarkDeps,
  base: Partial<ArenaConfig> = {},
): Promise<BenchmarkReport> {
  const startedAt = new Date().toISOString();
  const runs: BenchmarkRunResult[] = [];
  const total = specs.length;
  let done = 0;

  for (const spec of specs) {
    const config: ArenaConfig = {
      mode: spec.mode,
      agents: spec.agents,
      seed: spec.seed,
      tickMs: base.tickMs ?? 250,
      deadlineMs: base.deadlineMs ?? DEFAULT_ARENA_CONFIG.deadlineMs,
      model: base.model ?? "jev-latest",
    };
    const sim = new ArenaSimulation(config);
    const recorder = new MetricsRecorder({
      mode: spec.mode,
      agents: spec.agents,
      seed: spec.seed,
      tickMs: config.tickMs,
      deadlineMs: config.deadlineMs,
      model: config.model,
      startedAt: new Date().toISOString(),
    } satisfies RunMeta);

    deps.onProgress?.(done, total, `${spec.mode} × ${spec.agents}`);

    const startedAt = Date.now();
    for (let t = 0; t < spec.ticks; t++) {
      const ctx = sim.prepare();
      if (!ctx) {
        sim.reset();
        continue; // generation restarted; tick budget still consumed
      }
      const outcome = await deps.decide(sim, ctx, config.deadlineMs);
      const result = sim.applyDecision(ctx, outcome);
      recorder.add(result);
    }
    recorder.finish(Date.now() - startedAt);

    runs.push({ spec, summary: recorder.summary(), records: recorder.records });
    done += 1;
  }

  return { runs, startedAt, finishedAt: new Date().toISOString() };
}
