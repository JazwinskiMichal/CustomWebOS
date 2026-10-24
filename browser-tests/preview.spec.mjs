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
// list render. The mock answers listApps after ~150 ms.
async function openPreview(mode = 'ok') {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
  await page.goto(server.url + '?mock=' + mode)
  await page.waitForSelector('.app-item, .state')
  return { page, close: () => page.close() }
}

const APP_ROWS = '.app-item:not([data-id="__all__"])'

// Home shows the 9 curated apps both before (fallback) and after the
// service answers, so wait on the mock's answer counter, then one frame.
async function waitForServiceList(page) {
  await page.waitForFunction(() => window.__mock.listAppsAnswered > 0)
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())))
}

async function openAllApps(page) {
  await page.locator('.app-item[data-id="__all__"]').click()
  await page.waitForFunction(() => document.querySelector('h1').textContent === 'All apps')
}

const CURATED = ['netflix', 'youtube.leanback.v4', 'amazon', 'com.wbd.stream', 'canalplus',
  'com.apple.appletv', 'com.webos.app.livetv', 'com.webos.app.hdmi1', 'org.webosbrew.hbchannel']

test('Home shows the curated apps in config order, then All apps', async () => {
  const { page, close } = await openPreview()
  try {
    await waitForServiceList(page)
    const ids = await page.locator('.app-item').evaluateAll((els) => els.map((e) => e.getAttribute('data-id')))
    assert.deepEqual(ids, CURATED.concat(['__all__']))
  } finally { await close() }
})

test('All apps lists every service app alphabetically', async () => {
  const { page, close } = await openPreview()
  try {
    await waitForServiceList(page)
    await openAllApps(page)
    const titles = await page.locator('.app-title').evaluateAll((els) => els.map((e) => e.textContent))
    assert.equal(titles.length, 38)
    assert.deepEqual(titles, titles.slice().sort((a, b) => a.localeCompare(b)))
  } finally { await close() }
})

test('focused item stays on screen while scrolling', async () => {
  const { page, close } = await openPreview()
  try {
    await waitForServiceList(page)
    await openAllApps(page)
    for (let i = 0; i < 25; i++) await page.keyboard.press('ArrowDown')
    const box = await page.locator('.app-item.focused').boundingBox()
    assert.ok(box.y >= 0 && box.y + box.height <= 1080, 'focused row on screen: ' + JSON.stringify(box))
    assert.ok(await page.locator('.app-list').evaluate((ul) => ul.scrollTop) > 0)
  } finally { await close() }
})

test('error mode keeps the fallback list and says it is retrying', async () => {
  const { page, close } = await openPreview('error')
  try {
    await page.waitForSelector('.state.note')
    assert.match(await page.locator('.state.note').textContent(), /mock error.*retrying/)
    assert.ok(await page.locator('.app-item').count() > 0)
  } finally { await close() }
})

test('empty mode shows "No apps found."', async () => {
  const { page, close } = await openPreview('empty')
  try {
    await page.waitForFunction(() => /No apps found\./.test(document.body.textContent))
  } finally { await close() }
})

test('launch reports the preview limitation', async () => {
  const { page, close } = await openPreview()
  try {
    await waitForServiceList(page)
    await page.keyboard.press('Enter')
    await page.waitForFunction(() => /launching requires the TV/.test(document.body.textContent))
    assert.equal(await page.evaluate(() => window.__mock.launches.length), 1)
  } finally { await close() }
})

test('pointer hover moves focus and click launches', async () => {
  const { page, close } = await openPreview()
  try {
    await waitForServiceList(page)
    const third = page.locator('.app-item').nth(2)
    const id = await third.getAttribute('data-id')
    await third.hover()
    await page.waitForFunction((i) => document.querySelector('.app-item.focused').getAttribute('data-id') === i, id)
    await page.locator('.app-item').nth(2).click()
    await page.waitForFunction(() => window.__mock.launches.length > 0)
    await page.waitForTimeout(200)
    assert.deepEqual(await page.evaluate(() => window.__mock.launches), [id])
  } finally { await close() }
})

