const { app, BrowserWindow } = require('electron')
const fs = require('node:fs'), path = require('node:path')
app.disableHardwareAcceleration()
app.setPath('userData', require('node:path').join(require('node:os').tmpdir(), 'clankiosk-layout-' + process.pid))
app.on('window-all-closed', () => {})
const output = path.join(__dirname, '../artifacts/layout')
fs.mkdirSync(output, { recursive: true })
app.whenReady().then(async () => {
  const results = []
  for (const [name, width, height, preview, mode, hidden] of [
    ['portrait',1080,1920,'normal','kiosk'], ['dense',1080,1920,'busy','kiosk'],
    ['landscape',1920,1080,'busy','desktop'], ['desktop',1280,900,'normal','desktop'],
    ['tablet',768,1024,'normal','desktop'], ['narrow',390,844,'normal','desktop'],
    ['setup',1000,1000,'setup','desktop'], ['setup-narrow',390,844,'setup','desktop'],
    ['no-sessions',1280,900,'normal','desktop','sessions'],
    ['sessions-only',1080,1920,'normal','kiosk','today,activity,capacity'],
    ['two-sections',900,1200,'normal','desktop','activity,sessions'],
  ]) {
    const win = new BrowserWindow({ width, height, minWidth:width, minHeight:height, frame:false, show:false, webPreferences:{offscreen:true,contextIsolation:true,nodeIntegration:false} })
    win.setContentSize(width, height)
    await win.loadURL(`http://127.0.0.1:5173/?preview=${preview}&mode=${mode}${hidden ? `&hide=${hidden}` : ''}`)
    await win.webContents.executeJavaScript('document.fonts.ready')
    await new Promise(resolve => setTimeout(resolve, 350))
    const geometry = await win.webContents.executeJavaScript(`(() => {
      const summary = document.querySelector('.summary-grid'), list = document.querySelector('.provider-list')
      const bottom = list ? Math.max(...[...list.children].map(e => e.getBoundingClientRect().bottom)) : 0
      return { viewport:[innerWidth,innerHeight], sections:summary?.children.length ?? 0, sessionsVisible:!!document.querySelector('.sessions-panel'), horizontalOverflow:document.body.scrollWidth>innerWidth+1, capacityOverflow:summary && bottom>summary.getBoundingClientRect().bottom+1,
        titleStarts:[...document.querySelectorAll('.session-row h3')].map(e=>Math.round(e.getBoundingClientRect().left)),
        error:document.querySelector('vite-error-overlay')?.textContent || null }
    })()`)
    fs.writeFileSync(path.join(output, `${name}.png`), (await win.webContents.capturePage()).toPNG())
    if (['desktop','narrow','tablet'].includes(name)) {
      await win.webContents.executeJavaScript("document.querySelector('.sessions-panel')?.scrollIntoView({block:'start'})")
      await new Promise(resolve => setTimeout(resolve, 150))
      fs.writeFileSync(path.join(output, `${name}-sessions.png`), (await win.webContents.capturePage()).toPNG())
    }
    results.push({ name, ...geometry }); win.destroy()
  }
  fs.writeFileSync(path.join(output,'geometry.json'),JSON.stringify(results,null,2))
  console.log(JSON.stringify(results))
  app.exit(results.some(r=>r.horizontalOverflow || r.capacityOverflow || r.error || r.name==='no-sessions' && r.sessionsVisible || r.name==='sessions-only' && (r.sections || !r.sessionsVisible) || r.name==='two-sections' && r.sections!==2) ? 1 : 0)
}).catch(error=>{console.error(error.message);app.exit(1)})
