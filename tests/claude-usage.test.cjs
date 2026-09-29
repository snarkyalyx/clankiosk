const { test } = require('node:test')
const assert = require('node:assert/strict')
const { fromGroups, mergeUsage, todayTokens, localDateKey } = require('../electron/claude-usage.cjs')

test('headline uses the merged daily total when the hourly timeline undercounts', () => {
  const now = Date.parse('2026-09-29T13:00:00Z')
  const day = localDateKey(now)
  const usage = { daily: [{ date: day, totalTokens: 6400000000 }] }
  assert.equal(todayTokens(usage, { todayTokens: 4050000000 }, { todayTokens: 1210000000 }, now), 6400000000)
  assert.equal(todayTokens({ daily: [] }, { todayTokens: 4050000000 }, { todayTokens: 1210000000 }, now), 5260000000)
})

test('Claude input includes cache writes and reads exactly once', () => {
  const now = Date.parse('2026-09-29T12:00:00Z')
  const day = localDateKey(now)
  const claude = fromGroups([{
    day, model:'claude-opus-5-5', total:150, input:120, output:30,
    cacheRead:90, cost:0.42, unpriced:0, requests:1, lastHour:150,
  }], [{device:'linux',scanAt:now,error:null}], ['linux'], now)
  assert.equal(claude.todayTokens, 150)
  assert.equal(claude.daily[0].inputTokens, 120)
  assert.equal(claude.daily[0].cachedInputTokens / claude.daily[0].cacheObservedInputTokens, .75)
  assert.equal(claude.tokensLastHour, 150)
  assert.equal(claude.partial, false)
})

test('merging Claude usage adds model/day totals and surfaces missing source', () => {
  const now = Date.now(), day = localDateKey(now)
  const hub = { pricingBasis:'configured',costUsd:2,tokensPerMin:10,reasoningTokens:0,
    daily:[{date:day,totalTokens:100,costUsd:2,inputTokens:90,outputTokens:10,cachedInputTokens:45,cacheObservedInputTokens:90}],
    modelsDaily:[{provider:'openai',model:'gpt-6-sol',daily:{[day]:100}}],models:[] }
  const claude = fromGroups([{day,model:'claude-opus-5-5',total:150,input:120,output:30,
    cacheRead:90,cost:null,unpriced:1,requests:1,lastHour:150}], [], ['linux'], now)
  const merged = mergeUsage(hub, claude, now)
  assert.equal(merged.daily[0].totalTokens, 250)
  assert.equal(merged.daily[0].unpricedRequests, 1)
  assert.equal(merged.daily[0].cachedInputTokens, 135)
  assert.equal(merged.tokensPerMin, 12.5)
  assert.equal(merged.modelsDaily.length, 2)
  assert.equal(merged.partial, true)
})
