import type { TickContext } from "./sim/simulation";
import type { ModelDecision } from "./jev/types";

export type DecideResult =
  | { ok: true; decision: ModelDecision & { revision: number } }
  | { ok: false; reason: "timeout" }
  | { ok: false; reason: "error"; message: string };

export interface KeyStatus {
  hasKey: boolean;
  source: "runtime" | "env" | null;
  hint: string | null;
}

/** The key itself never round-trips back to the browser — only a mask. */
export async function fetchKeyStatus(): Promise<KeyStatus> {
  const res = await fetch("/api/key");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as KeyStatus;
}

export async function saveApiKey(key: string): Promise<KeyStatus> {
  const res = await fetch("/api/key", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as KeyStatus;
}

export async function clearApiKey(): Promise<KeyStatus> {
  const res = await fetch("/api/key", { method: "DELETE" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as KeyStatus;
}

/**
 * One Jev request for the whole tick (plan §5.1), raced against the decision
 * deadline. The server echoes our revision so stale responses are detectable.
 */
export async function decideViaProxy(
  ctx: TickContext,
  model: string,
  deadlineMs: number,
): Promise<DecideResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deadlineMs);
  try {
    const res = await fetch("/api/decide", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        state: ctx.sharedState,
        questions: ctx.questions,
        model,
        revision: ctx.revision,
        deadlineMs: deadlineMs + 150, // let the client deadline fire first
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return { ok: false, reason: "error", message: `HTTP ${res.status} ${detail.slice(0, 200)}` };
    }
    const data = (await res.json()) as ModelDecision & { revision: number };
    if (data.revision !== ctx.revision) {
      return { ok: false, reason: "error", message: "stale response (revision mismatch)" };
    }
    return { ok: true, decision: data };
  } catch (err) {
    if (controller.signal.aborted) return { ok: false, reason: "timeout" };
    return { ok: false, reason: "error", message: (err as Error).message };
  } finally {
    clearTimeout(timer);
  }
}
