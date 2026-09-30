// Local session histories record tokens but not list prices. A configured
// table fills that gap; anything it cannot match stays marked as unpriced so
// the dashboard never presents a guess as a complete total.
const PER_MILLION = 1e6

function rate(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

function entry(row) {
  if (!row || typeof row !== 'object') return null
  const model = typeof row.model === 'string' ? row.model.trim() : ''
  const input = rate(row.input), output = rate(row.output)
  if (!model || input == null || output == null) return null
  const cachedInput = rate(row.cachedInput ?? row.cached)
  return { model, input, cachedInput: cachedInput == null ? input : cachedInput, output }
}

// Patterns support an exact model id or a trailing/leading `*` wildcard.
function matches(pattern, model) {
  const value = model.toLowerCase(), wanted = pattern.toLowerCase()
  if (!wanted.includes('*')) return value === wanted
  const parts = wanted.split('*').filter(Boolean)
  if (!parts.length) return true
  let index = 0
  for (const part of parts) {
    const at = value.indexOf(part, index)
    if (at < 0) return false
    if (index === 0 && !wanted.startsWith('*') && at !== 0) return false
    index = at + part.length
  }
  return wanted.endsWith('*') || index === value.length
}

function compile(pricing = {}) {
  const rows = Array.isArray(pricing.models) ? pricing.models : []
  return rows.map(entry).filter(Boolean)
}

function matchPrice(model, table = []) {
  if (typeof model !== 'string' || !model) return null
  let best = null
  for (const row of table) {
    const price = entry(row)
    if (!price || !matches(price.model, model)) continue
    const weight = price.model.replace(/\*/g, '').length
    if (!best || weight > best.weight) best = { weight, price }
  }
  return best ? best.price : null
}

// Cached reads are billed at their own rate, and Codex counts them inside
// input_tokens, so only the uncached remainder uses the input rate.
function costFor({ input = 0, output = 0, cacheRead = 0 }, price) {
  const billableInput = Math.max(0, input - cacheRead)
  return (billableInput * price.input + cacheRead * price.cachedInput + output * price.output) / PER_MILLION
}

// Groups are the shared { model, input, output, cacheRead, cost, unpriced,
// requests } rows produced by both local collectors.
function applyPrices(groups = [], pricing = {}) {
  const table = compile(pricing)
  if (!table.length) return { table, priced: 0, missing: [] }
  const missing = new Set()
  let priced = 0
  for (const group of groups) {
    if (!group || typeof group !== 'object') continue
    if (Number.isFinite(group.cost)) continue
    const price = matchPrice(group.model, table)
    if (!price) { if (group.total > 0) missing.add(group.model); continue }
    group.cost = costFor(group, price)
    group.unpriced = 0
    group.pricedBy = "configured"
    priced++
  }
  return { table, priced, missing: [...missing] }
}

module.exports = { PER_MILLION, compile, matches, matchPrice, costFor, applyPrices }
