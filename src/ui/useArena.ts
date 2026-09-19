import { useCallback, useEffect, useRef } from "react";
import { ArenaSimulation, type DecisionOutcome, type TickContext } from "../sim/simulation";
import { decideViaProxy, fetchKeyStatus, type DecideResult } from "../api";
import { useArenaStore, type ArenaUiState } from "./store";

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Config keys that require rebuilding the world; others apply live. */
const structuralKey = (s: ArenaUiState): string =>
  `${s.config.mode}|${s.config.agents}|${s.config.seed}`;

/**
 * Owns the ArenaSimulation instance and the real-time tick loop (plan §8):
 * snapshot → ONE async Jev request → deadline/stale gate → resolver →
 * execute → schedule next tick. Rendering happens in Board via rAF.
 */
export function useArena() {
  const simRef = useRef<ArenaSimulation>(null as unknown as ArenaSimulation);
  const runIdRef = useRef(0);
  const pausedRef = useRef(false);

  const decide = useCallback(
    async (sim: ArenaSimulation, ctx: TickContext, deadlineMs: number): Promise<DecisionOutcome> => {
      if (sim.config.mode === "random" || sim.config.mode === "rule") {
        return { kind: "local", policy: sim.config.mode };
      }
      let raw: DecideResult;
      try {
        raw = await decideViaProxy(ctx, sim.config.model, deadlineMs);
      } catch (err) {
        return {
          kind: "model",
          decision: null,
          stale: false,
          deadlineMissed: false,
          error: (err as Error).message,
        };
      }
      if (!raw.ok) {
        return {
          kind: "model",
          decision: null,
          stale: false,
          deadlineMissed: raw.reason === "timeout",
          // Stable code; the UI translates it into actionable guidance.
          error: raw.reason === "timeout" ? "deadline" : raw.message,
        };
      }
      return { kind: "model", decision: raw.decision, stale: false, deadlineMissed: false };
    },
    [],
  );

  useEffect(() => {
    let key = structuralKey(useArenaStore.getState());
    let mounted = true;

    const startLoop = () => {
      const s = useArenaStore.getState();
      simRef.current = new ArenaSimulation(s.config);
      s.clearResults();
      s.select(null);
      // Sync before the async loop starts: the store subscription is not yet
      // registered when the first iteration would otherwise run.
      pausedRef.current = s.paused || s.benchmarkRunning || !s.started;
      runIdRef.current += 1;
      const runId = runIdRef.current;
      void (async () => {
        while (mounted && runId === runIdRef.current) {
          if (pausedRef.current) {
            await wait(60);
            continue;
          }
          const sim = simRef.current;
          const ctx = sim.prepare();
          if (!ctx) {
            // Game over: hold the final position on screen. The overlay tells
            // the user to Reset for a new generation — no silent auto-restart.
            await wait(500);
            continue;
          }
          const started = performance.now();
          const outcome = await decide(sim, ctx, sim.config.deadlineMs);
          // The sim may have been replaced while the request was in flight
          // (Reset / mode / agents / seed change): discard the stale decision
          // instead of polluting the fresh run with a foreign tick.
          if (!mounted || runId !== runIdRef.current || simRef.current !== sim) {
            continue;
          }
          const result = sim.applyDecision(ctx, outcome);
          useArenaStore.getState().pushResult(result);
          const elapsed = performance.now() - started;
          await wait(Math.max(15, sim.config.tickMs - elapsed));
        }
      })();
    };

    startLoop();

    // One fetch to learn whether a key is configured; Jev modes gate on it.
    const pullKeyStatus = () => {
      fetchKeyStatus()
        .then((status) => useArenaStore.getState().setKeyStatus(status))
        .catch(() => {
          useArenaStore.getState().setKeyStatus(null);
          setTimeout(() => {
            if (mounted) {
              fetchKeyStatus()
                .then((status) => useArenaStore.getState().setKeyStatus(status))
                .catch(() => useArenaStore.getState().setKeyStatus(null));
            }
          }, 2000);
        });
    };
    pullKeyStatus();

    const unsub = useArenaStore.subscribe((s) => {
      pausedRef.current = s.paused || s.benchmarkRunning || !s.started;
      const k = structuralKey(s);
      if (k !== key) {
        key = k;
        startLoop();
      } else {
        Object.assign(simRef.current.config, {
          tickMs: s.config.tickMs,
          deadlineMs: s.config.deadlineMs,
          model: s.config.model,
        });
      }
    });

    return () => {
      mounted = false;
      runIdRef.current += 1;
      unsub();
    };
  }, [decide]);

  const reset = useCallback(() => {
    // Full restart of the world; the long-lived loop re-reads simRef each
    // tick, so replacing the instance is enough.
    simRef.current = new ArenaSimulation(useArenaStore.getState().config);
    useArenaStore.getState().clearResults();
    useArenaStore.getState().select(null);
  }, []);

  const chaos = useCallback(() => {
    simRef.current.chaos();
  }, []);

  const runBenchmark = useCallback(
    async (specs: Array<{ mode: "random" | "rule" | "jev_raw" | "jev_joint"; agents: number; ticks: number }>) => {
      const { runBenchmark: runBench } = await import("../benchmark/runner");
      const { recordsToJsonl } = await import("../benchmark/export");
      const cfg = useArenaStore.getState().config;
      useArenaStore.getState().setBenchmark({
        benchmarkRunning: true,
        benchmarkSummaries: [],
        benchmarkRecordsJsonl: "",
        benchmarkProgress: { done: 0, total: specs.length, label: "starting" },
      });
      try {
        const report = await runBench(
          specs.map((s) => ({ ...s, seed: cfg.seed })),
          {
            decide: (sim, ctx, deadlineMs) => decide(sim, ctx, deadlineMs),
            onProgress: (done, total, label) =>
              useArenaStore.getState().setBenchmark({ benchmarkProgress: { done, total, label } }),
          },
          { tickMs: cfg.tickMs, deadlineMs: cfg.deadlineMs, model: cfg.model },
        );
        const allRecords = report.runs.flatMap((r) => r.records);
        useArenaStore.getState().setBenchmark({
          benchmarkRunning: false,
          benchmarkProgress: null,
          benchmarkSummaries: report.runs.map((r) => r.summary),
          benchmarkRecordsJsonl: recordsToJsonl(allRecords),
        });
      } catch (err) {
        useArenaStore.getState().setBenchmark({ benchmarkRunning: false, benchmarkProgress: null });
        throw err;
      }
    },
    [decide],
  );

  return { simRef, reset, chaos, runBenchmark };
}
