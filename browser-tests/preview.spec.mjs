// Browser smoke tests against the preview (scripts/dev-server.mjs + the
// mock bridge). Run with: npm run check:browser
// Kept outside test/ because node --test auto-discovers everything there.
import test from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { startDevServer } from '../scripts/dev-server.mjs'

let server
let browser

test.before(async () => {
  server = await startDevServer({ port: 0 })
  browser = await chromium.launch()
})

test.after(async () => {
  await browser?.close()
  await server?.close()
})

// Opens the preview at the TV's 1920x1080 stage and waits for the first
// render. The mock answers listApps after ~150 ms.
async function openPreview(mode = 'ok') {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
  await page.goto(server.url + '?mock=' + mode)
  await page.waitForSelector('.clock')
  return { page, close: () => page.close() }
}

// Failures in the first 30 s keep the loading state (LOADING_GRACE_MS), so
// error-screen tests run the page on a fake clock and move it past that.
async function openPastGrace(mode) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
  await page.clock.install()
  await page.goto(server.url + '?mock=' + mode)
  await page.waitForSelector('.state-panel')
  await page.clock.runFor(30500)
  await page.waitForSelector('.state.error-title')
  return { page, close: () => page.close() }
}

const DOCK_TILES = '.dock .app-item'
const APP_TILES = '.dock .app-item:not([data-id="__all__"])'

// Wait on the mock's answer counter, then one frame for the render.
async function waitForServiceList(page) {
  await page.waitForFunction(() => window.__mock.listAppsAnswered > 0)
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())))
}

async function openAllApps(page) {
  await page.locator('.app-item[data-id="__all__"]').click()
  await page.waitForFunction(() => document.querySelector('h1').textContent === 'All apps')
}

const focusedId = (page) => page.evaluate(() => document.querySelector('.app-item.focused').getAttribute('data-id'))
const focusedIndex = (page) => page.evaluate(() => Array.from(document.querySelectorAll('.app-item')).findIndex((l) => l.classList.contains('focused')))

function inside(inner, outer) {
  return inner.x >= outer.x - 0.5 && inner.y >= outer.y - 0.5 &&
    inner.x + inner.width <= outer.x + outer.width + 0.5 && inner.y + inner.height <= outer.y + outer.height + 0.5
}

const STAGE = { x: 0, y: 0, width: 1920, height: 1080 }

const CURATED = ['netflix', 'youtube.leanback.v4', 'amazon', 'com.wbd.stream', 'canalplus',
  'com.apple.appletv', 'com.webos.app.livetv', 'com.webos.app.hdmi1', 'org.webosbrew.hbchannel']

// --- Home dock ---

test('Home shows the curated apps in config order, then All apps', async () => {
  const { page, close } = await openPreview()
  try {
    await waitForServiceList(page)
    const ids = await page.locator(DOCK_TILES).evaluateAll((els) => els.map((e) => e.getAttribute('data-id')))
    assert.deepEqual(ids, CURATED.concat(['__all__']))
  } finally { await close() }
})

test('focus moves along the dock without rebuilding it', async () => {
  const { page, close } = await openPreview()
  try {
    await waitForServiceList(page)
    await page.evaluate(() => {
      window.__added = 0
      new MutationObserver((records) => {
        for (const r of records) window.__added += r.addedNodes.length
      }).observe(document.getElementById('root'), { childList: true, subtree: true })
    })
    const start = await focusedIndex(page)
    for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight')
    assert.equal(await focusedIndex(page), start + 5)
    assert.equal(await page.evaluate(() => window.__added), 0)
  } finally { await close() }
})

test('focus changes without animation', async () => {
  // On the TV the 120 ms scale/fade dropped 6 of 32 frames per 9 moves
  // (p95 67-83 ms); without it, 0 of 44 (docs/tv-log.md).
  const { page, close } = await openPreview()
  try {
    await waitForServiceList(page)
    const f = await page.locator('.app-item.focused').evaluate((e) => ({
      transform: getComputedStyle(e).transform, duration: getComputedStyle(e).transitionDuration
    }))
    assert.deepEqual(f, { transform: 'none', duration: '0s' })
  } finally { await close() }
})

