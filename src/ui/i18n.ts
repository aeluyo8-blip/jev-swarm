import { useArenaStore } from "./store";
import type { ArenaMode } from "../sim/simulation";
import type { RelativeAction, DeadEndRisk } from "../game/types";
import type { TelemetrySource } from "../sim/simulation";

export type Lang = "zh" | "en";

/** All UI strings, keyed by stable id. {curly} placeholders are interpolated. */
export const STRINGS = {
  tagline: {
    en: "One world. Ten agents. Ten judgments. One Jev call.",
    zh: "一个世界 · 十个智能体 · 十次判断 · 一次 Jev 调用",
  },
  langButton: { en: "中文", zh: "EN" },

  tileMode: { en: "Mode", zh: "模式" },
  tileAlive: { en: "Alive", zh: "存活" },
  tileFood: { en: "Food", zh: "食物" },
  tileLatency: { en: "Latency", zh: "延迟" },
  tileP5095: { en: "p50 / p95", zh: "p50 / p95" },
  tileQuestions: { en: "Questions/call", zh: "每次调用问题数" },
  tileTokens: { en: "Tokens in/out", zh: "Tokens 输入/输出" },
  tileRawConflicts: { en: "Raw conflicts", zh: "原始冲突" },
  tileCollisions: { en: "Collisions", zh: "碰撞死亡" },
  tileOverrides: { en: "Overrides", zh: "覆写次数" },
  tileOverrideRate: { en: "Override rate", zh: "覆写率" },
  tileDeadlineMiss: { en: "Deadline miss", zh: "截止超时" },
  tileStale: { en: "Stale", zh: "过期响应" },
  tileFallback: { en: "Fallback ticks", zh: "回退 tick" },
  tileTick: { en: "Tick", zh: "Tick" },

  decisionsThisTick: { en: "Decisions this tick", zh: "本 tick 决策" },
  feedEmpty: { en: "waiting for first tick…", zh: "等待第一个 tick…" },

  lensTitle: { en: "Decision Lens", zh: "决策透镜" },
  lensClear: { en: "clear", zh: "清除" },
  lensEmpty: { en: "click a snake on the board", zh: "点击棋盘上的蛇查看详情" },
  lensNoDist: { en: "no model distribution in this mode", zh: "当前模式无模型概率分布" },
  lensProposed: { en: "proposed (Jev top-1)", zh: "模型首选 (Jev top-1)" },
  lensExecuted: { en: "executed (resolver)", zh: "实际执行 (Resolver)" },
  lensOverrideReason: { en: "override reason", zh: "覆写原因" },
  lensConfidence: { en: "confidence", zh: "置信度" },
  lensTickLatency: { en: "tick {tick} · latency {latency}", zh: "tick {tick} · 延迟 {latency}" },

  featLegal: { en: "legal", zh: "合法" },
  featFoodDist: { en: "food dist", zh: "食物距离" },
  featFreeCells: { en: "free cells", zh: "可达空格" },
  featHeadDist: { en: "head dist", zh: "蛇头距离" },
  featRisk: { en: "risk", zh: "死路风险" },
  featConflictCand: { en: "conflict cand.", zh: "冲突候选" },
  featWallDist: { en: "wall dist", zh: "墙距" },

  controls: { en: "Controls", zh: "控制" },
  mode: { en: "Mode", zh: "模式" },
  agents: { en: "Agents", zh: "蛇数" },
  safety: { en: "Safety (Joint Resolver)", zh: "安全层(联合求解器)" },
  seed: { en: "Seed", zh: "种子" },
  tickMs: { en: "Tick ms", zh: "Tick 间隔(ms)" },
  deadlineMs: { en: "Deadline ms", zh: "决策截止(ms)" },
  pause: { en: "⏸ Pause", zh: "⏸ 暂停" },
  resume: { en: "▶ Resume", zh: "▶ 继续" },
  start: { en: "▶ Start", zh: "▶ 开始" },
  startOverlay: {
    en: "Press Start to run the arena",
    zh: "按「开始」运行对局",
  },
  jevNeedsKey: {
    en: "Jev modes need an API Key — paste it in the API Key section below",
    zh: "Jev 模式需要 API Key — 请在下方「API 密钥」处粘贴",
  },
  needsKeyShort: { en: "(needs key)", zh: "(需 Key)" },
  errDeadline: {
    en: "No response within the decision deadline — fell back. Raise Deadline ms in Controls (the TypeSafe round trip takes ~1s from typical networks).",
    zh: "决策截止时间内未收到响应 — 已回退。请在控制区调大「决策截止(ms)」(常规网络到 TypeSafe 的往返约需 1 秒)。",
  },
  reset: { en: "↺ Reset", zh: "↺ 重置" },
  chaos: { en: "⚡ Chaos", zh: "⚡ 突变" },

  benchmark: { en: "Benchmark", zh: "基准测试" },
  benchScaling: { en: "Scaling 1/2/5/10/20", zh: "规模测试 1/2/5/10/20" },
  benchCompare: { en: "Compare modes", zh: "模式对比" },
  benchRunning: { en: "running {done}/{total}: {label}", zh: "运行中 {done}/{total}:{label}" },
  benchExportCsv: { en: "Export summary CSV", zh: "导出汇总 CSV" },
  benchExportJsonl: { en: "Export ticks JSONL", zh: "导出逐 tick JSONL" },
  benchColMode: { en: "mode", zh: "模式" },
  benchColAgents: { en: "agents", zh: "蛇数" },
  benchColMiss: { en: "miss", zh: "超时" },
  benchColFood: { en: "food/min", zh: "食物/分" },
  benchColAlive: { en: "alive", zh: "存活" },
  benchColOvr: { en: "ovr%", zh: "覆写%" },

  overlayDead: { en: "All agents dead", zh: "全部蛇已死亡" },
  overlaySub: { en: "Tick {tick} · Reset to run a new generation", zh: "第 {tick} tick · 点击重置开始新一代" },
  boardHint: { en: "click a snake for Decision Lens · {agents} agents", zh: "点击蛇查看决策透镜 · {agents} 条蛇" },
  benchOverlay: { en: "Benchmark running — board paused", zh: "基准测试运行中,棋盘已暂停" },

  mode_random: { en: "Random", zh: "随机" },
  mode_rule: { en: "Rule / Greedy", zh: "规则 / 贪心" },
  mode_jev_raw: { en: "Jev Raw", zh: "Jev 原始输出" },
  mode_jev_joint: { en: "Jev Joint", zh: "Jev 联合求解" },

  action_LEFT: { en: "LEFT", zh: "左转" },
  action_STRAIGHT: { en: "STRAIGHT", zh: "直行" },
  action_RIGHT: { en: "RIGHT", zh: "右转" },

  risk_low: { en: "low", zh: "低" },
  risk_medium: { en: "medium", zh: "中" },
  risk_high: { en: "high", zh: "高" },

  illegal_wall: { en: "wall", zh: "撞墙" },
  illegal_body: { en: "body", zh: "撞蛇身" },
  illegal_obstacle: { en: "obstacle", zh: "障碍" },
  illegal_static: { en: "static", zh: "静态规则" },

  src_model: { en: "model", zh: "模型" },
  "src_model+resolver": { en: "model + resolver", zh: "模型 + 求解器" },
  src_random: { en: "random", zh: "随机" },
  src_rule: { en: "rule", zh: "规则" },
  src_fallback: { en: "fallback", zh: "回退" },

  apiKeyTitle: { en: "API Key", zh: "API 密钥" },
  apiKeyHint: {
    en: "Paste your TYPESAFE_API_KEY (get one at console.typesafe.ai/keys). It is kept in the local proxy's memory only — never written to disk; re-enter after a server restart.",
    zh: "粘贴 TYPESAFE_API_KEY(在 console.typesafe.ai/keys 获取)。仅保存在本地代理进程内存中,不写入磁盘;服务重启后需重新填写。",
  },
  apiKeyPlaceholder: { en: "paste API key…", zh: "粘贴 API Key…" },
  apiKeySave: { en: "Save", zh: "保存" },
  apiKeyClear: { en: "Clear", zh: "清除" },
  apiKeySet: { en: "configured {hint}", zh: "已配置 {hint}" },
  apiKeyEnv: { en: "configured via environment variable", zh: "已通过环境变量配置" },
  apiKeyMissing: { en: "not configured — Jev modes use fallback", zh: "未配置 — Jev 模式将使用回退" },
  apiKeyBad: { en: "save failed: {message}", zh: "保存失败:{message}" },
} as const;

