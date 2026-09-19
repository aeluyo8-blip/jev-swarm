import { useArenaStore } from "./store";
import { useT, modeKey, actionText, reasonText } from "./i18n";
import type { AgentTelemetry } from "../sim/simulation";
import { snakeColor } from "./colors";

const p50p95 = (values: number[]): { p50: number | null; p95: number | null } => {
  if (values.length === 0) return { p50: null, p95: null };
  const sorted = [...values].sort((a, b) => a - b);
  return {
    p50: sorted[Math.floor(sorted.length * 0.5)],
    p95: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))],
  };
};

function FeedLine({ t }: { t: AgentTelemetry }) {
  const lang = useArenaStore((s) => s.lang);
  const index = Number(t.agentId.slice("snake_".length));
  const color = snakeColor(index - 1);
  const pct =
    t.probabilities && t.proposed
      ? `${Math.round(t.probabilities[t.proposed] * 100)}%`
      : null;
  const reason = reasonText(t.overrideReason, lang);
  return (
    <div className="feed-line">
      <span className="feed-dot" style={{ background: color }} />
      <span className="feed-id">S{index}</span>
      <span className="feed-action">
        → {actionText(t.executed, lang)}
        {pct && t.executed === t.proposed ? ` ${pct}` : ""}
      </span>
      {reason && <span className="feed-override">↳ {reason}</span>}
    </div>
  );
}

export function MetricsPanel() {
  const t = useT();
  const setLang = useArenaStore((s) => s.setLang);
  const lang = useArenaStore((s) => s.lang);
  const last = useArenaStore((s) => s.lastResult);
  const history = useArenaStore((s) => s.history);
  const config = useArenaStore((s) => s.config);
  const hasKey = useArenaStore((s) => s.hasKey);
  const started = useArenaStore((s) => s.started);

  const isJev = config.mode === "jev_raw" || config.mode === "jev_joint";
  const showKeyWarning = isJev && hasKey === false && started;

  const latencies = history.map((r) => r.latencyMs).filter((v): v is number => v !== null);
  const { p50, p95 } = p50p95(latencies.slice(-100));
  const totalTicks = history.length || 1;
  const cum = history.reduce(
    (acc, r) => ({
      conflicts: acc.conflicts + (r.rawTop1Conflicts ? r.rawTop1Conflicts.sharedTarget + r.rawTop1Conflicts.headSwap : 0),
      collisions: acc.collisions + r.deaths.length,
      overrides: acc.overrides + r.overrides,
      missed: acc.missed + (r.deadlineMissed ? 1 : 0),
      stale: acc.stale + (r.stale ? 1 : 0),
      fallback: acc.fallback + (r.fallbackUsed ? 1 : 0),
    }),
    { conflicts: 0, collisions: 0, overrides: 0, missed: 0, stale: 0, fallback: 0 },
  );
  // Per DECISION actually made by the model: dead snakes make no decisions
  // and would dilute the override-rate diagnostic (plan §7.2).
  const aliveOnModelTicks = history.reduce(
    (acc, r) => acc + (r.fallbackUsed ? 0 : r.alive),
    0,
  );
  const overrideRate = cum.overrides / (aliveOnModelTicks || 1);

  const tiles: Array<[string, string]> = [
    [t("tileMode"), t(modeKey(config.mode))],
    [t("tileAlive"), String(last?.alive ?? config.agents) + "/" + config.agents],
    [t("tileFood"), String(last?.food ?? "–")],
    [t("tileLatency"), last?.latencyMs != null ? `${Math.round(last.latencyMs)} ms` : "–"],
    [t("tileP5095"), p50 != null && p95 != null ? `${Math.round(p50)} / ${Math.round(p95)} ms` : "–"],
    [t("tileQuestions"), last?.questionsPerCall ? String(last.questionsPerCall) : "–"],
    [t("tileTokens"), last?.usage ? `${last.usage.input_tokens}/${last.usage.output_tokens}` : "–"],
    [t("tileRawConflicts"), String(cum.conflicts)],
    [t("tileCollisions"), String(cum.collisions)],
    [t("tileOverrides"), String(cum.overrides)],
    [t("tileOverrideRate"), history.length ? `${(overrideRate * 100).toFixed(1)}%` : "–"],
    [t("tileDeadlineMiss"), history.length ? `${((cum.missed / totalTicks) * 100).toFixed(1)}%` : "–"],
    [t("tileStale"), String(cum.stale)],
    [t("tileFallback"), String(cum.fallback)],
    [t("tileTick"), String(last?.tick ?? 0)],
  ];

  return (
    <section className="panel">
      <div className="header">
        <div className="header-row">
          <h1>JEV SWARM</h1>
          <button className="lang-toggle" onClick={() => setLang(lang === "zh" ? "en" : "zh")}>
            {t("langButton")}
          </button>
        </div>
        <p className="tagline">{t("tagline")}</p>
      </div>
      <div className="tiles">
        {tiles.map(([k, v]) => (
          <div className="tile" key={k}>
            <div className="tile-key">{k}</div>
            <div className="tile-value">{v}</div>
          </div>
        ))}
      </div>
      <h2>{t("decisionsThisTick")}</h2>
      <div className="feed">
        {last?.telemetry
          .slice()
          .sort((a, b) => a.agentId.localeCompare(b.agentId))
          .map((tel) => <FeedLine key={tel.agentId} t={tel} />)}
        {!last && <div className="feed-empty">{t("feedEmpty")}</div>}
      </div>
      {showKeyWarning && <div className="error-note">⚠ {t("jevNeedsKey")}</div>}
      {last?.error && (
        <div className="error-note">
          {last.error === "deadline" ? `⚠ ${t("errDeadline")}` : `⚠ ${last.error}`}
        </div>
      )}
    </section>
  );
}