test('all ten tiles fit inside the dock and the dock inside the stage', async () => {
  const { page, close } = await openPreview()
  try {
    await waitForServiceList(page)
    const dock = await page.locator('.dock').boundingBox()
    assert.ok(inside(dock, STAGE), 'dock ' + JSON.stringify(dock))
    const tiles = await page.locator(DOCK_TILES).evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON()))
    assert.equal(tiles.length, 10)
    for (const t of tiles) assert.ok(inside(t, dock), 'tile ' + JSON.stringify(t))
  } finally { await close() }
})

test('fewer curated apps centre the dock and keep All apps last', async () => {
  const { page, close } = await openPreview('few')
  try {
    await waitForServiceList(page)
    const ids = await page.locator(DOCK_TILES).evaluateAll((els) => els.map((e) => e.getAttribute('data-id')))
    assert.deepEqual(ids, ['netflix', 'youtube.leanback.v4', '__all__'])
    const dock = await page.locator('.dock').boundingBox()
    assert.ok(Math.abs(dock.x + dock.width / 2 - 960) <= 2, 'dock centre ' + (dock.x + dock.width / 2))
  } finally { await close() }
})

test('a long title stays on one line', async () => {
  const { page, close } = await openPreview()
  try {
    await waitForServiceList(page)
    const t = await page.locator('.app-item[data-id="org.webosbrew.hbchannel"] .app-title').evaluate((e) => ({
      fits: e.scrollHeight <= e.clientHeight + 1, overflow: getComputedStyle(e).textOverflow, wrap: getComputedStyle(e).whiteSpace
    }))
    assert.deepEqual(t, { fits: true, overflow: 'ellipsis', wrap: 'nowrap' })
  } finally { await close() }
})

test('the date shows in Polish and updates at midnight', async () => {
  // The TV's language; the PC running the tests may be set to another.
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, locale: 'pl-PL' })
  try {
    await page.clock.install({ time: new Date(2026, 9, 25, 23, 59, 30) })
    await page.goto(server.url + '?mock=ok')
    await page.waitForSelector('.date')
    assert.equal(await page.locator('.date').textContent(), 'niedziela, 25 października')
    await page.clock.runFor(60000)
    assert.equal(await page.locator('.date').textContent(), 'poniedziałek, 26 października')
  } finally { await page.close() }
})

test('the header shows a 24h clock', async () => {
  const { page, close } = await openPreview()
  try {
    assert.match(await page.locator('.clock').textContent(), /^\d{2}:\d{2}$/)
  } finally { await close() }
})

test('curated apps and All apps show masked logos', async () => {
  const { page, close } = await openPreview()
  try {
    await waitForServiceList(page)
    const mask = (id) => page.locator('.app-item[data-id="' + id + '"] .logo').evaluate((e) => e.style.webkitMaskImage || e.style.maskImage)
    assert.match(await mask('netflix'), /assets\/icons\/netflix\.svg/)
    assert.match(await mask('__all__'), /assets\/icons\/apps\.svg/)
  } finally { await close() }
})

// --- Photo, glass, font, theme ---

test('the wallpaper fills the stage behind everything', async () => {
  const { page, close } = await openPreview()
  try {
    await page.waitForFunction(() => {
      const w = document.getElementById('wallpaper')
      return w && w.complete && w.naturalWidth > 0
    })
    const w = await page.locator('#wallpaper').evaluate((e) => ({ src: e.getAttribute('src'), box: e.getBoundingClientRect().toJSON() }))
    assert.match(w.src, /assets\/wallpapers\/morphogenesis-(day|night)\.jpg$/)
    assert.deepEqual([w.box.x, w.box.y, w.box.width, w.box.height], [0, 0, 1920, 1080])
  } finally { await close() }
})

