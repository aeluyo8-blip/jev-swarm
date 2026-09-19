import { create } from "zustand";
import type { ArenaConfig, TickResult } from "../sim/simulation";
import type { RunSummary } from "../benchmark/metrics";
import type { Lang } from "./i18n";

const LANG_STORAGE_KEY = "jevswarm-lang";

const initialLang = (): Lang => {
  try {
    const saved = localStorage.getItem(LANG_STORAGE_KEY);
    return saved === "en" || saved === "zh" ? saved : "zh";
  } catch {
    return "zh";
  }
};

export interface ArenaUiState {
  config: ArenaConfig;
  lang: Lang;
  /** The arena does not run until the user presses Start. */
  started: boolean;
  paused: boolean;
  /** null = not fetched yet; false disables the Jev modes. */
  hasKey: boolean | null;
  keySource: "runtime" | "env" | null;
  keyHint: string | null;
  lastResult: TickResult | null;
  history: TickResult[];
  selectedAgentId: string | null;
  benchmarkRunning: boolean;
  benchmarkProgress: { done: number; total: number; label: string } | null;
  benchmarkSummaries: RunSummary[];
  benchmarkRecordsJsonl: string;
  setConfig: (patch: Partial<ArenaConfig>) => void;
  setLang: (lang: Lang) => void;
  setStarted: (started: boolean) => void;
  setPaused: (paused: boolean) => void;
  setKeyStatus: (status: { hasKey: boolean; source: "runtime" | "env" | null; hint: string | null } | null) => void;
  pushResult: (result: TickResult) => void;
  clearResults: () => void;
  select: (agentId: string | null) => void;
  setBenchmark: (patch: Partial<Pick<ArenaUiState, "benchmarkRunning" | "benchmarkProgress" | "benchmarkSummaries" | "benchmarkRecordsJsonl">>) => void;
}

const HISTORY_LIMIT = 120;

export const useArenaStore = create<ArenaUiState>((set) => ({
  config: {
    mode: "rule",
    agents: 10,
    seed: 42,
    tickMs: 250,
    deadlineMs: 1500,
    model: "jev-latest",
  },
  lang: initialLang(),
  started: false,
  paused: false,
  hasKey: null,
  keySource: null,
  keyHint: null,
  lastResult: null,
  history: [],
  selectedAgentId: null,
  benchmarkRunning: false,
  benchmarkProgress: null,
  benchmarkSummaries: [],
  benchmarkRecordsJsonl: "",
  setConfig: (patch) => set((s) => ({ config: { ...s.config, ...patch } })),
  setLang: (lang) => {
    try {
      localStorage.setItem(LANG_STORAGE_KEY, lang);
    } catch {
      /* private mode — language just won't persist */
    }
    set({ lang });
  },
  setStarted: (started) => set({ started }),
  setPaused: (paused) => set({ paused }),
  setKeyStatus: (status) =>
    set({
      hasKey: status ? status.hasKey : null,
      keySource: status ? status.source : null,
      keyHint: status ? status.hint : null,
    }),
  pushResult: (result) =>
    set((s) => ({
      lastResult: result,
      history: [...s.history.slice(-(HISTORY_LIMIT - 1)), result],
    })),
  clearResults: () => set({ lastResult: null, history: [] }),
  select: (selectedAgentId) => set({ selectedAgentId }),
  setBenchmark: (patch) => set(patch),
}));
