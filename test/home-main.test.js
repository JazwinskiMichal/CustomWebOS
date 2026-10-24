const test = require('node:test')
const assert = require('node:assert/strict')

const main = require('../home/main.js')

test('parseLaunchPoints returns ok:true with items for a valid response', () => {
  const raw = {
    returnValue: true,
    launchPoints: [
      {id: 'netflix', title: 'Netflix'},
      {id: 'youtube.leanback.v4', title: 'YouTube'},
    ],
  }
  assert.deepEqual(main.parseLaunchPoints(raw), {
    ok: true,
    items: [
      {id: 'netflix', title: 'Netflix'},
      {id: 'youtube.leanback.v4', title: 'YouTube'},
    ],
  })
})

test('parseLaunchPoints returns ok:false with the service errorText on returnValue:false', () => {
  // webOS luna services sometimes route error payloads through onSuccess with
  // returnValue:false. The UI must show an error, not "no apps".
  const r = main.parseLaunchPoints({returnValue: false, errorText: 'denied'})
  assert.equal(r.ok, false)
  assert.equal(r.reason, 'denied')
})

test('parseLaunchPoints returns ok:false when the response is missing or malformed', () => {
  assert.equal(main.parseLaunchPoints(null).ok, false)
  assert.equal(main.parseLaunchPoints(undefined).ok, false)
  assert.equal(main.parseLaunchPoints({}).ok, false)
})

test('parseLaunchPoints returns ok:true with empty items on a successful empty-list response', () => {
  assert.deepEqual(main.parseLaunchPoints({returnValue: true, launchPoints: []}), {
    ok: true,
    items: [],
  })
})

test('buildLaunchParams accepts an id in the available list', () => {
  const r = main.buildLaunchParams('netflix', ['netflix', 'youtube.leanback.v4'])
  assert.equal(r.ok, true)
  assert.deepEqual(r.params, {id: 'netflix'})
})

test('buildLaunchParams rejects a stale id', () => {
  const r = main.buildLaunchParams('netflix', ['youtube.leanback.v4'])
  assert.equal(r.ok, false)
  assert.equal(r.reason, 'stale-id')
})

test('parseLaunchPoints accepts the home service listApps shape (apps)', () => {
  const r = main.parseLaunchPoints({returnValue: true, apps: [{id: 'netflix', title: 'Netflix', icon: 'x.png'}]})
  assert.deepEqual(r, {ok: true, items: [{id: 'netflix', title: 'Netflix'}]})
})

test('parseLaunchPoints skips entries without an id and hides the home app itself', () => {
  const r = main.parseLaunchPoints({
    returnValue: true,
    apps: [
      {title: 'no id'},
      {id: main.SELF_ID, title: 'CustomWebOS Home'},
      {id: 'netflix', title: 'Netflix'},
    ],
  })
  assert.deepEqual(r.items, [{id: 'netflix', title: 'Netflix'}])
})

test('chooseApps uses the service list when it answered', () => {
  const items = [{id: 'netflix', title: 'Netflix'}]
  assert.deepEqual(main.chooseApps({ok: true, items}, main.FALLBACK_APPS), {items, source: 'service', note: ''})
})

test('chooseApps keeps an honest empty service list (shows "No apps found")', () => {
  const r = main.chooseApps({ok: true, items: []}, main.FALLBACK_APPS)
  assert.deepEqual(r.items, [])
  assert.equal(r.source, 'service')
})

test('chooseApps falls back to the built-in list and says why when the service fails', () => {
  const r = main.chooseApps({ok: false, reason: 'no response'}, main.FALLBACK_APPS)
  assert.equal(r.items, main.FALLBACK_APPS)
  assert.equal(r.source, 'fallback')
  assert.match(r.note, /no response/)
})

test('focusIndexFor keeps focus on the same app across a list swap', () => {
  const items = [{id: 'a'}, {id: 'b'}, {id: 'c'}]
  assert.equal(main.focusIndexFor(items, 'c'), 2)
  assert.equal(main.focusIndexFor(items, 'gone'), 0)
  assert.equal(main.focusIndexFor([], 'a'), 0)
})

test('FALLBACK_APPS has unique ids and always includes Netflix', () => {
  const ids = main.FALLBACK_APPS.map((a) => a.id)
  assert.equal(new Set(ids).size, ids.length)
  assert.ok(ids.includes('netflix'))
})

test('service URIs point at the bundled home service', () => {
  assert.equal(main.SERVICE_URI, 'luna://org.jazwinski.customwebos.home.service')
})