test('the dock glass is the blurred wallpaper, lined up with the background', async () => {
  const { page, close } = await openPreview()
  try {
    await waitForServiceList(page)
    await page.waitForFunction(() => {
      const m = document.querySelector('.dock .mat-img')
      return m && m.complete && m.naturalWidth > 0
    })
    const m = await page.locator('.dock .mat-img').evaluate((e) => ({ src: e.getAttribute('src'), box: e.getBoundingClientRect().toJSON() }))
    assert.match(m.src, /assets\/wallpapers\/morphogenesis-(day|night)-dock\.jpg$/)
    assert.ok(Math.abs(m.box.x) <= 1 && Math.abs(m.box.y) <= 1, 'registered at the stage origin: ' + JSON.stringify(m.box))
    assert.equal(Math.round(m.box.width), 1920)
  } finally { await close() }
})

test('a missing wallpaper at night leaves a dark, readable screen', async () => {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
  try {
    await page.route('**/assets/wallpapers/**', (r) => r.abort())
    await page.goto(server.url + '?mock=ok&theme=dark')
    await waitForServiceList(page)
    await page.waitForTimeout(200)
    const rgb = (c) => c.match(/\d+/g).slice(0, 3).map(Number)
    const look = await page.evaluate(() => ({
      body: getComputedStyle(document.body).backgroundColor,
      clock: getComputedStyle(document.querySelector('.clock')).color,
      wallpaperShown: getComputedStyle(document.getElementById('wallpaper')).visibility !== 'hidden' && getComputedStyle(document.getElementById('wallpaper')).display !== 'none',
      dock: getComputedStyle(document.querySelector('.dock')).backgroundColor
    }))
    for (const ch of rgb(look.body)) assert.ok(ch < 60, 'dark background ' + look.body)
    for (const ch of rgb(look.clock)) assert.ok(ch > 200, 'light clock ' + look.clock)
    assert.equal(look.wallpaperShown, false)
    assert.match(look.dock, /rgba\(/, 'translucent dock fallback ' + look.dock)
  } finally { await page.close() }
})

test('text is set in Manrope', async () => {
  const { page, close } = await openPreview()
  try {
    await page.evaluate(() => document.fonts.ready)
    assert.equal(await page.evaluate(() => document.fonts.check('40px Manrope')), true)
    assert.match(await page.locator('.clock').evaluate((e) => getComputedStyle(e).fontFamily), /^Manrope/)
  } finally { await close() }
})

test('colours come from the dark theme set', async () => {
  const { page, close } = await openPreview()
  try {
    assert.equal(await page.evaluate(() => document.documentElement.className), 'theme-dark')
    assert.ok(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--ink').trim().length > 0))
  } finally { await close() }
})

test('All apps sits on a dimmed sheet over the photo', async () => {
  const { page, close } = await openPreview()
  try {
    await waitForServiceList(page)
    await openAllApps(page)
    const sheet = await page.locator('.sheet').evaluate((e) => ({ bg: getComputedStyle(e).backgroundColor, box: e.getBoundingClientRect().toJSON() }))
    assert.match(sheet.bg, /rgba\(/)
    assert.deepEqual([sheet.box.width, sheet.box.height], [1920, 1080])
  } finally { await close() }
})

// --- Loading and error states ---

test('nothing shows a list before the service answers', async () => {
  const { page, close } = await openPreview('slow')
  try {
    await page.waitForTimeout(500)
    assert.equal(await page.locator('.app-item').count(), 0)
    assert.match(await page.locator('.state-panel').textContent(), /Loading installed apps/)
  } finally { await close() }
})

test('a failed list keeps the loading state during the grace period', async () => {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
  try {
    await page.clock.install()
    await page.goto(server.url + '?mock=error')
    await page.waitForSelector('.state-panel')
    await page.clock.runFor(29000)
    assert.equal(await page.locator('.state.error-title').count(), 0)
    assert.match(await page.locator('.state-panel').textContent(), /Loading installed apps/)
    assert.ok(await page.evaluate(() => window.__mock.listAppsAnswered) >= 2, 'retried during the grace period')
  } finally { await page.close() }
})

test('a cold start that fails once and then answers never shows the error', async () => {
  const { page, close } = await openPreview('recover')
  try {
    await page.waitForSelector('.dock .app-item', { timeout: 8000 })
    assert.equal(await page.locator('.state.error-title').count(), 0)
    assert.equal(await page.locator(APP_TILES).count(), CURATED.length)
  } finally { await close() }
})

test('the error screen gives way to the list once the service answers', async () => {
  const { page, close } = await openPastGrace('recoverlate')
  try {
    await page.clock.runFor(30000)
    await page.waitForSelector('.dock .app-item')
    assert.equal(await page.locator('.state.error-title').count(), 0)
    assert.equal(await page.locator(APP_TILES).count(), CURATED.length)
  } finally { await close() }
})

test('error mode shows an error screen with the reason and no app list', async () => {
  const { page, close } = await openPastGrace('error')
  try {
    assert.equal(await page.locator('.state-panel .state.error-title').textContent(), "Can't reach the home service")
    assert.equal(await page.locator('.state.error-reason').textContent(), 'mock error')
    assert.match(await page.locator('.state.error-retry').textContent(), /Trying again in \d+ s/)
    assert.equal(await page.locator('.app-item').count(), 0)
  } finally { await close() }
})

test('keys on the error screen launch nothing', async () => {
  const { page, close } = await openPastGrace('error')
  try {
    await page.keyboard.press('Enter')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('Enter')
    assert.equal(await page.evaluate(() => window.__mock.launches.length), 0)
  } finally { await close() }
})

test('a long error reason stays on screen', async () => {
  const { page, close } = await openPastGrace('errorlong')
  try {
    const b = await page.locator('.state.error-retry').boundingBox()
    assert.ok(inside(b, STAGE), JSON.stringify(b))
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 1920)
  } finally { await close() }
})

test('empty mode shows "No apps found."', async () => {
  const { page, close } = await openPreview('empty')
  try {
    await page.waitForFunction(() => /No apps found\./.test(document.body.textContent))
  } finally { await close() }
})

// --- Launching ---

test('launch reports the preview limitation', async () => {
  const { page, close } = await openPreview()
  try {
    await waitForServiceList(page)
    await page.keyboard.press('Enter')
    await page.waitForFunction(() => /launching requires the TV/.test(document.body.textContent))
    assert.equal(await page.evaluate(() => window.__mock.launches.length), 1)
  } finally { await close() }
})

test('a failed launch keeps the dock on screen, with a one-line note above it', async () => {
  const { page, close } = await openPreview()
  try {
    await waitForServiceList(page)
    await page.keyboard.press('Enter')
    await page.waitForFunction(() => /launching requires the TV/.test(document.body.textContent))
    assert.equal(await page.locator(APP_TILES).count(), CURATED.length)
    const note = await page.locator('.state-panel .state.note').boundingBox()
    const dock = await page.locator('.dock').boundingBox()
    assert.ok(note.y + note.height <= dock.y, 'note above the dock')
    assert.ok(inside(dock, STAGE))
    assert.equal(await page.locator('.state.note').evaluate((e) => getComputedStyle(e).whiteSpace), 'nowrap')
  } finally { await close() }
})

test('the launch note is readable over the photo', async () => {
  // It is the only sign a launch failed; dim text straight on a bright
  // photo measured about 1.3:1 in review.
  const { page, close } = await openPreview()
  try {
    await waitForServiceList(page)
    await page.keyboard.press('Enter')
    await page.waitForSelector('.state.note')
    const n = await page.locator('.state.note').evaluate((e) => ({ color: getComputedStyle(e).color, bg: getComputedStyle(e).backgroundColor }))
    const ch = (c) => c.match(/[\d.]+/g).map(Number)
    for (const v of ch(n.color).slice(0, 3)) assert.ok(v > 200, 'full ink ' + n.color)
    const bg = ch(n.bg)
    assert.ok(bg.length === 4 && bg[3] >= 0.4 && bg.slice(0, 3).every((v) => v < 60), 'dark pill behind it ' + n.bg)
  } finally { await close() }
})

test('pointer hover moves focus and click launches', async () => {
  const { page, close } = await openPreview()
  try {
    await waitForServiceList(page)
    const third = page.locator(DOCK_TILES).nth(2)
    const id = await third.getAttribute('data-id')
    await third.hover()
    await page.waitForFunction((i) => document.querySelector('.app-item.focused').getAttribute('data-id') === i, id)
    await third.click()
    await page.waitForFunction(() => window.__mock.launches.length > 0)
    await page.waitForTimeout(200)
    assert.deepEqual(await page.evaluate(() => window.__mock.launches), [id])
  } finally { await close() }
})

test('Escape on Home is swallowed; the dock stays', async () => {
  const { page, close } = await openPreview()
  try {
    await waitForServiceList(page)
    await page.keyboard.press('ArrowRight')
    const before = await focusedId(page)
    await page.keyboard.press('Escape')
    assert.equal(await page.locator(APP_TILES).count(), CURATED.length)
    assert.equal(await focusedId(page), before)
    assert.equal(await page.locator('h1').textContent(), 'CustomWebOS')
  } finally { await close() }
})

test('pressing OK twice quickly launches once', async () => {
  const { page, close } = await openPreview()
  try {
    await waitForServiceList(page)
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(300)
    assert.equal(await page.evaluate(() => window.__mock.launches.length), 1)
  } finally { await close() }
})

test('after a failed launch, OK can retry straight away', async () => {
  const { page, close } = await openPreview()
  try {
    await waitForServiceList(page)
    await page.keyboard.press('Enter')
    await page.waitForFunction(() => window.__mock.launches.length === 1 && /launching requires the TV/.test(document.body.textContent))
    await page.keyboard.press('Enter')
    await page.waitForFunction(() => window.__mock.launches.length === 2)
  } finally { await close() }
})

async function hideAndShow(page) {
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
    document.dispatchEvent(new Event('visibilitychange'))
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
    document.dispatchEvent(new Event('visibilitychange'))
  })
}

