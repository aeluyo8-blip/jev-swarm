import { useState } from "react";
import { useArenaStore } from "./store";
import { useT, modeKey } from "./i18n";
import { saveApiKey, clearApiKey } from "../api";
import type { ArenaMode } from "../sim/simulation";

const MODES: ArenaMode[] = ["random", "rule", "jev_raw", "jev_joint"];
const AGENT_OPTIONS = [1, 2, 5, 10, 20];

function ApiKeySection() {
  const t = useT();
  const hasKey = useArenaStore((s) => s.hasKey);
  const keySource = useArenaStore((s) => s.keySource);
  const keyHint = useArenaStore((s) => s.keyHint);
  const setKeyStatus = useArenaStore((s) => s.setKeyStatus);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!value.trim()) return;
    setBusy(true);
    setError(null);
    try {
      setKeyStatus(await saveApiKey(value.trim()));
      setValue("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    setBusy(true);
    setError(null);
    try {
      setKeyStatus(await clearApiKey());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  let stateLine: string;
  if (error) stateLine = t("apiKeyBad", { message: error });
  else if (hasKey && keySource === "runtime") stateLine = t("apiKeySet", { hint: keyHint ?? "" });
  else if (hasKey && keySource === "env") stateLine = t("apiKeyEnv");
  else stateLine = t("apiKeyMissing");

  return (
    <>
      <h2>{t("apiKeyTitle")}</h2>
      <p className="api-key-hint">{t("apiKeyHint")}</p>
      <div className="api-key-row">
        <input
          type="password"
          value={value}
          placeholder={t("apiKeyPlaceholder")}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void save();
          }}
          autoComplete="off"
        />
        <button onClick={() => void save()} disabled={busy || !value.trim()}>
          {t("apiKeySave")}
        </button>
        <button onClick={() => void clear()} disabled={busy || !hasKey || keySource === "env"}>
          {t("apiKeyClear")}
        </button>
      </div>
      <div className={"api-key-status" + (hasKey ? " ok" : " missing")}>{stateLine}</div>
    </>
  );
}

