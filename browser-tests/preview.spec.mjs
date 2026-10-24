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

async function waitForServiceList(page) {
  // The fallback list renders first; the fixture has 38 usable entries.
  await page.waitForFunction(() => document.querySelectorAll('.app-item').length === 38)
}

test('renders the service list', async () => {
  const { page, close } = await openPreview()
  try {
    await waitForServiceList(page)
    assert.equal(await page.locator('.app-item').count(), 38)
  } finally { await close() }
})

test('focused item stays on screen while scrolling', async () => {
  const { page, close } = await openPreview()
  try {
    await waitForServiceList(page)
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
