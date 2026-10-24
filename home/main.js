// CustomWebOS Home — launcher. ES5 only; the webOS 4.4 web engine does
// not reliably accept newer syntax.

var SELF_ID = 'org.jazwinski.customwebos.home';

// Dev-mode webapps on consumer webOS 4.4 can't call applicationManager
// directly (LSCallFromApplication is gated on caller privilege), so listing
// and launching go through the bundled service component instead.
var SERVICE_URI = 'luna://org.jazwinski.customwebos.home.service';

// Home apps and the fallback list come from config.js (global HOME_APPS).
function homeApps() {
  return typeof HOME_APPS !== 'undefined' ? HOME_APPS : [];
}

// Shown immediately on boot, and kept when the service can't be reached, so
// the screen is never empty while the service is down or still spawning.
function fallbackItems() {
  var out = [];
  var apps = homeApps();
  for (var i = 0; i < apps.length; i++) out.push({ id: apps[i].id, title: apps[i].title, icon: null });
  return out;
}

// Returns a tagged result so the caller can distinguish between:
//   - a successful response with zero apps installed  (ok:true,  items:[])
//   - a service-level error delivered via onSuccess   (ok:false, reason: string)
// webOS luna services sometimes route errors through onSuccess with
// returnValue:false, so collapsing both cases to [] would show "no apps"
// when we should show an error.
// Accepts both applicationManager's shape (launchPoints) and the home
// service's listApps shape (apps). Entries without an id, repeated ids
// (listLaunchPoints lists the browser twice on-device) and the home app
// itself are dropped.
function parseLaunchPoints(raw) {
  if (!raw) return { ok: false, reason: 'empty-response' };
  if (raw.returnValue !== true) {
    return { ok: false, reason: raw.errorText || 'service-error' };
  }
  var list = raw.apps || raw.launchPoints;
  var items = [];
  var seen = {};
  if (list && list.length) {
    for (var i = 0; i < list.length; i++) {
      var lp = list[i];
      if (!lp || !lp.id || lp.id === SELF_ID || seen.hasOwnProperty(lp.id)) continue;
      seen[lp.id] = true;
      items.push({ id: lp.id, title: lp.title, icon: lp.icon || lp.largeIcon || null });
    }
  }
  return { ok: true, items: items };
}

// Launch points carry absolute TV paths; the web app loads them as file
// URLs. The browser preview serves its fixture icons under /__dev/.
function iconUrl(path) {
  if (!path) return null;
  if (path.indexOf('/__dev/') === 0) return path;
  return 'file://' + path;
}

function appInitials(title) {
  var words = String(title || '').split(/\s+/);
  var out = '';
  for (var i = 0; i < words.length && out.length < 2; i++) {
    if (words[i]) out += words[i].charAt(0).toUpperCase();
  }
  return out || '?';
}

// Picks what to show from a parseLaunchPoints result. A successful empty
// list is shown as-is ("No apps found"); only a failure falls back.
function chooseApps(parsed, fallback) {
  if (parsed.ok) return { items: parsed.items, source: 'service', note: '' };
  return {
    items: fallback,
    source: 'fallback',
    note: 'Built-in list (home service unavailable: ' + parsed.reason + ')'
  };
}

// Delay before re-asking the service after a failed listApps. Right after
// boot the whole luna bus can stay unresponsive for minutes (seen on-device),
// so keep trying — backing off to one cheap call every 30 s.
function retryDelayMs(attempt) {
  var delays = [5000, 10000, 20000];
  return attempt < delays.length ? delays[attempt] : 30000;
}

// scrollTop that centres the focused item in the list viewport, clamped so
// the list never scrolls past its first or last item.
function scrollTopFor(itemTop, itemHeight, viewHeight, contentHeight) {
  var top = itemTop - (viewHeight - itemHeight) / 2;
  var max = contentHeight - viewHeight;
  if (top > max) top = max;
  if (top < 0) top = 0;
  return Math.round(top);
}

// Splits the installed apps into the Home view (curated ids, in config
// order, skipping anything not installed) and All apps (everything,
// alphabetical). If no curated app is installed, Home shows the first 9.
function splitHomeApps(installed, curated) {
  var byId = {};
  var i;
  for (i = 0; i < installed.length; i++) byId[installed[i].id] = installed[i];
  var home = [];
  for (i = 0; i < curated.length; i++) {
    if (byId.hasOwnProperty(curated[i].id)) home.push(byId[curated[i].id]);
  }
  var all = installed.slice().sort(function (a, b) {
    return String(a.title || a.id).localeCompare(String(b.title || b.id));
  });
  if (!home.length) home = all.slice(0, 9);
  return { home: home, all: all };
}

