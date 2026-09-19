import { Board } from "./ui/Board";
import { ControlPanel } from "./ui/ControlPanel";
import { MetricsPanel } from "./ui/MetricsPanel";
import { DecisionLens } from "./ui/DecisionLens";
import { useArena } from "./ui/useArena";
import type { ArenaMode } from "./sim/simulation";

export default function App() {
  const { simRef, reset, chaos, runBenchmark } = useArena();

  return (
    <div className="app">
      <main className="app-main">
        <Board simRef={simRef} />
      </main>
      <aside className="app-side">
        <MetricsPanel />
        <DecisionLens />
        <ControlPanel
          onReset={reset}
          onChaos={chaos}
          onBenchmark={(specs) =>
            void runBenchmark(specs as Array<{ mode: ArenaMode; agents: number; ticks: number }>)
          }
        />
      </aside>
    </div>
  );
}
