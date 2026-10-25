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
      {id: 'netflix', title: 'Netflix', icon: null},
      {id: 'youtube.leanback.v4', title: 'YouTube', icon: null},
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

test('parseLaunchPoints accepts the home service listApps shape (apps)', () => {
  const r = main.parseLaunchPoints({returnValue: true, apps: [{id: 'netflix', title: 'Netflix', icon: 'x.png'}]})
  assert.deepEqual(r, {ok: true, items: [{id: 'netflix', title: 'Netflix', icon: 'x.png'}]})
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
  assert.deepEqual(r.items, [{id: 'netflix', title: 'Netflix', icon: null}])
})

test('parseLaunchPoints keeps only the first entry for a repeated id', () => {
  const r = main.parseLaunchPoints({
    returnValue: true,
    apps: [
      {id: 'com.webos.app.browser', title: 'Web Browser'},
      {id: 'netflix', title: 'Netflix'},
      {id: 'com.webos.app.browser', title: 'Web Browser (again)'},
    ],
  })
  assert.deepEqual(r.items, [
    {id: 'com.webos.app.browser', title: 'Web Browser', icon: null},
    {id: 'netflix', title: 'Netflix', icon: null},
  ])
})

test('unavailableText names the problem, the reason and the next try', () => {
  const t = main.unavailableText('no response from luna://x within 10s', 20000)
  assert.equal(t.title, "Can't reach the home service")
  assert.equal(t.reason, 'no response from luna://x within 10s')
  assert.match(t.retry, /Trying again in 20 s/)
  assert.match(t.retry, /close CustomWebOS and open it again/)
  assert.doesNotMatch(t.retry, /5 minutes/)
})

test('unavailableText rounds the delay up to whole seconds', () => {
  assert.match(main.unavailableText('x', 4500).retry, /in 5 s/)
})

test('focusIndexFor keeps focus on the same app across a list swap', () => {
  const items = [{id: 'a'}, {id: 'b'}, {id: 'c'}]
  assert.equal(main.focusIndexFor(items, 'c'), 2)
  assert.equal(main.focusIndexFor(items, 'gone'), 0)
  assert.equal(main.focusIndexFor([], 'a'), 0)
})

test('retryDelayMs backs off and then settles at 30 s, never giving up', () => {
  assert.deepEqual([0, 1, 2, 3, 10, 1000].map(main.retryDelayMs), [5000, 10000, 20000, 30000, 30000, 30000])
})

test('scrollTopFor centres the focused item, clamped to the list bounds', () => {
  // 40 items of 100px in an 800px viewport (content 4000px).
  assert.equal(main.scrollTopFor(0, 100, 800, 4000), 0)        // top: no scroll
  assert.equal(main.scrollTopFor(300, 100, 800, 4000), 0)      // still in the first screenful
  assert.equal(main.scrollTopFor(2000, 100, 800, 4000), 1650)  // middle: centred
  assert.equal(main.scrollTopFor(3900, 100, 800, 4000), 3200)  // last item: bottom-aligned, no overscroll
  assert.equal(main.scrollTopFor(100, 100, 800, 500), 0)       // list shorter than viewport
})

test('service URIs point at the bundled home service', () => {
  assert.equal(main.SERVICE_URI, 'luna://org.jazwinski.customwebos.home.service')
})

// --- Navigation (Task 4) ---

const item = (id) => ({id, title: id.toUpperCase(), icon: null})
function navState(over) {
  return Object.assign({view: 'home', focusIdx: 0, homeItems: [item('a'), item('b')], allItems: [item('a'), item('b'), item('c')], launch: null}, over)
}

test('keyAction maps webOS and browser keys', () => {
  assert.deepEqual([38, 40, 37, 39, 13, 461, 27, 8, 65].map(main.keyAction),
    ['up', 'down', 'left', 'right', 'ok', 'back', 'back', 'back', null])
})

test('rowsFor appends the All apps row to the home view only', () => {
  assert.deepEqual(main.rowsFor(navState()).map((r) => r.id), ['a', 'b', main.ALL_APPS_ID])
  assert.deepEqual(main.rowsFor(navState({view: 'all'})).map((r) => r.id), ['a', 'b', 'c'])
})

test('down/up clamp without wrapping', () => {
  assert.equal(main.nextState(navState({focusIdx: 2}), 'down').focusIdx, 2)
  assert.equal(main.nextState(navState({focusIdx: 0}), 'up').focusIdx, 0)
  assert.equal(main.nextState(navState({focusIdx: 0}), 'down').focusIdx, 1)
})

test('ok on an app sets launch to its id', () => {
  const s = main.nextState(navState({focusIdx: 1}), 'ok')
  assert.equal(s.launch, 'b')
  assert.equal(s.view, 'home')
})

