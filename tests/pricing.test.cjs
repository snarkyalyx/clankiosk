const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const pricing = require('../electron/pricing.cjs')
const { CodexUsage } = require('../electron/codex-usage.cjs')

const table = [{ model: 'gpt-5*', input: 1.25, cachedInput: 0.125, output: 10 }]

test('pricing patterns match exact ids and wildcards, longest wins', () => {
  assert.equal(pricing.matches('gpt-5*', 'GPT-5.1-codex'), true)
  assert.equal(pricing.matches('*codex', 'gpt-5-codex'), true)
  assert.equal(pricing.matches('*codex', 'gpt-5-mini'), false)
  assert.equal(pricing.matches('gpt-5*codex', 'gpt-5-1-codex'), true)
  assert.equal(pricing.matches('gpt-5*codex', 'gpt-5-1-codex-extra'), false)
  assert.equal(pricing.matches('gpt-5.1', 'gpt-5.1'), true)
  assert.equal(pricing.matches('gpt-5.1', 'gpt-5.10'), false)
  const specific = pricing.matchPrice('gpt-5.1-codex', [{ model: 'gpt-5*', input: 1, output: 1 }, { model: 'gpt-5.1-codex', input: 2, output: 3 }])
  assert.equal(specific.input, 2)
  assert.equal(pricing.matchPrice('unknown-model', table), null)
})

test('cached reads use their own rate and never double bill input', () => {
  const price = { input: 3, cachedInput: 0.3, output: 15 }
  assert.equal(pricing.costFor({ input: 1_000_000, output: 0, cacheRead: 0 }, price), 3)
  assert.equal(pricing.costFor({ input: 1_000_000, output: 0, cacheRead: 1_000_000 }, price), 0.3)
  assert.equal(pricing.costFor({ input: 200_000, output: 100_000, cacheRead: 50_000 }, price), 1.965)
  assert.equal(pricing.costFor({}, price), 0)
  assert.equal(pricing.costFor({ input: 5, output: 0, cacheRead: 5 }, price), 5 * 0.3 / 1e6)
  const noCachedRate = pricing.matchPrice('plain', [{ model: 'plain', input: 2, output: 4 }])
  assert.equal(noCachedRate.cachedInput, 2)
})

test('unmatched models stay unpriced and are reported', () => {
  const groups = [
    { model: 'gpt-5.1-codex', total: 100, input: 80, output: 20, cacheRead: 0, cost: null, unpriced: 4, requests: 4 },
    { model: 'mystery', total: 10, input: 8, output: 2, cacheRead: 0, cost: null, unpriced: 1, requests: 1 },
  ]
  const result = pricing.applyPrices(groups, { models: table })
  assert.equal(result.priced, 1)
  assert.deepEqual(result.missing, ['mystery'])
  assert.equal(groups[0].unpriced, 0)
  assert.equal(groups[0].pricedBy, 'configured')
  assert.equal(groups[0].cost, (80 * 1.25 + 20 * 10) / 1e6)
  assert.equal(groups[1].cost, null)
  assert.deepEqual(pricing.applyPrices(groups, { models: [] }).missing, [])
})

test('configured prices flow through the local Codex reader', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'clankiosk-priced-'))
  try {
    await fs.mkdir(path.join(root, 'sessions'))
    const totals = { input_tokens: 800_000, cached_input_tokens: 500_000, output_tokens: 200_000, total_tokens: 1_000_000 }
    await fs.writeFile(path.join(root, 'sessions', 'demo.jsonl'), [
      JSON.stringify({ type: 'turn_context', payload: { model: 'gpt-5.1-codex' } }),
      JSON.stringify({ type: 'event_msg', timestamp: new Date().toISOString(), payload: { type: 'token_count', info: { total_token_usage: totals, last_token_usage: totals } } }),
    ].join('\n'))
    const priced = await new CodexUsage().read(root, Date.now(), { models: table })
    assert.equal(priced.daily[0].unpricedRequests, 0)
    assert.equal(priced.daily[0].costUsd, (300_000 * 1.25 + 500_000 * 0.125 + 200_000 * 10) / 1e6)
    const unpriced = await new CodexUsage().read(root)
    assert.equal(unpriced.daily[0].unpricedRequests, 1)
    assert.equal(unpriced.daily[0].costUsd, 0)
  } finally { await fs.rm(root, { recursive: true }) }
})
