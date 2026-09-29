const { test } = require('node:test')
const assert = require('node:assert/strict')
const { usageEvent, CodexUsage } = require('../electron/codex-usage.cjs')
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path')
const event = (total, last, at = new Date().toISOString()) => ({type:'event_msg',timestamp:at,payload:{type:'token_count',info:{total_token_usage:total,last_token_usage:last}}})
test('local Codex counts new usage once and does not recount inherited session totals', () => {
  const state = {}, totals = {input_tokens:1000,cached_input_tokens:800,output_tokens:100,total_tokens:1100}
  usageEvent({type:'turn_context',payload:{model:'gpt-example'}},state)
  const row = usageEvent(event(totals,{input_tokens:100,cached_input_tokens:80,output_tokens:10,total_tokens:110}),state)
  assert.equal(row.total,110); assert.equal(row.model,'gpt-example')
  assert.equal(usageEvent(event(totals,totals),state),null)
  assert.equal(usageEvent(event({...totals,input_tokens:1100,total_tokens:1200},totals),state).total,100)
})
test('local Codex aggregates model/day cache counts and survives rescans', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'clankiosk-codex-'))
  try {
    await fs.mkdir(path.join(root,'sessions'))
    const tokens={input_tokens:100,cached_input_tokens:80,output_tokens:10,total_tokens:110}
    await fs.writeFile(path.join(root,'sessions','demo.jsonl'), [JSON.stringify({type:'turn_context',payload:{model:'gpt-example'}}), JSON.stringify(event(tokens,tokens)),JSON.stringify(event(tokens,tokens)),'{unfinished'].join('\n'))
    const reader=new CodexUsage(), first=await reader.read(root), next=await reader.read(root)
    assert.equal(first.todayTokens,110); assert.equal(next.todayTokens,110)
    assert.equal(first.modelsDaily[0].provider,'openai')
    assert.equal(first.daily[0].cachedInputTokens,80)
    assert.equal(first.daily[0].unpricedRequests,1)
  } finally { await fs.rm(root,{recursive:true}) }
})
