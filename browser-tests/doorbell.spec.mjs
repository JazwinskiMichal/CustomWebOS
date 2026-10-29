// Browser tests for the doorbell box (doorbell/) against the preview and the
// mock bridge. Run with: npm run check:browser
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

// Opens the box at the TV's 1920x1080 stage on a fake clock (the box's
// timers are 5 s and 60 s) and waits until it has asked for its settings.
async function openBox(mode = 'ok', params) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
  await page.clock.install()
  let url = server.url + 'doorbell/?mock=' + mode
  if (params) url += '&params=' + encodeURIComponent(JSON.stringify(params))
  await page.goto(url)
  await page.waitForSelector('.box')
  await page.clock.runFor(200)
  return page
}

const boxRect = (page) => page.evaluate(() => {
  const r = document.querySelector('.box').getBoundingClientRect()
  return { x: r.x, y: r.y, width: r.width, height: r.height }
})
const text = (page, sel) => page.evaluate((s) => document.querySelector(s).textContent, sel)
const mock = (page) => page.evaluate(() => window.__mock)

async function ok(page) {
  await page.keyboard.press('Enter')
  await page.clock.runFor(200) // the mock answers after 150 ms
}

const CORNER = { x: 1232, y: 632, width: 640, height: 400 }
const BIG = { x: 320, y: 140, width: 1280, height: 800 }

test('box starts in the corner with the camera picture', async () => {
  const page = await openBox()
  assert.deepEqual(await boxRect(page), CORNER)
  await page.waitForFunction(() => document.querySelector('.box img').naturalWidth > 0)
  assert.equal(await text(page, '.hint'), 'OK: open the door · Back: close')
  await page.close()
})

test('first OK enlarges and centres the box', async () => {
  const page = await openBox()
  await ok(page)
  assert.deepEqual(await boxRect(page), BIG)
  assert.equal(await text(page, '.hint'), 'OK again to open the door')
  assert.equal((await mock(page)).openDoor, 0)
  await page.close()
})

test('second OK opens the door', async () => {
  const page = await openBox()
  await ok(page)
  await ok(page)
  assert.equal((await mock(page)).openDoor, 1)
  assert.equal(await text(page, '.status'), 'Door opened (test)')
  assert.equal(await text(page, '.hint'), 'OK: open the door · Back: close')
  await page.close()

  const real = await openBox('door')
  await ok(real)
  await ok(real)
  assert.equal(await text(real, '.status'), 'Door opened')
  await real.close()
})

test('the enlarged box waits for the second OK however long it takes', async () => {
  // Michał: no auto-shrink; only Back closes it.
  const page = await openBox()
  await ok(page)
  await page.clock.runFor(120000)
  assert.deepEqual(await boxRect(page), BIG)
  assert.equal((await mock(page)).openDoor, 0)
  await ok(page)
  assert.equal((await mock(page)).openDoor, 1)
  assert.deepEqual(await boxRect(page), BIG)
  await page.close()
})

test('a click on the box counts as OK (Magic Remote pointer)', async () => {
  // Seen on the TV: with the pointer showing, OK arrives as a click, not keyCode 13.
  const page = await openBox()
  await page.mouse.click(1500, 800)
  await page.clock.runFor(200)
  assert.deepEqual(await boxRect(page), BIG)
  await page.mouse.click(900, 500)
  await page.clock.runFor(200)
  assert.equal((await mock(page)).openDoor, 1)
  await page.close()
})

test('a click outside the box does nothing', async () => {
  const page = await openBox()
  await page.mouse.click(100, 100)
  await page.clock.runFor(200)
  assert.deepEqual(await boxRect(page), CORNER)
  await page.close()
})

test('door failure is shown', async () => {
  const page = await openBox('doorfail')
  await ok(page)
  await ok(page)
  assert.equal(await text(page, '.status'), "Door didn't open: HTTP 500")
  await page.close()
})

test('Back closes the box', async () => {
  const page = await openBox()
  await page.keyboard.press('Escape')
  assert.equal(await page.evaluate(() => window.__closed), true)
  await page.close()
})

test('the box never closes by itself, in either size', async () => {
  const page = await openBox()
  await page.clock.runFor(600000)
  assert.equal(await page.evaluate(() => window.__closed), undefined)
  assert.deepEqual(await boxRect(page), CORNER)
  await ok(page)
  await page.clock.runFor(600000)
  assert.equal(await page.evaluate(() => window.__closed), undefined)
  await page.keyboard.press('Escape')
  assert.equal(await page.evaluate(() => window.__closed), true)
  await page.close()
})

test('missing settings say so', async () => {
  const page = await openBox('nocamera')
  assert.equal(await text(page, '.camera-msg'), 'Camera not set up')
  await page.close()
})

test('dead camera says so', async () => {
  const page = await openBox('deadcamera')
  await page.clock.runFor(5100)
  assert.equal(await text(page, '.camera-msg'), 'Camera not responding')
  await page.close()
})

test('a ring while open resets the box', async () => {
  const page = await openBox()
  await ok(page)
  assert.deepEqual(await boxRect(page), BIG)
  await page.evaluate(() => {
    window.PalmSystem.launchParams = JSON.stringify({ cameraUrl: '/__dev/fixtures/camera.jpg' })
    document.dispatchEvent(new Event('webOSRelaunch'))
  })
  await page.clock.runFor(200)
  assert.deepEqual(await boxRect(page), CORNER)
  await ok(page)
  assert.deepEqual(await boxRect(page), BIG)
  assert.equal((await mock(page)).openDoor, 0)
  await page.close()
})

test('launch params cannot set the door URL', async () => {
  const page = await openBox('ok', { doorUrl: 'http://evil/' })
  await ok(page)
  await ok(page)
  assert.deepEqual((await mock(page)).openDoorPayloads, [{}])
  await page.close()
})
