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

test('right/left move along the dock and clamp at both ends', () => {
  assert.equal(main.nextState(navState({focusIdx: 0}), 'right').focusIdx, 1)
  assert.equal(main.nextState(navState({focusIdx: 2}), 'right').focusIdx, 2)
  assert.equal(main.nextState(navState({focusIdx: 1}), 'left').focusIdx, 0)
  assert.equal(main.nextState(navState({focusIdx: 0}), 'left').focusIdx, 0)
})

test('up/down on Home leave focus where it is', () => {
  assert.equal(main.nextState(navState({focusIdx: 1}), 'up').focusIdx, 1)
  assert.equal(main.nextState(navState({focusIdx: 1}), 'down').focusIdx, 1)
})

// 14 apps in rows of GRID_COLS (6): indices 0-5, 6-11, 12-13.
const grid = (focusIdx) => navState({view: 'all', focusIdx, allItems: 'abcdefghijklmn'.split('').map(item)})

test('the grid has 6 columns', () => {
  assert.equal(main.GRID_COLS, 6)
})

test('down moves a row in the grid, landing on the last app of a short row', () => {
  assert.equal(main.nextState(grid(2), 'down').focusIdx, 8)
  assert.equal(main.nextState(grid(8), 'down').focusIdx, 13)
  assert.equal(main.nextState(grid(13), 'down').focusIdx, 13)
})

test('up moves a row in the grid and stays on the top row', () => {
  assert.equal(main.nextState(grid(13), 'up').focusIdx, 7)
  assert.equal(main.nextState(grid(3), 'up').focusIdx, 3)
})

