import snapshot from './preview-data.json'
import type { KioskData } from './types'
export function installPreview() {
  const params = new URLSearchParams(location.search)
  let data = structuredClone(snapshot) as unknown as KioskData
  const mode = params.get('preview')
  const now=Date.now()
  const nowSec=Math.floor(now/1000)
  const dateKey=(date:Date)=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`
  const dayKeys=Array.from({length:7},(_,i)=>{const d=new Date();d.setHours(12,0,0,0);d.setDate(d.getDate()-6+i);return dateKey(d)})
  const remapDaily=(daily:Record<string,number>)=>{const values=Object.values(daily||{});return Object.fromEntries(dayKeys.map((day,i)=>[day,values[i]??0]))}
  data.updatedAt=now; data.activity.hub!.updatedAt=now; data.usage!.updatedAt=now
  for(const p of data.providers){p.updatedAt=now;for(const bar of p.bars)if(bar.windowMins)bar.resetsAt=nowSec+bar.windowMins*60*.7}
  for(const s of data.t3!.sessions){
    const age=s.id==='demo-session-2'?90:s.status==='working'?600:s.status==='idle'?7200:45
    s.activityAt=nowSec-age
    s.completedAt=s.status==='working'?null:nowSec-age
    s.workingSince=s.status==='working'?nowSec-(s.id==='demo-session-3'?830:1720):null
    if(s.lifecycle==='woke')s.snoozedUntil=nowSec-120
    for(const p of s.prs)if(p.ci)p.ci.updatedAt=now
    for(const a of s.agents||[])a.updatedAt=now
  }
  data.activity.hub!.daily=data.activity.hub!.daily?.map((d,i)=>({...d,date:dayKeys[i]}))
  for(const m of data.activity.hub!.models||[])m.daily=remapDaily(m.daily)
  for(const m of data.usage!.modelsDaily||[])m.daily=remapDaily(m.daily)
  data.usage!.daily=data.usage!.daily?.map((d,i)=>({...d,date:dayKeys[i]}))
  if (mode === 'few') data.t3!.sessions = data.t3!.sessions.slice(0, 3).concat(data.t3!.sessions.filter(s => s.lifecycle === 'woke'))
  if (mode === 'busy') data.t3!.sessions = Array.from({ length: 30 }, (_, i) => ({...data.t3!.sessions[i % 8],id:`busy-${i}`,title:`${data.t3!.sessions[i % 8].title} ${i + 1}`})).concat(data.t3!.sessions.filter(s => s.lifecycle === 'woke'))
  if (mode === 'empty') { data.t3!.sessions = []; data.t3!.stats = {snoozed:0,settled:0}; data.usage!.modelsDaily=[]; data.usage!.daily=[]; data.activity.hub!.todayTokens=0 }
  if (mode === 'stale') {data.opencode={status:'unreachable'};data.t3!.detail='remote T3 source unavailable';data.t3!.sessions=data.t3!.sessions.map(s=>({...s,stale:true,staleAt:now-180000}));data.activity.hub!.updatedAt=Date.now()-600000}
  const listeners = new Set<(data:KioskData)=>void>()
  window.kiosk = { getData: async () => data, onData: callback => {listeners.add(callback);return ()=>{listeners.delete(callback)}}, onTick:()=>()=>{} }
  Object.assign(window,{__previewSet:(next:KioskData)=>{data=next;listeners.forEach(f=>f(next))},__previewData:data})
}
