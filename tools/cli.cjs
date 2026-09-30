#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')
const settings = require('../electron/config.cjs')
const forgeApi = require('../electron/forge.cjs')
const migration = require('../electron/migrate.cjs')
const root = path.join(__dirname, '..')
const [command = 'start', ...args] = process.argv.slice(2)
if (command === 'doctor') {
  const found = settings.detect(), { config, setupRequired, error } = settings.loadConfig()
  console.log(`Clankiosk · ${process.platform}/${process.arch}\nConfig: ${found.configPath}\nSetup: ${setupRequired ? 'needed' : 'complete'}`)
  console.log(`Codex: ${found.codex.installed ? 'installed' : 'not found'}; history ${found.codex.history ? 'found' : 'absent'}`)
  console.log(`Claude: ${found.claude.installed ? 'installed' : 'not found'}; history ${found.claude.history ? 'found' : 'absent'}`)
  console.log(`T3 database: ${found.t3 ? 'found' : 'absent'}\nPython: ${found.python || 'not found'}\nSQLite: ${found.sqlite || 'not found'}`)
  const forge = config.forge || {}, enterprise = (forge.githubHosts || []).join(', ')
  const tokenSource = forgeApi.configuredToken(forge, 'github.com') ? 'configured token'
    : process.env.GH_TOKEN || process.env.GITHUB_TOKEN ? 'GH_TOKEN/GITHUB_TOKEN'
    : settings.executable('gh') ? 'gh CLI (uses its login when present)' : 'not found'
  console.log(`PR enrichment: ${forge.enabled ? 'enabled' : 'disabled'}; GitHub token: ${tokenSource}${enterprise ? `; GitHub Enterprise: ${enterprise}` : ''}`)
  console.log(`Usage sources: Codex=${config.usage.codex}, Claude=${config.usage.claude}\nWindow: ${config.window.mode}`)
  if (error) console.error(error)
  if (error || config.claude.enabled && (!found.python || !found.sqlite) || config.t3.enabled && !found.sqlite) process.exitCode = 1
} else if (['start', 'setup', 'screenshot'].includes(command)) {
  if (!fs.existsSync(path.join(root, 'dist/index.html'))) { console.error('Run npm run build first.'); process.exit(1) }
  const target = command === 'screenshot' ? path.resolve(args[0] || `clankiosk-${Date.now()}.png`) : null
  if (target && fs.existsSync(target)) { console.error('Screenshot file already exists; choose a new filename.'); process.exit(1) }
  const extra = command === 'setup' ? ['--setup'] : target ? [`--screenshot=${target}`] : args
  const child = spawn(require('electron'), [root, ...extra], { stdio: 'inherit' })
  child.on('error', error => { console.error(error.message); process.exitCode = 1 })
  child.on('exit', async code => {
    if (!target) { process.exitCode = code || 0; return }
    const deadline = Date.now() + 10000
    while (!fs.existsSync(target) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100))
    if (fs.existsSync(target)) console.log(target)
    else { console.error('No screenshot received. Start Clankiosk with the same config directory first.'); process.exitCode = 1 }
  })
} else if (command === 'migrate') {
  const dryRun = args.includes('--dry-run'), force = args.includes('--force')
  const fromArg = args[args.indexOf('--from') + 1]
  const from = args.includes('--from') && fromArg ? path.resolve(fromArg) : migration.legacyPaths().configFile
  const destination = settings.paths().configFile
  if (!fs.existsSync(from)) {
    console.error(`No AI Kiosk config at ${from}. Pass --from <file> to migrate a different profile.`)
    process.exitCode = 1
  } else {
    let legacy
    try { legacy = JSON.parse(fs.readFileSync(from, 'utf8')) }
    catch (error) { legacy = null; console.error(`Could not read ${from}: ${error.message}`); process.exitCode = 1 }
    if (legacy) {
      const existing = fs.existsSync(destination) ? JSON.parse(fs.readFileSync(destination, 'utf8')) : null
      const { config: migrated, changes, skipped } = migration.plan(legacy, { localT3: fs.existsSync(legacy.t3?.database || settings.defaults().t3.database) })
      console.log(`From: ${from}`)
      console.log(existing ? `Into: ${destination} (existing settings are kept)` : `Into: ${destination}`)
      for (const change of changes) console.log(`  + ${change}`)
      for (const note of skipped) console.log(`  · ${note}`)
      if (!changes.length) console.log('  Nothing reusable was found in that profile.')
      if (dryRun) console.log('Dry run: nothing written.')
      else if (existing && !force) {
        console.error('Clankiosk already has its own config. Re-run with --force to merge into it, or --dry-run to inspect first.')
        process.exitCode = 1
      } else {
        settings.saveConfig(existing ? migration.merge(existing, migrated) : migrated)
        console.log(`Migrated. Review ${destination}, then start Clankiosk with: npm start`)
      }
    }
  }
} else {
  console.log('Usage: clankiosk [start [--desktop|--kiosk] | setup | doctor | screenshot [file.png] | migrate [--from file] [--dry-run] [--force]]')
  if (!['help','--help','-h'].includes(command)) process.exitCode = 1
}
