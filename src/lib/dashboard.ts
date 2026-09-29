import type { KioskData, T3Session } from "../types"
export const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
export function modelName(raw: string): string {
  const claude = raw.replace(/^.*\//, "").match(/^claude-(opus|sonnet|haiku)-(\d+)-(\d+)(?:-\d{8})?$/i)
  if (claude) return `Claude ${claude[1][0].toUpperCase()}${claude[1].slice(1).toLowerCase()} ${claude[2]}.${claude[3]}`
  const claudeMajor = raw.replace(/^.*\//, "").match(/^claude-([a-z]+)-(\d+)(?:-\d{8})?$/i)
  if (claudeMajor) return `Claude ${claudeMajor[1][0].toUpperCase()}${claudeMajor[1].slice(1).toLowerCase()} ${claudeMajor[2]}`
  return raw.replace(/^.*\//, "").replace(/-(?:20\d{6}|latest)$/, "")
    .replace(/^gpt-/i, "GPT ").replace(/^claude-/i, "Claude ").replace(/^deepseek-v/i, "DeepSeek V").replace(/^deepseek-/i, "DeepSeek ").replace(/^glm-/i, "GLM ").replace(/^kimi-/i, "Kimi ").replace(/^k3-256k$/i, "Kimi K3").replace(/^step-/i, "Step ")
    .replace(/-/g, " ").replace(/\b(luna|sol|astra|flash|opus|sonnet|haiku|coding|preview)\b/gi, s => s[0].toUpperCase() + s.slice(1))
}
const COLORS = ["#76b9cb", "#ad92dc", "#e0ae69", "#dc8f9f", "#78aede", "#8dc195", "#d49b80"]
export function modelColor(raw: string): string {
  const model = raw.replace(/^.*\//, "").toLowerCase()
  if (/deepseek/.test(model)) return "#649be0"
  if (/gpt.*sol/.test(model)) return "#e6b15d"
  if (/gpt.*luna/.test(model)) return "#aa91df"
  if (/gpt.*astra/.test(model)) return "#78bdcc"
  if (/gpt.*terra/.test(model)) return "#c99373"
  if (/gpt.*daybreak/.test(model)) return "#7caedc"
  if (/claude.*opus/.test(model)) return "#de9679"
  if (/claude.*fable/.test(model)) return "#d68fa8"
  if (/claude.*sonnet/.test(model)) return "#e1a477"
  if (/claude.*haiku/.test(model)) return "#d9b975"
  if (/claude/.test(model)) return "#dba184"
  if (/glm/.test(model)) return "#9792de"
  if (/kimi|^k3/.test(model)) return "#8fb9cb"
  if (/mimo/.test(model)) return "#dfa174"
  if (/grok/.test(model)) return "#a3bbbc"
  if (/qwen/.test(model)) return "#b38bd8"
  if (/step/.test(model)) return "#80afe0"
  if (/longcat/.test(model)) return "#d3a16d"
  let hash = 0
  for (const c of model) hash = ((hash * 31) + c.charCodeAt(0)) >>> 0
  return COLORS[hash % COLORS.length]
}
export function modelRows(data: KioskData, today: string) {
  const map = new Map<string, { model: string; tokens: number; daily: Record<string, number> }>()
  for (const row of data.usage?.modelsDaily ?? data.activity.hub?.models ?? []) {
    const model = row.model.replace(/^.*\//, "")
    const current = map.get(model) ?? { model, tokens: 0, daily: {} }
    for (const [day, n] of Object.entries(row.daily)) current.daily[day] = (current.daily[day] ?? 0) + n
    current.tokens += row.daily[today] ?? 0
    map.set(model, current)
  }
  return [...map.values()].sort((a, b) => b.tokens - a.tokens || a.model.localeCompare(b.model))
}
export function sessionRank(s: T3Session) {
  if (s.lifecycle === "snoozed" || s.lifecycle === "woke") return 3
  if (["done", "input", "approval", "error", "woke"].includes(s.status)) return 0
  return s.status === "working" ? 1 : 2
}
export function orderSessions(sessions: T3Session[]) {
  return [...sessions].sort((a, b) => sessionRank(a) - sessionRank(b) || (b.completedAt ?? b.activityAt ?? 0) - (a.completedAt ?? a.activityAt ?? 0) || `${a.origin}:${a.id}`.localeCompare(`${b.origin}:${b.id}`))
}
export function elapsed(seconds: number | null | undefined, now: number) {
  if (!seconds) return "—"
  const m = Math.max(0, Math.floor((now / 1000 - seconds) / 60))
  return m < 1 ? "now" : m < 60 ? `${m}m` : m < 1440 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${Math.floor(m / 1440)}d`
}
