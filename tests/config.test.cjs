const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const settings = require('../electron/config.cjs')

test('fresh defaults are portable, windowed, and contain no remote sources', () => {
  const config = settings.defaults()
  assert.equal(config.window.mode, 'desktop')
  assert.deepEqual(config.t3.remotes, [])
  assert.equal(config.opencodex.hubUrl, '')
  assert.equal(config.claude.enabled, false)
  assert.deepEqual(config.sections, { today:true, activity:true, capacity:true, sessions:true })
  assert.equal(settings.paths({}, 'darwin', '/Users/demo').configFile, '/Users/demo/Library/Application Support/Clankiosk/config.json')
  assert.equal(settings.paths({ XDG_CONFIG_HOME: '/tmp/config' }, 'linux', '/home/demo').configFile, '/tmp/config/clankiosk/config.json')
})
test('malformed config stays intact and setup is available to recover', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clankiosk-config-'))
  const previous = process.env.CLANKIOSK_CONFIG_DIR
  process.env.CLANKIOSK_CONFIG_DIR = dir
  try {
    const file = path.join(dir, 'config.json'); fs.writeFileSync(file, '{broken')
    assert.equal(settings.loadConfig().setupRequired, true)
    assert.equal(fs.readFileSync(file, 'utf8'), '{broken')
    settings.saveConfig({ window: { mode: 'desktop' } })
    assert.equal(settings.loadConfig().setupRequired, false)
    assert.equal(fs.statSync(file).mode & 0o777, 0o600)
  } finally {
    if (previous === undefined) delete process.env.CLANKIOSK_CONFIG_DIR
    else process.env.CLANKIOSK_CONFIG_DIR = previous
    fs.rmSync(dir, { recursive: true })
  }
})
test('invalid source authority, window modes and SSH options are rejected', () => {
  assert.throws(() => settings.normalize({ usage: { codex: 'both' } }))
  assert.throws(() => settings.normalize({ window: { mode: 'other' } }))
  assert.throws(() => settings.normalize({ t3: { remotes: [{ host: '-oProxyCommand=bad', label: 'remote' }] } }))
})
test('setup keeps advanced accounts and normalizes home-relative paths', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clankiosk-setup-'))
  const previous = process.env.CLANKIOSK_CONFIG_DIR
  process.env.CLANKIOSK_CONFIG_DIR = dir
  try {
    const existing = settings.normalize({
      codexAccounts: [{ id: 'codex-1', name: 'Work', codexHome: '~/.codex-work' }],
      t3: { readState: { profilePath: '~/T3 profile', identityFile: '~/.ssh/demo' } },
    })
    const saved = settings.setupConfig({ codex: true, mode: 'desktop' }, existing)
    assert.equal(saved.codexAccounts[0].name, 'Work')
    assert.equal(saved.codexAccounts[0].codexHome, path.join(os.homedir(), '.codex-work'))
    assert.equal(saved.t3.readState.profilePath, path.join(os.homedir(), 'T3 profile'))
    const disabled = settings.setupConfig({ codex: false }, saved)
    assert.equal(disabled.codex.enabled, false)
    assert.equal(disabled.codexAccounts.length, 1)
  } finally {
    if (previous === undefined) delete process.env.CLANKIOSK_CONFIG_DIR
    else process.env.CLANKIOSK_CONFIG_DIR = previous
    fs.rmSync(dir, { recursive: true })
  }
})
test('section visibility is independent of source tracking and never leaves a blank dashboard', () => {
  const hidden = settings.normalize({ t3:{enabled:true}, sections:{sessions:false} })
  assert.equal(hidden.t3.enabled, true)
  assert.equal(hidden.sections.sessions, false)
  assert.throws(() => settings.normalize({ sections:{ today:false,activity:false,capacity:false,sessions:false } }))
  assert.throws(() => settings.normalize({ sections:{ today:false,activity:false,capacity:false,sessions:true } }))
  assert.equal(settings.normalize({ t3:{enabled:true}, sections:{today:false,activity:false,capacity:false} }).sections.sessions, true)
})
