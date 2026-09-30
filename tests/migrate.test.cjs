const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const migration = require('../electron/migrate.cjs')
const settings = require('../electron/config.cjs')

const legacy = {
  codexAccounts: [
    { id: 'codex-1', name: 'Codex', sublabel: 'this machine', codexHome: null },
    { id: 'codex-2', name: 'Codex', sublabel: 'snarkyalyx', plan: 'Plus', codexHome: null },
  ],
  anthropic: { enabled: false, sublabel: '' },
  minors: [{ id: 'kimi', name: 'Kimi' }, { id: 'stepfun', name: 'StepFun' }],
  opencode: { url: '' },
  pollSeconds: 300,
  opencodex: { hubUrl: 'http://hub.example:10100/', adminToken: 'ocx_admin_example_token_value' },
  manualWindows: { kimi: [{ label: 'Monthly', resetDay: 1 }] },
  t3: { remotes: [{ host: '192.0.2.10', label: 'mac' }], sshIdentityFile: '/home/demo/.ssh/id_ed25519_example' },
  claude: { enabled: true, expectedSources: ['linux', 'mac'] },
  display: { counter: { mode: 'roll', speed: 1 } },
}

test('migration keeps what Clankiosk still tracks and normalizes it', () => {
  const { config, changes } = migration.plan(legacy)
  const normalized = settings.normalize(config)
  assert.equal(normalized.opencodex.hubUrl, 'http://hub.example:10100')
  assert.equal(normalized.opencodex.adminToken, 'ocx_admin_example_token_value')
  assert.equal(normalized.usage.codex, 'hub')
  assert.equal(normalized.usage.claude, 'local')
  assert.equal(normalized.codex.enabled, true)
  assert.equal(normalized.codexAccounts.length, 2)
  assert.equal(normalized.codexAccounts[1].plan, 'Plus')
  assert.equal(normalized.codexAccounts[0].sublabel, 'this machine')
  assert.equal(normalized.claude.enabled, true)
  assert.deepEqual(normalized.claude.expectedSources, ['linux', 'mac'])
  assert.equal(normalized.t3.enabled, true)
  assert.deepEqual(normalized.t3.remotes, [{ host: '192.0.2.10', label: 'mac' }])
  assert.equal(normalized.t3.readState.identityFile, '/home/demo/.ssh/id_ed25519_example')
  assert.equal(normalized.pollSeconds, 300)
  assert.equal(normalized.sections.sessions, true)
  assert.deepEqual(normalized.minors.map(m => m.id), ['stepfun'])
  assert.ok(changes.some(change => change.includes('OpenCodex hub')))
})

test('tokens are described, never printed', () => {
  const { changes, skipped } = migration.plan(legacy)
  const text = [...changes, ...skipped].join('\n')
  assert.equal(text.includes('ocx_admin_example_token_value'), false)
  assert.ok(text.includes('ocx_ad…alue'))
  assert.equal(migration.mask('short'), '•••••')
  assert.equal(migration.mask(''), '')
})

test('providers Clankiosk no longer uses are reported and dropped', () => {
  const { config, skipped } = migration.plan(legacy)
  assert.equal(config.minors.some(m => m.id === 'kimi'), false)
  assert.ok(skipped.some(note => note.includes('Kimi')))
  for (const key of ['display', 'manualWindows', 'opencode', 'anthropic']) assert.ok(skipped.some(note => note.includes(key)))
})

test('a hub-less profile falls back to local sources and hides empty sessions', () => {
  const { config } = migration.plan({ claude: { enabled: true }, codexAccounts: [{ id: 'codex-1' }] })
  assert.equal(config.usage.codex, 'local')
  assert.equal(config.usage.claude, 'local')
  assert.equal(config.sections.sessions, false)
  const hubOnly = migration.plan({ opencodex: { hubUrl: 'https://hub.example', adminToken: 'x'.repeat(20) } })
  assert.equal(hubOnly.config.usage.claude, 'hub')
  const nothing = migration.plan({})
  assert.deepEqual(nothing.changes, [])
  assert.equal(nothing.config.usage.codex, 'off')
})

test('a local T3 database enables sessions, and XDG paths stay separate', () => {
  const { config } = migration.plan({ t3: { database: '/tmp/state.sqlite' } }, { localT3: true })
  assert.equal(config.t3.enabled, true)
  assert.equal(config.t3.database, '/tmp/state.sqlite')
  assert.equal(config.sections.sessions, true)
  assert.equal(migration.legacyPaths({ XDG_CONFIG_HOME: '/tmp/config' }, '/home/demo').configFile, path.join('/tmp/config', 'ai-kiosk', 'config.json'))
  assert.equal(settings.paths({ XDG_CONFIG_HOME: '/tmp/config' }, 'linux', '/home/demo').configFile, path.join('/tmp/config', 'clankiosk', 'config.json'))
})

test('merging into an existing config keeps choices Clankiosk already had', () => {
  const base = {
    window: { mode: 'kiosk', display: 'portrait', width: 900 },
    sections: { sessions: false },
    pricing: { models: [{ model: 'example*', input: 1, output: 2 }] },
    forge: { enabled: true, tokens: { 'github.com': 'token' } },
    t3: { readState: { profilePath: '/tmp/T3 profile' } },
  }
  const { config } = migration.plan(legacy)
  const merged = settings.normalize(migration.merge(base, config))
  assert.equal(merged.window.mode, 'kiosk')
  assert.equal(merged.window.width, 900)
  assert.equal(merged.sections.sessions, true)
  assert.deepEqual(merged.pricing.models, base.pricing.models)
  assert.equal(merged.forge.enabled, true)
  assert.equal(merged.forge.tokens['github.com'], 'token')
  assert.equal(merged.t3.readState.profilePath, '/tmp/T3 profile')
  assert.equal(merged.t3.readState.identityFile, '/home/demo/.ssh/id_ed25519_example')
  assert.equal(merged.opencodex.hubUrl, 'http://hub.example:10100')
  assert.equal(migration.merge(null, { a: 1 }).a, 1)
  assert.deepEqual(migration.merge({ a: 1 }, null), null)
})
