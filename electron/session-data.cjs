// Pure normalization shared by the collector and its fixture checks.
const epoch = value => value ? Math.floor(Date.parse(value) / 1000) || null : null
const parse = (value, fallback) => { try { return JSON.parse(value) ?? fallback } catch { return fallback } }
const SETTLED = `(t.settled_at IS NOT NULL AND COALESCE(t.settled_override, '') <> 'unsettled')`
const ROWS_SQL = `SELECT t.thread_id AS id, t.title, t.branch, t.updated_at AS updatedAt,
 t.latest_user_message_at AS latestUserMessageAt, t.snoozed_until AS snoozedUntil,
 t.pending_approval_count AS pendingApprovals, t.pending_user_input_count AS pendingInput,
 t.has_actionable_proposed_plan AS pendingPlan, t.model_selection_json AS modelSelection,
 t.latest_turn_id AS latestTurnId, p.title AS project, s.status AS sessionStatus, s.provider_name AS providerName,
 s.active_turn_id AS activeTurnId, s.updated_at AS sessionUpdatedAt,
 t.linked_pull_request_json AS linkedPr, t.branch_pull_request_json AS branchPr,
 tr.state AS turnState, tr.requested_at AS requestedAt, tr.started_at AS runningSince, tr.completed_at AS completedAt,
 (SELECT json_group_array(json_object('number',pr.number,'host',pr.host,'repository',pr.repository,'url',pr.url,
 'state',json_extract(pr.snapshot_json,'$.state'),'draft',json_extract(pr.snapshot_json,'$.isDraft'),
 'mergeability',json_extract(pr.snapshot_json,'$.mergeability'),'title',json_extract(pr.snapshot_json,'$.title'),
 'updatedAt',json_extract(pr.snapshot_json,'$.syncedAt')))
 FROM projection_thread_pull_requests pr WHERE pr.thread_id=t.thread_id) AS prs
 FROM projection_threads t JOIN projection_projects p ON p.project_id=t.project_id
 LEFT JOIN projection_thread_sessions s ON s.thread_id=t.thread_id
 LEFT JOIN projection_turns tr ON tr.thread_id=t.thread_id AND tr.turn_id=COALESCE(s.active_turn_id,t.latest_turn_id)
 WHERE t.deleted_at IS NULL AND t.archived_at IS NULL AND NOT ${SETTLED}
 ORDER BY COALESCE(t.latest_user_message_at,t.updated_at) DESC`
const STATS_SQL = `SELECT SUM(CASE WHEN t.snoozed_until IS NOT NULL AND NOT ${SETTLED} THEN 1 ELSE 0 END) AS snoozed,
 SUM(CASE WHEN ${SETTLED} THEN 1 ELSE 0 END) AS settled FROM projection_threads t WHERE t.deleted_at IS NULL AND t.archived_at IS NULL`
// Start with visible threads so SQLite uses its thread/activity index before
// parsing JSON. Scanning all historical payloads stalls session status updates.
const AGENTS_SQL = `SELECT a.thread_id AS threadId,a.turn_id AS turnId,a.payload_json AS payload,a.created_at AS createdAt FROM
 projection_threads t CROSS JOIN projection_thread_activities a ON t.thread_id=a.thread_id AND t.latest_turn_id=a.turn_id
 WHERE json_extract(a.payload_json,'$.itemType')='collab_agent_tool_call' AND t.deleted_at IS NULL AND t.archived_at IS NULL
 ORDER BY a.created_at ASC`
