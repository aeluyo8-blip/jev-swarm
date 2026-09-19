import express from "express";
import { TypeSafeClient, choice } from "@typesafe-ai/sdk";
import type { ChoiceResponse, EntryType } from "@typesafe-ai/sdk";
import type { QuestionSpec } from "../src/jev/types.js";

// Load .env from the project root when present (Node >= 21).
try {
  process.loadEnvFile();
} catch {
  /* no .env file — rely on the ambient environment */
}

/**
 * Minimal API proxy (plan §10.1): the only job is to keep TYPESAFE_API_KEY
 * out of the browser bundle and forward one System-One request per tick.
 */
const PORT = Number(process.env.PORT ?? 8799);

/**
 * Runtime key entered from the UI. Kept in process memory only — never
 * written to disk, never sent back to the browser in full.
 */
let runtimeKey: string | null = null;
let cachedClient: TypeSafeClient | null = null;

const hasKey = () => Boolean(runtimeKey ?? process.env.TYPESAFE_API_KEY);

/** Lazy so a missing key surfaces as a clean 503 instead of a crashed proxy. */
function getClient(): TypeSafeClient {
  const apiKey = runtimeKey ?? process.env.TYPESAFE_API_KEY;
  if (!cachedClient) {
    cachedClient = apiKey ? new TypeSafeClient({ apiKey }) : new TypeSafeClient();
  }
  return cachedClient;
}

const maskKey = (key: string): string =>
  key.length > 10 ? `${key.slice(0, 6)}…${key.slice(-4)}` : "…";

const app = express();
app.use(express.json({ limit: "2mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, hasKey: hasKey() });
});

app.get("/api/key", (_req, res) => {
  res.json({
    hasKey: hasKey(),
    source: runtimeKey ? "runtime" : process.env.TYPESAFE_API_KEY ? "env" : null,
    hint: runtimeKey ? maskKey(runtimeKey) : null,
  });
});

app.post("/api/key", (req, res) => {
  const key = typeof req.body?.key === "string" ? req.body.key.trim() : "";
  if (!key) {
    res.status(422).json({ error: "key must be a non-empty string" });
    return;
  }
  runtimeKey = key;
  cachedClient = null; // rebuild the client with the new key on next use
  res.json({ hasKey: true, source: "runtime", hint: maskKey(key) });
});

app.delete("/api/key", (_req, res) => {
  runtimeKey = null;
  cachedClient = null;
  res.json({ hasKey: hasKey(), source: process.env.TYPESAFE_API_KEY ? "env" : null });
});

interface DecideBody {
  state: unknown;
  questions: QuestionSpec[];
  model?: string;
  deadlineMs?: number;
  /** Echoed back for stale-response detection on the client. */
  revision?: number;
}

app.post("/api/decide", async (req, res) => {
  const body = req.body as DecideBody;
  if (!body || !Array.isArray(body.questions) || body.questions.length === 0) {
    res.status(422).json({ error: "questions[] is required" });
    return;
  }

  const deadlineMs = Math.min(Math.max(body.deadlineMs ?? 10_000, 500), 30_000);
  if (!hasKey()) {
    res.status(503).json({
      error:
        "TYPESAFE_API_KEY is not configured on the server. Copy .env.example to .env, add your key from console.typesafe.ai/keys, and restart.",
    });
    return;
  }
  const client = getClient();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deadlineMs);

  // Questions arrive as an array; the API expects a map keyed by question id.
  const questionMap = Object.fromEntries(
    body.questions.map((q) => [q.id, choice(q.instructions, q.criteria)]),
  );

  const started = Date.now();
  try {
    const response = await client.systemOne(
      {
        state: body.state as EntryType,
        questions: questionMap,
        ...(body.model ? { model: body.model } : {}),
      },
      { signal: controller.signal },
    );
    const answers = Object.fromEntries(
      Object.entries(response.answers).flatMap(([id, answer]) => {
        if (answer.type !== "choice") return []; // all our questions are Choice
        const choiceAnswer = answer as ChoiceResponse;
        return [
          [
            id,
            {
              choice: choiceAnswer.choice,
              probabilities: { ...choiceAnswer.probabilities },
              confidence: choiceAnswer.confidence,
            },
          ],
        ];
      }),
    );
    res.json({
      model: response.model,
      answers,
      usage: {
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
      },
      latencyMs: Date.now() - started,
      revision: body.revision ?? null,
    });
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (controller.signal.aborted) {
      res.status(504).json({ error: "upstream deadline exceeded" });
    } else if (typeof status === "number") {
      res.status(status).json({
        error: (err as Error).message ?? "upstream error",
        status,
      });
    } else {
      res.status(502).json({ error: (err as Error).message ?? "upstream error" });
    }
  } finally {
    clearTimeout(timer);
  }
});

app.listen(PORT, "127.0.0.1", () => {
  console.log(`[jev-swarm] proxy listening on http://127.0.0.1:${PORT} (local only)`);
  if (!process.env.TYPESAFE_API_KEY) {
    console.warn("[jev-swarm] TYPESAFE_API_KEY is not set — Jev modes will fail. See .env.example");
  }
});
