const { app, BrowserWindow, ipcMain, screen, powerSaveBlocker, Menu, dialog } = require("electron")
const { spawn } = require("node:child_process")
const fs = require("node:fs")
const path = require("node:path")
const os = require("node:os")
const sessionData = require("./session-data.cjs")
const claudeUsage = require("./claude-usage.cjs")
const claudeQuota = require("./claude-quota.cjs")
const { readVisits } = require("./t3-read-state.cjs")
const quotaHistory = new Map()

const settings = require("./config.cjs")
process.env.PATH = settings.toolPath()
const { CodexUsage } = require("./codex-usage.cjs")
const loadedConfig = settings.loadConfig()
let config = loadedConfig.config
let quitting = false
const configPaths = settings.paths()
const headless = process.env.CLANKIOSK_HEADLESS === '1'
if (headless) { app.disableHardwareAcceleration(); if (process.platform === 'linux') app.commandLine.appendSwitch('ozone-platform', 'headless') }
fs.mkdirSync(path.join(configPaths.dataDir, 'electron'), { recursive: true, mode: 0o700 })
app.setName('Clankiosk')
app.setPath('userData', path.join(configPaths.dataDir, 'electron'))
if (process.argv.includes('--kiosk')) config.window.mode = 'kiosk'
if (process.argv.includes('--desktop')) config.window.mode = 'desktop'
let needsSetup = loadedConfig.setupRequired || process.argv.includes('--setup')

// ---------- state ----------
const state = {
  updatedAt: Date.now(),
  setupRequired: needsSetup,
  runtime: { mode: config.window.mode, t3Enabled: config.t3.enabled, sections: config.sections },
  providers: [],
  activity: {},
  opencode: { status: "unconfigured" },
  t3: { status: "unavailable", sessions: [] },
}
let hubUsage = null
let localClaudeUsage = null
let localCodexUsage = null
const codexUsageReader = new CodexUsage()
const isClaudeProvider = provider => ["anthropic", "claude"].includes(String(provider || "").toLowerCase())
const excludeHubModel = provider => isClaudeProvider(provider) ? config.usage.claude !== 'hub' : ['openai','codex'].includes(String(provider).toLowerCase()) ? config.usage.codex !== 'hub' : false
function rebuildUsage() {
  const primary = claudeUsage.mergeUsage(hubUsage, localCodexUsage)
  state.usage = claudeUsage.mergeUsage(primary, localClaudeUsage)
}
async function fetchLocalCodexUsage() {
  if (config.usage.codex !== 'local' || !config.codex.enabled) return
  try {
    localCodexUsage = await codexUsageReader.read(config.codex.home)
    state.activity.localCodex = { todayTokens: localCodexUsage.todayTokens, tokensLastHour: localCodexUsage.tokensLastHour, updatedAt: localCodexUsage.updatedAt }
  } catch { if (localCodexUsage) localCodexUsage.partial = true }
  rebuildUsage()
}

function codexBinary() { return settings.executable(config.codex.binary || 'codex') }

// ---------- Codex app-server MCP client ----------
class CodexAccount {
  constructor(account) {
    this.account = account
    this.proc = null
    this.pending = new Map()
    this.nextId = 1
    this.data = null
    this.usage = null
    this.buf = ""
    this.backoff = 5000
  }

  start() {
    if (quitting) return
    const bin = codexBinary()
    if (!bin) { this.data = { status: "error", detail: "codex binary not found" }; return }
    const env = { ...process.env }
    if (this.account.codexHome) env.CODEX_HOME = this.account.codexHome
    console.log(`[ai-kiosk] codex ${this.account.id}: spawning app-server (${bin})`)
    this.proc = spawn(bin, ["app-server", "--listen", "stdio://"], { env, stdio: ["pipe", "pipe", "pipe"] })
    this.proc.stdout.setEncoding("utf8")
    this.proc.stderr.setEncoding("utf8")
    this.proc.on('error', () => { this.data = { status:'error', detail:'Could not start Codex app-server' }; pushToRenderer() })
    this.proc.stderr.on("data", (d) => console.error(`[ai-kiosk] codex ${this.account.id} stderr:`, String(d).slice(0, 200)))
    this.proc.stdout.on("data", (chunk) => this.#onData(chunk))
    this.proc.on("exit", () => {
      this.proc = null
      if (quitting) return
      if (this.data?.status !== "unconfigured")
        this.data = { ...this.data, status: "error", detail: "app-server exited; retrying" }
      setTimeout(() => this.start(), this.backoff)
      this.backoff = Math.min(this.backoff * 2, 120000)
    })
    this.#rpc("initialize", { clientInfo: { name: "ai-kiosk", title: "AI Kiosk", version: "0.1.0" } })
      .then(() => { this.backoff = 5000; return this.refresh() })
      .catch((e) => console.error(`[ai-kiosk] codex ${this.account.id} init failed:`, String(e.message || e)))
  }

  #onData(chunk) {
    this.buf += chunk
    let idx
    while ((idx = this.buf.indexOf("\n")) >= 0) {
      const line = this.buf.slice(0, idx).trim()
      this.buf = this.buf.slice(idx + 1)
      if (!line) continue
      try {
        const msg = JSON.parse(line)
        if (msg.id != null && this.#waiters.has(msg.id)) {
          const { resolve, reject } = this.#waiters.get(msg.id)
          this.#waiters.delete(msg.id)
          if (msg.error) reject(new Error(msg.error.message || "rpc error"))
          else resolve(msg.result)
        }
      } catch {}
    }
  }

  #waiters = new Map()
  usageData = null

  #rpc(method, params, timeoutMs = 60000) {
    return new Promise((resolve, reject) => {
      if (!this.proc) return reject(new Error("not running"))
      const id = this.nextId++
      const timer = setTimeout(() => { this.#waiters.delete(id); reject(new Error("timeout")) }, timeoutMs)
      this.#waiters.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v) },
        reject: (e) => { clearTimeout(timer); reject(e) },
      })
      this.proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n")
    })
  }

  async refresh() {
    try {
      const rl = await this.#rpc("account/rateLimits/read", {})
      this.data = { status: "ok", rateLimits: rl, usage: this.usageData, capturedAt: Date.now() }
      pushToRenderer()
      // usage history is slow; never block the quota card on it
      this.usageData = this.usageData ?? null
      this.#rpc("account/usage/read", {}, 120000).then((usage) => {
        this.usageData = usage
        this.data = { status: "ok", rateLimits: rl, usage, capturedAt: this.data?.capturedAt }
        pushToRenderer()
      }).catch(() => {})
      console.log(`[ai-kiosk] codex ${this.account.id} refreshed: plan=${rl?.rateLimits?.planType} primary=${rl?.rateLimits?.primary?.usedPercent ?? "n/a"}%`)
      this.backoff = 5000
    } catch (e) {
      console.error(`[ai-kiosk] codex ${this.account.id} refresh failed:`, String(e.message || e))
      // If auth missing for this CODEX_HOME, mark unconfigured
      const msg = String(e.message || e)
      if (/not authenticated|no credentials|login/i.test(msg)) {
        this.data = { status: "unconfigured", detail: "No login in this CODEX_HOME yet" }
      } else {
        this.data = { status: "error", detail: msg.slice(0, 140) }
      }
    }
  }
}

