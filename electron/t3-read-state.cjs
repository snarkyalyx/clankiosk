// Read only T3's visit timestamps from a disposable copy of its desktop profile.
// Never open the live LevelDB (doing so would lock/write the user's profile).
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const { ClassicLevel } = require('classic-level')
const exec = promisify(execFile)
const LOCAL_KEY = Buffer.from('_t3code://app\0\x01t3code:ui-state:v1', 'latin1')

function visitMap(state, environmentId) {
 const result = {}, ambiguous = new Set()
 for (const [key, value] of Object.entries(state?.threadLastVisitedAtById || {})) {
  const split = key.indexOf(':')
  if (split < 1 || (environmentId && key.slice(0, split) !== environmentId) || !Number.isFinite(Date.parse(value))) continue
  const id = key.slice(split + 1)
  if (id in result) ambiguous.add(id)
  result[id] = value
 }
 // Never conflate copies of a thread in different T3 environments.
 for (const id of ambiguous) delete result[id]
 return result
}

async function readVisits({ host, profilePath, environmentId, identityFile } = {}) {
 const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kiosk-t3-visits-'))
 let db
 try {
  const copy = path.join(dir, 'db')
  if (host) {
   // Fixed path; only the desktop app's Local Storage, never browser profiles.
   const command = 'tar -C "$HOME/Library/Application Support/t3code/Local Storage/leveldb" -cf - .'
   const sshArgs = ['-o','BatchMode=yes','-o','ConnectTimeout=6']
   if (identityFile) sshArgs.push('-i',identityFile,'-o','IdentitiesOnly=yes')
   const { stdout } = await exec('ssh', [...sshArgs,host,command], { encoding:'buffer', timeout:12000, maxBuffer:8*1024*1024 })
   const archive = path.join(dir, 'snapshot.tar')
   await fs.writeFile(archive, stdout, { mode:0o600 })
   await fs.mkdir(copy)
   await exec('tar', ['-xf',archive,'-C',copy], { timeout:3000 })
  } else {
   const profile = profilePath || path.join(os.homedir(), process.platform === 'darwin' ? 'Library/Application Support/t3code' : '.config/t3code', 'Local Storage/leveldb')
   await fs.cp(profile, copy, { recursive:true })
  }
  db = new ClassicLevel(copy, { keyEncoding:'buffer', valueEncoding:'buffer', createIfMissing:false })
  await db.open()
  const raw = await db.get(LOCAL_KEY)
  if (!raw) throw new Error('T3 visit state missing')
  const state = JSON.parse(raw.subarray(1).toString(raw[0] === 0 ? 'utf16le' : 'latin1'))
  if (!state.threadLastVisitedAtById) throw new Error('T3 visit state missing')
  return visitMap(state, environmentId)
 } finally {
  try { if (db) await db.close() } finally { await fs.rm(dir, { recursive:true, force:true }) }
 }
}
module.exports = { readVisits, visitMap }