function prIdentity(pr) { return `${(pr.host || '').replace(/^https?:\/\//,'').toLowerCase()}/${(pr.repository || '').toLowerCase()}#${pr.number}` }
function normalizePr(p) {
 let host=p.host, repository=p.repository
 try { const u=new URL(p.url); const parts=u.pathname.match(/^\/([^/]+\/[^/]+)\/pulls?\/\d+/); if(parts) { host ||= u.host; repository ||= parts[1] } } catch {}
 return { number:Number(p.number), host:host || undefined, repository:repository || undefined, url:p.url || undefined,
 state:p.state === 'merged' ? 'merged' : p.state === 'closed' ? 'closed' : p.state === 'open' ? 'open' : null,
 draft:!!(p.draft ?? p.isDraft), mergeability:p.mergeability || null,title:p.title || null,relation:p.relation || 'linked',
 updatedAt:p.updatedAt ? Date.parse(p.updatedAt) || undefined : undefined }
}
function threadPrs(r) {
 const linked=parse(r.prs,[])
 // T3's explicit registrations take precedence over its legacy/branch fallback.
 const fallback=parse(r.linkedPr,null) || parse(r.branchPr,null)
 const candidates=linked.length ? linked : fallback ? [{...fallback,relation:r.linkedPr?'linked':'branch'}] : []
 return [...new Map(candidates.filter(p=>Number.isInteger(Number(p.number)) && Number(p.number)>0).map(p=>{const pr=normalizePr(p);return [prIdentity(pr),pr]})).values()]
}
function mapRows(rows, origin, now = Date.now(), visited = {}) {
 return rows.map(r => {
  const snoozedUntil = epoch(r.snoozedUntil), completedAt = epoch(r.completedAt), userAt = epoch(r.latestUserMessageAt)
  const lifecycle = snoozedUntil == null ? 'active' : snoozedUntil*1000 <= now ? 'woke' : 'snoozed'
  const lastVisitedAt=visited[r.id], lastVisitedMs=Date.parse(lastVisitedAt)
  const unread=lastVisitedAt && Date.parse(r.completedAt)>lastVisitedMs
  const errorAtMs=Date.parse(r.completedAt || r.sessionUpdatedAt || r.updatedAt)
  const errorWasRead=r.sessionStatus === 'error' && Number.isFinite(lastVisitedMs) && Number.isFinite(errorAtMs) && lastVisitedMs >= errorAtMs
  // Proposed plans alone are not pending input; completed and failed turns
  // remain attention states only until the user visits the thread.
  // T3 can leave completed_at populated when a turn resumes or continues.
  // The active turn's state is the live signal; a stale completion timestamp
  // must not demote that turn to idle or reset its elapsed-time display.
  const turnInProgress = ['running','starting'].includes(r.turnState) && ['running','starting'].includes(r.sessionStatus)
  const status = r.pendingApprovals > 0 ? 'approval' : r.pendingInput > 0 ? 'input'
   : ['running','starting'].includes(r.sessionStatus) || turnInProgress ? 'working'
   : r.sessionStatus === 'error' && !errorWasRead ? 'error' : unread ? 'done' : 'idle'
  const model = parse(r.modelSelection, {})
  return { id:r.id,title:r.title,branch:r.branch || null,project:r.project,projectInitials:String(r.project || '?').slice(0,2).toUpperCase(),
   status,lifecycle,harness:r.providerName || null,snoozedUntil,completedAt,workingSince:status === 'working' ?
    (turnInProgress || !r.completedAt ? epoch(r.runningSince) ?? epoch(r.requestedAt) : null) ?? epoch(r.sessionUpdatedAt) : null,
   activityAt:userAt ?? epoch(r.updatedAt),origin,model:typeof model.model === 'string' ? model.model : typeof model.modelId === 'string' ? model.modelId : null,
   latestTurnId:r.latestTurnId,prs:threadPrs(r) }
 })
}
function attachAgents(sessions, activities) {
 const byParent = new Map()
 for (const row of activities) {
  const payload = parse(row.payload,{}), item = payload.data?.item
  if (!item) continue
  const parent = item.senderThreadId || row.threadId
  const session = sessions.find(s => s.id === row.threadId || s.id === parent)
  if (!session || !session.latestTurnId || row.turnId !== session.latestTurnId) continue
  const agents = byParent.get(session.id) || new Map()
  for (const id of new Set([...(item.receiverThreadIds || []),...Object.keys(item.agentsStates || {})])) {
   const previous = agents.get(id), state = item.agentsStates?.[id]?.status
   const status = item.tool === 'closeAgent' && item.status === 'completed' || state === 'shutdown' ? 'closed'
    : state === 'running' || state === 'pendingInit' ? 'working' : state === 'completed' ? 'done'
    : state === 'errored' || state === 'error' ? 'error' : previous?.status || 'unknown'
   agents.set(id,{id,name:item.agentsStates?.[id]?.nickname || previous?.name || null,model:item.model || previous?.model || null,status,updatedAt:Date.parse(row.createdAt),turnId:row.turnId})
  }
  byParent.set(session.id,agents)
 }
 for (const s of sessions) {
  const values=[...(byParent.get(s.id)?.values() || [])]
  s.agents=values.filter(a => a.status !== 'closed' && a.status !== 'unknown' && !(a.status === 'working' && s.status !== 'working')).map(({turnId,...a})=>a)
 }
}
function normalizeForgePr(p, repo, now = Date.now()) {
 const merged = !!p.merged || !!p.merged_at || p.state === 'merged'
 return { number:Number(p.number),host:repo.host,repository:`${repo.owner}/${repo.name}`,url:p.html_url,
  headSha:p.head?.sha,updatedAt:now,state:merged?'merged':p.state==='closed'?'closed':'open',draft:!!p.draft,
  // A failed mergeability check can also mean pending checks or branch policy.
  mergeability:p.mergeable_state==='dirty'?'conflicting':p.mergeable===true?'mergeable':null,title:p.title || null }
}
function normalizeChecks(body, now = Date.now()) {
 if (body && body.total_count === 0 && body.statuses == null) return {state:'none',passed:0,total:0,failed:0,updatedAt:now}
 if (!body || !Array.isArray(body.statuses)) return {state:'unknown',passed:0,total:0,failed:0,updatedAt:now}
 const latest = new Map()
 for (const s of body.statuses) {
  const key=s.context || String(s.id), old=latest.get(key)
  if (!old || Date.parse(s.updated_at || s.created_at || 0) >= Date.parse(old.updated_at || old.created_at || 0)) latest.set(key,s)
 }
 const states=[...latest.values()].map(s=>s.status || s.state), passed=states.filter(s=>s==='success').length, failed=states.filter(s=>s==='failure'||s==='error').length
 return {state:failed?'failure':body.total_count > states.length?'unknown':states.length===0?'none':passed===states.length?'success':'pending',passed,total:states.length,failed,updatedAt:now}
}
function normalizeReviews(rows) {
 if (!Array.isArray(rows)) return 'unknown'
 const latest=new Map()
 for (const r of [...rows].sort((a,b)=>Date.parse(a.submitted_at || a.updated_at || 0)-Date.parse(b.submitted_at || b.updated_at || 0))) {
  if (['APPROVED','REQUEST_CHANGES','DISMISSED'].includes(r.state)) latest.set(r.user?.id ?? r.user?.login ?? r.id,r.state)
 }
 return [...latest.values()].includes('REQUEST_CHANGES')?'changes':[...latest.values()].includes('APPROVED')?'approved':'pending'
}
function recordQuota(history, provider, now = Date.now()) {
 for (const bar of provider.bars || []) {
  if (bar.usedPct == null || !bar.resetsAt) continue
  const key=`${provider.id}:${bar.label}`, at=provider.updatedAt || now, prev=history.get(key) || []
  let samples=prev.filter(s=>s.reset===bar.resetsAt && now-s.at<6*3600000)
  if (samples.length && bar.usedPct < samples.at(-1).used) samples=[]
  if (!samples.length || at>samples.at(-1).at) samples.push({at,used:bar.usedPct,reset:bar.resetsAt})
  history.set(key,samples.slice(-100))
  const recent=samples.filter(s=>at-s.at<=3600000), first=recent[0], last=recent.at(-1)
  bar.burnPctPerHour=recent.length>=3 && last.at-first.at>=10*60000 && last.used>first.used ? (last.used-first.used)/((last.at-first.at)/3600000) : null
 }
}
function normalizeUsageDay(day) {
 const sum = field => (day.models || []).reduce((n, m) => n + (m[field] || 0), 0)
 return { date:day.date,totalTokens:day.totalTokens ?? sum('totalTokens'),
  costUsd:Number.isFinite(day.estimatedCostUsd)?day.estimatedCostUsd:null,
  inputTokens:day.inputTokens ?? sum('inputTokens'),outputTokens:day.outputTokens ?? sum('outputTokens'),
  cachedInputTokens:day.cachedInputTokens ?? day.cacheReadInputTokens ?? sum('cacheReadInputTokens'),
  cacheObservedInputTokens:day.cacheObservedInputTokens ?? sum('cacheObservedInputTokens'),
  pricedRequests:day.pricedRequests,unpricedRequests:day.unpricedRequests,unmeteredRequests:day.unmeteredRequests }
}
module.exports={ROWS_SQL,STATS_SQL,AGENTS_SQL,mapRows,attachAgents,prIdentity,normalizeForgePr,normalizeChecks,normalizeReviews,recordQuota,normalizeUsageDay}
