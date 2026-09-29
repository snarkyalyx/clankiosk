// Exercise the real app with synthetic histories and an isolated profile.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')
const root = path.join(__dirname, '..')
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clankiosk-smoke-'))
const now = new Date().toISOString()
const configDir = path.join(dir, 'config'), dataDir = path.join(dir, 'data')
const codexHome = path.join(dir, 'codex'), projects = path.join(dir, 'claude')
for (const folder of [configDir, dataDir, path.join(codexHome, 'sessions'), projects]) fs.mkdirSync(folder, { recursive:true })
const codexTokens = { input_tokens:100, cached_input_tokens:80, output_tokens:10, total_tokens:110 }
fs.writeFileSync(path.join(codexHome, 'sessions/demo.jsonl'), [
  { type:'turn_context', payload:{model:'gpt-example'} },
  { type:'event_msg', timestamp:now, payload:{type:'token_count',info:{total_token_usage:codexTokens,last_token_usage:codexTokens}} },
].map(row=>JSON.stringify(row)).join('\n')+'\n')
fs.writeFileSync(path.join(projects, 'demo.jsonl'), JSON.stringify({type:'assistant',timestamp:now,sessionId:'demo',requestId:'demo-request',
  message:{id:'demo-message',model:'claude-example',usage:{input_tokens:10,cache_creation_input_tokens:20,cache_read_input_tokens:30,output_tokens:4}}})+'\n')
fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({
  window:{mode:'desktop'}, usage:{codex:'local',claude:'local'}, codex:{enabled:true,home:codexHome}, codexAccounts:[],
  claude:{enabled:true,quota:false,projects,database:path.join(dataDir,'claude.sqlite'),expectedSources:['local']},
  t3:{enabled:true,database:path.join(dir,'missing-t3.sqlite')}, sections:{sessions:false},
}))
const env = {...process.env, CLANKIOSK_CONFIG_DIR:configDir, CLANKIOSK_DATA_DIR:dataDir, CLANKIOSK_HEADLESS:'1', AI_KIOSK_DUMP:path.join(dir,'state.json')}
const packaged = process.argv[2]
const binary = packaged ? path.resolve(packaged) : require('electron')
const args = [...(packaged ? [] : [root]), ...(process.platform === 'linux' ? ['--no-sandbox','--ozone-platform=headless'] : [])]
let log = '', child
const pause = ms => new Promise(resolve=>setTimeout(resolve,ms))
async function until(check, label) {
  const deadline=Date.now()+25000
  while (Date.now()<deadline) {
    if (check()) return
    if (child.exitCode != null || child.signalCode) throw new Error(`App exited before ${label}: ${log}`)
    await pause(150)
  }
  throw new Error(`Timed out: ${label}. ${log}`)
}
async function main() {
  child = spawn(binary,args,{env,detached:true,stdio:['ignore','pipe','pipe']})
  child.stdout.on('data',chunk=>{log+=chunk}); child.stderr.on('data',chunk=>{log+=chunk})
  child.on('error',error=>{log+=error.message})
  await until(()=>{
    try { const state=JSON.parse(fs.readFileSync(env.AI_KIOSK_DUMP)); return state.usage?.totalTokens===174 && !state.usage.partial && state.usage.modelsDaily.length===2 && state.runtime.t3Enabled && state.runtime.sections.sessions===false } catch { return false }
  },'merged Codex + Claude usage (174 tokens)')
  const screenshot=path.join(dir,'running.png')
  const request=spawn(binary,[...args,`--screenshot=${screenshot}`],{env,stdio:'ignore'})
  await new Promise((resolve,reject)=>{request.on('error',reject);request.on('exit',code=>code===0?resolve():reject(new Error(`Screenshot command exited ${code}`)))})
  await until(()=>fs.existsSync(screenshot) && fs.statSync(screenshot).size>1000,'screenshot from existing instance')
  process.kill(child.pid,0)
  console.log(`App smoke passed on ${process.platform}/${process.arch}: 174 merged tokens, both local collectors, hidden T3 with tracking enabled, screenshot without restart.`)
}
main().catch(error=>{console.error(error.message);process.exitCode=1}).finally(()=>{
  if (child?.pid) { try { process.kill(-child.pid,'SIGTERM') } catch {} }
  // Keep synthetic screenshots for inspection; fixtures contain no personal data.
  console.log(`Synthetic fixture: ${dir}`)
})