test('a launch-failure note clears when the user comes back', async () => {
  const { page, close } = await openPreview()
  try {
    await waitForServiceList(page)
    await page.keyboard.press('Enter')
    await page.waitForFunction(() => /launching requires the TV/.test(document.body.textContent))
    await hideAndShow(page)
    await page.waitForFunction(() => !/launching requires the TV/.test(document.body.textContent))
  } finally { await close() }
})

test('a launch timeout that fires while the launched app is open leaves no note', async () => {
  const { page, close } = await openPreview('slowlaunch')
  try {
    // slowlaunch: launch answers after 12 s, past the 10 s timeout.
    await waitForServiceList(page)
    await page.keyboard.press('Enter')
    await page.waitForFunction(() => window.__mock.launches.length === 1)
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await page.waitForTimeout(10600)
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    assert.doesNotMatch(await page.locator('body').textContent(), /Could not open/)
  } finally { await close() }
})

// --- Remembering, refreshing ---

test('the last launched app is focused again after a reload', async () => {
  const { page, close } = await openPreview()
  try {
    await waitForServiceList(page)
    const third = page.locator(DOCK_TILES).nth(2)
    const id = await third.getAttribute('data-id')
    await third.click()
    await page.waitForFunction((i) => window.__mock.launches.indexOf(i) !== -1, id)
    await page.reload()
    await waitForServiceList(page)
    assert.equal(await focusedId(page), id)
  } finally { await close() }
})

