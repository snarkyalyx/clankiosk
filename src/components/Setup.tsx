import { useEffect, useState } from 'react'
import { ProviderLogo, HarnessLogo } from './BrandLogo'
import type { SetupChoices, SetupInfo } from '../types'

export function Setup({ firstRun, onCancel }: { firstRun: boolean; onCancel: () => void }) {
  const [info, setInfo] = useState<SetupInfo | null>(null)
  const [choices, setChoices] = useState<SetupChoices>({ codex: false, claude: false, t3: false, mode: 'desktop', sections: { today:true, activity:true, capacity:true, sessions:true }, hubUrl: '', hubToken: '' })
  const [error, setError] = useState(''), [saving, setSaving] = useState(false)
  useEffect(() => {
    window.kiosk?.getSetup?.().then(next => {
      setInfo(next)
      setChoices({ ...next.selected, hubToken: '',
        codex: firstRun ? next.detected.codex.history || next.detected.codex.installed : next.selected.codex,
        claude: firstRun ? next.detected.claude.history && !!next.detected.python && !!next.detected.sqlite : next.selected.claude,
        t3: firstRun ? next.detected.t3 && !!next.detected.sqlite : next.selected.t3 })
      if (next.error) setError(next.error)
    }).catch(() => setError('Could not inspect local tools. Reopen setup to try again.'))
  }, [firstRun])
  const change = (patch: Partial<SetupChoices>) => setChoices(old => ({ ...old, ...patch }))
  const show = (section: keyof SetupChoices['sections'], enabled: boolean) => change({ sections: { ...choices.sections, [section]: enabled } })
  const canOpen = choices.sections.today || choices.sections.activity || choices.sections.capacity || choices.sections.sessions && choices.t3
  async function save(event: React.FormEvent) {
    event.preventDefault(); setError(''); setSaving(true)
    try { await window.kiosk?.saveSetup?.(choices) }
    catch (e) { setError(String(e instanceof Error ? e.message : e).replace(/^Error invoking remote method '[^']+': Error: /, '')); setSaving(false) }
  }
  return <main className="setup"><form className="setup-card" onSubmit={save}>
    <p className="setup-eyebrow">CLANKIOSK</p><h1>{firstRun ? 'Your AI activity, at a glance.' : 'Set up your dashboard'}</h1>
    <p className="setup-intro">Choose the tools to track on this device. Usage stays on your machine.</p>
    <fieldset disabled={!info || saving}><legend>Local sources</legend>
      <label className="setup-source"><input type="checkbox" checked={choices.codex} onChange={e => change({ codex: e.target.checked })} /><ProviderLogo id="codex" /><span><strong>Codex</strong><small>Tokens and cache from local sessions. Capacity from your existing login.</small></span><span className="setup-detected">{info?.detected.codex.history ? 'Found' : 'No history yet'}</span></label>
      <label className="setup-source"><input type="checkbox" checked={choices.claude} onChange={e => change({ claude: e.target.checked })} /><HarnessLogo harness="claudeAgent" /><span><strong>Claude Code</strong><small>Tokens and cache from local history. Subscription capacity where available.</small></span><span className="setup-detected">{info?.detected.claude.history ? 'Found' : 'No history yet'}</span></label>
      <label className="setup-source"><input type="checkbox" checked={choices.t3} onChange={e => change({ t3: e.target.checked })} /><span className="setup-t3">T3</span><span><strong>T3 Code sessions</strong><small>Working chats, completed tasks, input requests and linked PRs.</small></span><span className="setup-detected">{info?.detected.t3 ? 'Found' : 'Not detected'}</span></label>
      {info && (!info.detected.python || !info.detected.sqlite) && <p className="setup-note">Claude tracking needs Python 3 and sqlite3. T3 needs sqlite3. See the setup guide to install missing tools.</p>}
    </fieldset>
    <fieldset disabled={saving}><legend>Display</legend><div className="setup-modes">
      <label><input type="radio" name="mode" checked={choices.mode === 'desktop'} onChange={() => change({ mode: 'desktop' })} /><span>Resizable window<small>Drag any window edge to change the layout.</small></span></label>
      <label><input type="radio" name="mode" checked={choices.mode === 'kiosk'} onChange={() => change({ mode: 'kiosk' })} /><span>Fullscreen kiosk<small>Fills a dedicated portrait display.</small></span></label>
    </div></fieldset>
    <fieldset disabled={saving}><legend>Visible sections</legend><div className="setup-sections">
      {([['today','Tokens today'],['activity','Token activity'],['capacity','Capacity'],['sessions','T3 sessions']] as const).map(([key, label]) => <label key={key}><input type="checkbox" checked={choices.sections[key]} onChange={e => show(key, e.target.checked)} />{label}</label>)}
    </div><p className="setup-note">Visibility does not change which sources are tracked.</p></fieldset>
    <details className="setup-hub"><summary>Connect an OpenCodex hub</summary><p className="setup-note">Use a hub for shared provider usage and capacity. Hub usage replaces local Codex totals.</p>
      <label>Hub URL<input type="url" placeholder="http://localhost:10100" value={choices.hubUrl} onChange={e => change({ hubUrl: e.target.value })} /></label>
      <label>Admin token<input type="password" autoComplete="off" placeholder={info?.selected.hasHubToken ? 'Saved token — leave blank to keep' : 'Stored only on this device'} value={choices.hubToken} onChange={e => change({ hubToken: e.target.value })} /></label>
    </details>
    {error && <p className="setup-error" role="alert">{error}</p>}
    <div className="setup-actions">{!firstRun && <button type="button" onClick={onCancel}>Cancel</button>}<button className="setup-primary" disabled={!info || saving || !canOpen}>{saving ? 'Opening dashboard…' : 'Open dashboard'}</button></div>
  </form></main>
}