export function ControlPanel({
  onReset,
  onChaos,
  onBenchmark,
}: {
  onReset: () => void;
  onChaos: () => void;
  onBenchmark: (specs: Array<{ mode: ArenaMode; agents: number; ticks: number }>) => void;
}) {
  const t = useT();
  const config = useArenaStore((s) => s.config);
  const setConfig = useArenaStore((s) => s.setConfig);
  const started = useArenaStore((s) => s.started);
  const setStarted = useArenaStore((s) => s.setStarted);
  const paused = useArenaStore((s) => s.paused);
  const setPaused = useArenaStore((s) => s.setPaused);
  const hasKey = useArenaStore((s) => s.hasKey);
  const benchmarkRunning = useArenaStore((s) => s.benchmarkRunning);
  const benchmarkProgress = useArenaStore((s) => s.benchmarkProgress);
  const benchmarkSummaries = useArenaStore((s) => s.benchmarkSummaries);
  const benchmarkRecordsJsonl = useArenaStore((s) => s.benchmarkRecordsJsonl);

  const isJev = config.mode === "jev_raw" || config.mode === "jev_joint";
  const safetyOn = config.mode === "jev_joint";
  const jevAllowed = hasKey === true;
  // Benchmarks that include Jev modes are meaningless without a key.
  const canRunScaling = !benchmarkRunning && (!isJev || jevAllowed);
  const canRunCompare = !benchmarkRunning && jevAllowed;
  const liveControlsDisabled = benchmarkRunning;

  const toggleSafety = () => {
    if (!isJev) return;
    setConfig({ mode: safetyOn ? "jev_raw" : "jev_joint" });
  };

  const exportCsv = (csv: string, name: string) => {
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
  };

  return (
    <section className="panel">
      <h2>{t("controls")}</h2>

      <label className="row">
        <span>{t("mode")}</span>
        <select
          value={config.mode}
          onChange={(e) => setConfig({ mode: e.target.value as ArenaMode })}
          disabled={benchmarkRunning}
        >
          {MODES.map((m) => {
            const locked = m.startsWith("jev_") && !jevAllowed;
            return (
              <option key={m} value={m} disabled={locked}>
                {t(modeKey(m))}
                {locked ? ` ${t("needsKeyShort")}` : ""}
              </option>
            );
          })}
        </select>
      </label>
      {isJev && hasKey === false && <div className="error-note">⚠ {t("jevNeedsKey")}</div>}

      <label className="row">
        <span>{t("agents")}</span>
        <select
          value={config.agents}
          onChange={(e) => setConfig({ agents: Number(e.target.value) })}
          disabled={benchmarkRunning}
        >
          {AGENT_OPTIONS.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>

      <label className="row toggle" title="Joint Action Resolver (Jev modes only)">
        <span>{t("safety")}</span>
        <input type="checkbox" checked={safetyOn} disabled={!isJev || benchmarkRunning} onChange={toggleSafety} />
      </label>

      <div className="row-grid">
        <label className="row">
          <span>{t("seed")}</span>
          <input
            type="number"
            value={config.seed}
            min={0}
            onChange={(e) => setConfig({ seed: Math.max(0, Number(e.target.value) || 0) })}
            disabled={benchmarkRunning}
          />
        </label>
        <label className="row">
          <span>{t("tickMs")}</span>
          <input
            type="number"
            value={config.tickMs}
            min={80}
            step={10}
            onChange={(e) => setConfig({ tickMs: Math.max(80, Number(e.target.value) || 250) })}
          />
        </label>
        <label className="row">
          <span>{t("deadlineMs")}</span>
          <input
            type="number"
            value={config.deadlineMs}
            min={60}
            step={10}
            onChange={(e) => setConfig({ deadlineMs: Math.max(60, Number(e.target.value) || 1500) })}
          />
        </label>
      </div>

      <div className="btn-row">
        <button
          onClick={() => (started ? setPaused(!paused) : setStarted(true))}
          className={started ? "" : "btn-start"}
          disabled={liveControlsDisabled}
        >
          {!started ? t("start") : paused ? t("resume") : t("pause")}
        </button>
        <button onClick={onReset} disabled={liveControlsDisabled}>
          {t("reset")}
        </button>
        <button onClick={onChaos} disabled={liveControlsDisabled}>
          {t("chaos")}
        </button>
      </div>

      <h2>{t("benchmark")}</h2>
      <div className="btn-row">
        <button disabled={!canRunScaling} onClick={() =>
          onBenchmark(AGENT_OPTIONS.map((agents) => ({ mode: config.mode, agents, ticks: 120 })))
        }>
          {t("benchScaling")}
        </button>
        <button disabled={!canRunCompare} onClick={() =>
          onBenchmark(MODES.map((mode) => ({ mode, agents: config.agents, ticks: 120 })))
        }>
          {t("benchCompare")}
        </button>
      </div>
      {benchmarkRunning && benchmarkProgress && (
        <div className="benchmark-progress">
          {t("benchRunning", {
            done: benchmarkProgress.done + 1,
            total: benchmarkProgress.total,
            label: benchmarkProgress.label,
          })}
        </div>
      )}

      {benchmarkSummaries.length > 0 && (
        <>
          <table className="benchmark-table">
            <thead>
              <tr>
                <th>{t("benchColMode")}</th>
                <th>{t("benchColAgents")}</th>
                <th>p50</th>
                <th>p95</th>
                <th>{t("benchColMiss")}</th>
                <th>{t("benchColFood")}</th>
                <th>{t("benchColAlive")}</th>
                <th>{t("benchColOvr")}</th>
              </tr>
            </thead>
            <tbody>
              {benchmarkSummaries.map((s) => (
                <tr key={`${s.meta.mode}-${s.meta.agents}`}>
                  <td>{t(modeKey(s.meta.mode))}</td>
                  <td>{s.meta.agents}</td>
                  <td>{s.latencyP50Ms?.toFixed(0) ?? "–"}</td>
                  <td>{s.latencyP95Ms?.toFixed(0) ?? "–"}</td>
                  <td>{(s.deadlineMissRate * 100).toFixed(0)}%</td>
                  <td>{s.foodPerMinute.toFixed(1)}</td>
                  <td>{s.avgAlive.toFixed(1)}</td>
                  <td>{(s.overrideRate * 100).toFixed(0)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="btn-row">
            <button
              onClick={() => {
                void import("../benchmark/export").then(({ summariesToCsv, timestampSlug }) =>
                  exportCsv(
                    summariesToCsv(benchmarkSummaries),
                    `jev-swarm-summary-${timestampSlug()}.csv`,
                  ),
                );
              }}
            >
              {t("benchExportCsv")}
            </button>
            <button
              onClick={() => {
                const blob = new Blob([benchmarkRecordsJsonl], { type: "application/x-ndjson" });
                const a = document.createElement("a");
                a.href = URL.createObjectURL(blob);
                void import("../benchmark/export").then(({ timestampSlug }) => {
                  a.download = `jev-swarm-ticks-${timestampSlug()}.jsonl`;
                  a.click();
                });
              }}
            >
              {t("benchExportJsonl")}
            </button>
          </div>
        </>
      )}

      <ApiKeySection />
    </section>
  );
}
