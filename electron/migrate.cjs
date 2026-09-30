// Reads the original AI Kiosk profile and describes the Clankiosk equivalent.
// Nothing here writes: the CLI decides, and the legacy directory is never
// touched so the old kiosk keeps working until its owner removes it.
const os = require('node:os')
const path = require('node:path')

function legacyPaths(env = process.env, home = os.homedir()) {
  const configBase = env.XDG_CONFIG_HOME || path.join(home, '.config')
  const dataBase = env.XDG_DATA_HOME || path.join(home, '.local', 'share')
  return { configFile: path.join(configBase, 'ai-kiosk', 'config.json'), dataDir: path.join(dataBase, 'ai-kiosk') }
}

function mask(value) {
  const text = String(value ?? '')
  if (!text) return ''
  if (text.length <= 10) return '•'.repeat(text.length)
  return `${text.slice(0, 6)}…${text.slice(-4)}`
}

function plan(legacy = {}, options = {}) {
  if (!legacy || typeof legacy !== 'object' || Array.isArray(legacy)) throw new Error('Legacy config must be a JSON object')
  const config = { opencodex: {}, claude: {}, t3: { remotes: [], readState: {} }, usage: {} }
  const changes = [], skipped = []

  const hubUrl = String(legacy.opencodex?.hubUrl || '').trim().replace(/\/$/, '')
  const hubToken = String(legacy.opencodex?.adminToken || '')
  if (hubUrl) {
    config.opencodex = { hubUrl, adminToken: hubToken }
    changes.push(`OpenCodex hub ${hubUrl}${hubToken ? ` · token ${mask(hubToken)}` : ''}`)
    if (!hubToken) skipped.push('Hub URL without a token; add one in setup')
  } else if (hubToken) skipped.push('Hub token without a URL; nothing to reuse')

  const accounts = Array.isArray(legacy.codexAccounts) ? legacy.codexAccounts : []
  if (accounts.length) {
    config.codexAccounts = accounts.map((account, index) => ({
      id: account?.id || `codex-${index + 1}`,
      name: account?.name || 'Codex',
      ...(account?.sublabel ? { sublabel: account.sublabel } : {}),
      ...(account?.plan ? { plan: account.plan } : {}),
      codexHome: account?.codexHome || null,
    }))
    config.codex = { enabled: true }
    changes.push(`${config.codexAccounts.length} Codex account${config.codexAccounts.length > 1 ? 's' : ''}`)
  }
  // The hub owns shared capacity; local history fills gaps the hub cannot see.
  config.usage.codex = hubUrl ? 'hub' : accounts.length ? 'local' : 'off'

  if (legacy.claude?.enabled) {
    config.claude = { enabled: true, managedCollector: true, quota: true,
      ...(Array.isArray(legacy.claude.expectedSources) && legacy.claude.expectedSources.length ? { expectedSources: legacy.claude.expectedSources.map(String) } : {}) }
    config.usage.claude = 'local'
    changes.push(`Claude Code local history${config.claude.expectedSources ? ` · sources ${config.claude.expectedSources.join(', ')}` : ''}`)
    skipped.push('Claude history is scanned again into the Clankiosk database; the old usage file is not copied')
  } else {
    config.usage.claude = hubUrl ? 'hub' : 'off'
  }

  const remotes = Array.isArray(legacy.t3?.remotes) ? legacy.t3.remotes : []
  if (remotes.length) {
    config.t3.remotes = remotes.map(remote => ({ host: String(remote?.host || ''), label: String(remote?.label || remote?.host || '') }))
    config.t3.enabled = true
    changes.push(`T3 remotes ${config.t3.remotes.map(r => r.label).join(', ')}`)
  }
  if (legacy.t3?.sshIdentityFile) {
    config.t3.readState = { identityFile: legacy.t3.sshIdentityFile }
    changes.push(`T3 SSH identity ${legacy.t3.sshIdentityFile}`)
  }
  if (legacy.t3?.database) { config.t3.database = legacy.t3.database; changes.push(`T3 database ${legacy.t3.database}`) }
  if (options.localT3 && !config.t3.enabled) { config.t3.enabled = true; changes.push('Local T3 sessions') }

  const minors = (Array.isArray(legacy.minors) ? legacy.minors : []).filter(minor => minor && String(minor.id).toLowerCase() !== 'kimi')
  if (minors.length) {
    config.minors = minors.map(minor => ({ id: minor.id, name: minor.name || minor.id, plan: minor.plan ?? null, resets: minor.resets ?? null, note: minor.note ?? null }))
    changes.push(`Manual providers ${config.minors.map(m => m.name).join(', ')}`)
  }
  if ((legacy.minors || []).some(minor => String(minor?.id).toLowerCase() === 'kimi')) skipped.push('Kimi is no longer tracked and was left out')
  for (const key of ['display', 'manualWindows', 'opencode', 'anthropic']) if (legacy[key] !== undefined) skipped.push(`${key} settings are not used by Clankiosk`)
  if (Number.isFinite(Number(legacy.pollSeconds))) { config.pollSeconds = Number(legacy.pollSeconds); changes.push(`Poll interval ${config.pollSeconds}s`) }

  config.sections = { today: true, activity: true, capacity: true, sessions: !!config.t3.enabled }
  return { config, changes, skipped }
}

// Deep merge for plain objects: migrating into an existing Clankiosk config
// keeps window, pricing and forge settings the user already chose.
function merge(base, patch) {
  if (!base || typeof base !== 'object' || Array.isArray(base)) return patch
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return patch
  const merged = { ...base }
  for (const [key, value] of Object.entries(patch)) {
    merged[key] = value && typeof value === 'object' && !Array.isArray(value) ? merge(base[key], value) : value
  }
  return merged
}

module.exports = { legacyPaths, mask, plan, merge }
