#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')
const settings = require('../electron/config.cjs')
const root = path.join(__dirname, '..')
const [command = 'start', ...args] = process.argv.slice(2)
if (command === 'doctor') {
  const found = settings.detect(), { config, setupRequired, error } = settings.loadConfig()
  console.log(`Clankiosk · ${process.platform}/${process.arch}\nConfig: ${found.configPath}\nSetup: ${setupRequired ? 'needed' : 'complete'}`)
  console.log(`Codex: ${found.codex.installed ? 'installed' : 'not found'}; history ${found.codex.history ? 'found' : 'absent'}`)
  console.log(`Claude: ${found.claude.installed ? 'installed' : 'not found'}; history ${found.claude.history ? 'found' : 'absent'}`)
  console.log(`T3 database: ${found.t3 ? 'found' : 'absent'}\nPython: ${found.python || 'not found'}\nSQLite: ${found.sqlite || 'not found'}`)
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
} else {
  console.log('Usage: clankiosk [start [--desktop|--kiosk] | setup | doctor | screenshot [file.png]]')
  if (!['help','--help','-h'].includes(command)) process.exitCode = 1
}