test('ok on the All apps row switches to the all view without launching', () => {
  const s = main.nextState(navState({focusIdx: 2}), 'ok')
  assert.equal(s.view, 'all')
  assert.equal(s.focusIdx, 0)
  assert.equal(s.launch, null)
})

test('back from all returns to home focused on the All apps row', () => {
  const s = main.nextState(navState({view: 'all', focusIdx: 2}), 'back')
  assert.equal(s.view, 'home')
  assert.equal(main.rowsFor(s)[s.focusIdx].id, main.ALL_APPS_ID)
})

test('back on home is swallowed', () => {
  const before = navState({focusIdx: 1})
  assert.deepEqual(main.nextState(before, 'back'), before)
})

test('launch is cleared on the next action', () => {
  const launched = main.nextState(navState(), 'ok')
  assert.equal(main.nextState(launched, 'down').launch, null)
})

test('point moves focus without launching; click focuses and launches', () => {
  const p = main.nextState(navState(), {type: 'point', index: 1})
  assert.equal(p.focusIdx, 1)
  assert.equal(p.launch, null)
  const c = main.nextState(navState(), {type: 'click', index: 1})
  assert.equal(c.focusIdx, 1)
  assert.equal(c.launch, 'b')
})

test('click on the All apps row opens the all view', () => {
  assert.equal(main.nextState(navState(), {type: 'click', index: 2}).view, 'all')
})

test('point and click ignore out-of-range indices', () => {
  const s = navState({focusIdx: 1})
  assert.equal(main.nextState(s, {type: 'point', index: 9}).focusIdx, 1)
  assert.equal(main.nextState(s, {type: 'click', index: -1}).launch, null)
})

// --- Icons (Task 5) ---

test('parseLaunchPoints keeps icon, preferring icon over largeIcon', () => {
  const r = main.parseLaunchPoints({returnValue: true, apps: [
    {id: 'a', title: 'A', icon: '/x/a.png', largeIcon: '/x/a-large.png'},
    {id: 'b', title: 'B', largeIcon: '/x/b-large.png'},
    {id: 'c', title: 'C'},
  ]})
  assert.deepEqual(r.items.map((i) => i.icon), ['/x/a.png', '/x/b-large.png', null])
})

test('iconUrl turns TV paths into file URLs and passes preview paths through', () => {
  assert.equal(main.iconUrl('/media/cryptofs/apps/usr/palm/applications/netflix/icon.png'),
    'file:///media/cryptofs/apps/usr/palm/applications/netflix/icon.png')
  assert.equal(main.iconUrl('/__dev/fixtures/icon-netflix.png'), '/__dev/fixtures/icon-netflix.png')
  assert.equal(main.iconUrl(null), null)
  assert.equal(main.iconUrl(''), null)
})

test('appInitials takes the first letters of the first two words', () => {
  assert.equal(main.appInitials('Prime Video'), 'PV')
  assert.equal(main.appInitials('Netflix'), 'N')
  assert.equal(main.appInitials('homebrew channel extra'), 'HC')
  assert.equal(main.appInitials('  '), '?')
  assert.equal(main.appInitials(''), '?')
})

// --- Curation (Task 6) ---

const app = (id, title) => ({id, title, icon: null})
const INSTALLED = [app('yt', 'YouTube'), app('nf', 'Netflix'), app('ap', 'Apple TV'), app('zz', 'Zattoo')]

test('splitHomeApps keeps curated order', () => {
  const r = main.splitHomeApps(INSTALLED, [{id: 'yt', title: 'YouTube'}, {id: 'nf', title: 'Netflix'}])
  assert.deepEqual(r.home.map((a) => a.id), ['yt', 'nf'])
})

test('splitHomeApps skips curated ids that are not installed', () => {
  const r = main.splitHomeApps(INSTALLED, [{id: 'gone', title: 'Gone'}, {id: 'nf', title: 'Netflix'}])
  assert.deepEqual(r.home.map((a) => a.id), ['nf'])
})

test('splitHomeApps falls back to the first 9 of all when no curated id is installed', () => {
  const many = []
  for (let i = 0; i < 12; i++) many.push(app('id' + i, 'App ' + String(i).padStart(2, '0')))
  const r = main.splitHomeApps(many, [{id: 'gone', title: 'Gone'}])
  assert.equal(r.home.length, 9)
  assert.deepEqual(r.home, r.all.slice(0, 9))
})

test('splitHomeApps: all is alphabetical by title and includes curated apps', () => {
  const r = main.splitHomeApps(INSTALLED, [{id: 'nf', title: 'Netflix'}])
  assert.deepEqual(r.all.map((a) => a.title), ['Apple TV', 'Netflix', 'YouTube', 'Zattoo'])
})