test('a last app outside Home is remembered via the All apps tile', async () => {
  const { page, close } = await openPreview()
  try {
    await waitForServiceList(page)
    await openAllApps(page)
    await page.locator('.app-item[data-id="pl.cda"]').click()
    await page.waitForFunction(() => window.__mock.launches.indexOf('pl.cda') !== -1)
    await page.reload()
    await waitForServiceList(page)
    assert.equal(await focusedId(page), '__all__')
    await page.keyboard.press('Enter')
    await page.waitForFunction(() => document.querySelector('h1').textContent === 'All apps')
    assert.equal(await focusedId(page), 'pl.cda')
  } finally { await close() }
})

test('returning to the page refreshes the app list', async () => {
  const { page, close } = await openPreview()
  try {
    await waitForServiceList(page)
    const before = await page.evaluate(() => window.__mock.listAppsAnswered)
    await hideAndShow(page)
    await page.waitForFunction((n) => window.__mock.listAppsAnswered > n, before)
  } finally { await close() }
})

test('a failed refresh keeps the service list', async () => {
  const { page, close } = await openPreview('flaky')
  try {
    await waitForServiceList(page)
    await openAllApps(page)
    await hideAndShow(page)
    await page.waitForFunction(() => window.__mock.listAppsAnswered >= 2)
    await page.waitForTimeout(100)
    assert.equal(await page.locator('.app-item').count(), 38)
    assert.equal(await page.locator('.state.note').count(), 0)
  } finally { await close() }
})