// --- Preferences (localStorage). Never throws: a missing, denied or
// corrupt store just means defaults. ---

var PREFS_KEY = 'customwebos.home.v1';

function loadPrefs(storage) {
  var prefs = { lastAppId: null };
  try {
    var raw = storage && storage.getItem(PREFS_KEY);
    var saved = raw ? JSON.parse(raw) : null;
    if (saved && typeof saved.lastAppId === 'string') prefs.lastAppId = saved.lastAppId;
  } catch (e) { /* defaults */ }
  return prefs;
}

function savePrefs(storage, prefs) {
  try {
    if (!storage) return false;
    storage.setItem(PREFS_KEY, JSON.stringify({ lastAppId: prefs.lastAppId }));
    return true;
  } catch (e) {
    return false;
  }
}

function pad2(n) { return n < 10 ? '0' + n : String(n); }

// 24-hour local time, HH:MM.
function formatClock(date) {
  return pad2(date.getHours()) + ':' + pad2(date.getMinutes());
}

function msToNextMinute(date) {
  return 60000 - (date.getSeconds() * 1000 + date.getMilliseconds());
}

function focusIndexFor(items, id) {
  for (var i = 0; i < items.length; i++) {
    if (items[i].id === id) return i;
  }
  return 0;
}

// --- Navigation: one pure reducer for keys and the Magic Remote pointer ---

// Sentinel row at the end of the Home view that opens the All apps view.
var ALL_APPS_ID = '__all__';

function keyAction(keyCode) {
  switch (keyCode) {
    case 38: return 'up';
    case 40: return 'down';
    case 37: return 'left';
    case 39: return 'right';
    case 13: return 'ok';
    case 461: return 'back'; // webOS remote Back
    case 27:                 // browser preview: Escape
    case 8:  return 'back';  // browser preview: Backspace
  }
  return null;
}

// Rows currently on screen: Home apps plus the All apps row, or every app.
function rowsFor(state) {
  if (state.view === 'all') return state.allItems;
  return state.homeItems.concat([{ id: ALL_APPS_ID, title: 'All apps', icon: null }]);
}

function withChanges(state, changes) {
  var next = {};
  var k;
  for (k in state) if (state.hasOwnProperty(k)) next[k] = state[k];
  for (k in changes) if (changes.hasOwnProperty(k)) next[k] = changes[k];
  return next;
}

// state: { view: 'home'|'all', focusIdx, homeItems, allItems, launch, lastAppId }
// action: a keyAction() value, or { type: 'point'|'click', index }.
// Returns a new state; launch is the id to open, set only by the action
// that asked for it. Back on Home is swallowed: as the Home app there is
// nowhere to go back to.
function nextState(state, action) {
  var rows = rowsFor(state);
  var last = rows.length - 1;
  var idx = state.focusIdx;

  function activate(i) {
    var row = rows[i];
    if (!row) return withChanges(state, { launch: null });
    if (row.id === ALL_APPS_ID) {
      return withChanges(state, { view: 'all', focusIdx: focusIndexFor(state.allItems, state.lastAppId), launch: null });
    }
    return withChanges(state, { focusIdx: i, launch: row.id, lastAppId: row.id });
  }

  if (action && typeof action === 'object') {
    if (action.index < 0 || action.index > last) return withChanges(state, { launch: null });
    if (action.type === 'point') return withChanges(state, { focusIdx: action.index, launch: null });
    if (action.type === 'click') return activate(action.index);
    return state;
  }
  switch (action) {
    case 'up':   return withChanges(state, { focusIdx: idx > 0 ? idx - 1 : 0, launch: null });
    case 'down': return withChanges(state, { focusIdx: idx < last ? idx + 1 : last, launch: null });
    case 'ok':   return activate(idx);
    case 'back':
      if (state.view === 'all') {
        return withChanges(state, { view: 'home', focusIdx: state.homeItems.length, launch: null });
      }
      return state;
  }
  return withChanges(state, { launch: null });
}