function codexToCard(account, data) {
  const name = account.name || "Codex"
  const id = account.id
  const base = { id, name, sublabel: account.sublabel || undefined, icon: "codex" }
  if (!data || data.status === "loading") return { ...base, status: "loading", bars: [] }
  if (data.status === "unconfigured")
    return { ...base, status: "unconfigured", statusDetail: data.detail || "No login configured", bars: [] }
  if (data.status === "error")
    return { ...base, status: "error", statusDetail: data.detail, bars: [] }
  const rl = data.rateLimits?.rateLimits
  const bars = []
  // Tokens actually burned inside each rate-limit window, from the app-server's
  // daily buckets. The hub's day buckets and these are both local-day aligned.
  const consumedInWindow = (win) => {
    const buckets = data.usage?.dailyUsageBuckets
    if (!win?.resetsAt || !win?.windowDurationMins || !Array.isArray(buckets)) return null
    const startKey = localDateKey((win.resetsAt - win.windowDurationMins * 60) * 1000)
    return buckets.filter((b) => b.startDate >= startKey).reduce((a, b) => a + (b.tokens || 0), 0)
  }
  if (rl?.primary) {
    bars.push({
      label: rl.primary.windowDurationMins === 10080 ? "Weekly" : `Session (${Math.round(rl.primary.windowDurationMins / 60)}h)`,
      usedPct: rl.primary.usedPercent,
      resetsAt: rl.primary.resetsAt,
      consumedTokens: consumedInWindow(rl.primary),
      windowMins: rl.primary.windowDurationMins,
    })
  }
  if (rl?.secondary) {
    bars.push({
      label: rl.secondary.windowDurationMins === 10080 ? "Weekly" : `Session (${Math.round(rl.secondary.windowDurationMins / 60)}h)`,
      usedPct: rl.secondary.usedPercent,
      resetsAt: rl.secondary.resetsAt,
      consumedTokens: consumedInWindow(rl.secondary),
      windowMins: rl.secondary.windowDurationMins,
    })
  }
  const credits = rl ? data.rateLimits.rateLimitResetCredits : null
  const chips = []
  if (credits?.availableCount > 0) chips.push(`${credits.availableCount} reset credit${credits.availableCount > 1 ? "s" : ""}`)
  const lifetime = data.usage?.summary?.lifetimeTokens
  if (lifetime > 0) chips.push(fmtTokensShort(lifetime) + " lifetime")
  const plan = rl?.planType ? rl.planType.replace(/^./, (c) => c.toUpperCase()) : null
  return { ...base, status: "ok", plan, bars, chips, quotaGroup: "codex", weight: 1, updatedAt: data.capturedAt }
}

// ---------- OpenCodex hub (Mac) provider quotas ----------
const PROVIDER_META = {
  openai:   { id: "codex-pool", name: "Codex", icon: "codex", sublabel: "OpenCodex pool" },
  ollama:   { id: "ollama", name: "Ollama", icon: "ollama", sublabel: "Cloud" },
  "ollama-cloud": { id: "ollama", name: "Ollama", icon: "ollama", sublabel: "Cloud" },
  anthropic: { id: "anthropic", name: "Anthropic", icon: "anthropic", sublabel: "Claude" },
  claude:   { id: "anthropic", name: "Anthropic", icon: "anthropic", sublabel: "Claude" },
  kimi:     { id: "kimi", name: "Kimi", icon: "kimi", sublabel: "Coding plan" },
  stepfun:  { id: "stepfun", name: "StepFun", icon: "stepfun", sublabel: "Plan" },
  mimo:     { id: "xiaomi", name: "MiMo", icon: "xiaomi", sublabel: "Xiaomi" },
  xiaomi:   { id: "xiaomi", name: "MiMo", icon: "xiaomi", sublabel: "Xiaomi" },
  xai:      { id: "xai", name: "xAI Grok", icon: "xai", sublabel: "" },
}

function toSeconds(ts) {
  if (typeof ts !== "number") return null
  return ts > 1e12 ? Math.floor(ts / 1000) : ts
}

