const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')
const readline = require('node:readline')
const { fromGroups, localDateKey } = require('./claude-usage.cjs')
const pricingApi = require('./pricing.cjs')
const DAY = 86400000

function usageEvent(event, state) {
  if (event.type === 'turn_context') { state.model = event.payload?.model || state.model; return null }
  const payload = event.payload
  if (event.type !== 'event_msg' || payload?.type !== 'token_count' || !payload.info?.total_token_usage) return null
  const total = payload.info.total_token_usage, previous = state.previous
  state.previous = total
  if (previous && total.total_tokens === previous.total_tokens) return null
  const fresh = !previous || total.total_tokens < previous.total_tokens
  const counts = fresh ? payload.info.last_token_usage : Object.fromEntries(['total_tokens','input_tokens','output_tokens','cached_input_tokens'].map(k => [k, Math.max(0, (total[k] || 0) - (previous[k] || 0))]))
  const at = Date.parse(event.timestamp)
  if (!counts || !Number.isFinite(at) || !Number.isFinite(counts.total_tokens) || counts.total_tokens <= 0) return null
  return { at, model: state.model || 'codex-unknown', total: counts.total_tokens,
    input: counts.input_tokens || 0, output: counts.output_tokens || 0, cacheRead: counts.cached_input_tokens || 0 }
}

async function* files(root) {
  let entries
  try { entries = await fsp.readdir(root, { withFileTypes: true }) } catch (e) { if (e.code === 'ENOENT') return; throw e }
  for (const entry of entries) {
    const file = path.join(root, entry.name)
    if (entry.isDirectory()) yield* files(file)
    else if (entry.isFile() && file.endsWith('.jsonl')) yield file
  }
}

class CodexUsage {
  cache = new Map()
  async read(home, now = Date.now(), pricing = {}) {
    const seen = new Set(), cutoff = now - 8 * DAY
    for (const root of ['sessions', 'archived_sessions']) for await (const file of files(path.join(home, root))) {
      seen.add(file)
      const stat = await fsp.stat(file)
      if (stat.mtimeMs < cutoff) { this.cache.delete(file); continue }
      const old = this.cache.get(file)
      if (old?.mtime === stat.mtimeMs && old?.size === stat.size) continue
      const state = { model: null, previous: null }, rows = []
      const input = fs.createReadStream(file, { encoding: 'utf8' })
      const lines = readline.createInterface({ input, crlfDelay: Infinity })
      try {
        for await (const line of lines) {
          let event
          try { event = JSON.parse(line) } catch { continue }
          const row = usageEvent(event, state)
          if (row && row.at >= cutoff && row.at <= now) rows.push(row)
        }
      } finally { lines.close(); input.destroy() }
      this.cache.set(file, { mtime: stat.mtimeMs, size: stat.size, rows })
    }
    for (const key of this.cache.keys()) if (!seen.has(key)) this.cache.delete(key)
    const groups = new Map()
    for (const entry of this.cache.values()) for (const row of entry.rows) {
      if (row.at < cutoff) continue
      const day = localDateKey(row.at), key = `${day}/${row.model}`
      const group = groups.get(key) || { day, model: row.model, total: 0, input: 0, output: 0, cacheRead: 0, cost: null, unpriced: 0, requests: 0, lastHour: 0 }
      for (const k of ['total','input','output','cacheRead']) group[k] += row[k]
      group.requests++; group.unpriced++
      if (row.at >= now - 3600000) group.lastHour += row.total
      groups.set(key, group)
    }
    const rows = [...groups.values()]
    pricingApi.applyPrices(rows, pricing)
    return fromGroups(rows, [], [], now, 'openai')
  }
}
module.exports = { CodexUsage, usageEvent }
