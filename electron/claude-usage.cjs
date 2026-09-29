const fs = require('node:fs')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const exec = promisify(execFile)

const DAY = 86400000
const localDateKey = ms => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

async function readClaudeUsage(database, expectedSources = [], now = Date.now()) {
  if (!database || !fs.existsSync(database)) return null
  const cutoff = Math.floor(now - 8 * DAY), hour = Math.floor(now - 3600000)
  const sql = `WITH grouped AS (
    SELECT date(at_ms/1000,'unixepoch','localtime') AS day, model,
      SUM(input_tokens+cache_creation_tokens+cache_read_tokens+output_tokens) AS total,
      SUM(input_tokens+cache_creation_tokens+cache_read_tokens) AS input,
      SUM(output_tokens) AS output, SUM(cache_read_tokens) AS cache_read,
      SUM(cost_usd) AS cost, SUM(CASE WHEN cost_usd IS NULL THEN 1 ELSE 0 END) AS unpriced,
      COUNT(*) AS requests,
      SUM(CASE WHEN at_ms>=${hour} THEN input_tokens+cache_creation_tokens+cache_read_tokens+output_tokens ELSE 0 END) AS last_hour
    FROM requests WHERE at_ms>=${cutoff} GROUP BY day,model
  ) SELECT json_object(
    'groups',(SELECT json_group_array(json_object('day',day,'model',model,'total',total,
      'input',input,'output',output,'cacheRead',cache_read,'cost',cost,
      'unpriced',unpriced,'requests',requests,'lastHour',last_hour)) FROM grouped),
    'sources',(SELECT json_group_array(json_object('device',source_device,
      'scanAt',last_scan_ms,'otelAt',last_otel_ms,'error',last_error)) FROM source_sync)
  ) AS payload`
  const { stdout } = await exec(require('./config.cjs').executable('sqlite3') || 'sqlite3', ['-json', `file:${database}?mode=ro`, sql], { timeout: 5000, maxBuffer: 2 * 1024 * 1024 })
  const payload = JSON.parse(JSON.parse(stdout || '[]')[0]?.payload || '{}')
  return fromGroups(payload.groups || [], payload.sources || [], expectedSources, now)
}

function fromGroups(groups, sources = [], expectedSources = [], now = Date.now(), provider = 'anthropic') {
  const days = new Map(), models = new Map(), modelDays = new Map()
  let tokensLastHour = 0
  for (const g of groups) {
    if (!g.day || !g.model) continue
    const tokens = g.total || 0, input = g.input || 0, output = g.output || 0, cacheRead = g.cacheRead || 0
    const day = days.get(g.day) || { date: g.day, totalTokens: 0, inputTokens: 0, outputTokens: 0,
      cachedInputTokens: 0, cacheObservedInputTokens: 0, costUsd: 0, unpricedRequests: 0, pricedRequests: 0 }
    day.totalTokens += tokens; day.inputTokens += input; day.outputTokens += output
    day.cachedInputTokens += cacheRead; day.cacheObservedInputTokens += input
    day.costUsd += g.cost || 0; day.unpricedRequests += g.unpriced || 0
    day.pricedRequests += (g.requests || 0) - (g.unpriced || 0)
    days.set(g.day, day)
    const model = models.get(g.model) || { provider, model: g.model, tokens: 0,
      inputTokens: 0, outputTokens: 0, costUsd: 0, cacheRead: 0, inputObserved: 0, requests: 0 }
    model.tokens += tokens; model.inputTokens += input; model.outputTokens += output
    model.costUsd += g.cost || 0; model.cacheRead += cacheRead; model.inputObserved += input
    model.requests += g.requests || 0; models.set(g.model, model)
    const md = modelDays.get(g.model) || {}
    md[g.day] = (md[g.day] || 0) + tokens
    modelDays.set(g.model, md)
    tokensLastHour += g.lastHour || 0
  }
  const today = localDateKey(now)
  const sourceMap = new Map(sources.map(s => [s.device, s]))
  const partial = expectedSources.some(device => {
    const s = sourceMap.get(device)
    return !s || !!s.error || !s.scanAt || now - s.scanAt > 120000
  })
  return {
    updatedAt: now, partial, sources,
    daily: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)),
    modelsDaily: [...modelDays].map(([model, daily]) => ({ provider, model, daily })),
    models: [...models.values()].map(({cacheRead,inputObserved,...m}) => ({ ...m,
      cacheHitRate: inputObserved ? cacheRead / inputObserved : null })).sort((a,b) => b.tokens - a.tokens),
    todayTokens: days.get(today)?.totalTokens || 0, tokensLastHour,
  }
}

