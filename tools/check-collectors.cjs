// Run read-only collectors without launching a kiosk window or background timers.
const fs=require('fs'),path=require('path'),vm=require('vm'),{createRequire}=require('module')
const entry=path.join(__dirname,'../electron/main.cjs'),localRequire=createRequire(entry)
const electron={app:{whenReady:()=>({then:()=>{}}),on:()=>{}},ipcMain:{handle:()=>{}}}
const load=vm.runInThisContext('(function(require,__dirname){'+fs.readFileSync(entry,'utf8')+'\nreturn {fetchOpencodeHub,fetchHubUsage,refreshT3,forgeRefresh,buildSnapshot,state};})',{filename:entry})
const api=load(name=>name==='electron'?electron:localRequire(name),path.dirname(entry))
;(async()=>{
 await Promise.all([api.fetchOpencodeHub(),api.refreshT3()])
 await Promise.all([api.fetchHubUsage(),api.forgeRefresh()])
 await api.refreshT3();api.buildSnapshot()
 fs.writeFileSync('/tmp/kiosk-redesign-check.json',JSON.stringify(api.state,null,2))
 const s=api.state
 console.log(JSON.stringify({providers:s.providers.map(p=>({name:p.name,status:p.status,windows:p.bars.length})),usageUpdated:s.usage?.updatedAt,today:s.usage?.daily.at(-1),t3:s.t3.status,detail:s.t3.detail,sources:s.t3.sources,sessions:s.t3.sessions.length,linkedPRs:s.t3.sessions.reduce((n,s)=>n+s.prs.length,0),ci:s.t3.sessions.flatMap(s=>s.prs.map(p=>p.ci?.state)),withAgents:s.t3.sessions.filter(s=>s.agents?.length).length},null,2))
})().catch(e=>{console.error(e.message);process.exitCode=1})
