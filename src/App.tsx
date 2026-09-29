import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { Check, CircleCheck, CircleDashed, CircleHelp, CirclePause, CircleX, Clock3, GitBranch, GitMerge, GitPullRequest, GitPullRequestClosed, GitPullRequestDraft, MessageSquare, ShieldQuestion, Users, TriangleAlert, Zap } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { TokenCounter } from "./components/TokenCounter"
import { CompletionPixels } from "./components/CompletionPixels"
import { Setup } from "./components/Setup"
import { DeviceLogo, HarnessLogo, ProviderLogo } from "./components/BrandLogo"
import { cn, fmtCountdown, fmtTokens } from "./lib/utils"
import { dayKey, elapsed, modelColor, modelName, modelRows, orderSessions, sessionRank } from "./lib/dashboard"
import type { KioskData, KioskTick, ProviderCard, T3Pr, T3Session, UsageBar } from "./types"

function useData() {
  const [data, setData] = useState<KioskData | null>(null)
  const [tick, setTick] = useState<KioskTick | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let alive = true
    const pull = async () => {
      try {
        if (!window.kiosk) return
        const next = await window.kiosk.getData()
        if (alive) { setData(next); setFailed(false) }
      } catch { if (alive) setFailed(true) }
    }
    void pull()
    const off = window.kiosk?.onData(d => { if (alive) { setData(d); setFailed(false) } })
    const offTick = window.kiosk?.onTick?.(t => { if (alive) setTick(t) })
    const interval = setInterval(pull, 12000)
    return () => { alive = false; off?.(); offTick?.(); clearInterval(interval) }
  }, [])
  return { data, tick, failed }
}

function Signal({ icon: Icon, label, tone = "quiet", children }: { icon: LucideIcon; label: string; tone?: string; children?: React.ReactNode }) {
  return <span className={cn("signal", tone)} role="img" aria-label={label} title={label}><Icon aria-hidden="true" />{children}</span>
}

function Today({ data, tick, now }: { data: KioskData; tick: KioskTick | null; now: number }) {
  const today = dayKey(new Date(now)), daily = data.usage?.daily.find(d => d.date === today)
  const tokens = daily?.totalTokens ?? tick?.tokensToday ?? ((data.activity.hub?.todayTokens ?? 0) + (data.activity.claude?.todayTokens ?? 0))
  const rate = tick?.tokensPerMin ?? data.usage?.tokensPerMin ?? 0
  const models = modelRows(data, today).filter(m => m.tokens > 0), total = models.reduce((sum, m) => sum + m.tokens, 0)
  const share = (value: number) => value / total < .001 ? "<0.1%" : `${(value / total * 100).toLocaleString("en", { maximumFractionDigits: 1 })}%`
  const cache = daily?.cacheObservedInputTokens ? daily.cachedInputTokens / daily.cacheObservedInputTokens : null
  const coverage = daily?.inputTokens ? (daily.cacheObservedInputTokens ?? 0) / daily.inputTokens : null
  const unpriced = (daily?.unpricedRequests ?? 0) + (daily?.unmeteredRequests ?? 0)
  const cost = unpriced > 0 && !daily?.pricedRequests && !daily?.costUsd ? null : daily?.costUsd
  const at = tick?.updatedAt ?? data.activity.hub?.updatedAt, stale = at != null && now - at > 120000
  const other = models.slice(6).reduce((sum, m) => sum + m.tokens, 0)
  return <section className="today-panel" aria-label="Tokens today">
    <h2>Tokens today{data.usage?.partial && <span className="warning usage-partial" title="A usage source is temporarily unavailable"> · partial</span>}</h2><TokenCounter tokens={tokens} />
    <div className={cn("rate", stale && "warning")}>{stale ? <><Clock3 />{elapsed(at! / 1000, now)} old</> : <><Zap className="rate-icon" aria-hidden="true" /><span className="digits">{fmtTokens(Math.round(rate))}</span><span>/min</span></>}</div>
    <div className="model-list">{models.slice(0, 6).map(m => <div className="model-row" key={m.model}>
      <div className="model-row-label"><span className="model-dot" style={{ background: modelColor(m.model) }} /><span className="model-name">{modelName(m.model)}</span><span className="model-tokens digits">{fmtTokens(m.tokens)}</span><span className="model-share digits">{share(m.tokens)}</span></div>
      <div className="model-track"><span style={{ width: `${m.tokens / total * 100}%`, background: modelColor(m.model) }} /></div>
    </div>)}{other > 0 && <div className="model-other"><span>Other</span><span className="model-tokens digits">{fmtTokens(other)}</span><span className="model-share digits">{share(other)}</span></div>}
    {!models.length && <div className="quiet empty">{data.usage ? "No usage today" : "Usage unavailable"}</div>}</div>
    <dl className="usage-details">
      <div><dt title={unpriced > 0 ? "Lower bound: some requests lack price data" : undefined}>{data.usage?.pricingBasis === "list-price" ? "API equivalent" : "API estimate"}</dt><dd className="digits" title={unpriced > 0 ? "Excludes requests without price data" : undefined}>{cost == null ? "—" : `${unpriced > 0 ? "" : "≈ "}$${cost.toLocaleString("en-US", { maximumFractionDigits: cost < 10 ? 2 : 0 })}${unpriced > 0 ? "+" : ""}`}</dd></div>
      <div><dt>Cache hit{cache != null && coverage != null && coverage < .995 && <span className="cache-coverage"> · {Math.round(coverage * 100)}% of input</span>}</dt><dd className="digits" aria-label={cache == null ? "Cache data unavailable" : `${Math.round(cache * 100)} percent of reported input tokens served from cache`}>{cache == null ? "—" : `${Math.round(cache * 100)}%`}</dd></div>
    </dl>
  </section>
}

