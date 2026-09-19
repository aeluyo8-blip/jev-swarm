import { useArenaStore } from "./store";
import { useT, actionText, riskText, illegalReasonText, sourceText, reasonText, format } from "./i18n";
import { snakeColor, shortId } from "./colors";
import type { ActionFeaturesByAction, RelativeAction } from "../game/types";
import { RELATIVE_ACTIONS } from "../game/types";

const ACTIONS: RelativeAction[] = [...RELATIVE_ACTIONS];

function ProbabilityBars({
  probabilities,
  executed,
}: {
  probabilities: Record<RelativeAction, number> | null;
  executed: RelativeAction | null;
}) {
  const t = useT();
  const lang = useArenaStore((s) => s.lang);
  if (!probabilities) {
    return <div className="lens-muted">{t("lensNoDist")}</div>;
  }
  return (
    <div className="bars">
      {ACTIONS.map((a) => {
        const p = probabilities[a] ?? 0;
        return (
          <div className="bar-row" key={a}>
            <span className="bar-label">{actionText(a, lang)}</span>
            <div className="bar-track">
              <div
                className={"bar-fill" + (executed === a ? " bar-executed" : "")}
                style={{ width: `${Math.max(2, p * 100)}%` }}
              />
            </div>
            <span className="bar-value">{(p * 100).toFixed(1)}%</span>
          </div>
        );
      })}
    </div>
  );
}

function FeatureTable({ features }: { features: ActionFeaturesByAction }) {
  const t = useT();
  const lang = useArenaStore((s) => s.lang);
  const rows: Array<[string, (a: RelativeAction) => string]> = [
    [t("featLegal"), (a) => (features[a].legal ? "✓" : `✗ ${illegalReasonText(features[a].illegalReason ?? "static", lang)}`)],
    [t("featFoodDist"), (a) => String(features[a].foodDistanceAfterMove)],
    [t("featFreeCells"), (a) => String(features[a].reachableFreeCells)],
    [t("featHeadDist"), (a) => String(features[a].nearestOtherHead)],
    [t("featRisk"), (a) => riskText(features[a].deadEndRisk, lang)],
    [t("featConflictCand"), (a) => String(features[a].headConflictCandidates)],
    [t("featWallDist"), (a) => String(features[a].wallDistance)],
  ];
  return (
    <table className="feature-table">
      <thead>
        <tr>
          <th />
          {ACTIONS.map((a) => (
            <th key={a}>{actionText(a, lang)}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map(([label, get]) => (
          <tr key={label}>
            <td>{label}</td>
            {ACTIONS.map((a) => (
              <td key={a}>{get(a)}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function DecisionLens() {
  const t = useT();
  const lang = useArenaStore((s) => s.lang);
  const selectedAgentId = useArenaStore((s) => s.selectedAgentId);
  const last = useArenaStore((s) => s.lastResult);
  const select = useArenaStore((s) => s.select);

  const telemetry = last?.telemetry.find((tel) => tel.agentId === selectedAgentId);
  const agentId = selectedAgentId;
  const index = agentId ? Number(agentId.slice("snake_".length)) - 1 : null;

  return (
    <section className="panel">
      <h2>
        {t("lensTitle")}{" "}
        {agentId && (
          <button className="lens-clear" onClick={() => select(null)}>
            {t("lensClear")}
          </button>
        )}
      </h2>
      {!telemetry || agentId === null || index === null ? (
        <div className="lens-muted">{t("lensEmpty")}</div>
      ) : (
        <>
          <div className="lens-head">
            <span className="feed-dot" style={{ background: snakeColor(index) }} />
            <strong>{shortId(agentId)}</strong>
            <span className="lens-source">{sourceText(telemetry.source, lang)}</span>
          </div>

          <ProbabilityBars probabilities={telemetry.probabilities} executed={telemetry.executed} />

          <div className="lens-grid">
            <div>
              <div className="tile-key">{t("lensProposed")}</div>
              <div className="tile-value">{telemetry.proposed ? actionText(telemetry.proposed, lang) : "–"}</div>
            </div>
            <div>
              <div className="tile-key">{t("lensExecuted")}</div>
              <div className="tile-value">{actionText(telemetry.executed, lang)}</div>
            </div>
            <div className="lens-reason">
              <div className="tile-key">{t("lensOverrideReason")}</div>
              <div className="tile-value">{reasonText(telemetry.overrideReason, lang) ?? "—"}</div>
            </div>
            <div>
              <div className="tile-key">{t("lensConfidence")}</div>
              <div className="tile-value">
                {telemetry.confidence != null ? telemetry.confidence.toFixed(3) : "–"}
              </div>
            </div>
          </div>

          <FeatureTable features={telemetry.features} />
          <div className="lens-muted">
            {format(t("lensTickLatency"), {
              tick: last?.tick ?? "–",
              latency: last?.latencyMs != null ? `${Math.round(last.latencyMs)} ms` : "–",
            })}
          </div>
        </>
      )}
    </section>
  );
}