test('splitHomeApps returns empty lists when nothing is installed', () => {
  assert.deepEqual(main.splitHomeApps([], [{id: 'nf', title: 'Netflix'}]), {home: [], all: []})
})

// --- Clock (Task 7) ---

test('formatClock is 24-hour HH:MM in local time', () => {
  assert.equal(main.formatClock(new Date(2026, 9, 25, 7, 5)), '07:05')
  assert.equal(main.formatClock(new Date(2026, 9, 25, 23, 59, 59)), '23:59')
  assert.equal(main.formatClock(new Date(2026, 9, 25, 0, 0)), '00:00')
  assert.equal(main.formatClock(new Date(2026, 9, 25, 13, 30)), '13:30')
})

test('msToNextMinute counts to the next minute boundary', () => {
  assert.equal(main.msToNextMinute(new Date(2026, 9, 25, 7, 5, 30, 250)), 29750)
  assert.equal(main.msToNextMinute(new Date(2026, 9, 25, 7, 5, 0, 0)), 60000)
  assert.equal(main.msToNextMinute(new Date(2026, 9, 25, 7, 5, 59, 999)), 1)
})

// --- Preferences (Task 8) ---

function fakeStorage(initial) {
  const data = Object.assign({}, initial)
  return {
    data,
    getItem: (k) => (Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v) },
  }
}

test('prefs round-trip under customwebos.home.v1', () => {
  const st = fakeStorage()
  assert.equal(main.savePrefs(st, {lastAppId: 'netflix'}), true)
  assert.ok(st.data['customwebos.home.v1'])
  assert.equal(main.PREFS_KEY, 'customwebos.home.v1')
  assert.deepEqual(main.loadPrefs(st), {lastAppId: 'netflix'})
})

test('loadPrefs returns defaults for missing, corrupt or odd values', () => {
  assert.deepEqual(main.loadPrefs(fakeStorage()), {lastAppId: null})
  assert.deepEqual(main.loadPrefs(fakeStorage({'customwebos.home.v1': '{not json'})), {lastAppId: null})
  assert.deepEqual(main.loadPrefs(fakeStorage({'customwebos.home.v1': '42'})), {lastAppId: null})
  assert.deepEqual(main.loadPrefs(fakeStorage({'customwebos.home.v1': '{"lastAppId":7}'})), {lastAppId: null})
})

test('loadPrefs and savePrefs never throw', () => {
  const throwing = {getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('quota') }}
  assert.deepEqual(main.loadPrefs(throwing), {lastAppId: null})
  assert.equal(main.savePrefs(throwing, {lastAppId: 'x'}), false)
  assert.deepEqual(main.loadPrefs(null), {lastAppId: null})
  assert.equal(main.savePrefs(null, {lastAppId: 'x'}), false)
})

// --- Deferred minors ---

test('shouldLaunch allows one launch of any app per LAUNCH_GUARD_MS', () => {
  assert.equal(main.LAUNCH_GUARD_MS, 1000)
  assert.equal(main.shouldLaunch(null, 'a', 5000), true)
  assert.equal(main.shouldLaunch({id: 'a', at: 5000}, 'a', 5500), false)
  assert.equal(main.shouldLaunch({id: 'a', at: 5000}, 'a', 6000), true)
  // keydown on the focused row + click on the row under the pointer
  assert.equal(main.shouldLaunch({id: 'a', at: 5000}, 'b', 5100), false)
})

test('shouldLaunch allows a launch when the clock went backwards', () => {
  assert.equal(main.shouldLaunch({id: 'a', at: 5000}, 'a', 4000), true)
})

test('opening All apps focuses the last launched app when it is there', () => {
  const s = main.nextState(navState({focusIdx: 2, lastAppId: 'c'}), 'ok')
  assert.equal(s.view, 'all')
  assert.equal(main.rowsFor(s)[s.focusIdx].id, 'c')
  assert.equal(main.nextState(navState({focusIdx: 2, lastAppId: 'zzz'}), 'ok').focusIdx, 0)
})

test('launching records lastAppId in the state', () => {
  assert.equal(main.nextState(navState({focusIdx: 1}), 'ok').lastAppId, 'b')
})

test('bootFocusIndex: a curated last app, a non-curated one (the All apps row), or the first row', () => {
  const s = navState()
  assert.equal(main.bootFocusIndex(s, 'b'), 1)
  assert.equal(main.rowsFor(s)[main.bootFocusIndex(s, 'c')].id, main.ALL_APPS_ID)
  assert.equal(main.bootFocusIndex(s, 'unknown'), 0)
  assert.equal(main.bootFocusIndex(s, null), 0)
})