function Activity({ data, now }: { data: KioskData; now: number }) {
  const today = dayKey(new Date(now))
  const source = data.usage?.daily ?? data.activity.hub?.daily?.map(d => ({ date: d.date, totalTokens: d.tokens })) ?? []
  const days = Array.from({ length: 7 }, (_, i) => { const date = new Date(now); date.setDate(date.getDate() - 6 + i); const key = dayKey(date); return { date: key, tokens: source.find(d => d.date === key)?.totalTokens ?? null } })
  const models = modelRows(data, today).map(m => ({ ...m, week: days.reduce((sum, d) => sum + (m.daily[d.date] ?? 0), 0) })).filter(m => m.week > 0).sort((a, b) => b.week - a.week).slice(0, 5)
  const max = Math.max(...days.map(d => d.tokens ?? 0), 1), total = days.reduce((sum, d) => sum + (d.tokens ?? 0), 0)
  return <section className="activity-panel" aria-label="Token activity over seven calendar days">
    <div className="section-heading"><h2>Token activity</h2><span className="quiet">7d</span></div>
    <div className="activity-chart">{days.map(day => {
      let bottom = 0
      const segments = models.map(m => { const tokens = m.daily[day.date] ?? 0; const segment = { model: m.model, tokens, bottom }; bottom += tokens; return segment })
      const other = Math.max(0, (day.tokens ?? 0) - bottom)
      if (other > 0) segments.push({ model: "Other", tokens: other, bottom })
      return <div className={cn("activity-day", day.date === today && "is-today")} key={day.date}>
        <span className="digits activity-value">{day.tokens == null ? "—" : fmtTokens(day.tokens)}</span>
        <div className="activity-track" role="img" aria-label={`${day.date}: ${day.tokens == null ? "unavailable" : fmtTokens(day.tokens) + " tokens"}`}>
          {day.tokens != null && day.tokens > 0 && <span className="activity-fill" style={{ height: `${day.tokens / max * 100}%` }}>{segments.filter(s => s.tokens > 0).map(s => <span key={s.model} className="activity-segment" style={{ bottom: `${s.bottom / day.tokens! * 100}%`, height: `${s.tokens / day.tokens! * 100}%`, background: s.model === "Other" ? "var(--other)" : modelColor(s.model) }} />)}</span>}
        </div><span className="day-label">{new Date(`${day.date}T12:00:00`).toLocaleDateString("en", { weekday: "short" })}</span>
      </div>
    })}</div>
    <div className="activity-legend">{models.map(m => <div key={m.model}><span className="model-dot" style={{ background: modelColor(m.model) }} /><span>{modelName(m.model)}</span><span className="digits">{fmtTokens(m.week)}</span></div>)}</div>
    <div className="activity-total"><span className="digits">{fmtTokens(total)}</span><span className="quiet">in 7 days</span></div>
  </section>
}

