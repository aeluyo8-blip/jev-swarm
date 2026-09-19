import type { RelativeAction } from "../game/types.js";

/** A typed question sent to the model. One Choice per snake per tick. */
export interface QuestionSpec {
  id: string;
  type: "choice";
  instructions: string;
  criteria: Record<string, string | null>;
}

export interface ChoiceAnswer {
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
}

export interface ModelUsage {
  input_tokens: number;
  output_tokens: number;
}

export interface ModelDecision {
  model: string;
  answers: Record<string, ChoiceAnswer>;
  usage: ModelUsage;
  /** Client-measured round trip in milliseconds. */
  latencyMs: number;
}

export interface ModelRequest {
  state: unknown;
  questions: QuestionSpec[];
  model: string;
}

/**
 * World-agnostic model boundary (plan §14). The browser talks to a
 * FetchModelClient; the server implements the same interface with the
 * official SDK while keeping TYPESAFE_API_KEY private.
 */
export interface ModelClient {
  decide(request: ModelRequest, deadlineMs: number): Promise<ModelDecision>;
}

export const actionFromAnswer = (answer: ChoiceAnswer): RelativeAction =>
  answer.choice === "LEFT" || answer.choice === "RIGHT" ? answer.choice : "STRAIGHT";