function mergeUsage(hub, claude, now = Date.now()) {
  if (!hub && !claude) return null
  const days = new Map(), models = new Map(), modelsDaily = new Map()
  for (const source of [hub, claude].filter(Boolean)) {
    for (const d of source.daily || []) {
      const row = days.get(d.date) || { date:d.date,totalTokens:0,costUsd:0,inputTokens:0,outputTokens:0,
        cachedInputTokens:0,cacheObservedInputTokens:0,pricedRequests:0,unpricedRequests:0,unmeteredRequests:0 }
      for (const key of ['totalTokens','inputTokens','outputTokens','cachedInputTokens','cacheObservedInputTokens','pricedRequests','unpricedRequests','unmeteredRequests']) row[key] += d[key] || 0
      row.costUsd += d.costUsd || 0
      if (d.costUsd == null && d.totalTokens > 0 && !d.unpricedRequests) row.unpricedRequests++
      days.set(d.date, row)
    }
    for (const m of source.models || []) {
      const key = `${m.provider}/${m.model}`, old = models.get(key)
      models.set(key, old ? { ...old, tokens:old.tokens+(m.tokens||0), inputTokens:old.inputTokens+(m.inputTokens||0),
        outputTokens:old.outputTokens+(m.outputTokens||0), costUsd:old.costUsd+(m.costUsd||0), requests:old.requests+(m.requests||0) } : {...m})
    }
    for (const m of source.modelsDaily || []) {
      const key = `${m.provider}/${m.model}`, old = modelsDaily.get(key) || {provider:m.provider,model:m.model,daily:{}}
      for (const [day,n] of Object.entries(m.daily)) old.daily[day] = (old.daily[day] || 0) + n
      modelsDaily.set(key, old)
    }
  }
  const daily = [...days.values()].sort((a,b) => a.date.localeCompare(b.date))
  const costUsd = daily.reduce((sum,d) => sum + d.costUsd, 0)
  const input = daily.reduce((sum,d) => sum + d.inputTokens, 0)
  const cacheRead = daily.reduce((sum,d) => sum + d.cachedInputTokens, 0)
  const observed = daily.reduce((sum,d) => sum + d.cacheObservedInputTokens, 0)
  return { updatedAt:now, pricingBasis:hub?.pricingBasis || 'configured', costUsd,
    cacheHitRate:observed ? cacheRead / observed : null,
    tokensPerMin:((hub?.tokensPerMin || 0)*60+(claude?.tokensLastHour || 0))/60,
    totalTokens:daily.reduce((sum,d)=>sum+d.totalTokens,0), inputTokens:input,
    outputTokens:daily.reduce((sum,d)=>sum+d.outputTokens,0), reasoningTokens:hub?.reasoningTokens || 0,
    models:[...models.values()].sort((a,b)=>b.tokens-a.tokens), modelsDaily:[...modelsDaily.values()], daily,
    partial:!!hub?.partial || !!claude?.partial }
}

function todayTokens(usage, hub, claude, now = Date.now()) {
  const day = localDateKey(now)
  const total = usage?.daily?.find(row => row.date === day)?.totalTokens
  return Number.isFinite(total) ? total : (hub?.todayTokens || 0) + (claude?.todayTokens || 0)
}

module.exports = { readClaudeUsage, fromGroups, mergeUsage, todayTokens, localDateKey }
