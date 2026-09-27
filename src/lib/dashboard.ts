import type { KioskData, T3Session } from "../types"
export const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
export function modelName(raw: string): string {
  return raw.replace(/^.*\//, "").replace(/-(?:20\d{6}|latest)$/, "")
    .replace(/^gpt-/i, "GPT ").replace(/^claude-/i, "Claude ").replace(/^deepseek-v/i, "DeepSeek V").replace(/^deepseek-/i, "DeepSeek ").replace(/^glm-/i, "GLM ").replace(/^kimi-/i, "Kimi ").replace(/^k3-256k$/i, "Kimi K3").replace(/^step-/i, "Step ")
    .replace(/-/g, " ").replace(/\b(luna|sol|astra|flash|opus|sonnet|haiku|coding|preview)\b/gi, s => s[0].toUpperCase() + s.slice(1))
}
const COLORS = ["#80bdad", "#b6a1dd", "#e4b877", "#de91a2", "#88b9d6", "#b9c88c", "#bb9981"]
export function modelColor(raw: string): string {
  const model = raw.replace(/^.*\//, "").toLowerCase()
  if (/gpt-5.*luna/.test(model)) return "#619789"
  if (/gpt-5.*sol/.test(model)) return "#8c79ad"
  if (/gpt.*luna/.test(model)) return COLORS[0]
  if (/gpt.*sol/.test(model)) return COLORS[1]
  if (/gpt.*astra/.test(model)) return COLORS[4]
  if (/deepseek/.test(model)) return COLORS[2]
  if (/glm/.test(model)) return COLORS[3]
  if (/claude/.test(model)) return COLORS[5]
  if (/kimi|^k3/.test(model)) return COLORS[6]
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
