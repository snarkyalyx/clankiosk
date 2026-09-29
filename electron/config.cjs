const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

function paths(env = process.env, platform = process.platform, home = os.homedir()) {
  const base = platform === 'darwin' ? path.join(home, 'Library/Application Support/Clankiosk') : path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'clankiosk')
  const configDir = path.resolve(env.CLANKIOSK_CONFIG_DIR || base)
  const dataDir = path.resolve(env.CLANKIOSK_DATA_DIR || (platform === 'darwin' ? base : path.join(env.XDG_DATA_HOME || path.join(home, '.local/share'), 'clankiosk')))
  return { configDir, dataDir, configFile: path.join(configDir, 'config.json'), collectorFile: path.join(configDir, 'claude-collector.json') }
}
function expand(file) { return typeof file === 'string' && file.startsWith('~/') ? path.join(os.homedir(), file.slice(2)) : file }
function toolPath() {
  return [...new Set([...(process.env.PATH || '').split(path.delimiter), path.join(os.homedir(), '.local/bin'), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin'].filter(Boolean))].join(path.delimiter)
}
function executable(name) {
  for (const dir of toolPath().split(path.delimiter)) {
    const file = path.isAbsolute(name) ? name : path.join(dir, name)
    try { fs.accessSync(file, fs.constants.X_OK); return file } catch {}
  }
  return null
}
function defaults() {
  return { version: 1, window: { mode: 'desktop', display: 'portrait', width: 1280, height: 900, alwaysOnTop: false, preventSleep: false },
    usage: { codex: 'local', claude: 'local' },
    codex: { enabled: false, home: process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), binary: '' }, codexAccounts: [],
    claude: { enabled: false, managedCollector: true, quota: true, projects: path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'projects'), database: path.join(paths().dataDir, 'claude-usage.sqlite'), expectedSources: ['local'] },
    opencodex: { hubUrl: '', adminToken: '' }, t3: { enabled: false, database: path.join(os.homedir(), '.t3/userdata/state.sqlite'), remotes: [], readState: {} },
    forge: { enabled: false }, minors: [], manualWindows: {}, pollSeconds: 300 }
}
function normalize(raw) {
  const d = defaults()
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Config must be a JSON object')
  const c = { ...d, ...raw }
  for (const key of ['window', 'usage', 'codex', 'claude', 'opencodex', 't3', 'forge']) c[key] = { ...d[key], ...raw[key] }
  if (!['desktop', 'kiosk'].includes(c.window.mode)) throw new Error('window.mode must be desktop or kiosk')
  c.window.width = Math.max(360, Math.min(7680, Number(c.window.width) || 1280))
  c.window.height = Math.max(480, Math.min(7680, Number(c.window.height) || 900))
  for (const k of ['codex', 'claude']) if (!['local', 'hub', 'off'].includes(c.usage[k])) throw new Error(`usage.${k} must be local, hub or off`)
  if (!Array.isArray(c.codexAccounts) || !Array.isArray(c.t3.remotes)) throw new Error('Accounts and remotes must be arrays')
  if (c.opencodex.hubUrl && !/^https?:\/\//.test(c.opencodex.hubUrl)) throw new Error('Hub URL must start with http:// or https://')
  for (const rem of c.t3.remotes) {
    if (!rem || !/^[a-zA-Z0-9_.@:-]+$/.test(rem.host || '') || rem.host.startsWith('-') || !rem.label) throw new Error('Each T3 remote needs a valid SSH host and unique label')
  }
  if (new Set(c.t3.remotes.map(r => r.label)).size !== c.t3.remotes.length) throw new Error('T3 remote labels must be unique')
  c.pollSeconds = Math.max(30, Number(c.pollSeconds) || 300)
  for (const [obj, keys] of [[c.codex,['home','binary']], [c.claude,['projects','database']], [c.t3,['database','sshIdentityFile']]]) for (const key of keys) obj[key] = expand(obj[key])
  c.codexAccounts = c.codexAccounts.map(account => ({ ...account, codexHome: expand(account.codexHome) }))
  c.t3.readState = { ...d.t3.readState, ...c.t3.readState }
  for (const key of ['profilePath', 'identityFile']) c.t3.readState[key] = expand(c.t3.readState[key])
  return c
}
function loadConfig() {
  const file = paths().configFile
  if (!fs.existsSync(file)) return { config: defaults(), setupRequired: true, error: null }
  try { return { config: normalize(JSON.parse(fs.readFileSync(file, 'utf8'))), setupRequired: false, error: null } }
  catch (e) { return { config: defaults(), setupRequired: true, error: `Cannot load config: ${e.message}` } }
}
function writePrivate(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  const temporary = `${file}.${process.pid}.tmp`
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 })
  fs.renameSync(temporary, file)
  fs.chmodSync(file, 0o600)
}
function saveConfig(raw) {
  const config = normalize(raw), p = paths()
  writePrivate(p.configFile, config)
  if (config.claude.enabled && config.claude.managedCollector) {
    const previous = fs.existsSync(p.collectorFile) ? JSON.parse(fs.readFileSync(p.collectorFile, 'utf8')) : {}
    writePrivate(p.collectorFile, { ...previous, database: config.claude.database, projects: config.claude.projects, sources: previous.sources || [{ device: 'local' }] })
  }
  return config
}
function detect() {
  const config = defaults()
  return { platform: process.platform, configPath: paths().configFile,
    codex: { installed: !!executable('codex'), history: fs.existsSync(path.join(config.codex.home, 'sessions')) },
    claude: { installed: !!executable('claude'), history: fs.existsSync(config.claude.projects) },
    t3: fs.existsSync(config.t3.database), python: executable('python3'), sqlite: executable('sqlite3') }
}
function setupConfig(selection, existing = defaults()) {
  if (!selection || typeof selection !== 'object') throw new Error('Setup choices missing')
  const detected = detect(), c = normalize(existing)
  c.window.mode = selection.mode === 'kiosk' ? 'kiosk' : 'desktop'
  c.window.alwaysOnTop = c.window.mode === 'kiosk'; c.window.preventSleep = c.window.mode === 'kiosk'
  const useCodex = selection.codex === true, useClaude = selection.claude === true
  if (useClaude && (!detected.python || !detected.sqlite)) throw new Error('Claude tracking needs Python 3 and sqlite3. Install them, then reopen setup.')
  if (selection.t3 && !detected.sqlite) throw new Error('T3 sessions need sqlite3.')
  c.codex.enabled = useCodex
  if (useCodex && !c.codexAccounts.length) c.codexAccounts = [{ id: 'codex-1', name: 'Codex', codexHome: c.codex.home }]
  c.claude.enabled = useClaude
  c.t3.enabled = selection.t3 === true
  c.opencodex.hubUrl = String(selection.hubUrl || '').trim().replace(/\/$/, '')
  c.opencodex.adminToken = String(selection.hubToken || '')
  if (c.opencodex.hubUrl && !c.opencodex.adminToken) throw new Error('Enter the hub token, or leave the hub URL empty.')
  // Hub owns Codex when configured; local Claude can be selected independently.
  c.usage.codex = c.opencodex.hubUrl ? 'hub' : useCodex ? 'local' : 'off'
  c.usage.claude = useClaude ? 'local' : c.opencodex.hubUrl ? 'hub' : 'off'
  return saveConfig(c)
}
module.exports = { paths, expand, executable, toolPath, defaults, normalize, loadConfig, saveConfig, setupConfig, detect, writePrivate }
