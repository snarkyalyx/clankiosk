const { test } = require('node:test')
const assert = require('node:assert/strict')
const { quotaBar, quotaCard } = require('../electron/claude-quota.cjs')

test('Claude quota uses measured utilization and reset times', () => {
  const at = '2026-09-29T06:10:00Z'
  const card = quotaCard({ five_hour: { utilization: 97, resets_at: at },
    seven_day: { utilization: 8, resets_at: at }, seven_day_opus: null }, 123)
  assert.equal(card.id, 'anthropic')
  assert.equal(card.updatedAt, 123)
  assert.deepEqual(card.bars.map(b => [b.label, b.usedPct, b.windowMins]),
    [['Session', 97, 300], ['Weekly', 8, 10080]])
  assert.equal(card.bars[0].resetsAt, Date.parse(at) / 1000)
})

test('absent or invalid Claude limits never become empty zero-percent bars', () => {
  assert.equal(quotaBar({ utilization: null, resets_at: '2026-09-29T06:00:00Z' }, 'Session', 300), null)
  assert.equal(quotaBar({ utilization: 50, resets_at: null }, 'Session', 300), null)
  assert.throws(() => quotaCard({ five_hour: null, seven_day: null }))
})
