const { test } = require('node:test')
const assert = require('node:assert/strict')
const {mapRows,attachAgents,prIdentity,normalizeForgePr,normalizeChecks,normalizeReviews,recordQuota,normalizeUsageDay}=require('../electron/session-data.cjs')
const now=Date.parse('2026-09-26T12:00:00Z')
const row={id:'parent',title:'Work',project:'Project',sessionStatus:'ready',latestUserMessageAt:'2026-09-26T10:00:00Z',updatedAt:'2026-09-26T11:00:00Z',prs:'[]'}
test('Done means an unread completion, with millisecond precision',()=>{
 assert.equal(mapRows([row],'linux',now)[0].status,'idle')
 const completed={...row,turnState:'completed',completedAt:'2026-09-26T11:00:00.351Z'}
 assert.equal(mapRows([completed],'linux',now)[0].status,'idle')
 assert.equal(mapRows([completed],'linux',now,{parent:'2026-09-26T11:00:00.351Z'})[0].status,'idle')
 assert.equal(mapRows([completed],'linux',now,{parent:'2026-09-26T11:00:00.350Z'})[0].status,'done')
 assert.equal(mapRows([completed],'linux',now,{parent:'2026-09-26T11:10:00Z'})[0].status,'idle')
})
test('old proposed plans do not make stopped sessions request input',()=>{
 assert.equal(mapRows([{...row,title:'Review fixture implementation',sessionStatus:'stopped',pendingPlan:1,turnState:'completed',completedAt:'2026-09-24T13:15:13.351Z'}],'mac',now,{parent:'2026-09-24T13:15:13.351Z'})[0].status,'idle')
})
test('current session state wins over stale turn state; connecting uses its own timer',()=>{
 assert.equal(mapRows([{...row,turnState:'running'}],'linux',now)[0].status,'idle')
 assert.equal(mapRows([{...row,turnState:'error'}],'linux',now)[0].status,'idle')
 assert.equal(mapRows([{...row,sessionStatus:'error'}],'linux',now)[0].status,'error')
 const s=mapRows([{...row,sessionStatus:'starting',sessionUpdatedAt:'2026-09-26T11:00:00Z',runningSince:'2026-09-25T12:00:00Z',completedAt:'2026-09-25T13:00:00Z'}],'linux',now)[0]
 assert.equal(s.status,'working');assert.equal(s.workingSince,Date.parse('2026-09-26T11:00:00Z')/1000)
})
test('input and approval outrank running; expired snoozes stay parked',()=>{
 const s=mapRows([{...row,sessionStatus:'running',pendingInput:1,snoozedUntil:'2026-09-26T11:30:00Z'}],'linux',now)[0]
 assert.equal(s.status,'input');assert.equal(s.lifecycle,'woke')
 assert.equal(mapRows([{...row,pendingApprovals:1,pendingInput:1}],'linux',now)[0].status,'approval')
 assert.equal(mapRows([{...row,snoozedUntil:'2026-09-27T11:30:00Z'}],'linux',now)[0].lifecycle,'snoozed')
})
test('PR identities never collide across repositories and hosts',()=>{
 assert.notEqual(prIdentity({host:'a',repository:'x/a',number:1}),prIdentity({host:'a',repository:'x/b',number:1}))
 assert.notEqual(prIdentity({host:'a',repository:'x/a',number:1}),prIdentity({host:'b',repository:'x/a',number:1}))
})
test('only authoritative T3 links or branch snapshots associate PRs',()=>{
 assert.deepEqual(mapRows([{...row,title:'Review PR 780 and 778',branch:'preview/731-780'}],'linux',now)[0].prs,[])
 const fallback={number:789,url:'https://git.example/team/repo/pulls/789',state:'open',isDraft:true}
 const s=mapRows([{...row,branchPr:JSON.stringify(fallback)}],'linux',now)[0]
 assert.equal(s.prs[0].repository,'team/repo');assert.equal(s.prs[0].host,'git.example');assert.equal(s.prs[0].draft,true);assert.equal(s.prs[0].relation,'branch')
 const linked=mapRows([{...row,prs:JSON.stringify([{...fallback,number:790}]),branchPr:JSON.stringify(fallback)}],'linux',now)[0]
 assert.deepEqual(linked.prs.map(p=>p.number),[790])
})
test('CI deduplicates contexts and counts failures, missing is unknown',()=>{
 const ci=normalizeChecks({statuses:[{context:'test',status:'failure',updated_at:'2026-09-26T11:00:00Z'},{context:'test',status:'success',updated_at:'2026-09-26T10:00:00Z'},{context:'lint',status:'success'}]},now)
 assert.deepEqual([ci.state,ci.total,ci.passed,ci.failed],['failure',2,1,1])
 assert.equal(normalizeChecks({total_count:0,statuses:null}).state,'none');assert.equal(normalizeChecks(null).state,'unknown');assert.equal(normalizeChecks({statuses:[]}).state,'none')
})
test('mergeable false does not invent a conflict; explicit dirty state does',()=>{
 const repo={host:'git.example',owner:'team',name:'repo'},pr={number:1,state:'open',mergeable:false}
 assert.equal(normalizeForgePr(pr,repo).mergeability,null)
 assert.equal(normalizeForgePr({...pr,mergeable_state:'dirty'},repo).mergeability,'conflicting')
 assert.equal(normalizeForgePr({...pr,state:'closed',merged_at:'2026-09-26'},repo).state,'merged')
})
test('review dismissal removes previous approval',()=>{
 assert.equal(normalizeReviews([{user:{id:1},state:'APPROVED',submitted_at:'2026-09-25'},{user:{id:1},state:'DISMISSED',submitted_at:'2026-09-26'}]),'pending')
})
test('a completed spawn tool is not a completed child',()=>{
 const sessions=[{id:'parent',latestTurnId:'turn',status:'working'}]
 const event={threadId:'parent',turnId:'turn',createdAt:'2026-09-26T11:00:00Z',payload:JSON.stringify({data:{item:{senderThreadId:'provider-parent',receiverThreadIds:['child'],status:'completed',tool:'spawnAgent',agentsStates:{child:{status:'running'}}}}})}
 attachAgents(sessions,[event]);assert.equal(sessions[0].agents[0].status,'working')
 const completed={...event,createdAt:'2026-09-26T11:10:00Z',payload:JSON.stringify({data:{item:{receiverThreadIds:['child'],agentsStates:{child:{status:'completed'}}}}})}
 attachAgents(sessions,[event,completed]);assert.equal(sessions[0].agents.length,1);assert.equal(sessions[0].agents[0].status,'done')
 assert.equal(sessions[0].agents[0].name,null)
 attachAgents(sessions,[{...event,turnId:'old-turn'}]);assert.equal(sessions[0].agents.length,0)
 const closed={...event,createdAt:'2026-09-26T11:15:00Z',payload:JSON.stringify({data:{item:{tool:'closeAgent',status:'completed',receiverThreadIds:['child'],agentsStates:{child:{status:'running'}}}}})}
 attachAgents(sessions,[event,closed]);assert.equal(sessions[0].agents.length,0)
 sessions[0].status='idle';attachAgents(sessions,[event]);assert.equal(sessions[0].agents.length,0)
})
test('quota burn requires observations, resets break the series',()=>{
 const history=new Map(),p={id:'a',updatedAt:now,bars:[{label:'Weekly',resetsAt:now/1000+1000,usedPct:50}]}
 recordQuota(history,p,now);assert.equal(p.bars[0].burnPctPerHour,null)
 p.updatedAt=now+300000;p.bars[0].usedPct=51;recordQuota(history,p,p.updatedAt)
 p.updatedAt=now+600000;p.bars[0].usedPct=52;recordQuota(history,p,p.updatedAt)
 assert.equal(p.bars[0].burnPctPerHour,12)
 p.updatedAt+=300000;p.bars[0].usedPct=2;p.bars[0].resetsAt+=604800;recordQuota(history,p,p.updatedAt)
 assert.equal(p.bars[0].burnPctPerHour,null)
})

test('daily input and cache totals come from model rows, with observed coverage',()=>{
 const result=normalizeUsageDay({date:'2026-09-26',totalTokens:1010,estimatedCostUsd:3,models:[{inputTokens:900,outputTokens:5,cacheReadInputTokens:0,cacheObservedInputTokens:0},{inputTokens:100,outputTokens:5,cacheReadInputTokens:90,cacheObservedInputTokens:100}]})
 assert.equal(result.inputTokens,1000);assert.equal(result.outputTokens,10);assert.equal(result.cachedInputTokens,90);assert.equal(result.cacheObservedInputTokens,100);assert.equal(result.costUsd,3)
 assert.equal(normalizeUsageDay({date:'2026-09-26',models:[]}).costUsd,null)
})