test('a failed launch keeps the list on screen', async () => {
  const { page, close } = await openPreview()
  try {
    await waitForServiceList(page)
    await page.keyboard.press('Enter')
    await page.waitForFunction(() => /launching requires the TV/.test(document.body.textContent))
    assert.equal(await page.locator(APP_ROWS).count(), CURATED.length)
  } finally { await close() }
})

test('Escape on Home is swallowed; the list stays', async () => {
  const { page, close } = await openPreview()
  try {
    await waitForServiceList(page)
    await page.keyboard.press('ArrowDown')
    const focused = () => page.evaluate(() => document.querySelector('.app-item.focused').getAttribute('data-id'))
    const before = await focused()
    await page.keyboard.press('Escape')
    assert.equal(await page.locator(APP_ROWS).count(), CURATED.length)
    assert.equal(await focused(), before)
    assert.equal(await page.locator('h1').textContent(), 'CustomWebOS')
  } finally { await close() }
})

test('All apps opens from Home and Back returns to its row', async () => {
  const { page, close } = await openPreview()
  try {
    await waitForServiceList(page)
    await page.locator('.app-item[data-id="__all__"]').click()
    await page.waitForFunction(() => document.querySelector('h1').textContent === 'All apps')
    await page.keyboard.press('Escape')
    await page.waitForFunction(() => document.querySelector('.app-item.focused').getAttribute('data-id') === '__all__')
  } finally { await close() }
})

test('rows show the app icon, or initials when it is missing or broken', async () => {
  const { page, close } = await openPreview()
  try {
    await waitForServiceList(page)
    const netflixImg = page.locator('.app-item[data-id="netflix"] img')
    await page.waitForFunction(() => {
      const img = document.querySelector('.app-item[data-id="netflix"] img')
      return img && img.complete && img.naturalWidth > 0
    })
    assert.equal(await netflixImg.count(), 1)
    // Prime Video's fixture icon 404s: initials replace it, no broken img left.
    await page.waitForFunction(() => {
      const row = document.querySelector('.app-item[data-id="amazon"]')
      return row && !row.querySelector('img') && row.querySelector('.initials')
    })
    assert.equal(await page.locator('.app-item[data-id="amazon"] .initials').textContent(), 'PV')
    // No icon at all: initials straight away (Spotify is only in All apps).
    await openAllApps(page)
    assert.equal(await page.locator('.app-item[data-id="spotify-beehive"] .initials').textContent(), 'S')
  } finally { await close() }
})

test('a broken icon stays as initials after re-renders', async () => {
  const { page, close } = await openPreview()
  try {
    await waitForServiceList(page)
    await page.waitForFunction(() => !document.querySelector('.app-item[data-id="amazon"] img'))
    // Record any <img> re-inserted into the Prime Video row, however briefly.
    await page.evaluate(() => {
      window.__brokenImgReinserted = false
      new MutationObserver((records) => {
        for (const r of records) for (const n of r.addedNodes) {
          const row = n.querySelector && n.querySelector('.app-item[data-id="amazon"]')
          if (row && row.querySelector('img')) window.__brokenImgReinserted = true
        }
      }).observe(document.getElementById('root'), { childList: true, subtree: true })
    })
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowDown')
    assert.equal(await page.evaluate(() => window.__brokenImgReinserted), false)
  } finally { await close() }
})

test('the header shows a 24h clock', async () => {
  const { page, close } = await openPreview()
  try {
    await page.waitForSelector('.clock')
    assert.match(await page.locator('.clock').textContent(), /^\d{2}:\d{2}$/)
  } finally { await close() }
})

test('the last launched app is focused again after a reload', async () => {
  const { page, close } = await openPreview()
  try {
    await waitForServiceList(page)
    const third = page.locator('.app-item').nth(2)
    const id = await third.getAttribute('data-id')
    await third.click()
    await page.waitForFunction((i) => window.__mock.launches.indexOf(i) !== -1, id)
    await page.reload()
    await waitForServiceList(page)
    assert.equal(await page.locator('.app-item.focused').getAttribute('data-id'), id)
  } finally { await close() }
})

