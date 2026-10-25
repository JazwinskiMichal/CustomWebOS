const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const SERVER = pathToFileURL(path.join(__dirname, '..', 'scripts', 'dev-server.mjs')).href

// Raw GET so paths like /../x reach the server unnormalised (fetch would
// resolve the dot segments client-side).
function get(url, rawPath) {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    http.get({ host: u.hostname, port: u.port, path: rawPath }, (res) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (c) => { body += c })
      res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'] || '', body }))
    }).on('error', reject)
  })
}

async function withServer(fn) {
  const { startDevServer } = await import(SERVER)
  const srv = await startDevServer({ port: 0 })
  try { await fn(srv.url) } finally { await srv.close() }
}

test('serves index.html with the mock injected before main.js', () => withServer(async (url) => {
  const r = await get(url, '/')
  assert.equal(r.status, 200)
  assert.match(r.type, /text\/html/)
  assert.match(r.body, /<script src="\/__dev\/mock-bridge\.js"><\/script>\s*<script src="main\.js">/)
}))

test('serves home/ assets and dev/ fixtures', () => withServer(async (url) => {
  const css = await get(url, '/style.css')
  assert.equal(css.status, 200)
  assert.match(css.type, /text\/css/)
  const fx = await get(url, '/__dev/fixtures/listApps.json')
  assert.equal(fx.status, 200)
  const json = JSON.parse(fx.body)
  assert.equal(json.returnValue, true)
  assert.ok(json.apps.length >= 10)
}))

test('serves svg, jpg and woff2 with their media types', () => withServer(async (url) => {
  const { startDevServer } = await import(SERVER)
  assert.ok(startDevServer)
  const { TYPES } = await import(SERVER)
  assert.equal(TYPES['.svg'], 'image/svg+xml')
  assert.equal(TYPES['.jpg'], 'image/jpeg')
  assert.equal(TYPES['.woff2'], 'font/woff2')
}))

test('refuses path traversal', () => withServer(async (url) => {
  for (const p of ['/../package.json', '/__dev/../../package.json', '/%2e%2e/package.json']) {
    assert.equal((await get(url, p)).status, 404, p)
  }
}))

test('binds to loopback only', () => withServer(async (url) => {
  assert.match(url, /^http:\/\/127\.0\.0\.1:\d+\/$/)
}))