// Where focus starts on boot: the last launched app if it's on Home; the
// All apps row if it's only in All apps (opening it then lands on the
// app); otherwise the first row.
function bootFocusIndex(state, lastAppId) {
  var rows = rowsFor(state);
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].id === lastAppId && rows[i].id !== ALL_APPS_ID) return i;
  }
  if (state.view === 'home') {
    for (var j = 0; j < state.allItems.length; j++) {
      if (state.allItems[j].id === lastAppId) return rows.length - 1;
    }
  }
  return 0;
}

// One launch of any app per LAUNCH_GUARD_MS: a held OK auto-repeats, and
// with the Magic Remote pointer visible OK can arrive as both keydown (the
// focused row) and click (the row under the pointer, possibly another app).
// A negative delta (wall clock moved back) allows the launch.
var LAUNCH_GUARD_MS = 1000;

function shouldLaunch(last, id, now) {
  if (!last) return true;
  var elapsed = now - last.at;
  return elapsed < 0 || elapsed >= LAUNCH_GUARD_MS;
}

// Monotonic where available (Chrome 24+), so NTP corrections after boot
// don't skew the launch guard.
function nowMs() {
  if (typeof performance !== 'undefined' && performance.now) return performance.now();
  return new Date().getTime();
}

// --- Browser runtime (guarded; does not execute when required from Node) ---