// --- All apps (the grid itself is Task 6) ---

test('All apps lists every service app alphabetically', async () => {
  const { page, close } = await openPreview()
  try {
    await waitForServiceList(page)
    await openAllApps(page)
    const titles = await page.locator('.grid .app-title').evaluateAll((els) => els.map((e) => e.textContent))
    assert.equal(titles.length, 38)
    assert.deepEqual(titles, titles.slice().sort((a, b) => a.localeCompare(b)))
  } finally { await close() }
})

test('arrow keys move in two dimensions in the grid', async () => {
  const { page, close } = await openPreview()
  try {
    await waitForServiceList(page)
    await openAllApps(page)
    await page.keyboard.press('Home') // no-op key; focus starts on tile 0 (no remembered app)
    assert.equal(await focusedIndex(page), 0)
    await page.keyboard.press('ArrowDown')
    assert.equal(await focusedIndex(page), 6)
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowDown')
    assert.equal(await focusedIndex(page), 7)
  } finally { await close() }
})

test('the grid shows whole rows only', async () => {
  const { page, close } = await openPreview()
  try {
    await waitForServiceList(page)
    await openAllApps(page)
    const g = await page.locator('.grid').evaluate((e) => {
      const t = e.querySelector('.app-item')
      const pitch = t.offsetHeight + parseFloat(getComputedStyle(t).marginBottom)
      return { h: e.clientHeight, pitch }
    })
    assert.equal(g.h % g.pitch, 0, JSON.stringify(g))
    assert.ok(inside(await page.locator('.grid').boundingBox(), STAGE))
  } finally { await close() }
})

test('the focused tile stays on screen while the grid scrolls', async () => {
  const { page, close } = await openPreview()
  try {
    await waitForServiceList(page)
    await openAllApps(page)
    for (let i = 0; i < 25; i++) await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowLeft')
    const grid = await page.locator('.grid').boundingBox()
    const box = await page.locator('.app-item.focused').boundingBox()
    assert.ok(inside(box, grid), 'focused ' + JSON.stringify(box) + ' grid ' + JSON.stringify(grid))
    assert.ok(await page.locator('.grid').evaluate((e) => e.scrollTop) > 0)
  } finally { await close() }
})

test('moving in the grid does not rebuild it', async () => {
  const { page, close } = await openPreview()
  try {
    await waitForServiceList(page)
    await openAllApps(page)
    await page.evaluate(() => {
      window.__added = 0
      new MutationObserver((records) => {
        for (const r of records) window.__added += r.addedNodes.length
      }).observe(document.getElementById('root'), { childList: true, subtree: true })
    })
    for (const k of ['ArrowDown', 'ArrowRight', 'ArrowDown', 'ArrowUp', 'ArrowLeft']) await page.keyboard.press(k)
    assert.equal(await page.evaluate(() => window.__added), 0)
  } finally { await close() }
})

