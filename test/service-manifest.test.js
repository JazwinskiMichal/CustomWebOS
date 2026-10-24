const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..')
const SVC = 'org.jazwinski.customwebos.home.service'
const SVC_DIR = path.join(ROOT, 'services', SVC)

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'))
const appinfo = readJson(path.join(ROOT, 'home', 'appinfo.json'))
const servicesJson = readJson(path.join(SVC_DIR, 'services.json'))
const pkg = readJson(path.join(SVC_DIR, 'package.json'))

test('service id is the home app id + ".service" everywhere', () => {
  // webOS requires a bundled service id to be prefixed by its app id.
  assert.equal(SVC, appinfo.id + '.service')
  assert.equal(servicesJson.id, SVC)
  assert.deepEqual(servicesJson.services.map((s) => s.name), [SVC])
  assert.equal(pkg.name, SVC)
})

test('package.json main points at an existing file', () => {
  assert.ok(fs.existsSync(path.join(SVC_DIR, pkg.main)), 'missing ' + pkg.main)
})

test('service.js registers exactly the methods handlers.js implements', () => {
  const src = fs.readFileSync(path.join(SVC_DIR, 'service.js'), 'utf8')
  const registered = [...src.matchAll(/service\.register\('(\w+)'/g)].map((m) => m[1]).sort()
  const { createHandlers } = require(path.join(SVC_DIR, 'handlers.js'))
  assert.deepEqual(registered, Object.keys(createHandlers(() => {})).sort())
})

test('home app calls only methods the service registers', () => {
  const main = fs.readFileSync(path.join(ROOT, 'home', 'main.js'), 'utf8')
  const used = [...main.matchAll(/SERVICE_URI \+ '\/(\w+)'/g)].map((m) => m[1])
  assert.ok(used.length > 0)
  const { createHandlers } = require(path.join(SVC_DIR, 'handlers.js'))
  const provided = Object.keys(createHandlers(() => {}))
  for (const m of used) assert.ok(provided.includes(m), 'home calls unregistered method ' + m)
})

test('home app no longer calls applicationManager directly', () => {
  // Blocked for dev-mode apps on webOS 4.4 (LSCallFromApplication not privileged).
  const main = fs.readFileSync(path.join(ROOT, 'home', 'main.js'), 'utf8')
  assert.doesNotMatch(main, /'luna:\/\/com\.webos\.applicationManager/)
})