type QuotaEntry = { provider: ProviderCard; bar: UsageBar }
function quotaState({ provider, bar }: QuotaEntry, now: number) {
  const left = bar.usedPct == null ? null : Math.min(100, Math.max(0, 100 - bar.usedPct))
  const remaining = bar.resetsAt == null ? null : bar.resetsAt * 1000 - now
  const stale = provider.status === "error" || (provider.updatedAt != null && now - provider.updatedAt > 900000)
  const ideal = !stale && remaining != null && remaining > 0 && bar.windowMins ? Math.min(100, remaining / (bar.windowMins * 60000) * 100) : null
  const overused = left != null && ideal != null && left < ideal
  const hours = bar.burnPctPerHour != null && bar.burnPctPerHour > 0 && left != null ? left / bar.burnPctPerHour : null
  const willRunOut = !stale && hours != null && remaining != null && hours * 3600000 < remaining
  return { left, remaining, stale, ideal, overused, hours, willRunOut }
}
function accountLabel(provider: ProviderCard) {
  return provider.quotaGroup === "codex" && provider.plan === "Pro" ? "Pro 20×" : provider.plan || provider.sublabel || provider.name
}
function Quota({ entries, now }: { entries: QuotaEntry[]; now: number }) {
  const shared = entries.length > 1, states = entries.map(entry => ({ ...entry, ...quotaState(entry, now) }))
  const first = states[0]
  return <div className={cn("quota", shared && "quota-shared")}>
    <div className="quota-label"><span>{first.bar.label.replace(/\s*\(.*\)/, "")}</span>{!shared && first.provider.id !== "anthropic" && first.willRunOut && <span className="quota-forecast warning">empty ~{fmtCountdown(first.hours! * 3600000)}</span>}{!shared && <strong className={cn("digits", first.left === 0 && "danger")}>{first.left == null ? "—" : `${Math.round(first.left)}%`}</strong>}</div>
    <div className="quota-track">
      {states.map(({ provider, bar, left, remaining, stale, ideal, overused }) => <div key={provider.id} className={cn("quota-segment", stale && "stale")} style={{ flex: shared ? Math.max(.001, provider.weight ?? 1) : 1 }} role="img" aria-label={`${shared ? accountLabel(provider) + ": " : ""}${bar.label}: ${left == null ? "unavailable" : `${Math.round(left)} percent remaining`}${ideal == null || left == null ? "" : `, ${overused ? "overused" : "on pace"}; even-use target ${Math.round(ideal)} percent remaining`}${stale ? ", stale" : ""}`}>
        {left != null && <span className="quota-fill" style={{ width: `${left}%` }} />}
        {!shared && remaining != null && <span className="quota-reset"><Clock3 />{fmtCountdown(remaining)}</span>}
        {ideal != null && left != null && <span className={cn("ideal-marker", overused ? "pace-over" : "pace-good")} style={{ left: `clamp(1px, ${ideal}%, calc(100% - 3px))` }} />}
      </div>)}
    </div>
    {shared && <div className="quota-accounts">{states.map(({provider, left, remaining, stale}) => <div key={provider.id}><span>{accountLabel(provider)}</span><strong className={cn("digits", left === 0 && "danger")}>{left == null ? "—" : `${Math.round(left)}%`}</strong><span className="quota-account-reset">{stale ? <Clock3 aria-label="Stale quota" /> : remaining != null && <><Clock3 />{fmtCountdown(remaining)}</>}</span></div>)}</div>}
  </div>
}
function Capacity({ providers, now }: { providers: ProviderCard[]; now: number }) {
  const visible = providers.filter(p => p.id !== "kimi" && p.icon !== "kimi" && p.status !== "unconfigured" && p.bars.length > 0)
  const groups = new Map<string, ProviderCard[]>()
  for (const provider of visible) {
    const key = provider.quotaGroup || provider.id
    groups.set(key, [...groups.get(key) ?? [], provider])
  }
  return <section className="capacity-panel" aria-label="Provider capacity"><div className="section-heading"><h2>Capacity</h2><span className="quiet">left</span></div>{!visible.length && <p className="quiet empty">No capacity available</p>}<div className="provider-list">{[...groups].map(([id, members]) => {
    const windows = new Map<string, QuotaEntry[]>()
    for (const provider of members) for (const bar of provider.bars) {
      const key = `${bar.label.replace(/\s*\(.*\)/, "").toLowerCase()}:${bar.windowMins ?? ""}`
      windows.set(key, [...windows.get(key) ?? [], { provider, bar }])
    }
    const p = members[0], stale = members.some(p => quotaState({provider:p,bar:p.bars[0]}, now).stale)
    return <div className="provider" key={id}><div className="provider-name"><ProviderLogo id={p.quotaGroup || p.id} /><span>{p.name.replace(/ - Auth$/, "")}</span>{members.length === 1 && p.plan && <span className="quiet">{accountLabel(p)}</span>}{stale && <Signal icon={Clock3} label="Quota is stale" tone="warning" />}</div>{[...windows].map(([key, entries]) => <Quota key={key} entries={entries} now={now} />)}</div>
  })}</div></section>
}