test('a long title stays on one line in the grid', async () => {
  const { page, close } = await openPreview()
  try {
    await waitForServiceList(page)
    await openAllApps(page)
    const t = await page.locator('.grid .app-item[data-id="org.webosbrew.hbchannel"] .app-title').evaluate((e) => ({
      fits: e.scrollHeight <= e.clientHeight + 1, overflow: getComputedStyle(e).textOverflow, wrap: getComputedStyle(e).whiteSpace
    }))
    assert.deepEqual(t, { fits: true, overflow: 'ellipsis', wrap: 'nowrap' })
  } finally { await close() }
})

test('All apps opens from Home and Back returns to its tile', async () => {
  const { page, close } = await openPreview()
  try {
    await waitForServiceList(page)
    await openAllApps(page)
    await page.keyboard.press('Escape')
    await page.waitForFunction(() => document.querySelector('.app-item.focused').getAttribute('data-id') === '__all__')
  } finally { await close() }
})

test('apps without a bundled logo show the TV icon whitened, or initials', async () => {
  const { page, close } = await openPreview()
  try {
    await waitForServiceList(page)
    await openAllApps(page)
    // pl.cda's fixture icon loads: shown, turned white.
    await page.waitForFunction(() => {
      const img = document.querySelector('.app-item[data-id="pl.cda"] .icon img')
      return img && img.complete && img.naturalWidth > 0
    })
    assert.match(await page.locator('.app-item[data-id="pl.cda"] .icon img').evaluate((e) => getComputedStyle(e).filter), /invert\(1\)/)
    // ipla's icon 404s: initials replace it, no broken img left.
    await page.waitForFunction(() => {
      const row = document.querySelector('.app-item[data-id="ipla"]')
      return row && !row.querySelector('img') && row.querySelector('.initials')
    })
    // No icon at all: initials straight away.
    assert.equal(await page.locator('.app-item[data-id="spotify-beehive"] .initials').textContent(), 'S')
  } finally { await close() }
})

test('a broken icon stays as initials after re-renders', async () => {
  const { page, close } = await openPreview()
  try {
    await waitForServiceList(page)
    await openAllApps(page)
    await page.waitForFunction(() => !document.querySelector('.app-item[data-id="ipla"] img'))
    await page.evaluate(() => {
      window.__brokenImgReinserted = false
      new MutationObserver((records) => {
        for (const r of records) for (const n of r.addedNodes) {
          const row = n.querySelector && n.querySelector('.app-item[data-id="ipla"]')
          if (row && row.querySelector('img')) window.__brokenImgReinserted = true
        }
      }).observe(document.getElementById('root'), { childList: true, subtree: true })
    })
    await page.keyboard.press('Escape')
    await openAllApps(page)
    assert.equal(await page.evaluate(() => window.__brokenImgReinserted), false)
  } finally { await close() }
})

test('pointing at a lower tile focuses it and a click launches it, not another', async () => {
  const { page, close } = await openPreview()
  try {
    await waitForServiceList(page)
    await openAllApps(page)
    const target = await page.evaluate(() => {
      const grid = document.querySelector('.grid').getBoundingClientRect()
      const tiles = Array.from(document.querySelectorAll('.app-item'))
      const visible = tiles.filter((t) => { const b = t.getBoundingClientRect(); return b.top >= grid.top && b.bottom <= grid.bottom })
      const tile = visible[visible.length - 1]
      const b = tile.getBoundingClientRect()
      return { id: tile.getAttribute('data-id'), x: b.left + b.width / 2, y: b.top + b.height / 2 }
    })
    await page.mouse.move(target.x, target.y)
    await page.waitForTimeout(300)
    assert.equal(await focusedId(page), target.id)
    await page.mouse.click(target.x, target.y)
    await page.waitForTimeout(300)
    assert.deepEqual(await page.evaluate(() => window.__mock.launches), [target.id])
  } finally { await close() }
})

