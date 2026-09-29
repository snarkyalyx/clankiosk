const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const exec = promisify(execFile)

const CREDENTIALS = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), '.credentials.json')
const ENDPOINT = 'https://api.anthropic.com/api/oauth/usage'

function quotaBar(value, label, windowMins) {
  if (!value || typeof value !== 'object') return null
  const usedPct = value.utilization
  const resetMs = Date.parse(value.resets_at)
  if (typeof usedPct !== 'number' || !Number.isFinite(usedPct) || usedPct < 0 || usedPct > 100 || !Number.isFinite(resetMs)) return null
  return { label, usedPct, resetsAt: Math.floor(resetMs / 1000), windowMins }
}

function quotaCard(body, now = Date.now()) {
  const bars = [
    quotaBar(body?.five_hour, 'Session', 300),
    quotaBar(body?.seven_day, 'Weekly', 10080),
    quotaBar(body?.seven_day_opus, 'Opus weekly', 10080),
    quotaBar(body?.seven_day_sonnet, 'Sonnet weekly', 10080),
  ].filter(Boolean)
  if (!bars.length) throw new Error('Claude usage response has no supported quota windows')
  return { id: 'anthropic', name: 'Claude', icon: 'anthropic', status: 'ok', bars,
    chips: [], updatedAt: now, _claudeQuota: true }
}

async function readClaudeQuota(credentialsFile = CREDENTIALS, now = Date.now()) {
  let credentials
  if (fs.existsSync(credentialsFile)) credentials = JSON.parse(fs.readFileSync(credentialsFile, 'utf8'))
  else if (process.platform === 'darwin') {
    // Read the existing Claude Code login from its Keychain entry. Never log it.
    const { stdout } = await exec('/usr/bin/security', ['find-generic-password', '-s', 'Claude Code-credentials', '-w'], { timeout: 5000, maxBuffer: 256 * 1024 })
    credentials = JSON.parse(stdout)
  } else throw new Error('Sign in to Claude Code to read capacity')
  const token = credentials.claudeAiOauth?.accessToken
  if (typeof token !== 'string' || !token) throw new Error('Claude OAuth credential unavailable')
  const response = await fetch(ENDPOINT, {
    headers: { Authorization: `Bearer ${token}`, 'anthropic-beta': 'oauth-2025-04-20', 'User-Agent': 'claude-code/2.1.280' },
    signal: AbortSignal.timeout(15000),
  })
  if (!response.ok) throw new Error(`Claude usage request returned ${response.status}`)
  return quotaCard(await response.json(), now)
}

module.exports = { quotaBar, quotaCard, readClaudeQuota }
