#!/usr/bin/env node
// Rasterizes build/icon.svg into the PNG sizes electron-builder expects.
// Electron renders it offscreen so the same command works on macOS and Linux
// without system rasterizers; commit the output so builds stay reproducible.
const { app, BrowserWindow, nativeImage } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const source = path.join(root, 'build', 'icon.svg')
const targets = [16, 24, 32, 48, 64, 128, 256, 512, 1024]
const largest = Math.max(...targets)
const paintTimeout = 15000

// Ozone picks its platform before this script runs, so Linux needs the flags
// on the command line. Re-exec once with them instead of demanding a wrapper.
const HEADLESS_FLAG = '--ozone-platform=headless'
if (process.platform === 'linux' && !process.argv.includes(HEADLESS_FLAG)) {
  const { spawnSync } = require('node:child_process')
  const child = spawnSync(process.execPath, [__filename, '--no-sandbox', HEADLESS_FLAG, `--ozone-override-screen-size=${largest + 200},${largest + 200}`], { stdio: 'inherit' })
  process.exit(child.status ?? 1)
}

app.disableHardwareAcceleration()
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('ozone-platform', 'headless')
  app.commandLine.appendSwitch('ozone-override-screen-size', `${largest + 200},${largest + 200}`)
}

function pageFor(svg) {
  const body = svg.replace(/^<\?xml[^>]*>\s*/, '').replace(/width="[^"]*"\s+height="[^"]*"/, 'width="100%" height="100%"')
  return '<!doctype html><html><body style="margin:0;background:transparent">' + body + '</body></html>'
}

function hasPixels(image) {
  const bitmap = !image.isEmpty() ? image.toBitmap() : null
  if (!bitmap || !bitmap.length) return false
  for (let i = 3; i < bitmap.length; i += 4) if (bitmap[i] !== 0) return true
  return false
}

// Offscreen frames arrive empty until the renderer rasterizes the document, so
// keep asking and use the first frame that actually carries pixels.
async function render(win, size) {
  const deadline = Date.now() + paintTimeout
  let latest = null
  const onPaint = (_event, _dirty, image) => {
    const actual = image.getSize()
    if (actual.width === size && actual.height === size && !image.isEmpty()) latest = image
  }
  win.webContents.on('paint', onPaint)
  try {
    while (Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 250))
      win.webContents.invalidate()
      if (latest && hasPixels(latest)) return latest
    }
    throw new Error(`No ${size}px frame with pixels was painted in ${paintTimeout}ms`)
  } finally { win.webContents.off('paint', onPaint) }
}

app.whenReady().then(async () => {
  const svg = fs.readFileSync(source, 'utf8')
  const win = new BrowserWindow({ width: largest, height: largest, show: false, frame: false, transparent: true, useContentSize: true, webPreferences: { offscreen: true } })
  win.webContents.setFrameRate(30)
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(pageFor(svg)))
  const directory = path.join(root, 'build', 'icons')
  fs.mkdirSync(directory, { recursive: true })
  // One render at full size, then Skia resamples: switching an offscreen
  // window between sizes paints stale frames for the small icons.
  const master = await render(win, largest)
  if (master.isEmpty()) throw new Error('The rendered icon has no pixels')
  if (master.getSize().width !== largest) throw new Error(`Rendered icon is ${master.getSize().width}px, expected ${largest}px`)
  for (const size of targets) {
    const png = size === largest ? master.toPNG() : master.resize({ width: size, height: size, quality: 'best' }).toPNG()
    fs.writeFileSync(path.join(directory, `${size}x${size}.png`), png)
    if (size === 1024) fs.writeFileSync(path.join(root, 'build', 'icon.png'), png)
    console.log(`${size}x${size}.png · ${png.length} bytes`)
  }
  app.exit(0)
}).catch(error => { console.error(error.message); app.exit(1) })