function mountUI(doc) {
  // status/note describe the service; nav is the reducer's state.
  var state = { status: 'loading', note: '', launchNote: '' };
  var nav = { view: 'home', focusIdx: 0, homeItems: [], allItems: [], launch: null, lastAppId: null };
  var lastLaunch = null;
  // Until the user does anything, each new list re-derives the boot focus
  // (the fallback list may not contain the remembered app).
  var userMoved = false;
  var root = doc.getElementById('root');
  var storage = null;
  try { storage = window.localStorage; } catch (e) { /* unavailable */ }
  var prefs = loadPrefs(storage);
  // Icon URLs that failed to load: render initials for them from then on,
  // so a broken icon doesn't flash back on every re-render.
  var brokenIcons = {};

  function appendState(className, text) {
    var p = doc.createElement('p');
    p.className = className;
    p.textContent = text;
    root.appendChild(p);
  }

  function initialsBox(title) {
    var span = doc.createElement('span');
    span.className = 'initials';
    span.textContent = appInitials(title);
    return span;
  }

  function iconBox(row) {
    var box = doc.createElement('span');
    box.className = 'app-icon';
    var url = row.id === ALL_APPS_ID ? null : iconUrl(row.icon);
    if (row.id === ALL_APPS_ID) {
      var more = doc.createElement('span');
      more.className = 'initials';
      more.textContent = '…';
      box.appendChild(more);
    } else if (!url || brokenIcons[url]) {
      box.appendChild(initialsBox(row.title || row.id));
    } else {
      var img = doc.createElement('img');
      img.alt = '';
      img.onerror = function () {
        brokenIcons[url] = true;
        if (img.parentNode) box.replaceChild(initialsBox(row.title || row.id), img);
      };
      img.src = url;
      box.appendChild(img);
    }
    return box;
  }

  // keepScroll: a pointer action. Keep the list where it is; recentring
  // would slide another row under the pointer. (Synthetic mousemoves at an
  // unchanged position are also filtered in onPointer.)
  function render(keepScroll) {
    var oldList = root.querySelector('.app-list');
    var oldScroll = oldList ? oldList.scrollTop : 0;
    while (root.firstChild) root.removeChild(root.firstChild);
    var header = doc.createElement('header');
    var h = doc.createElement('h1');
    h.textContent = nav.view === 'all' ? 'All apps' : 'CustomWebOS';
    header.appendChild(h);
    var clock = doc.createElement('span');
    clock.className = 'clock';
    clock.textContent = formatClock(new Date());
    header.appendChild(clock);
    root.appendChild(header);

    if (state.status === 'loading') { appendState('state', 'Loading installed apps…'); return; }
    if (!nav.homeItems.length && !nav.allItems.length) { appendState('state', 'No apps found.'); return; }

    // One single-line note (see .state.note), launch result first, so Home
    // keeps its fixed height whatever the messages say.
    var notes = [];
    if (state.launchNote) notes.push(state.launchNote);
    if (state.note) notes.push(state.note);
    if (notes.length) appendState('state note', notes.join(' · '));

    // The list is its own clipped viewport filling the rest of the screen;
    // keep the focused item centred in it as focus moves.
    var rows = rowsFor(nav);
    var ul = doc.createElement('ul');
    ul.className = 'app-list';
    var focusedLi = null;
    for (var i = 0; i < rows.length; i++) {
      var li = doc.createElement('li');
      li.className = 'app-item' + (i === nav.focusIdx ? ' focused' : '');
      li.setAttribute('tabindex', '-1');
      li.setAttribute('data-id', rows[i].id);
      li.setAttribute('data-index', String(i));
      li.appendChild(iconBox(rows[i]));
      var label = doc.createElement('span');
      label.className = 'app-title';
      label.textContent = rows[i].title || rows[i].id;
      li.appendChild(label);
      ul.appendChild(li);
      if (i === nav.focusIdx) focusedLi = li;
    }
    root.appendChild(ul);
    if (keepScroll) {
      ul.scrollTop = oldScroll;
    } else if (focusedLi) {
      ul.scrollTop = scrollTopFor(focusedLi.offsetTop, focusedLi.offsetHeight, ul.clientHeight, ul.scrollHeight);
    }
  }

  // LG's own OSE bootplate uses WebOSServiceBridge; PalmServiceBridge is a
  // Palm-era alias that may be present but silently drops responses on
  // webOS 4.x. Prefer the canonical class, fall back if only the alias is
  // defined. The 10 s timeout surfaces a dead call either way.
  function newBridge() {
    if (typeof WebOSServiceBridge !== 'undefined') return new WebOSServiceBridge();
    if (typeof PalmServiceBridge !== 'undefined')  return new PalmServiceBridge();
    return null;
  }

  function lunaCall(uri, payload, onSuccess, onFailure) {
    var bridge = newBridge();
    if (!bridge) {
      onFailure({ errorText: 'no service bridge available (not running on TV?)' });
      return;
    }
    var done = false;
    bridge.onservicecallback = function (msgText) {
      if (done) return;
      done = true;
      var msg;
      try { msg = JSON.parse(msgText); } catch (e) {
        onFailure({ errorText: 'bad JSON from ' + uri });
        return;
      }
      if (msg && msg.returnValue === false) {
        onFailure(msg);
      } else {
        onSuccess(msg);
      }
    };
    setTimeout(function () {
      if (done) return;
      done = true;
      onFailure({ errorText: 'no response from ' + uri + ' within 10s (webOS 4 bus permission?)' });
    }, 10000);
    bridge.call(uri, JSON.stringify(payload));
  }

  function launch(id) {
    state.launchNote = '';
    prefs.lastAppId = id;
    savePrefs(storage, prefs);
    lunaCall(
      SERVICE_URI + '/launch',
      { id: id },
      function () {},
      function (err) {
        // Failing while we're hidden means the launch most likely worked and
        // only its reply was late (slow bus); don't greet the user with it.
        lastLaunch = null; // let OK retry straight away
        if (doc.visibilityState === 'hidden') return;
        // A note, not the error screen: the list stays usable.
        state.launchNote = 'Could not open ' + id + ': ' + ((err && err.errorText) || 'launch failed');
        render();
      }
    );
  }

  function dispatch(action) {
    if (state.status !== 'ready') return;
    var before = nav;
    userMoved = true;
    nav = nextState(nav, action);
    if (nav.launch) {
      var now = nowMs();
      if (shouldLaunch(lastLaunch, nav.launch, now)) {
        lastLaunch = { id: nav.launch, at: now };
        launch(nav.launch);
      }
    }
    var pointer = typeof action === 'object' && nav.view === before.view;
    if (nav !== before) render(pointer);
  }

  function onKey(e) {
    var action = keyAction(e.keyCode);
    if (!action) return;
    e.preventDefault();
    if (e.repeat && action === 'ok') return; // held OK: launch once
    dispatch(action);
  }

  // Magic Remote pointer: hover focuses, click opens.
  function rowIndex(target) {
    while (target && target !== root) {
      if (target.getAttribute && target.getAttribute('data-index') !== null) {
        return parseInt(target.getAttribute('data-index'), 10);
      }
      target = target.parentNode;
    }
    return -1;
  }

  // Hover counts only when the pointer really moved. After the list scrolls
  // (key navigation recentres it), Blink sends a synthetic mousemove/over at
  // the unchanged position, which would otherwise steal focus from the keys.
  var lastPointer = { x: -1, y: -1 };

  function onPointer(type) {
    return function (e) {
      if (type === 'point') {
        if (e.clientX === lastPointer.x && e.clientY === lastPointer.y) return;
        lastPointer = { x: e.clientX, y: e.clientY };
      }
      var index = rowIndex(e.target);
      if (index < 0 || (type === 'point' && index === nav.focusIdx)) return;
      dispatch({ type: type, index: index });
    };
  }

  function showApps(choice) {
    // Keep focus on the same row across a list swap, but only if real apps
    // were on screen; before the first list the only row is All apps.
    var hadApps = nav.homeItems.length > 0 || nav.allItems.length > 0;
    var focusedId = hadApps ? rowsFor(nav)[nav.focusIdx].id : null;
    var split = splitHomeApps(choice.items, homeApps());
    nav = { view: nav.view, focusIdx: 0, homeItems: split.home, allItems: split.all, launch: null, lastAppId: prefs.lastAppId };
    nav.focusIdx = hadApps && userMoved ? focusIndexFor(rowsFor(nav), focusedId) : bootFocusIndex(nav, prefs.lastAppId);
    state.note = choice.note;
    state.status = 'ready';
    render();
  }

  var retryTimer = null;
  var listInFlight = false;
  var haveServiceList = false;

  function requestApps(attempt) {
    function retry(reason) {
      // Once the service has answered, a failed refresh (slow bus after
      // boot, see m2-tracking) keeps the list on screen and retries quietly.
      if (!haveServiceList) {
        var choice = chooseApps({ ok: false, reason: reason }, fallbackItems());
        choice.note += ' — retrying';
        showApps(choice);
      }
      retryTimer = setTimeout(function () { retryTimer = null; requestApps(attempt + 1); }, retryDelayMs(attempt));
    }
    listInFlight = true;
    lunaCall(
      SERVICE_URI + '/listApps',
      {},
      function (msg) {
        listInFlight = false;
        var parsed = parseLaunchPoints(msg);
        if (parsed.ok) {
          haveServiceList = true;
          showApps(chooseApps(parsed, fallbackItems()));
        } else {
          retry(parsed.reason);
        }
      },
      function (err) {
        listInFlight = false;
        retry((err && err.errorText) || 'listApps failed');
      }
    );
  }

  function fetchLaunchPoints() {
    showApps({ items: fallbackItems(), note: '' });
    requestApps(0);
  }

  // Updates the clock text in place at each minute boundary; a setTimeout
  // chain rather than setInterval so it re-aligns after the TV sleeps.
  var clockTimer = null;
  function tickClock() {
    var el = root.querySelector('.clock');
    var now = new Date();
    if (el) el.textContent = formatClock(now);
    clearTimeout(clockTimer);
    clockTimer = setTimeout(tickClock, msToNextMinute(now));
  }

  // Coming back from another app: catch up the clock and refresh the list
  // (apps may have been installed). A pending retry already covers it.
  function onVisibility() {
    if (doc.visibilityState !== 'visible') {
      // Leaving (usually into the launched app): a stale launch error must
      // not greet the user on return.
      state.launchNote = '';
      return;
    }
    render();
    tickClock();
    if (!retryTimer && !listInFlight) requestApps(0);
  }

  doc.addEventListener('keydown', onKey);
  doc.addEventListener('visibilitychange', onVisibility);
  root.addEventListener('mousemove', onPointer('point'));
  root.addEventListener('click', onPointer('click'));
  render();
  tickClock();
  fetchLaunchPoints();
}

if (typeof window !== 'undefined' && window.document) {
  if (window.document.readyState === 'loading') {
    window.document.addEventListener('DOMContentLoaded', function () { mountUI(window.document); });
  } else {
    mountUI(window.document);
  }
}

// --- Node-testable exports (no-op when main.js runs in the browser) ---

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SELF_ID: SELF_ID,
    SERVICE_URI: SERVICE_URI,
    parseLaunchPoints: parseLaunchPoints,
    chooseApps: chooseApps,
    focusIndexFor: focusIndexFor,
    retryDelayMs: retryDelayMs,
    scrollTopFor: scrollTopFor,
    ALL_APPS_ID: ALL_APPS_ID,
    keyAction: keyAction,
    rowsFor: rowsFor,
    nextState: nextState,
    iconUrl: iconUrl,
    appInitials: appInitials,
    splitHomeApps: splitHomeApps,
    bootFocusIndex: bootFocusIndex,
    LAUNCH_GUARD_MS: LAUNCH_GUARD_MS,
    shouldLaunch: shouldLaunch,
    formatClock: formatClock,
    msToNextMinute: msToNextMinute,
    PREFS_KEY: PREFS_KEY,
    loadPrefs: loadPrefs,
    savePrefs: savePrefs
  };
}