function localDateKey(ms) {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

function fmtTokensShort(n) {
  if (!Number.isFinite(n)) return "—"
  if (n >= 1e12) return (n / 1e12).toFixed(2) + "T"
  if (n >= 1e9) return (n / 1e9).toFixed(1) + "B"
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M"
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K"
  return String(Math.round(n))
}

// Token timeline: hourly buckets aggregated into LOCAL days so "today"
// rolls over at local midnight, plus a last-hour rate for the live counter.
async function fetchHubTimeline() {
  const hub = config.opencodex || {}
  const base = (hub.hubUrl || "").replace(/\/$/, "")
  if (!base || !hub.adminToken) return
  try {
    const t = await fetch(base + "/api/usage/timeline?hours=168&bucketMinutes=60&metric=total&grouping=model", {
      headers: { "x-opencodex-api-key": hub.adminToken },
      signal: AbortSignal.timeout(20000),
    })
    if (!t.ok) return
    const tl = await t.json()
    const perDay = new Map()
    const series = (tl.series || []).filter(sr => !(excludeHubModel(sr.provider)))
    const models = series.map((sr) => {
      const perDay2 = {}
      ;(sr.points || []).forEach((v, i) => {
        if (!v) return
        const ts = (tl.start + i * tl.bucketSeconds) * 1000
        const d = localDateKey(ts)
        perDay.set(d, (perDay.get(d) || 0) + v)
        perDay2[d] = (perDay2[d] || 0) + v
      })
      const week = Object.values(perDay2).reduce((a, b) => a + b, 0)
      return { provider: sr.provider, model: sr.model, week, daily: perDay2 }
    }).sort((a, b) => b.week - a.week)
    const daily = [...perDay.entries()].sort(([a], [b]) => a.localeCompare(b))
      .map(([date, tokens]) => ({ date, tokens }))
    const cutoff = Date.now() - 3600 * 1000
    let tokensLastHour = 0
    for (const sr of series) {
      (sr.points || []).forEach((v, i) => {
        if (!v) return
        const ts = (tl.start + i * tl.bucketSeconds) * 1000
        if (ts > cutoff && ts <= Date.now()) tokensLastHour += v
      })
    }
    state.activity.hub = {
      daily, models, tokensLastHour,
      todayTokens: perDay.get(localDateKey(Date.now())) || 0,
      updatedAt: Date.now(),
    }
  } catch {}
}

// Aggregate list-price cost, cache-hit rate, token mix and per-model breakdown
// from the hub's daily usage rows (/api/usage). All in the hub's day buckets,
// which are local-midnight aligned on the Mac.
async function fetchHubUsage() {
  const hub = config.opencodex || {}
  const base = (hub.hubUrl || "").replace(/\/$/, "")
  if (!base || !hub.adminToken) return
  try {
    const r = await fetch(base + "/api/usage?hours=168", {
      headers: { "x-opencodex-api-key": hub.adminToken },
      signal: AbortSignal.timeout(20000),
    })
    if (!r.ok) return
    const body = await r.json()
    const rawDays = body.days || []
    const hadClaudeRows = rawDays.some(d => (d.models || []).some(m => excludeHubModel(m.provider)))
    const days = hadClaudeRows ? rawDays.map(d => {
      const models = (d.models || []).filter(m => !excludeHubModel(m.provider))
      const sum = key => models.reduce((n, m) => n + (m[key] || 0), 0)
      return { date:d.date,models,totalTokens:sum('totalTokens'),inputTokens:sum('inputTokens'),
        outputTokens:sum('outputTokens'),cachedInputTokens:sum('cacheReadInputTokens'),
        cacheObservedInputTokens:sum('cacheObservedInputTokens'),
        estimatedCostUsd:sum('estimatedCostUsd'),
        unpricedRequests:sum('unpricedRequests'),pricedRequests:sum('pricedRequests'),
        unmeteredRequests:sum('unmeteredRequests') }
    }) : rawDays
    const modelMap = new Map()
    const modelsDaily = new Map()
    for (const d of days) {
      for (const m of d.models || []) {
        const key = m.provider + "/" + m.model
        const cur = modelMap.get(key) || {
          provider: m.provider, model: m.model, tokens: 0, inputTokens: 0,
          outputTokens: 0, costUsd: 0, cacheRead: 0, cacheObserved: 0, requests: 0,
        }
        cur.tokens += m.totalTokens || 0
        cur.inputTokens += m.inputTokens || 0
        cur.outputTokens += m.outputTokens || 0
        cur.costUsd += m.estimatedCostUsd || 0
        cur.cacheRead += m.cacheReadInputTokens || 0
        cur.cacheObserved += m.cacheObservedInputTokens || 0
        cur.requests += m.requests || 0
        modelMap.set(key, cur)
        const md = modelsDaily.get(key) || {}
        md[d.date] = (md[d.date] || 0) + (m.totalTokens || 0)
        modelsDaily.set(key, md)
      }
    }
    const models = [...modelMap.values()].map((m) => ({
      provider: m.provider,
      model: m.model,
      tokens: m.tokens,
      inputTokens: m.inputTokens,
      outputTokens: m.outputTokens,
      costUsd: m.costUsd,
      cacheHitRate: m.cacheObserved > 0 ? m.cacheRead / m.cacheObserved : null,
      requests: m.requests,
    })).sort((a, b) => b.tokens - a.tokens)
    const s = hadClaudeRows ? {
      estimatedCostUsd: days.reduce((n,d)=>n+(d.estimatedCostUsd||0),0),
      totalTokens: days.reduce((n,d)=>n+(d.totalTokens||0),0),
      inputTokens: days.reduce((n,d)=>n+(d.inputTokens||0),0),
      outputTokens: days.reduce((n,d)=>n+(d.outputTokens||0),0),
      cachedInputTokens: days.reduce((n,d)=>n+(d.cachedInputTokens||0),0),
      cacheObservedInputTokens: days.reduce((n,d)=>n+(d.cacheObservedInputTokens||0),0),
      reasoningOutputTokens: 0,
    } : body.summary || {}
    hubUsage = {
      updatedAt: Date.now(),
      pricingBasis: "configured",
      costUsd: s.estimatedCostUsd || 0,
      cacheHitRate: s.cacheObservedInputTokens > 0 ? (s.cachedInputTokens || 0) / s.cacheObservedInputTokens : null,
      tokensPerMin: (state.activity?.hub?.tokensLastHour || 0) / 60,
      totalTokens: s.totalTokens || 0,
      inputTokens: s.inputTokens || 0,
      outputTokens: s.outputTokens || 0,
      reasoningTokens: s.reasoningOutputTokens || 0,
      models,
      modelsDaily: [...modelsDaily.entries()].map(([key, daily]) => {
        const [provider, ...rest] = key.split("/")
        return { provider, model: rest.join("/"), daily }
      }),
      daily: days.map(sessionData.normalizeUsageDay),
    }
    rebuildUsage()
  } catch {}
}

async function fetchClaudeUsage() {
  if (!config.claude?.enabled || config.usage.claude !== 'local') return
  const database = config.claude.database || path.join(configPaths.dataDir, "claude-usage.sqlite")
  try {
    localClaudeUsage = await claudeUsage.readClaudeUsage(database, config.claude.expectedSources || [])
  } catch (e) {
    console.error("[ai-kiosk] Claude usage read failed:", String(e.message || e).slice(0, 120))
    if (localClaudeUsage) localClaudeUsage = { ...localClaudeUsage, partial:true }
  }
  if (!localClaudeUsage) localClaudeUsage = { daily:[], models:[], modelsDaily:[], todayTokens:0, tokensLastHour:0, partial:true }
  state.activity.claude = { todayTokens:localClaudeUsage.todayTokens, tokensLastHour:localClaudeUsage.tokensLastHour,
    updatedAt:localClaudeUsage.updatedAt || 0, partial:localClaudeUsage.partial }
  rebuildUsage()
}

async function fetchClaudeQuota() {
  if (!config.claude?.enabled || !config.claude.quota) return
  try {
    const card = await claudeQuota.readClaudeQuota()
    state.providers = state.providers.filter(p => p.id !== 'anthropic')
    state.providers.push(card)
  } catch (error) {
    const card = state.providers.find(p => p.id === 'anthropic')
    if (card?._claudeQuota) card.status = 'error'
    console.error('[ai-kiosk] Claude quota unavailable:', String(error.message || error).slice(0, 100))
  }
}

async function fetchOpencodeHub() {
  const hub = config.opencodex || {}
  const base = (hub.hubUrl || "").replace(/\/$/, "")
  if (!base || !hub.adminToken) {
    return
  }
  try {
    const r = await fetch(base + "/api/provider-quotas", {
      headers: { "x-opencodex-api-key": hub.adminToken },
      signal: AbortSignal.timeout(20000),
    })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    const body = await r.json()
    const reports = (body.reports || []).filter((rep) =>
      !(rep.provider === "openai" && state.providers.some((p) => p.id === "codex-1" && p.status === "ok")))
    // drop previous hub cards
    const ocxIds = new Set()
    for (const rep of reports) {
      const q = rep.quota || {}
      const meta = PROVIDER_META[rep.provider] || { id: rep.provider, name: rep.label || rep.provider, icon: "generic", sublabel: "via OpenCodex" }
      ocxIds.add(meta.id)
      const bars = []
      if (typeof q.fiveHourPercent === "number")
        bars.push({ label: "Session", usedPct: q.fiveHourPercent, resetsAt: toSeconds(q.fiveHourResetAt), windowMins: 300 })
      if (typeof q.weeklyPercent === "number")
        bars.push({ label: "Weekly", usedPct: q.weeklyPercent, resetsAt: toSeconds(q.weeklyResetAt), windowMins: 10080 })
      if (typeof q.monthlyPercent === "number")
        bars.push({ label: "Monthly", usedPct: q.monthlyPercent, resetsAt: toSeconds(q.monthlyResetAt) })
      for (const cw of q.customWindows || []) {
        if (typeof cw.percent !== "number") continue
        bars.push({ label: cw.label, usedPct: cw.percent, resetsAt: toSeconds(cw.resetAt), windowMins: cw.windowMinutes ?? (cw.windowSeconds ? cw.windowSeconds / 60 : null) })
      }
      if (q.creditsUsd && Number.isFinite(q.creditsUsd.percent)) {
        bars.push({
          label: "Monthly",
          usedPct: q.creditsUsd.percent,
          resetsAt: toSeconds(q.creditsUsd.expiresAt),
          note: q.creditsUsd.unlimited ? undefined : `$${Number(q.creditsUsd.used).toFixed(2)} of $${Number(q.creditsUsd.limit).toFixed(2)} used`,
        })
      }
      const card = {
        id: meta.id,
        name: meta.name,
        sublabel: meta.sublabel,
        icon: meta.icon,
        ...(rep.provider === 'openai' ? { quotaGroup:'codex' } : {}),
        status: "ok",
        bars: bars.slice(0, 3),
        chips: [],
        updatedAt: rep.updatedAt ? (toSeconds(rep.updatedAt) * 1000) : Date.now(),
        _hub: true,
      }
      const idx = state.providers.findIndex((p) => p.id === card.id)
      if (idx >= 0) state.providers[idx] = card
      else state.providers.push(card)
    }
    state.providers = state.providers.filter(p => !p._hub || ocxIds.has(p.id))
    state.providers = state.providers.filter((p) => p.id !== "ocx-hub")
    state.opencode = { status: "connected", url: base, detail: "OpenCodex hub" }
    // config-driven manual windows for quotas the hub cannot see
    for (const [provId, windows] of Object.entries(config.manualWindows || {})) {
      const card = state.providers.find((p) => p.id === provId)
      if (!card) continue
      for (const w of windows || []) {
        if (card.bars.some((b) => b.label === w.label)) continue
        let resetAt = null
        if (w.resetDay) {
          const now = new Date()
          resetAt = Math.floor(new Date(now.getFullYear(), now.getMonth(), w.resetDay, 0, 0, 0).getTime() / 1000)
          if (resetAt * 1000 <= Date.now()) {
            resetAt = Math.floor(new Date(now.getFullYear(), now.getMonth() + 1, w.resetDay, 0, 0, 0).getTime() / 1000)
          }
        }
        card.bars.push({ label: w.label, usedPct: w.usedPct ?? null, resetsAt: resetAt })
      }
    }
    // Additional Codex accounts reported by the hub
    try {
      const cq = await fetch(base + "/api/codex-auth/quota", {
        headers: { "x-opencodex-api-key": hub.adminToken },
        signal: AbortSignal.timeout(20000),
      })
      if (cq.ok) {
        const body2 = await cq.json()
        const extras = Object.entries(body2.quotas || {}).filter(([k]) => k !== "__main__")
        const codex2 = extras[0]
        const accountCfg = (config.codexAccounts || []).find((a) => a.id === "codex-2")
        if (codex2 && accountCfg) {
          const q = codex2[1]
          const idx = state.providers.findIndex((p) => p.id === "codex-2")
          const card = {
            id: "codex-2",
            name: accountCfg.name || "Codex",
            sublabel: accountCfg.sublabel || "second account",
            icon: "codex",
            status: "ok",
            plan: accountCfg.plan || "Plus",
            bars: [{ label: "Weekly", usedPct: q.weeklyPercent ?? null, resetsAt: toSeconds(q.weeklyResetAt), windowMins: 10080 }],
            chips: q.resetCredits > 0 ? [`${q.resetCredits} reset credit${q.resetCredits > 1 ? "s" : ""}`] : [],
            quotaGroup: "codex",
            weight: 0.05,
            updatedAt: q.updatedAt ? (toSeconds(q.updatedAt) * 1000) : Date.now(),
            _hub: true,
          }
          state.hubCodex2 = card
        }
      }
    } catch {}

    await fetchHubTimeline()
  } catch (e) {
    state.opencode = { status: "unreachable", url: base, detail: String(e.message || e).slice(0, 120) }
  }
}

// ---------- minors (config-driven) ----------
function minorsToCards() {
  for (const mn of config.minors || []) {
    const idx = state.providers.findIndex((p) => p.id === mn.id)
    const card = {
      id: mn.id,
      name: mn.name,
      plan: mn.plan || null,
      icon: mn.id,
      status: mn.resets ? "ok" : "unconfigured",
      statusDetail: mn.resets ? undefined : "No reset configured",
      bars: [],
      chips: mn.resets ? [`resets ${mn.resets}`] : [],
    }
    if (idx >= 0) state.providers[idx] = card
    else state.providers.push(card)
  }
  state.providers = state.providers.filter((p) => !p.id.startsWith("minor-"))
}

// ---------- opencode probe ----------
async function probeOpencode() {
  const hub = config.opencodex || {}
  const base = (hub.hubUrl || "").replace(/\/$/, "")
  if (!base) { state.opencode = { status: "unconfigured" }; return }
  try {
    const r = await fetch(base + "/healthz", { signal: AbortSignal.timeout(5000) })
    state.opencode = { status: r.ok ? "connected" : "unreachable", url: base }
  } catch {
    state.opencode = { status: "unreachable", url: base }
  }
}

// ---------- t3 sessions (local state DB, read-only) ----------
const T3_DB = config.t3.database
// ---------- forge pull requests ----------
// T3 owns PR associations; the forge only refreshes those exact records.
const forge = { at: 0, reposAt: 0, repos: [], cred: new Map(), tried: new Map(), byNumber: new Map(), byHead: new Map(), error: null }

function readGitCredential(host) {
  return new Promise((resolve) => {
    const child = spawn("git", ["credential", "fill"], { stdio: ["pipe", "pipe", "ignore"] })
    let out = ""
    const timer = setTimeout(() => child.kill("SIGKILL"), 6000)
    child.stdout.setEncoding("utf8")
    child.stdout.on("data", (d) => { out += d })
    child.on("error", () => { clearTimeout(timer); resolve(null) })
    child.on("close", () => {
      clearTimeout(timer)
      const user = (out.match(/^username=(.*)$/m) || [])[1]
      const pass = (out.match(/^password=(.*)$/m) || [])[1]
      resolve(user && pass ? { user, pass } : null)
    })
    child.stdin.end(`protocol=https\nhost=${host}\n\n`)
  })
}

async function forgeCredential(host) {
  const hit = forge.cred.get(host)
  if (hit && Date.now() - hit.at < 600000) return hit.value
  const value = await readGitCredential(host)
  forge.cred.set(host, { at: Date.now(), value })
  return value
}

async function forgeGet(repo, path) {
  const cred = await forgeCredential(repo.host)
  if (!cred) throw new Error("no credential for " + repo.host)
  const auth = "Basic " + Buffer.from(cred.user + ":" + cred.pass).toString("base64")
  const r = await fetch(repo.base + path, { headers: { authorization: auth, accept: "application/json" }, signal: AbortSignal.timeout(15000) })
  if (!r.ok) throw new Error("forge " + r.status)
  return r.json()
}

// Snoozed rows retain their lifecycle; settled threads are counted separately.
const T3_ROWS_SQL = sessionData.ROWS_SQL
const T3_STATS_SQL = sessionData.STATS_SQL
const t3SourceCache = new Map()
let refreshingT3 = false

function projectInitials(name) {
  const words = String(name || "?").trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return "?"
  const chars = words.length >= 2 ? words[0][0] + words[1][0] : String(words[0]).slice(0, 2)
  return chars.toUpperCase()
}

function t3Query(sql = T3_ROWS_SQL, database = T3_DB) {
  return new Promise((resolve) => {
    const child = spawn(settings.executable('sqlite3') || 'sqlite3', ["-json", `file:${database}?mode=ro`, sql], { stdio: ["ignore", "pipe", "pipe"] })
    let out = "", err = ""
    const timer = setTimeout(() => child.kill("SIGKILL"), 8000)
    child.stdout.setEncoding("utf8")
    child.stderr.setEncoding("utf8")
    child.stdout.on("data", (d) => { out += d })
    child.stderr.on("data", (d) => { err += d })
    child.on("error", (e) => { clearTimeout(timer); resolve({ error: String(e.message || e) }) })
    child.on("close", (code) => {
      clearTimeout(timer)
      if (code !== 0) return resolve({ error: (err || `exit ${code}`).slice(0, 140) })
      try { resolve({ rows: JSON.parse(out || "[]") }) }
      catch { resolve({ error: "unreadable sqlite output" }) }
    })
  })
}

async function refreshT3() {
  if (!config.t3.enabled || refreshingT3) return
  refreshingT3 = true
  try {
    const remotes = config.t3.remotes
    const jobs = [t3Load(localHostName(), t3Query, sql => t3Query(sql, path.join(os.homedir(), '.codex/state_5.sqlite')))]
    for (const rem of remotes) if (rem?.host) jobs.push(t3Load(rem.label, sql => t3RemoteQuery(rem.host, sql), sql => t3RemoteQuery(rem.host, sql, '.codex/state_5.sqlite')))
    const macRemote = remotes.find(rem => rem?.host && rem.label?.toLowerCase() === "mac")
    const focusJob = process.platform === "darwin" ? localMacFrontmost() : macRemote ? t3RemoteFrontmostBundleId(macRemote.host) : Promise.resolve(null)
    const readStateConfig = config.t3.readState
    const visitsJob = readVisits({ ...readStateConfig, identityFile: readStateConfig.identityFile ?? config.t3?.sshIdentityFile }).then(visits => ({ visits }), () => ({ visits: {}, error: true }))
    const [results, readState, frontmostBundleId] = await Promise.all([Promise.allSettled(jobs), visitsJob, focusJob])
    const sessions = [], errors = [], sources = []
    let snoozed = 0, settledCount = 0, successes = 0
    if (readState.error) errors.push("T3 read state unavailable")
    for (const result of results) {
      if (result.status !== "fulfilled") { errors.push("T3 source failed"); continue }
      const { origin, rows, stats, statsError, agents, agentNames, error } = result.value
      if (!error) {
        const mapped = sessionData.mapRows(rows, origin, Date.now(), readState.visits)
        sessionData.attachAgents(mapped, agents)
        for (const session of mapped) for (const agent of session.agents) {
          const known = agentNames.find(a => a.id === agent.id)
          if (known) { agent.name = known.name || agent.name; agent.model = known.model || agent.model }
        }
        t3SourceCache.set(origin, { sessions: mapped, stats: statsError ? (t3SourceCache.get(origin)?.stats || {}) : stats, updatedAt: Date.now() })
        successes++
      } else errors.push(`${origin}: unavailable`)
      const cached = t3SourceCache.get(origin)
      if (!cached) continue
      sessions.push(...cached.sessions.map(s => ({ ...s, stale: !!error, staleAt: error ? cached.updatedAt : undefined })))
      snoozed += cached.stats.snoozed || 0
      settledCount += cached.stats.settled || 0
      sources.push({ origin, updatedAt: cached.updatedAt, stale: !!error })
    }
    state.t3 = { status: successes > 0 ? "ok" : "unavailable", detail: errors.join("; ") || undefined,
      sessions, stats: { snoozed, settled: settledCount }, sources,
      macT3Focused: frontmostBundleId == null ? undefined : frontmostBundleId === "com.t3tools.t3code",
      updatedAt: successes > 0 ? Date.now() : state.t3.updatedAt }
    attachForgePrs(sessions)
  } finally { refreshingT3 = false }
}

// Enrichment cannot create associations from titles or reused branch names.
function attachForgePrs(sessions) {
  for (const s of sessions) s.prs = (s.prs || []).map(pr => ({ ...pr, ...(forge.byNumber.get(sessionData.prIdentity(pr)) || {}) }))
}

// The repositories to ask about, taken from the pull request rows t3 already
// has on record: the same repository serves both this machine and the mac.
async function forgeRepositories() {
  const rows = []
  const REPOS_SQL = `SELECT DISTINCT pr.repository,pr.url,p.title AS project FROM projection_thread_pull_requests pr JOIN projection_threads t ON t.thread_id=pr.thread_id JOIN projection_projects p ON p.project_id=t.project_id WHERE pr.url IS NOT NULL AND pr.url <> ''`
  const grab = async (run) => {
    const res = await run(REPOS_SQL)
    ;(res && res.rows ? res.rows : []).forEach((r) => rows.push(r))
  }
  await Promise.allSettled([
    grab((sql) => t3Query(sql)),
    ...((config.t3.remotes).filter((r) => r?.host)
      .map((r) => grab((sql) => t3RemoteQuery(r.host, sql)))),
  ])
  const repos = new Map()
  for (const r of rows) {
    const m = String(r.url).match(/^(https?:\/\/[^/]+)\/([^/]+)\/([^/]+?)(?:\.git)?\/pulls?\//)
    if (!m) continue
    const host = m[1].replace(/^https?:\/\//, "")
    const key = `${host}/${m[2]}/${m[3]}`.toLowerCase()
    const existing = repos.get(key)
    if (existing) { if (!existing.projects.includes(r.project)) existing.projects.push(r.project) }
    else repos.set(key, { base: m[1], host, owner: m[2], name: m[3], projects: [r.project] })
  }
  return [...repos.values()]
}

let refreshingForge = false
async function forgeRefresh() {
  if (!config.t3.enabled || !config.forge.enabled || refreshingForge) return
  refreshingForge = true
  try {
    if (Date.now() - forge.reposAt > 900000) {
      forge.repos = await forgeRepositories()
      forge.reposAt = Date.now()
    }
    const byNumber = new Map(forge.byNumber), byHead = new Map(), enrichment = []
    for (const repo of forge.repos) {
      const prefix = `${repo.host}/${repo.owner}/${repo.name}`.toLowerCase()
      const base = `/api/v1/repos/${repo.owner}/${repo.name}`
      const response = await forgeGet(repo, `${base}/pulls?state=all&limit=50&sort=recentupdate`)
      const raws = Array.isArray(response) ? response : []
      const wanted = new Set()
      for (const s of state.t3?.sessions || []) {
        for (const p of s.prs || []) if ((p.host || '').toLowerCase() === repo.host.toLowerCase() && (p.repository || '').toLowerCase() === `${repo.owner}/${repo.name}`.toLowerCase()) wanted.add(p.number)
      }
      for (const n of [...wanted].filter(n => !raws.some(p => p.number === n)).slice(0, 12)) {
        try { const raw = await forgeGet(repo, `${base}/pulls/${n}`); if (raw?.number) raws.push(raw) } catch {}
      }
      for (const raw of raws) {
        const pr = sessionData.normalizeForgePr(raw, repo), key = sessionData.prIdentity(pr)
        const previous = byNumber.get(key)
        if (previous?.headSha === pr.headSha) { pr.ci = previous.ci; pr.review = previous.review }
        byNumber.set(key, pr)
        const branch = raw.head?.ref
        if (branch && !branch.startsWith('refs/pull/')) {
          const key = `${prefix}:${branch}`, list = byHead.get(key) || []; list.push(pr); byHead.set(key,list)
        }
        const related = wanted.has(pr.number)
        if (related) enrichment.push(async () => {
          const results = await Promise.allSettled([
            pr.headSha ? forgeGet(repo, `${base}/commits/${encodeURIComponent(pr.headSha)}/status?limit=100`) : Promise.reject(new Error('No head SHA')),
            forgeGet(repo, `${base}/pulls/${pr.number}/reviews?limit=100`),
          ])
          if (results[0].status === 'fulfilled') pr.ci = sessionData.normalizeChecks(results[0].value)
          else if (!pr.ci) pr.ci = sessionData.normalizeChecks(null)
          if (results[1].status === 'fulfilled') pr.review = sessionData.normalizeReviews(results[1].value)
          else if (!pr.review) pr.review = 'unknown'
        })
      }
    }
    for (let i = 0; i < enrichment.length; i += 4) await Promise.all(enrichment.slice(i,i+4).map(f=>f()))
    forge.byNumber = byNumber; forge.byHead = byHead; forge.at = Date.now(); forge.error = null
  } catch (e) { forge.error = String(e.message || e); writeForgeNote(forge.error) }
  finally { refreshingForge = false }
}

function writeForgeNote(m) {
  try { fs.appendFileSync(path.join(configPaths.dataDir, 'forge.log'), new Date().toISOString() + " " + m + "\n") } catch {}
}

// Read projections and provider-assigned subagent names; missing names are optional.
async function t3Load(origin, run, runCodex) {
  const [rowsRes, statsRes, agentsRes, namesRes] = await Promise.all([run(T3_ROWS_SQL), run(T3_STATS_SQL), run(sessionData.AGENTS_SQL),
    runCodex ? runCodex('SELECT id,agent_nickname AS name,model FROM threads WHERE agent_nickname IS NOT NULL') : Promise.resolve({rows:[]})])
  return {
    origin,
    agents: agentsRes?.rows || [],
    agentNames: namesRes?.rows || [],
    rows: (rowsRes && rowsRes.rows) || [],
    stats: (statsRes && statsRes.rows && statsRes.rows[0]) || {},
    statsError: statsRes?.error,
    // Session rows are authoritative; a failed count query must not invalidate them.
    error: rowsRes?.error,
  }
}

function t3RemoteQuery(host, sql = T3_ROWS_SQL, relativeDb = '.t3/userdata/state.sqlite') {
  return new Promise((resolve) => {
    const b64 = Buffer.from(sql).toString("base64")
    const remoteCmd = `echo ${b64} | base64 -d | sqlite3 -json "file:$HOME/${relativeDb}?mode=ro"`
    const args = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=6", "-o", "StrictHostKeyChecking=accept-new"]
    if (config.t3?.sshIdentityFile) args.push("-i", config.t3.sshIdentityFile, "-o", "IdentitiesOnly=yes")
    const child = spawn("ssh", [...args, host, remoteCmd], { stdio: ["ignore", "pipe", "pipe"] })
    let out = "", err = ""
    const timer = setTimeout(() => child.kill("SIGKILL"), 15000)
    child.stdout.setEncoding("utf8")
    child.stderr.setEncoding("utf8")
    child.stdout.on("data", (d) => { out += d })
    child.stderr.on("data", (d) => { err += d })
    child.on("error", (e) => { clearTimeout(timer); resolve({ error: String(e.message || e) }) })
    child.on("close", (code) => {
      clearTimeout(timer)
      if (code !== 0) return resolve({ error: (err || `exit ${code}`).slice(0, 140) })
      try { resolve({ rows: JSON.parse(out || "[]") }) }
      catch { resolve({ error: "unreadable sqlite output" }) }
    })
  })
}

function t3RemoteFrontmostBundleId(host) {
  return new Promise((resolve) => {
    const args = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=3", "-o", "StrictHostKeyChecking=accept-new"]
    if (config.t3?.sshIdentityFile) args.push("-i", config.t3.sshIdentityFile, "-o", "IdentitiesOnly=yes")
    const remoteCmd = 'asn=$(lsappinfo front 2>/dev/null) && lsappinfo info -only bundleID "$asn" 2>/dev/null'
    const child = spawn("ssh", [...args, host, remoteCmd], { stdio: ["ignore", "pipe", "ignore"] })
    let out = ""
    const timer = setTimeout(() => child.kill("SIGKILL"), 5000)
    child.stdout.setEncoding("utf8")
    child.stdout.on("data", d => { out += d })
    child.on("error", () => { clearTimeout(timer); resolve(null) })
    child.on("close", code => {
      clearTimeout(timer)
      const match = code === 0 && out.match(/bundleID="([^"]+)"/)
      resolve(match ? match[1] : null)
    })
  })
}

function localHostName() { return config.t3.label || (process.platform === 'darwin' ? 'mac' : 'linux') }
function localMacFrontmost() {
  return new Promise(resolve => {
    const { execFile } = require('node:child_process')
    execFile('/usr/bin/lsappinfo', ['front'], { timeout: 2000 }, (error, asn) => {
      if (error) return resolve(null)
      execFile('/usr/bin/lsappinfo', ['info','-only','bundleID',asn.trim()], { timeout: 2000 }, (error, output) => resolve(error ? null : output.match(/bundleID="([^"]+)"/)?.[1] || null))
    })
  })
}

// ---------- orchestration ----------
const codexAccounts = []

function buildSnapshot() {
  const accountIds = new Set(config.codexAccounts.map(account => account.id))
  state.providers = state.providers.filter(p => !accountIds.has(p.id) && (!p.id.startsWith('codex') || p._hub))
  const cards = []
  for (const acc of config.codex.enabled ? config.codexAccounts : []) {
    const inst = codexAccounts.find((c) => c.account.id === acc.id)
    if (acc.id === "codex-2" && state.hubCodex2) {
      cards.push(state.hubCodex2)
      continue
    }
    const data = inst?.data
      ? inst.data
      : acc.id === "codex-1"
        ? { status: "loading" }
        : { status: "unconfigured", detail: "No local login and not in the hub pool" }
    cards.push(codexToCard(acc, data))
  }
  state.providers = [...cards, ...state.providers]
  // config-driven minor cards only where the hub has nothing
  for (const mn of config.minors || []) {
    if (state.providers.some((p) => p.id === mn.id)) continue
    state.providers.push({
      id: mn.id, name: mn.name, plan: mn.plan || null, icon: mn.id,
      status: mn.resets ? "ok" : "unconfigured",
      statusDetail: mn.resets ? undefined : "No reset configured",
      bars: [], chips: mn.resets ? [`resets ${mn.resets}`] : [],
    })
  }
  for (const provider of state.providers) sessionData.recordQuota(quotaHistory, provider)
  state.updatedAt = Date.now()
}

function collectOnce() {
  const jobs = []
  jobs.push(fetchOpencodeHub())
  jobs.push(probeOpencode())
  return Promise.allSettled(jobs)
}

function startData() {
  for (const acc of config.codex.enabled ? config.codexAccounts : []) {
    if (!acc.codexHome) continue // needs explicit CODEX_HOME (except default account below)
    const inst = new CodexAccount(acc)
    codexAccounts.push(inst)
    inst.start()
  }
  // The first account uses the default ~/.codex
  const first = config.codex.enabled && config.codexAccounts?.[0]
  if (first && !first.codexHome) {
    const inst = new CodexAccount({ ...first, codexHome: null })
    codexAccounts.push(inst)
    inst.start()
  }
  buildSnapshot()

  const iv = setInterval(async () => {
    for (const inst of codexAccounts) inst.refresh().catch(() => {})
    await collectOnce()
    buildSnapshot()
    pushToRenderer()
  }, (config.pollSeconds || 300) * 1000)

  // lighter heartbeat to refresh countdowns / opencode status
  setInterval(async () => {
    await probeOpencode()
    buildSnapshot()
    pushToRenderer()
  }, 60000)
  // Session status is a separate, frequent lane; refreshT3 prevents overlap.
  refreshT3().then(() => pushToRenderer())
  setInterval(() => { refreshT3().then(() => pushToRenderer()) }, 3000)
  // forge pull requests: a couple of requests a minute at most, and PR state
  // moves slowly, so this lane is deliberately lazy and re-runs t3 afterwards
  forgeRefresh().then(() => refreshT3()).then(() => pushToRenderer()).catch(() => {})
  setInterval(() => { forgeRefresh().then(() => refreshT3()).then(() => pushToRenderer()).catch(() => {}) }, 120000)
  // initial async collect
  collectOnce().then(() => { buildSnapshot(); pushToRenderer() })
  // Live token lane: the hub timeline is ~5 KB and answers in ~10 ms, so poll it
  // once a second and push a tick. The odometer then follows real consumption
  // instead of extrapolating a rate that was last measured 45s ago.
  // Main-process stdout stops reaching the journal a few seconds after start
  // (the journald socket goes quiet), so failures here go to a file instead.
  const noteLaneFailure = (m) => { try { fs.appendFileSync(path.join(configPaths.dataDir, 'token-lane.log'), new Date().toISOString() + " " + m + "\n") } catch {} }
  const tokenLane = async () => {
    try {
      await fetchHubTimeline()
      if (state.usage) state.usage.tokensPerMin = ((state.activity?.hub?.tokensLastHour || 0) + (state.activity?.claude?.tokensLastHour || 0) + (state.activity?.localCodex?.tokensLastHour || 0)) / 60
      pushTick()
    } catch (e) {
      noteLaneFailure(String((e && e.message) || e))
    }
  }
  tokenLane()
  setInterval(tokenLane, 1000)
  // The heavier aggregate (cost, cache, per-model detail, ~54 KB) stays slow.
  const usageLane = async () => { await Promise.all([fetchHubUsage(), fetchLocalCodexUsage()]); buildSnapshot(); pushToRenderer() }
  usageLane()
  setInterval(usageLane, 60000)
  let codexReading = false
  setInterval(async () => { if (codexReading) return; codexReading = true; try { await fetchLocalCodexUsage(); pushTick(); pushToRenderer() } finally { codexReading = false } }, 10000)
  if (config.claude?.enabled) {
    const claudeLane = async () => { await fetchClaudeUsage(); pushTick(); pushToRenderer() }
    claudeLane()
    setInterval(claudeLane, 5000)
    const claudeQuotaLane = async () => { await fetchClaudeQuota(); buildSnapshot(); pushToRenderer() }
    claudeQuotaLane()
    setInterval(claudeQuotaLane, 120000)
  }
  setInterval(() => { for (const inst of codexAccounts) if (inst.data?.status === "ok") { /* keep-alive */ } }, 60000)
}

let win = null
let cursorGuard = null

function startCursorGuard() {
  if (config.window.mode !== "kiosk" || process.platform !== "linux" || !win || win.isDestroyed() || cursorGuard) return
  let windowId
  try {
    const handle = win.getNativeWindowHandle()
    windowId = handle.length >= 8 ? handle.readBigUInt64LE(0) & 0xffffffffn : BigInt(handle.readUInt32LE(0))
  } catch (e) { console.error("[ai-kiosk] native cursor handle unavailable:", String(e.message || e)); return }
  const guard = spawn(settings.executable('python3') || 'python3', [app.isPackaged ? path.join(process.resourcesPath, 'collectors/cursor-guard.py') : path.join(__dirname, 'cursor-guard.py'), `0x${windowId.toString(16)}`], { stdio: ["ignore", "ignore", "pipe"] })
  cursorGuard = guard
  let error = ""
  guard.stderr.setEncoding("utf8")
  guard.stderr.on("data", chunk => { error += chunk })
  guard.on("error", e => {
    if (cursorGuard === guard) cursorGuard = null
    console.error("[ai-kiosk] native cursor guard failed:", String(e.message || e))
  })
  guard.on("exit", code => {
    if (cursorGuard === guard) cursorGuard = null
    if (code && error.trim()) console.error("[ai-kiosk] native cursor guard exited:", error.trim())
  })
}

function stopCursorGuard() {
  const guard = cursorGuard
  cursorGuard = null
  if (guard && !guard.killed) guard.kill("SIGTERM")
}
// Dev-only probe: AI_KIOSK_PROBE=/path/log.txt has the renderer report, from
// inside the page, what the live tick says next to the figure the wheels are
// actually showing, so the counter can be checked against the hub directly.
function probeTickChannel() {
  const file = process.env.AI_KIOSK_PROBE
  if (!file || !win || win.isDestroyed()) return
  const note = (m) => { try { fs.appendFileSync(file, new Date().toISOString() + " " + m + "\n") } catch {} }
  const script = [
    "(() => new Promise((resolve) => {",
    "  const out = { tick: null, shown: null, odo: null, frames: null }",
    "  try { window.kiosk?.onTick?.((t) => { out.tick = t }) } catch (e) { out.err = String(e) }",
    "  const readWheels = () => Array.from(document.querySelectorAll('.wheel')).map((w) => {",
    "    const g = Array.from(w.querySelectorAll('[data-glyph]')).map((n) => ({ d: n.textContent, o: Number(n.style.opacity || 1) })).sort((a, b) => b.o - a.o)[0]",
    "    return g ? g.d : '?'",
    "  }).join('')",
    "  setTimeout(() => {",
    "    const d = []",
    "    let prev = performance.now()",
    "    const t0 = prev",
    "    const frame = (t) => {",
    "      d.push(t - prev); prev = t",
    "      if (t - t0 < 2500) { requestAnimationFrame(frame); return }",
    "      const s = d.slice(1).sort((a, b) => a - b)",
    "      out.frames = { n: s.length, p50: Math.round(s[(s.length * 0.5) | 0] || 0), p95: Math.round(s[(s.length * 0.95) | 0] || 0), max: Math.round(s[s.length - 1] || 0) }",
    "      out.shown = readWheels()",
    "      out.odo = window.__odo || null",
    "      resolve(JSON.stringify(out))",
    "    }",
    "    requestAnimationFrame(frame)",
    "  }, 3000)",
    "}))()",
  ].join("\n")
  let n = 0
  const probe = async () => {
    try { note(await win.webContents.executeJavaScript(script)) } catch (e) { note("probe failed: " + String(e && e.message || e)) }
    n += 1
    if (n < 14) setTimeout(probe, 15000)
  }
  setTimeout(probe, 10000)
}

// Dev-only visual QA hook: set AI_KIOSK_SHOT=/path/out.png to have the kiosk
// snapshot itself once after it is up. Never active without the env var.
function maybeAutoShot() {
  const file = process.env.AI_KIOSK_SHOT
  if (!file) return
  const delay = Number(process.env.AI_KIOSK_SHOT_DELAY_MS || 12000)
  const shots = Number(process.env.AI_KIOSK_SHOT_COUNT || 1)
  let n = 0
  const grab = async () => {
    try {
      if (!win || win.isDestroyed()) return
      const img = await win.webContents.capturePage()
      const out = n === 0 && shots === 1 ? file : file.replace(/\.png$/, `-${n}.png`)
      fs.writeFileSync(out, img.toPNG())
      console.log("[ai-kiosk] shot written:", out)
    } catch (e) {
      console.error("[ai-kiosk] shot failed:", String(e.message || e))
    }
  }
  const loop = () => {
    grab().then(() => {
      n += 1
      if (n < shots) setTimeout(loop, delay)
    })
  }
  setTimeout(loop, delay)
}

function targetDisplay() {
  const displays = screen.getAllDisplays(), selection = config.window.display
  if (selection === 'primary') return screen.getPrimaryDisplay()
  if (selection === 'portrait') return displays.find(d => d.size.height > d.size.width)
  return displays.find(d => String(d.id) === String(selection))
}
function placeOnKioskDisplay() {
  if (config.window.mode !== 'kiosk' || needsSetup) return
  if (!win || win.isDestroyed()) { createWindow(); return }
  const target = targetDisplay()
  if (!target) { win.hide(); stopCursorGuard(); return }
  const b = target.bounds, old = win.getBounds()
  if (Object.keys(b).some(k => b[k] !== old[k])) win.setBounds(b)
  if (!win.isFullScreen()) win.setFullScreen(true)
  if (!win.isVisible()) win.showInactive()
  startCursorGuard()
  win.setAlwaysOnTop(!!config.window.alwaysOnTop, 'floating')
}

let placeTimer = null
function debouncedPlace() {
  if (placeTimer) clearTimeout(placeTimer)
  placeTimer = setTimeout(() => {
    placeTimer = null
    try { placeOnKioskDisplay() } catch (e) { console.error("[ai-kiosk] reposition failed:", e) }
    // The compositor may restack once more after it publishes the new layout.
    setTimeout(() => { try { placeOnKioskDisplay() } catch (e) { console.error("[ai-kiosk] restack failed:", e) } }, 1800)
  }, 800)
}

let lastDisplayLayout = ""
function checkDisplayLayout() {
  const layout = screen.getAllDisplays().map(d => `${d.id}:${d.bounds.x},${d.bounds.y},${d.bounds.width},${d.bounds.height}`).sort().join("|")
  if (layout === lastDisplayLayout) return
  lastDisplayLayout = layout
  debouncedPlace()
}

// Live token tick: a small payload on its own channel, once a second, so the
// odometer reacts to real consumption without re-rendering the dashboard.
function pushTick() {
  if (!win || win.isDestroyed()) return
  const hub = state.activity?.hub || {}
  const claude = state.activity?.claude || {}
  const today = claudeUsage.todayTokens(state.usage, { todayTokens: (hub.todayTokens || 0) + (state.activity.localCodex?.todayTokens || 0) }, claude)
  const lastHour = (hub.tokensLastHour || 0) + (claude.tokensLastHour || 0) + (state.activity.localCodex?.tokensLastHour || 0)
  win.webContents.send("kiosk:tick", {
    tokensToday: today,
    tokensLastHour: lastHour,
    tokensPerMin: lastHour / 60,
    updatedAt: Math.max(hub.updatedAt || 0, claude.updatedAt || 0, state.activity.localCodex?.updatedAt || 0),
  })
}

function pushToRenderer() {
  if (win && !win.isDestroyed()) {
    buildSnapshot()
    win.webContents.send("kiosk:data", state)
  }
  maybeDumpState()
}

// Design-preview hook: AI_KIOSK_DUMP=/path/state.json mirrors the renderer payload
// to disk so offline mockups can use real numbers.
function maybeDumpState() {
  const file = process.env.AI_KIOSK_DUMP
  if (!file) return
  try { fs.writeFileSync(file, JSON.stringify(state, null, 1)) } catch (e) { console.error("[ai-kiosk] dump failed:", String(e.message || e)) }
}

let collectorProcess = null
function startManagedCollector() {
  if (!config.claude.enabled || !config.claude.managedCollector || config.usage.claude !== 'local') return
  const python = settings.executable('python3')
  if (!python) return
  if (!fs.existsSync(configPaths.collectorFile)) settings.writePrivate(configPaths.collectorFile, { database:config.claude.database, projects:config.claude.projects, sources:[{device:'local'}] })
  const script = app.isPackaged ? path.join(process.resourcesPath, 'collectors/claude_collector.py') : path.join(__dirname, 'claude_collector.py')
  collectorProcess = spawn(python, [script, '--config', configPaths.collectorFile, '--scan-only'], { stdio: ['ignore','ignore','pipe'] })
  collectorProcess.stderr.on('data', () => {})
  collectorProcess.on('error', () => { collectorProcess = null })
  collectorProcess.on('exit', () => { collectorProcess = null; if (!quitting) setTimeout(startManagedCollector, 10000) })
}
async function captureScreenshot(file) {
  if (!win || win.isDestroyed()) throw new Error('No kiosk window is open')
  const image = await win.webContents.capturePage()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, image.toPNG(), { mode: 0o600 })
}
function createWindow() {
  if (quitting || win) return
  const kiosk = config.window.mode === 'kiosk' && !needsSetup
  const target = kiosk ? targetDisplay() : screen.getPrimaryDisplay()
  if (!target) return
  const b = target.workArea
  win = new BrowserWindow({
    ...(kiosk ? target.bounds : { width: Math.min(config.window.width, b.width), height: Math.min(config.window.height, b.height), minWidth: 360, minHeight: 480 }),
    title: 'Clankiosk', frame: !kiosk, fullscreen: kiosk, alwaysOnTop: kiosk && config.window.alwaysOnTop,
    show: false, backgroundColor: '#121211',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, offscreen: headless },
  })
  win.once('ready-to-show', () => {
    if (!headless) { if (kiosk) { win.showInactive(); startCursorGuard() } else win.show() }
    maybeAutoShot(); probeTickChannel()
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', event => event.preventDefault())
  win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  win.on('closed', () => { stopCursorGuard(); win = null })
}
function openSetup() {
  if (!win) {
    needsSetup = true
    state.setupRequired = true
    createWindow()
  } else win.webContents.send('kiosk:show-setup')
  if (win && !headless) { win.show(); win.focus() }
}

ipcMain.handle('kiosk:get-data', () => state)
ipcMain.handle('kiosk:get-setup', () => ({ detected: settings.detect(), error: loadedConfig.error,
  selected: { codex: !!config.codex.enabled, claude: config.claude.enabled, t3: config.t3.enabled,
    mode: config.window.mode, sections: config.sections, hubUrl: config.opencodex.hubUrl, hasHubToken: !!config.opencodex.adminToken } }))
ipcMain.handle('kiosk:save-setup', (_event, selection) => {
  const input = { ...selection }
  if (!input.hubToken && input.hubUrl === config.opencodex.hubUrl) input.hubToken = config.opencodex.adminToken
  settings.setupConfig(input, config)
  app.relaunch({ args: process.argv.slice(1).filter(a => !['--setup','--kiosk','--desktop'].includes(a)) })
  app.quit()
  return true
})

const screenshotFile = process.argv.find(arg => arg.startsWith('--screenshot='))?.slice(13)
if (!app.requestSingleInstanceLock({ screenshot: screenshotFile ? path.resolve(screenshotFile) : null })) {
  app.quit()
} else if (screenshotFile) {
  console.error('Start Clankiosk before requesting a screenshot.'); app.exit(1)
} else {
  app.on('second-instance', async (_event, _args, _cwd, extra) => {
    if (extra?.screenshot) { try { await captureScreenshot(extra.screenshot) } catch (error) { console.error(error.message) }; return }
    if (_args.includes('--setup')) { openSetup(); return }
    if (!win) createWindow()
    if (win && config.window.mode === 'desktop') { win.show(); win.focus() }
  })
  app.whenReady().then(() => {
    if (headless && process.platform === 'darwin') app.dock.hide()
    if (config.window.preventSleep && !needsSetup) powerSaveBlocker.start('prevent-display-sleep')
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
      { label: process.platform === 'darwin' ? 'File' : 'Clankiosk', submenu: [
        { label: 'Setup…', accelerator: 'CmdOrCtrl+,', click: openSetup },
        { label: 'Save screenshot…', accelerator: 'CmdOrCtrl+Shift+S', click: async () => {
          const result = await dialog.showSaveDialog(win, { defaultPath: 'clankiosk.png', filters: [{ name: 'PNG', extensions: ['png'] }] })
          if (!result.canceled && result.filePath) await captureScreenshot(result.filePath)
        } }, { role: 'quit' }] },
      { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' },
    ]))
    createWindow()
    if (!needsSetup) { startManagedCollector(); startData() }
    screen.on('display-added', debouncedPlace)
    screen.on('display-removed', debouncedPlace)
    screen.on('display-metrics-changed', debouncedPlace)
    if (config.window.mode === 'kiosk') setInterval(checkDisplayLayout, 3000)
  })
}
app.on('activate', () => { if (!win) createWindow() })
app.on('before-quit', () => {
  quitting = true; stopCursorGuard()
  if (collectorProcess) collectorProcess.kill('SIGTERM')
  for (const account of codexAccounts) if (account.proc) account.proc.kill('SIGTERM')
})
app.on('window-all-closed', () => {
  if (quitting) return
  if (config.window.mode === 'kiosk') setTimeout(createWindow, 1000)
  else if (process.platform !== 'darwin') app.quit()
})
