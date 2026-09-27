const { test } = require('node:test')
const assert = require('node:assert/strict')
const { visitMap } = require('../electron/t3-read-state.cjs')
test('visit timestamps keep environment collisions ambiguous and ignore invalid values',()=>{
 const state={threadLastVisitedAtById:{'mac:one':'2026-09-26T12:00:00.351Z','linux:two':'2026-09-26T12:00:00.350Z','copy:one':'2026-09-26T11:00:00Z','mac:bad':'oops'}}
 assert.deepEqual(visitMap(state),{two:'2026-09-26T12:00:00.350Z'})
 assert.deepEqual(visitMap(state,'mac'),{one:'2026-09-26T12:00:00.351Z'})
})