function PullRequest({ pr, now }: { pr: T3Pr; now: number }) {
  const merged = pr.state === "merged", closed = pr.state === "closed", conflict = !merged && !closed && pr.mergeability === "conflicting"
  const Icon = merged ? GitMerge : closed ? GitPullRequestClosed : pr.draft ? GitPullRequestDraft : GitPullRequest
  const tone = merged ? "merged" : closed ? "danger" : pr.review === "changes" ? "warning" : pr.draft || !pr.state ? "quiet" : "success", ci = pr.ci, stale = ci != null && now - ci.updatedAt > 600000
  return <span className="pr-facts"><span className={cn("pr-number", tone)} role="img" aria-label={`PR ${pr.number}: ${merged ? "merged" : closed ? "closed" : pr.draft ? "draft" : pr.state === "open" ? "open" : "unknown"}${pr.review === "changes" && !merged && !closed ? ", changes requested" : ""}`}><Icon /><span className="digits">#{pr.number}</span></span>
    {conflict && <Signal icon={TriangleAlert} label="Merge conflicts" tone="warning" />}
    {pr.review === "approved" && !merged && !closed && <Signal icon={Check} label="Review approved" tone="success" />}
    {ci && ci.state !== "none" && <Signal icon={stale ? Clock3 : ci.state === "success" ? CircleCheck : ci.state === "failure" ? CircleX : ci.state === "pending" ? CircleDashed : CircleHelp} label={stale ? "CI is stale" : `CI ${ci.state}: ${ci.passed} of ${ci.total} passed${ci.failed ? `, ${ci.failed} failed` : ""}`} tone={stale ? "quiet" : ci.state === "success" ? "success" : ci.state === "failure" ? "danger" : ci.state === "pending" ? "warning" : "quiet"}>{ci.total > 0 && <span className="digits">{ci.passed}/{ci.total}</span>}</Signal>}
  </span>
}
function SessionState({ session: s, now }: { session: T3Session; now: number }) {
  const observedAt = s.stale && s.staleAt ? s.staleAt : now
  const ago = (at: number | null | undefined) => { const age = elapsed(at, observedAt); return age === "now" || age === "—" ? age : `${age} ago` }
  let Icon: LucideIcon | null = null, tone = "quiet", label = "Idle", value = ago(s.activityAt)
  if (s.lifecycle === "woke") { Icon = Clock3; tone = "warning"; label = "Snoozed session has woken"; value = `Woke ${elapsed(s.snoozedUntil, now)}` }
  else if (s.lifecycle === "snoozed") { Icon = CirclePause; label = "Snoozed"; value = s.snoozedUntil ? fmtCountdown(s.snoozedUntil * 1000 - now) : "—" }
  else if (s.status === "input" || s.status === "woke") { Icon = MessageSquare; tone = "warning"; label = "Needs input"; value = "Input" }
  else if (s.status === "approval") { Icon = ShieldQuestion; tone = "warning"; label = "Needs approval"; value = "Approval" }
  else if (s.status === "error") { Icon = CircleX; tone = "danger"; label = "Turn failed"; value = "Error" }
  else if (s.status === "done") { Icon = CircleCheck; tone = "success"; label = "Turn completed"; value = ago(s.completedAt ?? s.activityAt) }
  else if (s.status === "working") { Icon = CircleDashed; tone = "working"; label = "Working"; value = elapsed(s.workingSince, observedAt) }
  const sourceAge = s.staleAt ? elapsed(s.staleAt / 1000, now) : null
  const freshness = s.stale ? `; source data ${sourceAge === "now" ? "just now" : sourceAge ? `${sourceAge} ago` : "is old"}` : ""
  return <span className={cn("session-status", tone, s.stale && "stale")} aria-label={`${s.stale ? "Last known " : ""}${label}: ${value}${freshness}`} title={`${s.stale ? "Last known " : ""}${label}: ${value}${freshness}`}>
    {Icon && <Icon aria-hidden="true" />}<span className="session-time digits">{value}</span>
  </span>
}

