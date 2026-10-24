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

async function waitForServiceList(page) {
  // The fallback list renders first; the fixture has 38 usable entries.
  await page.waitForFunction((sel) => document.querySelectorAll(sel).length === 38, APP_ROWS)
}

test('renders the service list', async () => {
  const { page, close } = await openPreview()
  try {
    await waitForServiceList(page)
    assert.equal(await page.locator(APP_ROWS).count(), 38)
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

test('pointer hover moves focus and click launches', async () => {
  const { page, close } = await openPreview()
  try {
    await waitForServiceList(page)
    const third = page.locator('.app-item').nth(2)
    const id = await third.getAttribute('data-id')
    await third.hover()
    await page.waitForFunction((i) => document.querySelector('.app-item.focused').getAttribute('data-id') === i, id)
    await page.locator('.app-item').nth(2).click()
    await page.waitForFunction((i) => window.__mock.launches.indexOf(i) !== -1, id)
  } finally { await close() }
})

test('a failed launch keeps the list on screen', async () => {
  const { page, close } = await openPreview()
  try {
    await waitForServiceList(page)
    await page.keyboard.press('Enter')
    await page.waitForFunction(() => /launching requires the TV/.test(document.body.textContent))
    assert.equal(await page.locator(APP_ROWS).count(), 38)
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
    assert.equal(await page.locator(APP_ROWS).count(), 38)
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
