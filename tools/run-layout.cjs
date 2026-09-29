const path = require('node:path')
const { spawn } = require('node:child_process')
const args = process.platform === 'linux' ? ['--no-sandbox', '--ozone-platform=headless'] : []
// Sandboxing is disabled only in this isolated offscreen fixture runner.
const child = spawn(require('electron'), [...args, path.join(__dirname, 'check-layout.cjs')], { stdio: 'inherit' })
child.on('error', error => { console.error(error.message); process.exitCode = 1 })
child.on('exit', code => { process.exitCode = code ?? 1 })