// Keep completion detection above the status groups: moving Working → Done
// remounts the row. Initial data and marking an old completion unread must not flash.
function useCompletions(sessions: T3Session[], macT3Focused?: boolean) {
  const previous = useRef(new Map<string, T3Session>()), timers = useRef(new Set<ReturnType<typeof setTimeout>>())
  const [highlights, setHighlights] = useState<Record<string, { done?: number; input?: number }>>({})
  useEffect(() => {
    const next = new Map(sessions.map(s => [`${s.origin}:${s.id}`, s])), completed: string[] = [], needsInput: string[] = []
    for (const [id, s] of next) {
      const old = previous.current.get(id)
      if (!old || old.stale || s.stale) continue
      if (s.status === "input" && old.status !== "input") needsInput.push(id)
      const chattingInMacT3 = s.origin?.toLowerCase() === "mac" && macT3Focused === true
      if (!chattingInMacT3 && s.completedAt && s.status !== "working" && s.status !== "error" && s.completedAt > (old.completedAt ?? 0)) completed.push(id)
    }
    previous.current = next
    if (!completed.length && !needsInput.length) return
    const at = Date.now()
    setHighlights(current => {
      const next = { ...current }
      for (const id of completed) next[id] = { done: at }
      for (const id of needsInput) next[id] = { input: at }
      return next
    })
    for (const [ids, effect, duration] of [[completed, "done", 3000], [needsInput, "input", 900]] as const) {
      if (!ids.length) continue
      const timer = setTimeout(() => {
        setHighlights(current => {
          const next = { ...current }
          for (const id of ids) {
            const active = next[id]
            if (!active || active[effect] !== at) continue
            const remaining = { ...active }
            delete remaining[effect]
            if (remaining.done == null && remaining.input == null) delete next[id]
            else next[id] = remaining
          }
          return next
        })
        timers.current.delete(timer)
      }, duration)
      timers.current.add(timer)
    }
  }, [sessions, macT3Focused])
  useEffect(() => () => { for (const timer of timers.current) clearTimeout(timer) }, [])
  return highlights
}
function SessionRow({ session: s, now, highlight }: { session: T3Session; now: number; highlight?: { done?: number; input?: number } }) {
  const prs = [...s.prs].sort((a, b) => Number(b.ci?.state === "failure" || b.mergeability === "conflicting") - Number(a.ci?.state === "failure" || a.mergeability === "conflicting"))
  const agents = s.agents ?? [], running = agents.filter(a => a.status === "working").length, errors = agents.filter(a => a.status === "error").length
  const title = <div className="session-title"><HarnessLogo harness={s.harness} /><h3 title={s.title}>{s.title}</h3></div>
  const state = <div className="session-state"><SessionState session={s} now={now} /></div>
  const context = <div className="session-context"><span className="session-project">{s.project}</span>{!!agents.length && <Signal icon={Users} label={`${agents.length} subagents, ${running} working, ${errors} failed`} tone={errors ? "danger" : running ? "working" : "quiet"}><span className="digits">{agents.length}</span></Signal>}</div>
  const branch = <span className="session-branch">{s.branch && <span className="branch" title={s.branch}><GitBranch /><span>{s.branch}</span></span>}<DeviceLogo origin={s.origin} /></span>
  const artifacts = !!prs.length && <div className="session-artifacts">
    {!!prs.length && <span className="session-prs">{prs.slice(0, 5).map(pr => <PullRequest key={`${pr.host}:${pr.repository}:${pr.number}`} pr={pr} now={now} />)}{[1, 2, 3, 4, 5].map(limit => prs.length > limit && <span key={limit} className={`pr-overflow pr-overflow-${limit} quiet`} title={prs.slice(limit).map(pr => `#${pr.number}`).join(", ")}>+{prs.length - limit}</span>)}</span>}
  </div>
  return <article className={cn("session-row", ["done", "input", "approval"].includes(s.status) && "attention-row", highlight?.done != null && "just-completed", highlight?.input != null && "just-needs-input")} data-session-id={`${s.origin}:${s.id}`}>
    {highlight?.done != null && <CompletionPixels startedAt={highlight.done} />}
    <>
      <div className="session-top">{title}{state}</div>
      <div className="session-bottom"><div className="session-location">{context}<span className="session-separator" aria-hidden="true">·</span>{branch}</div>{artifacts}</div>
    </>
  </article>
}

