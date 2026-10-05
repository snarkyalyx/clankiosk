const test = require('node:test')
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const sd = require('../electron/session-data.cjs')

test('v2 session query maps onto the shared row shape', () => {
  const db = ':memory:'
  const sql = `
CREATE TABLE projection_projects (project_id TEXT PRIMARY KEY, title TEXT);
CREATE TABLE orchestration_v2_projection_threads (thread_id TEXT PRIMARY KEY, project_id TEXT, title TEXT, default_provider TEXT, updated_at TEXT, archived_at TEXT, deleted_at TEXT, payload_json TEXT);
CREATE TABLE orchestration_v2_projection_runs (run_id TEXT PRIMARY KEY, thread_id TEXT, ordinal INTEGER, status TEXT, requested_at TEXT, completed_at TEXT, payload_json TEXT);
CREATE TABLE orchestration_v2_projection_messages (message_id TEXT, thread_id TEXT, role TEXT, created_at TEXT);
CREATE TABLE orchestration_v2_projection_runtime_requests (thread_id TEXT, kind TEXT, status TEXT);
INSERT INTO projection_projects VALUES ('p1','Demo');
INSERT INTO orchestration_v2_projection_threads VALUES ('a','p1','Working','codex','2026-10-03T10:00:00Z',NULL,NULL,'{"branch":"x","modelSelection":{"model":"m1"}}');
INSERT INTO orchestration_v2_projection_threads VALUES ('b','p1','Settled','codex','2026-10-03T10:00:00Z',NULL,NULL,'{"settledAt":"2026-10-03T10:00:00Z"}');
INSERT INTO orchestration_v2_projection_threads VALUES ('c','p1','Gone','codex','2026-10-03T10:00:00Z','2026-10-03T10:00:00Z',NULL,'{}');
INSERT INTO orchestration_v2_projection_runs VALUES ('r1','a',1,'running','2026-10-03T10:00:00Z',NULL,'{"startedAt":"2026-10-03T10:00:01Z"}');
`
  const rows = JSON.parse(execFileSync('sqlite3', ['-json', db, sql + sd.ROWS_SQL_V2]).toString())
  const [s, ...rest] = sd.mapRows(rows, 'local', Date.parse('2026-10-03T10:05:00Z'))
  assert.equal(rest.length, 0)
  assert.equal(s.title, 'Working')
  assert.equal(s.project, 'Demo')
  assert.equal(s.status, 'working')
  assert.equal(s.model, 'm1')
  const stats = JSON.parse(execFileSync('sqlite3', ['-json', db, sql + sd.STATS_SQL_V2]).toString())[0]
  assert.equal(stats.settled, 1)
})

test('nestSubagents folds child threads under their parent', () => {
  const mk = (id, status, parentId = null) => ({ id, title: id, status, model: 'm', activityAt: 1, parentId, agents: [] })
  const top = sd.nestSubagents([mk('p', 'working'), mk('c1', 'working', 'p'), mk('c2', 'input', 'p'), mk('c3', 'done', 'p'), mk('orphan', 'idle', 'gone')])
  assert.deepEqual(top.map(s => s.id), ['p'])
  assert.deepEqual(top[0].agents.map(a => a.status), ['working', 'working', 'done'])
})

test('nestSubagents marks an idle parent working while a subagent works', () => {
  const mk = (id, status, parentId = null, workingSince = null) => ({ id, title: id, status, model: 'm', activityAt: 1, parentId, workingSince, agents: [] })
  const [p] = sd.nestSubagents([mk('p', 'idle'), mk('c', 'working', 'p', 500)])
  assert.equal(p.status, 'working')
  assert.equal(p.workingSince, 500)
  const [q] = sd.nestSubagents([mk('q', 'idle'), mk('d', 'done', 'q')])
  assert.equal(q.status, 'idle')
})

test('subagents whose parent is not listed are dropped, not shown as sessions', () => {
 const out = sd.nestSubagents([{ id:'a', status:'idle' }, { id:'b', status:'error', parentId:'gone' }])
 assert.deepEqual(out.map(s => s.id), ['a'])
})