test('arrow keys keep focus while the pointer rests over the tiles', async () => {
  const { page, close } = await openPreview()
  try {
    await waitForServiceList(page)
    await openAllApps(page)
    const box = await page.locator('.app-item').nth(3).boundingBox()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.waitForTimeout(100)
    const start = await focusedIndex(page)
    for (let i = 0; i < 15; i++) await page.keyboard.press('ArrowRight')
    await page.waitForTimeout(150)
    assert.equal(await focusedIndex(page), start + 15)
  } finally { await close() }
})

// --- Perf mode ---

test('perf mode can open All apps before stepping', async () => {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
  try {
    await page.addInitScript(() => {
      window.PalmSystem = { launchParams: '{"perf":{"action":"down","steps":5,"intervalMs":20,"view":"all"}}' }
    })
    await page.goto(server.url + '?mock=ok')
    await page.waitForFunction(() => window.__mock.perfReports.length === 1, null, { timeout: 8000 })
    assert.equal(await page.locator('h1').textContent(), 'All apps')
    assert.equal(await focusedIndex(page), 30)
    assert.equal(await page.evaluate(() => window.__mock.perfReports[0].params.view), 'all')
    assert.equal(await page.evaluate(() => window.__mock.launches.length), 0)
  } finally { await page.close() }
})

test('perf mode steps focus and reports timings', async () => {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
  try {
    await page.addInitScript(() => {
      window.PalmSystem = { launchParams: '{"perf":{"action":"right","steps":5,"intervalMs":20}}' }
    })
    await page.goto(server.url + '?mock=ok')
    await page.waitForFunction(() => window.__mock.perfReports.length === 1, null, { timeout: 8000 })
    const r = await page.evaluate(() => window.__mock.perfReports[0])
    assert.equal(r.dispatchMs.frames, 5)
    assert.ok(r.frames.frames > 0)
    assert.ok(r.appsShownMs >= r.firstPaintMs)
    assert.deepEqual(r.params, { action: 'right', steps: 5, intervalMs: 20, view: 'home' })
    assert.equal(await page.evaluate(() => window.__mock.launches.length), 0)
    assert.equal(await focusedIndex(page), 5)
  } finally { await page.close() }
})

// Day/night theme: a forced mode, and the switch at Warsaw's sunset.
const themeState = (page) => page.evaluate(() => ({
  cls: document.documentElement.className,
  wall: document.getElementById('wallpaper').getAttribute('src'),
  glass: Array.from(document.querySelectorAll('.mat-img'), (i) => i.getAttribute('src')),
}))

test('?theme=light shows the day wallpaper, glass and colours', async () => {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
  await page.goto(server.url + '?mock=ok&theme=light')
  await page.waitForSelector('.dock .app-item')
  const s = await themeState(page)
  assert.equal(s.cls, 'theme-light')
  assert.equal(s.wall, 'assets/wallpapers/morphogenesis-day.jpg')
  assert.ok(s.glass.length >= 1 && s.glass.every((g) => g === 'assets/wallpapers/morphogenesis-day-dock.jpg'), s.glass.join())
  await page.close()
})

test('Home switches to night at Warsaw sunset without reopening', async () => {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
  // 21 June 2026, sunset ~19:01 UTC; start two minutes before.
  await page.clock.install({ time: new Date('2026-06-21T18:58:30Z') })
  await page.goto(server.url + '?mock=ok')
  await page.waitForSelector('.clock')
  await page.clock.runFor(1000)
  await page.waitForSelector('.dock .app-item')
  assert.equal((await themeState(page)).cls, 'theme-light')
  await page.clock.runFor(5 * 60 * 1000)
  const s = await themeState(page)
  assert.equal(s.cls, 'theme-dark')
  assert.equal(s.wall, 'assets/wallpapers/morphogenesis-night.jpg')
  assert.ok(s.glass.length >= 1 && s.glass.every((g) => g.endsWith('morphogenesis-night-dock.jpg')), s.glass.join())
  await page.close()
})