const EMPTY_SESSIONS: T3Session[] = []
function Sessions({ data, now }: { data: KioskData; now: number }) {
  const source = data.t3?.sessions
  const completions = useCompletions(source ?? EMPTY_SESSIONS, data.t3?.macT3Focused)
  const list = orderSessions(source ?? EMPTY_SESSIONS)
  const active = list.filter(s => sessionRank(s) < 3)
  const snoozed = list.filter(s => sessionRank(s) === 3).sort((a, b) => Number(b.lifecycle === "woke") - Number(a.lifecycle === "woke") || (a.snoozedUntil ?? 0) - (b.snoozedUntil ?? 0))
  const woke = snoozed.filter(s => s.lifecycle === "woke")
  const attention = (s: T3Session) => ["input", "approval", "error", "woke"].includes(s.status)
  const ref = useRef<HTMLDivElement>(null), [height, setHeight] = useState(750)
  useLayoutEffect(() => {
    if (!ref.current) return
    const observer = new ResizeObserver(([entry]) => setHeight(entry.contentRect.height))
    observer.observe(ref.current)
    return () => observer.disconnect()
  }, [])
  const groups = [0, 1, 2].map(rank => ({ rank, rows: active.filter(s => sessionRank(s) === rank) })).filter(g => g.rows.length)
  const overhead = groups.length * 22 + Math.max(0, groups.length - 1) * 20
  const usable = Math.max(0, height - overhead)
  const rowHeight = 62
  const slots = Math.max(groups.length, Math.floor(usable / rowHeight))
  const distributable = Math.max(0, slots - groups.length)
  const remainingRows = Math.max(1, active.length - groups.length)
  const allocations = groups.map(g => Math.min(g.rows.length, 1 + Math.floor(distributable * (g.rows.length - 1) / remainingRows)))
  let spare = slots - allocations.reduce((sum, n) => sum + n, 0)
  while (spare > 0 && allocations.some((n, i) => n < groups[i].rows.length)) {
    for (let i = 0; i < groups.length && spare > 0; i++) if (allocations[i] < groups[i].rows.length) { allocations[i]++; spare-- }
  }
  const nextSnooze = snoozed.find(s => s.lifecycle === "snoozed")
  return <section className="sessions-panel" aria-label="T3 sessions">
    <div className="sessions-heading"><h2>T3 sessions</h2></div>
    <div className="session-list" ref={ref}>
      {groups.map((group, i) => {
        const count = allocations[i]
        const critical = group.rows.filter(attention)
        // Keep the visible slice stable. Input, approval and error rows take
        // priority within Done & input; remaining rows follow activity order.
        const pinned = critical.slice(0, count)
        const rest = group.rows.filter(s => !pinned.includes(s))
        const shown = data.runtime?.mode === 'desktop' ? group.rows : [...pinned, ...rest.slice(0, Math.max(0, count - pinned.length))]
        const hidden = group.rows.length - shown.length
        return <div className="session-group" key={group.rank}>
          <div className="group-label"><span>{["Done & input", "Working", "Idle"][group.rank]}<span className="group-count digits">{group.rows.length}</span></span><span className="section-rule" aria-hidden="true" />{hidden > 0 && <span className="group-hidden digits" aria-label={`${hidden} more sessions not shown`} title={`${hidden} more sessions not shown`}>+{hidden}</span>}</div>
          {shown.map(s => <SessionRow key={`${s.origin}:${s.id}`} session={s} now={now} highlight={completions[`${s.origin}:${s.id}`]} />)}
        </div>
      })}
      {!list.length && <div className="empty quiet">{data.t3?.status === "unavailable" ? "T3 unavailable" : "No active sessions"}</div>}
    </div>
    <div className="parked">
      <div className="parked-heading snoozed-heading"><span>Snoozed</span>{nextSnooze?.snoozedUntil && <span className="parked-next">Next in {fmtCountdown(nextSnooze.snoozedUntil * 1000 - now)}</span>}<span className="section-rule" aria-hidden="true" /><span className="parked-count digits">{data.t3?.stats?.snoozed ?? snoozed.length}</span></div>
      {woke.slice(0, 2).map(s => <div className="woke-row" key={`${s.origin}:${s.id}`}><span>{s.title}</span><SessionState session={s} now={now} /></div>)}
      {woke.length > 2 && <div className="warning">+{woke.length - 2} woke</div>}
      <div className="parked-heading"><span>Settled</span><span className="section-rule" aria-hidden="true" /><span className="parked-count digits">{data.t3?.stats?.settled ?? 0}</span></div>
    </div>
  </section>
}
export default function App() {
  const { data, tick, failed } = useData(), [now, setNow] = useState(Date.now())
  const [showSetup, setShowSetup] = useState(false)
  useEffect(() => window.kiosk?.onSetup?.(() => setShowSetup(true)), [])
  useEffect(() => {
    document.documentElement.dataset.mode = showSetup || data?.setupRequired ? 'setup' : data?.runtime?.mode || 'desktop'
  }, [data?.runtime?.mode, data?.setupRequired, showSetup])
  useEffect(() => { const interval = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(interval) }, [])
  const preview = import.meta.env.DEV && new URLSearchParams(location.search).has("preview")
  if (showSetup || data?.setupRequired) return <Setup firstRun={!!data?.setupRequired} onCancel={() => setShowSetup(false)} />
  const sections = data?.runtime?.sections ?? { today:true, activity:true, capacity:true, sessions:true }
  const usageCount = Number(sections.today) + Number(sections.activity) + Number(sections.capacity)
  const showSessions = sections.sessions && data?.runtime?.t3Enabled !== false
  return <main className="kiosk"><header className="kiosk-header"><span>{new Date(now).toLocaleDateString("en", { weekday: "long", day: "numeric", month: "long" })}{preview && <span className="preview-label">Preview</span>}</span><div><time className="digits">{new Date(now).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</time></div></header>
    {data ? <div className={cn("kiosk-content", !showSessions && "usage-only", !usageCount && "sessions-only")}>{usageCount > 0 && <div className="summary-grid" data-count={usageCount}>{sections.today && <Today data={data} tick={tick} now={now} />}{sections.activity && <Activity data={data} now={now} />}{sections.capacity && <Capacity providers={data.providers} now={now} />}</div>}{showSessions && <Sessions data={data} now={now} />}</div> : <div className="loading-view"><div className="loading-counter" /><div className="loading-columns">{Array.from({ length: 7 }, (_, i) => <span key={i} />)}</div><p>{failed ? "Kiosk data unavailable" : "Waiting for kiosk data"}</p></div>}
  </main>
}
