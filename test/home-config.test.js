const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

// config.js is a plain browser script defining a global; run it in a sandbox.
function loadConfig() {
  const sandbox = {}
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'home', 'config.js'), 'utf8'), sandbox)
  return sandbox
}

test('config.js defines HOME_APPS as id/title pairs', () => {
  const { HOME_APPS } = loadConfig()
  assert.ok(Array.isArray(HOME_APPS))
  for (const a of HOME_APPS) {
    assert.equal(typeof a.id, 'string')
    assert.equal(typeof a.title, 'string')
  }
})

test('HOME_APPS has unique ids, includes Netflix, and holds at most 9 apps', () => {
  const ids = loadConfig().HOME_APPS.map((a) => a.id)
  assert.equal(new Set(ids).size, ids.length)
  assert.ok(ids.includes('netflix'))
  assert.ok(ids.length >= 1 && ids.length <= 9)
})

test('HOME_APPS starts with the planned curated order', () => {
  // Array.from: arrays made inside the vm sandbox have that realm's prototype.
  assert.deepEqual(Array.from(loadConfig().HOME_APPS, (a) => a.id), [
    'com.webos.app.livetv', 'netflix', 'youtube.leanback.v4', 'com.webos.app.hdmi1', 'com.appgeneration.app.radiobymytuner',
  ])
})

test('config.js names the location for sunrise and sunset', () => {
  const { HOME_LOCATION, HOME_WALLPAPER } = loadConfig()
  assert.deepEqual({ ...HOME_LOCATION }, { name: 'Warsaw', lat: 52.23, lon: 21.01 })
  assert.equal(HOME_WALLPAPER, undefined)
})