export type StringKey = keyof typeof STRINGS;

export const format = (template: string, vars: Record<string, string | number>): string =>
  template.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`));

export type Translator = (key: StringKey, vars?: Record<string, string | number>) => string;

export function useT(): Translator {
  const lang = useArenaStore((s) => s.lang);
  return (key, vars) => {
    const template = STRINGS[key][lang];
    return vars ? format(template, vars) : template;
  };
}

export const modeKey = (mode: ArenaMode): StringKey => `mode_${mode}` as StringKey;

export const actionText = (action: RelativeAction, lang: Lang): string =>
  STRINGS[`action_${action}` as StringKey][lang];

export const riskText = (risk: DeadEndRisk, lang: Lang): string =>
  STRINGS[`risk_${risk}` as StringKey][lang];

export const illegalReasonText = (reason: string, lang: Lang): string =>
  STRINGS[`illegal_${reason}` as StringKey]?.[lang] ?? reason;

export const sourceText = (source: TelemetrySource, lang: Lang): string =>
  STRINGS[`src_${source}` as StringKey][lang];

/**
 * The raw override reasons come from the resolver (English constants);
 * translate the known shapes and pass anything else through untouched.
 */
export function reasonText(reason: string | null, lang: Lang): string | null {
  if (!reason) return null;
  if (reason.startsWith("conflict with snake_")) {
    const id = `S${Number(reason.slice("conflict with snake_".length))}`;
    return lang === "zh" ? `与 ${id} 冲突` : `conflict ${id}`;
  }
  if (reason.startsWith("head-swap with snake_")) {
    const id = `S${Number(reason.slice("head-swap with snake_".length))}`;
    return lang === "zh" ? `与 ${id} 换头` : `swap ${id}`;
  }
  const illegal = reason.match(/^illegal \((\w+)\)$/);
  if (illegal) {
    const why = illegalReasonText(illegal[1], lang);
    return lang === "zh" ? `非法(${why})` : why;
  }
  if (reason === "no valid joint action — fallback") {
    return lang === "zh" ? "无合法联合动作 — 回退" : "joint fallback";
  }
  if (reason === "model unavailable — fallback") {
    return lang === "zh" ? "模型不可用 — 回退" : "API fallback";
  }
  if (reason === "no legal action — doomed") {
    return lang === "zh" ? "无合法动作 — 必死" : "doomed (no legal action)";
  }
  if (reason === "constraint") {
    return lang === "zh" ? "约束" : "constraint";
  }
  return reason;
}