test('returning to the page refreshes the app list', async () => {
  const { page, close } = await openPreview()
  try {
    await waitForServiceList(page)
    const before = await page.evaluate(() => window.__mock.listAppsAnswered)
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
      document.dispatchEvent(new Event('visibilitychange'))
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await page.waitForFunction((n) => window.__mock.listAppsAnswered > n, before)
  } finally { await close() }
})

// --- Final-review fixes ---

async function hideAndShow(page) {
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
    document.dispatchEvent(new Event('visibilitychange'))
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
    document.dispatchEvent(new Event('visibilitychange'))
  })
}

test('pointing at a lower row focuses that row and a click launches it, not another', async () => {
  const { page, close } = await openPreview()
  try {
    await waitForServiceList(page)
    await openAllApps(page)
    // Pick the visible row nearest the bottom of the list viewport.
    const target = await page.evaluate(() => {
      const ul = document.querySelector('.app-list').getBoundingClientRect()
      const rows = Array.from(document.querySelectorAll('.app-item'))
      const visible = rows.filter((r) => { const b = r.getBoundingClientRect(); return b.top >= ul.top && b.bottom <= ul.bottom })
      const row = visible[visible.length - 1]
      const b = row.getBoundingClientRect()
      return { id: row.getAttribute('data-id'), x: b.left + 40, y: b.top + b.height / 2 }
    })
    await page.mouse.move(target.x, target.y)
    await page.waitForTimeout(300)
    assert.equal(await page.locator('.app-item.focused').getAttribute('data-id'), target.id)
    await page.mouse.click(target.x, target.y)
    await page.waitForTimeout(300)
    assert.deepEqual(await page.evaluate(() => window.__mock.launches), [target.id])
  } finally { await close() }
})

test('a failed refresh keeps the service list instead of falling back', async () => {
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

test('the launch note does not hide the service note', async () => {
  const { page, close } = await openPreview('error')
  try {
    await page.waitForSelector('.state.note')
    await page.keyboard.press('Enter')
    await page.waitForFunction(() => /launching requires the TV/.test(document.body.textContent))
    assert.match(await page.locator('body').textContent(), /mock error/)
  } finally { await close() }
})

test('a launch timeout that fires while the launched app is open leaves no note', async () => {
  const { page, close } = await openPreview('slow')
  try {
    // slow mode: every answer takes 12 s, past the 10 s timeout.
    await page.keyboard.press('Enter')
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

test('the All apps row shows an ellipsis glyph', async () => {
  const { page, close } = await openPreview()
  try {
    await waitForServiceList(page)
    assert.equal(await page.locator('.app-item[data-id="__all__"] .initials').textContent(), '…')
  } finally { await close() }
})

for (const mode of ['ok', 'error']) {
  test('Home fits on screen without scrolling (' + mode + ')', async () => {
    const { page, close } = await openPreview(mode)
    try {
      if (mode === 'ok') await waitForServiceList(page)
      else await page.waitForSelector('.state.note')
      const fit = await page.evaluate(() => {
        const ul = document.querySelector('.app-list')
        const last = document.querySelector('.app-item[data-id="__all__"]').getBoundingClientRect()
        return { overflow: ul.scrollHeight - ul.clientHeight, lastBottom: last.bottom }
      })
      assert.ok(fit.overflow <= 1, 'Home list overflows by ' + fit.overflow + 'px')
      assert.ok(fit.lastBottom <= 1080, 'All apps row off-screen at ' + fit.lastBottom)
    } finally { await close() }
  })
}

test('a last app outside Home is remembered via the All apps row', async () => {
  const { page, close } = await openPreview()
  try {
    await waitForServiceList(page)
    await openAllApps(page)
    await page.locator('.app-item[data-id="pl.cda"]').click()
    await page.waitForFunction(() => window.__mock.launches.indexOf('pl.cda') !== -1)
    await page.reload()
    await waitForServiceList(page)
    assert.equal(await page.locator('.app-item.focused').getAttribute('data-id'), '__all__')
    await page.keyboard.press('Enter')
    await page.waitForFunction(() => document.querySelector('h1').textContent === 'All apps')
    assert.equal(await page.locator('.app-item.focused').getAttribute('data-id'), 'pl.cda')
  } finally { await close() }
})