test('right/left move one app in the grid and clamp at the ends', () => {
  assert.equal(main.nextState(grid(13), 'right').focusIdx, 13)
  assert.equal(main.nextState(grid(5), 'right').focusIdx, 6)
  assert.equal(main.nextState(grid(0), 'left').focusIdx, 0)
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

test('frameStats summarises frame deltas', () => {
  assert.deepEqual(main.frameStats([16, 16, 17, 50]), { frames: 4, p50: 16.5, p95: 50, max: 50, over33: 1 })
})

test('frameStats of no frames is all zeros', () => {
  assert.deepEqual(main.frameStats([]), { frames: 0, p50: 0, p95: 0, max: 0, over33: 0 })
})

test('perfParams reads the perf launch parameters, with defaults', () => {
  assert.deepEqual(main.perfParams('{"perf":{"action":"down","steps":10,"intervalMs":50}}'), { action: 'down', steps: 10, intervalMs: 50, view: 'home' })
  assert.deepEqual(main.perfParams('{"perf":{}}'), { action: 'right', steps: 40, intervalMs: 80, view: 'home' })
  assert.equal(main.perfParams('{"perf":{"view":"all"}}').view, 'all')
})

test('perfParams is null without a usable perf object', () => {
  for (const raw of [undefined, 'nope', '{}', '{"perf":{"action":"jump"}}', '{"perf":{"view":"settings"}}']) {
    assert.equal(main.perfParams(raw), null, String(raw))
  }
})

test('formatDate gives the Polish date by default and English for en', () => {
  const d = new Date(2026, 9, 25)
  assert.equal(main.formatDate(d, 'pl-PL'), 'niedziela, 25 października')
  assert.equal(main.formatDate(d, 'en-US'), 'Sunday, 25 October')
  assert.equal(main.formatDate(d, undefined), 'niedziela, 25 października')
  assert.equal(main.formatDate(d, ''), 'niedziela, 25 października')
})

test('formatDate uses the genitive for every Polish month', () => {
  const months = ['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca', 'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia']
  months.forEach((m, i) => {
    assert.match(main.formatDate(new Date(2026, i, 3), 'pl'), new RegExp(', 3 ' + m + '$'))
  })
})

test('formatDate names every Polish weekday', () => {
  // 2026-10-25 is a Sunday.
  const days = ['niedziela', 'poniedziałek', 'wtorek', 'środa', 'czwartek', 'piątek', 'sobota']
  days.forEach((d, i) => {
    assert.equal(main.formatDate(new Date(2026, 9, 25 + i), 'pl').split(',')[0], d)
  })
})

test('logoFor maps curated apps and All apps to bundled logos', () => {
  assert.equal(main.logoFor('netflix'), 'assets/icons/netflix.svg')
  assert.equal(main.logoFor('com.wbd.stream'), 'assets/icons/max.svg')
  assert.equal(main.logoFor(main.ALL_APPS_ID), 'assets/icons/apps.svg')
  assert.equal(main.logoFor('pl.cda'), null)
})

test('a failed app list shows loading during the grace period, then the error', () => {
  assert.equal(main.LOADING_GRACE_MS, 30000)
  assert.equal(main.failureView(0), 'loading')
  assert.equal(main.failureView(29999), 'loading')
  assert.equal(main.failureView(30000), 'error')
})

// Day/night theme: sunrise and sunset in Warsaw (minutes after 00:00 UTC).
const WAW = {lat: 52.23, lon: 21.01}
const near = (actual, expected, what) =>
  assert.ok(Math.abs(actual - expected) <= 5, what + ': ' + actual + ' vs ' + expected)

test('sunTimesUtc gives Warsaw sunrise and sunset at midsummer', () => {
  const t = main.sunTimesUtc(2026, 6, 21, WAW.lat, WAW.lon)
  near(t.rise, 134, 'rise 02:14 UTC')
  near(t.set, 1141, 'set 19:01 UTC')
})

test('sunTimesUtc gives Warsaw sunrise and sunset at midwinter', () => {
  const t = main.sunTimesUtc(2026, 12, 21, WAW.lat, WAW.lon)
  near(t.rise, 403, 'rise 06:43 UTC')
  near(t.set, 865, 'set 14:25 UTC')
})

test('sunTimesUtc has no jump across the clock change (it works in UTC)', () => {
  const before = main.sunTimesUtc(2026, 3, 28, WAW.lat, WAW.lon)
  const after = main.sunTimesUtc(2026, 3, 30, WAW.lat, WAW.lon)
  assert.ok(Math.abs(after.set - before.set) < 5)
})

test('themeFor follows the sun in Warsaw', () => {
  assert.equal(main.themeFor(new Date(Date.UTC(2026, 5, 21, 12, 0)), WAW), 'light')
  assert.equal(main.themeFor(new Date(Date.UTC(2026, 5, 21, 20, 0)), WAW), 'dark')
  assert.equal(main.themeFor(new Date(Date.UTC(2026, 11, 21, 15, 0)), WAW), 'dark')
  assert.equal(main.themeFor(new Date(Date.UTC(2026, 11, 21, 7, 0)), WAW), 'light')
})

test('themeFor uses fixed local hours while the clock is unsynced', () => {
  assert.equal(main.themeFor(new Date(2020, 0, 1, 12, 0), WAW), 'light')
  assert.equal(main.themeFor(new Date(2020, 0, 1, 22, 0), WAW), 'dark')
})

test('themeFor uses fixed local hours without a usable location', () => {
  assert.equal(main.themeFor(new Date(2026, 5, 21, 6, 0), undefined), 'dark')
  assert.equal(main.themeFor(new Date(2026, 5, 21, 7, 0), undefined), 'light')
  assert.equal(main.themeFor(new Date(2026, 5, 21, 6, 0), {lat: 'x'}), 'dark')
  assert.deepEqual(main.FALLBACK_DAY, {from: 420, to: 1140})
})

test('wallpaperSrc names the mode and glass files', () => {
  assert.equal(main.wallpaperSrc('light', false), 'assets/wallpapers/morphogenesis-day.jpg')
  assert.equal(main.wallpaperSrc('light', true), 'assets/wallpapers/morphogenesis-day-dock.jpg')
  assert.equal(main.wallpaperSrc('dark', false), 'assets/wallpapers/morphogenesis-night.jpg')
  assert.equal(main.wallpaperSrc('dark', true), 'assets/wallpapers/morphogenesis-night-dock.jpg')
})

test('forcedTheme reads a theme launch param, else a ?theme= query', () => {
  assert.equal(main.forcedTheme('{"theme":"light"}', ''), 'light')
  assert.equal(main.forcedTheme('{"theme":"dark","perf":{}}', '?theme=light'), 'dark')
  assert.equal(main.forcedTheme(undefined, '?theme=dark'), 'dark')
  assert.equal(main.forcedTheme('{}', '?x=1&theme=light'), 'light')
  assert.equal(main.forcedTheme('{"theme":"blue"}', ''), null)
  assert.equal(main.forcedTheme('not json', '?theme=pink'), null)
  assert.equal(main.forcedTheme(undefined, undefined), null)
})

test('slideshowParams accepts the four HDMI inputs from launch params or the preview query', () => {
  for (const n of [1, 2, 3, 4]) {
    assert.deepEqual(main.slideshowParams('{"slideshow":{"input":"com.webos.app.hdmi' + n + '"}}', ''), { input: 'com.webos.app.hdmi' + n })
  }
  assert.deepEqual(main.slideshowParams(undefined, '?mock=photos&slideshow=com.webos.app.hdmi2'), { input: 'com.webos.app.hdmi2' })
  assert.equal(main.slideshowParams('{"slideshow":{"input":"com.webos.app.livetv"}}', ''), null)
  assert.equal(main.slideshowParams('{"slideshow":{"input":"com.webos.app.hdmi5"}}', ''), null)
  assert.equal(main.slideshowParams('not json', '?slideshow=netflix'), null)
  assert.equal(main.slideshowParams('{}', ''), null)
})

test('shuffle returns a permutation, driven by the given random source', () => {
  const list = ['a', 'b', 'c', 'd', 'e']
  let seed = 1
  const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 }
  const out = main.shuffle(list, rand)
  assert.deepEqual([...out].sort(), list)
  assert.deepEqual(list, ['a', 'b', 'c', 'd', 'e'], 'input untouched')
  assert.notDeepEqual(out, list)
  assert.equal(main.SLIDE_MS, 30000)
  assert.equal(main.FADE_MS, 1000)
})
