// CustomWebOS Home — launcher. ES5 only; the webOS 4.4 web engine does
// not reliably accept newer syntax.

var SELF_ID = 'org.jazwinski.customwebos.home';

// Dev-mode webapps on consumer webOS 4.4 can't call applicationManager
// directly (LSCallFromApplication is gated on caller privilege), so listing
// and launching go through the bundled service component instead.
var SERVICE_URI = 'luna://org.jazwinski.customwebos.home.service';

// The Home view's apps, in order, come from config.js (global HOME_APPS).
function homeApps() {
  return typeof HOME_APPS !== 'undefined' ? HOME_APPS : [];
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

// The error screen shown until the home service first answers. There is
// deliberately no built-in app list: a list that can't launch anything
// looks like a working Home and hides the real problem.
function unavailableText(reason, retryMs) {
  return {
    title: "Can't reach the home service",
    reason: reason,
    retry: 'Trying again in ' + Math.ceil(retryMs / 1000) + ' s. ' +
      "If this doesn't clear, close CustomWebOS and open it again."
  };
}

// How long a failing app list keeps showing "Loading installed apps…"
// before the error screen. A cold-started TV's first listApps can fail
// while the service spawns; the retry 5 s later usually works.
var LOADING_GRACE_MS = 30000;

function failureView(elapsedMs) {
  return elapsedMs < LOADING_GRACE_MS ? 'loading' : 'error';
}

// Delay before re-asking the service after a failed listApps (service still
// spawning, slow reply): keep trying, backing off to one cheap call every
// 30 s.
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
  // A config title names the Home tile ("PS5" for HDMI 1); All apps keeps
  // the TV's own name.
  for (i = 0; i < curated.length; i++) {
    if (!byId.hasOwnProperty(curated[i].id)) continue;
    var row = byId[curated[i].id];
    if (curated[i].title) {
      var named = {};
      for (var k in row) if (row.hasOwnProperty(k)) named[k] = row[k];
      named.title = curated[i].title;
      row = named;
    }
    home.push(row);
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

// Sunrise and sunset for a UTC calendar day at lat/lon (east positive), in
// minutes after 00:00 UTC: the NOAA "sunrise equation", good to a minute or
// two at these latitudes. Polar day/night is clamped (not relevant here).
function sunTimesUtc(year, month, day, lat, lon) {
  var rad = Math.PI / 180;
  var jd0 = Date.UTC(year, month - 1, day) / 86400000 + 2440587.5;
  var n = Math.ceil(jd0 - 2451545 + 0.0008);
  var jStar = n - lon / 360;
  var m = (357.5291 + 0.98560028 * jStar) % 360;
  var c = 1.9148 * Math.sin(m * rad) + 0.02 * Math.sin(2 * m * rad) + 0.0003 * Math.sin(3 * m * rad);
  var lambda = (m + c + 180 + 102.9372) % 360;
  var transit = 2451545 + jStar + 0.0053 * Math.sin(m * rad) - 0.0069 * Math.sin(2 * lambda * rad);
  var sinDecl = Math.sin(lambda * rad) * Math.sin(23.4397 * rad);
  var cosDecl = Math.cos(Math.asin(sinDecl));
  var cosW = (Math.sin(-0.833 * rad) - Math.sin(lat * rad) * sinDecl) / (Math.cos(lat * rad) * cosDecl);
  var w = Math.acos(Math.max(-1, Math.min(1, cosW))) / rad;
  function minutesOf(jd) {
    var f = jd + 0.5 - Math.floor(jd + 0.5);
    return f * 1440;
  }
  return { rise: minutesOf(transit - w / 360), set: minutesOf(transit + w / 360) };
}

// Local minutes of the day used when the sun can't be computed.
var FALLBACK_DAY = { from: 7 * 60, to: 19 * 60 };

// 'light' between sunrise and sunset at loc, else 'dark'. Without a usable
// location, or with a clock that isn't synced yet (the TV can report an old
// year just after boot), fixed local hours decide instead.
function themeFor(date, loc) {
  var usable = loc && typeof loc.lat === 'number' && typeof loc.lon === 'number' &&
    !isNaN(loc.lat) && !isNaN(loc.lon) && date.getFullYear() >= 2026;
  if (!usable) {
    var local = date.getHours() * 60 + date.getMinutes();
    return local >= FALLBACK_DAY.from && local < FALLBACK_DAY.to ? 'light' : 'dark';
  }
  var t = sunTimesUtc(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), loc.lat, loc.lon);
  var now = date.getUTCHours() * 60 + date.getUTCMinutes();
  return now >= t.rise && now < t.set ? 'light' : 'dark';
}

// The date under the clock, in the TV's language: built-in tables rather
// than toLocaleDateString, which depends on the TV's ICU build. English for
// en*, Polish (genitive months) for everything else.
var DATE_NAMES = {
  pl: {
    days: ['niedziela', 'poniedziałek', 'wtorek', 'środa', 'czwartek', 'piątek', 'sobota'],
    months: ['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca', 'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia']
  },
  en: {
    days: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
    months: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
  }
};

function formatDate(date, lang) {
  var names = String(lang || '').toLowerCase().indexOf('en') === 0 ? DATE_NAMES.en : DATE_NAMES.pl;
  return names.days[date.getDay()] + ', ' + date.getDate() + ' ' + names.months[date.getMonth()];
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

// White monochrome logos bundled in assets/icons/ (sources and licences in
// that folder), by app id. Apps not listed use the TV's icon or initials.
var APP_LOGOS = {
  'netflix': 'netflix',
  'youtube.leanback.v4': 'youtube',
  'amazon': 'primevideo',
  'com.wbd.stream': 'max',
  'com.apple.appletv': 'appletv',
  'com.webos.app.livetv': 'livetv',
  'com.webos.app.hdmi1': 'hdmi',
  'org.webosbrew.hbchannel': 'homebrew'
};
APP_LOGOS[ALL_APPS_ID] = 'apps';

function logoFor(id) {
  return APP_LOGOS.hasOwnProperty(id) ? 'assets/icons/' + APP_LOGOS[id] + '.svg' : null;
}

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

// Tiles per row in the All apps grid.
var GRID_COLS = 6;

// state: { view: 'home'|'all', focusIdx, homeItems, allItems, launch, lastAppId }
// Home is a one-row dock (left/right; up/down do nothing yet: up is kept
// for a future control row). All apps is a grid of GRID_COLS columns.
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
  function moveTo(i) { return withChanges(state, { focusIdx: i, launch: null }); }
  var grid = state.view === 'all';
  switch (action) {
    case 'left':  return moveTo(idx > 0 ? idx - 1 : 0);
    case 'right': return moveTo(idx < last ? idx + 1 : last);
    case 'up':    return moveTo(grid && idx - GRID_COLS >= 0 ? idx - GRID_COLS : idx);
    case 'down':
      // Down from a row above a short last row lands on its last app.
      if (grid && Math.floor(idx / GRID_COLS) < Math.floor(last / GRID_COLS)) {
        return moveTo(Math.min(idx + GRID_COLS, last));
      }
      return moveTo(idx);
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

// --- Perf mode: measured on the TV by scripts/perf.ps1 ---

// Summary of frame (or dispatch) durations in ms: p50 is the median, p95 the
// nearest-rank 95th percentile, over33 the count slower than 30 fps.
function frameStats(deltas) {
  var n = deltas.length;
  if (!n) return { frames: 0, p50: 0, p95: 0, max: 0, over33: 0 };
  var s = deltas.slice().sort(function (a, b) { return a - b; });
  var mid = Math.floor(n / 2);
  var p50 = n % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  var over = 0;
  for (var i = 0; i < n; i++) if (s[i] > 33) over++;
  function r(x) { return Math.round(x * 10) / 10; }
  return { frames: n, p50: r(p50), p95: r(s[Math.ceil(0.95 * n) - 1]), max: r(s[n - 1]), over33: over };
}

var PERF_ACTIONS = { right: true, left: true, down: true, up: true };
var PERF_VIEWS = { home: true, all: true };

// The app's launch parameters (PalmSystem.launchParams, a JSON string) may
// carry {"perf": {action, steps, intervalMs, view}}; anything else means no
// perf run. view 'all' opens All apps before stepping.
function perfParams(raw) {
  var parsed;
  try { parsed = JSON.parse(raw); } catch (e) { return null; }
  var p = parsed && parsed.perf;
  if (!p || typeof p !== 'object') return null;
  var action = p.action === undefined ? 'right' : p.action;
  if (!PERF_ACTIONS.hasOwnProperty(action)) return null;
  var view = p.view === undefined ? 'home' : p.view;
  if (!PERF_VIEWS.hasOwnProperty(view)) return null;
  return {
    action: action,
    steps: typeof p.steps === 'number' ? p.steps : 40,
    intervalMs: typeof p.intervalMs === 'number' ? p.intervalMs : 80,
    view: view
  };
}

// The wallpaper (glass false) or its pre-blurred glass copy for a mode.
function wallpaperSrc(mode, glass) {
  return 'assets/wallpapers/morphogenesis-' + (mode === 'light' ? 'day' : 'night') +
    (glass ? '-dock' : '') + '.jpg';
}

// A mode forced for checks on the TV: launch params {"theme": "light"|"dark"},
// or, without launch params, a ?theme= query (dev server). Else null.
function forcedTheme(raw, search) {
  var parsed = null;
  try { parsed = JSON.parse(raw); } catch (e) { parsed = null; }
  var t = parsed && parsed.theme;
  if (!t && typeof search === 'string') {
    var m = /[?&]theme=([a-z]+)/.exec(search);
    t = m && m[1];
  }
  return t === 'light' || t === 'dark' ? t : null;
}

// No-signal slideshow: one photo every SLIDE_MS, cross-faded over FADE_MS.
var SLIDE_MS = 30000;
var FADE_MS = 1000;
var HDMI_APP = /^com\.webos\.app\.hdmi[1-4]$/;

// {input} when launched to cover a dark HDMI input: launch params
// {"slideshow":{"input":"com.webos.app.hdmiN"}}, or, without launch params,
// a ?slideshow=com.webos.app.hdmiN query (dev server). Else null.
function slideshowParams(raw, search) {
  var parsed = null;
  try { parsed = JSON.parse(raw); } catch (e) { parsed = null; }
  var input = parsed && parsed.slideshow && parsed.slideshow.input;
  if (!input && typeof search === 'string') {
    var m = /[?&]slideshow=([a-z0-9.]+)/.exec(search);
    input = m && m[1];
  }
  return typeof input === 'string' && HDMI_APP.test(input) ? { input: input } : null;
}

// A shuffled copy of list (Fisher-Yates); rand() returns [0, 1).
function shuffle(list, rand) {
  var out = list.slice();
  for (var i = out.length - 1; i > 0; i--) {
    var j = Math.floor(rand() * (i + 1));
    var t = out[i];
    out[i] = out[j];
    out[j] = t;
  }
  return out;
}

// --- Browser runtime (guarded; does not execute when required from Node) ---

function mountUI(doc) {
  // status is loading | error | ready; nav is the reducer's state.
  var state = { status: 'loading', error: null, launchNote: '' };
  var nav = { view: 'home', focusIdx: 0, homeItems: [], allItems: [], launch: null, lastAppId: null };
  var lastLaunch = null;
  // Until the user does anything, each new list re-derives the boot focus.
  var userMoved = false;
  var root = doc.getElementById('root');
  var storage = null;
  try { storage = window.localStorage; } catch (e) { /* unavailable */ }
  var prefs = loadPrefs(storage);
  // Icon URLs that failed to load: render initials for them from then on,
  // so a broken icon doesn't flash back on every re-render.
  var brokenIcons = {};

  var lang = (typeof navigator !== 'undefined' && navigator.language) || '';

  // Day or night: the theme class on <html>, the wallpaper behind everything
  // and its pre-blurred glass copy all follow the sun at HOME_LOCATION (or
  // a forced mode for checks). If an image fails to load, the background
  // colour and the translucent veil remain; a broken glass image is
  // remembered per mode, so the other mode still gets its glass.
  var forced = forcedTheme(window.PalmSystem && window.PalmSystem.launchParams,
    window.location && window.location.search);
  var homeLocation = typeof HOME_LOCATION !== 'undefined' ? HOME_LOCATION : undefined;
  var mode = null;
  var glassBroken = { light: false, dark: false };
  var wallpaper = doc.getElementById('wallpaper');
  if (wallpaper) wallpaper.onerror = function () { wallpaper.style.display = 'none'; };

  function currentMode() {
    return forced || themeFor(new Date(), homeLocation);
  }

  // Switches everything at once, with no transition: fades over the glass
  // drop frames on this TV (docs/tv-notes.md).
  function applyMode(m) {
    mode = m;
    doc.documentElement.className = 'theme-' + m;
    if (wallpaper) {
      wallpaper.style.display = '';
      wallpaper.src = wallpaperSrc(m, false);
    }
  }

  applyMode(currentMode());
  // Warm the other mode's images so the switch shows no blank frame.
  (function () {
    var other = mode === 'light' ? 'dark' : 'light';
    new Image().src = wallpaperSrc(other, false);
    new Image().src = wallpaperSrc(other, true);
  })();

  function el(tag, className, text) {
    var e = doc.createElement(tag);
    if (className) e.className = className;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function initialsBox(title) {
    return el('span', 'initials', appInitials(title));
  }

  // A tile's mark: the bundled white logo; else the TV's own icon, turned
  // white in CSS; else initials (also when the icon fails to load).
  function markFor(row) {
    var logo = logoFor(row.id);
    if (logo) {
      var m = el('span', 'logo');
      m.style.webkitMaskImage = 'url(' + logo + ')';
      m.style.maskImage = 'url(' + logo + ')';
      return m;
    }
    var url = iconUrl(row.icon);
    if (!url || brokenIcons[url]) return initialsBox(row.title || row.id);
    var box = el('span', 'icon');
    var img = el('img');
    img.alt = '';
    img.onerror = function () {
      brokenIcons[url] = true;
      if (box.parentNode) box.parentNode.replaceChild(initialsBox(row.title || row.id), box);
    };
    img.src = url;
    box.appendChild(img);
    return box;
  }

  function tile(row, i) {
    var li = el('li', 'app-item');
    li.setAttribute('tabindex', '-1');
    li.setAttribute('data-id', row.id);
    li.setAttribute('data-index', String(i));
    var mark = el('span', 'mark');
    mark.appendChild(markFor(row));
    li.appendChild(mark);
    li.appendChild(el('span', 'app-title', row.title || row.id));
    return li;
  }

  // The current view's tiles by row index, the element they scroll in, and
  // the panel that holds the launch note. render() rebuilds them when the
  // view or the app list changes; focus moves only swap a class.
  var tiles = [];
  var listEl = null;
  var notePanel = null;
  var dockEl = null;
  var shownFocus = -1;

  function render() {
    renderView();
    perfMarkRender();
  }

  function renderView() {
    while (root.firstChild) root.removeChild(root.firstChild);
    tiles = [];
    listEl = null;
    notePanel = null;
    dockEl = null;
    shownFocus = -1;
    root.className = 'view-' + nav.view;
    // All apps dims the photo so its rows of white marks stay readable.
    if (nav.view === 'all') root.appendChild(el('div', 'sheet'));

    var top = el('div', 'top');
    // On Home the clock and date sit on glass like the dock; All apps
    // already dims everything behind them.
    if (nav.view === 'home') addGlass(top);
    var now = new Date();
    top.appendChild(el('div', 'clock', formatClock(now)));
    top.appendChild(el('div', 'date', formatDate(now, lang)));
    root.appendChild(top);
    root.appendChild(el('h1', 'view-title', nav.view === 'all' ? 'All apps' : 'CustomWebOS'));

    var hasApps = nav.homeItems.length > 0 || nav.allItems.length > 0;
    if (state.status !== 'ready' || !hasApps) {
      // Loading, error and "no apps" sit where the dock would be.
      var panel = el('div', 'state-panel');
      if (state.status === 'loading') {
        panel.appendChild(el('p', 'state', 'Loading installed apps…'));
      } else if (state.status === 'error') {
        var t = unavailableText(state.error.reason, state.error.retryMs);
        panel.appendChild(el('p', 'state error-title', t.title));
        panel.appendChild(el('p', 'state error-reason', t.reason));
        panel.appendChild(el('p', 'state error-retry', t.retry));
      } else {
        panel.appendChild(el('p', 'state', 'No apps found.'));
      }
      appendDock(panel, 'dock dock-state');
      alignGlass();
      return;
    }

    notePanel = el('div', 'state-panel note-panel');
    root.appendChild(notePanel);
    renderNote();

    var rows = rowsFor(nav);
    if (nav.view === 'home') {
      listEl = el('ul', 'dock-track');
      appendDock(listEl, 'dock');
    } else {
      listEl = el('ul', 'grid');
      root.appendChild(listEl);
    }
    for (var i = 0; i < rows.length; i++) {
      tiles.push(tile(rows[i], i));
      listEl.appendChild(tiles[i]);
    }
    alignGlass();
    updateFocus(false);
  }

  // The dock is centred in a full-width row (an absolutely positioned box
  // offset by left:50% could only shrink-wrap to half the stage). Its glass
  // is the pre-blurred photo, clipped by the dock and shifted back by the
  // dock's own position so it lines up with the photo behind it: no
  // backdrop-filter on this engine, and no blurring at run time.
  function appendDock(content, className) {
    var row = el('div', 'dock-row');
    var dock = el('div', className);
    addGlass(dock);
    dock.appendChild(content);
    row.appendChild(dock);
    root.appendChild(row);
    dockEl = dock;
  }

  // Puts the current mode's glass (the pre-blurred wallpaper, clipped by the
  // box) at the back of box, unless that image failed to load before.
  function addGlass(box) {
    var m = mode;
    if (glassBroken[m]) return;
    var mat = el('div', 'mat');
    var img = el('img', 'mat-img');
    img.alt = '';
    img.onerror = function () {
      glassBroken[m] = true;
      if (mat.parentNode) mat.parentNode.removeChild(mat);
    };
    img.src = wallpaperSrc(m, true);
    mat.appendChild(img);
    box.appendChild(mat);
  }

  // Call once the dock's content is in place: its size decides where it
  // sits, and so how far each glass image (dock and clock) must shift.
  function alignGlass() {
    var imgs = root.querySelectorAll('.mat-img');
    var rootBox = root.getBoundingClientRect();
    for (var i = 0; i < imgs.length; i++) {
      var box = imgs[i].parentNode.getBoundingClientRect();
      imgs[i].style.left = Math.round(rootBox.left - box.left) + 'px';
      imgs[i].style.top = Math.round(rootBox.top - box.top) + 'px';
    }
  }

  // The one-line launch note above the dock (see .state.note).
  function renderNote() {
    if (!notePanel) return;
    while (notePanel.firstChild) notePanel.removeChild(notePanel.firstChild);
    if (state.launchNote) notePanel.appendChild(el('p', 'state note', state.launchNote));
  }

  // keepScroll: a pointer action. Keep the grid where it is; recentring
  // would slide another tile under the pointer. (Synthetic mousemoves at an
  // unchanged position are also filtered in onPointer.)
  function updateFocus(keepScroll) {
    if (tiles[shownFocus]) tiles[shownFocus].className = 'app-item';
    shownFocus = nav.focusIdx;
    var t = tiles[shownFocus];
    if (!t) return;
    t.className = 'app-item focused';
    if (!keepScroll && nav.view === 'all' && listEl) {
      listEl.scrollTop = scrollTopFor(t.offsetTop, t.offsetHeight, listEl.clientHeight, listEl.scrollHeight);
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
    if (state.launchNote) {
      state.launchNote = '';
      renderNote();
    }
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
        renderNote();
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
    if (nav.view !== before.view) {
      render();
    } else if (nav.focusIdx !== before.focusIdx) {
      updateFocus(typeof action === 'object');
    }
  }

  function onKey(e) {
    var action = keyAction(e.keyCode);
    if (!action) return;
    e.preventDefault();
    if (show) {
      // During the slideshow only the arrows do anything; Back stays put.
      if (action === 'left') stepShow(-1);
      if (action === 'right') stepShow(1);
      return;
    }
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

  function showApps(items) {
    // Keep focus on the same row across a list swap, but only if real apps
    // were on screen; before the first list the only row is All apps.
    var hadApps = nav.homeItems.length > 0 || nav.allItems.length > 0;
    var focusedId = hadApps ? rowsFor(nav)[nav.focusIdx].id : null;
    var split = splitHomeApps(items, homeApps());
    nav = { view: nav.view, focusIdx: 0, homeItems: split.home, allItems: split.all, launch: null, lastAppId: prefs.lastAppId };
    nav.focusIdx = hadApps && userMoved ? focusIndexFor(rowsFor(nav), focusedId) : bootFocusIndex(nav, prefs.lastAppId);
    state.error = null;
    state.status = 'ready';
    render();
  }

  var retryTimer = null;
  var retryDueAt = 0;
  var listInFlight = false;
  var haveServiceList = false;
  var mountedAt = nowMs();
  var lastFailure = null;

  // Until the service has answered once: within LOADING_GRACE_MS of opening,
  // failures keep the loading state; after it, the error screen shows.
  function showFailure() {
    if (haveServiceList || !lastFailure || failureView(nowMs() - mountedAt) !== 'error') return;
    state.status = 'error';
    state.error = { reason: lastFailure, retryMs: Math.max(1000, retryDueAt - nowMs()) };
    render();
  }

  setTimeout(showFailure, LOADING_GRACE_MS);

  function requestApps(attempt) {
    function retry(reason) {
      // Once the service has answered, a failed refresh (slow bus after
      // boot, see tv-log) keeps the list on screen and retries quietly.
      var delay = retryDelayMs(attempt);
      retryDueAt = nowMs() + delay;
      lastFailure = reason;
      showFailure();
      retryTimer = setTimeout(function () { retryTimer = null; requestApps(attempt + 1); }, delay);
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
          showApps(parsed.items);
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


  // Updates the clock text in place at each minute boundary; a setTimeout
  // chain rather than setInterval so it re-aligns after the TV sleeps.
  var clockTimer = null;
  function tickClock() {
    var clock = root.querySelector('.clock');
    var date = root.querySelector('.date');
    var now = new Date();
    if (clock) clock.textContent = formatClock(now);
    if (date) date.textContent = formatDate(now, lang);
    // Sunrise or sunset since the last tick (or the TV's clock just synced):
    // switch the whole look and redraw with the new glass.
    var m = currentMode();
    if (m !== mode) {
      applyMode(m);
      render();
    }
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
    renderNote();
    tickClock();
    if (!retryTimer && !listInFlight) requestApps(0);
  }

  // Perf mode (scripts/perf.ps1 launches the app with {"perf": {…}}): note
  // when the first screen and the first app list render, then step focus
  // through dispatch() as the keys would, sampling frame times, and hand
  // the numbers to the service, which writes them to a file on the TV.
  var perf = perfParams(window.PalmSystem && window.PalmSystem.launchParams);
  var perfMarks = { firstPaintMs: null, appsShownMs: null };

  function perfMarkRender() {
    if (!perf) return;
    var t = Math.round(nowMs());
    if (perfMarks.firstPaintMs === null) perfMarks.firstPaintMs = t;
    if (perfMarks.appsShownMs === null && state.status === 'ready' && (nav.homeItems.length || nav.allItems.length)) {
      perfMarks.appsShownMs = t;
      setTimeout(runPerf, 1000);
    }
  }

  function supports(prop, value) {
    try { return !!(window.CSS && window.CSS.supports(prop, value)); } catch (e) { return false; }
  }

  function runPerf() {
    var deltas = [];
    var durations = [];
    var lastFrame = null;
    var running = true;
    var step = 0;
    function frame(t) {
      if (lastFrame !== null) deltas.push(t - lastFrame);
      lastFrame = t;
      if (running) window.requestAnimationFrame(frame);
    }
    function tick() {
      if (step >= perf.steps) {
        running = false;
        sendPerfReport(deltas, durations);
        return;
      }
      step++;
      var t0 = nowMs();
      dispatch(perf.action);
      durations.push(nowMs() - t0);
      setTimeout(tick, perf.intervalMs);
    }
    if (perf.view === 'all' && nav.view !== 'all') {
      // Open All apps through the All apps tile, as a click would, and let
      // it paint before sampling.
      dispatch({ type: 'click', index: rowsFor(nav).length - 1 });
      setTimeout(function () {
        window.requestAnimationFrame(frame);
        tick();
      }, 500);
      return;
    }
    window.requestAnimationFrame(frame);
    tick();
  }

  function sendPerfReport(deltas, durations) {
    var datePl = null;
    // A fixed date (Sunday 25 Oct 2026), not today: shows how the TV's own Intl
    // formats Polish dates, for comparison with formatDate.
    try {
      datePl = new Date(2026, 9, 25).toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long' });
    } catch (e) { /* no Intl */ }
    var report = {
      ua: navigator.userAgent,
      lang: navigator.language,
      params: perf,
      firstPaintMs: perfMarks.firstPaintMs,
      appsShownMs: perfMarks.appsShownMs,
      frames: frameStats(deltas),
      dispatchMs: frameStats(durations),
      datePl: datePl,
      supports: {
        grid: supports('display', 'grid'),
        backdrop: supports('-webkit-backdrop-filter', 'blur(1px)'),
        mask: supports('-webkit-mask-image', 'url(x.svg)')
      }
    };
    lunaCall(SERVICE_URI + '/perfReport', { report: report }, function () {}, function () {});
  }

  // No-signal slideshow over a dark HDMI input (the no-signal hook launches
  // the app with {"slideshow":{"input":…}}). It ends only when the signal
  // returns (the hook relaunches the input), the source changes (the app is
  // hidden), or a relaunch without slideshow params (the Home button); with
  // no photos left it hands back to the input itself.
  var show = null;

  function startShow(input) {
    endShow(false);
    var s = { input: input, photos: [], idx: 0, timer: null, el: el('div'), imgs: [el('img'), el('img')], cur: 0, failed: 0 };
    show = s;
    // The black layer goes up at once, so Home never shows while the photo
    // list loads; the first photo fades in over it.
    s.el.id = 'slideshow';
    for (var i = 0; i < 2; i++) {
      s.imgs[i].alt = '';
      s.imgs[i].onerror = onPhotoError;
      s.el.appendChild(s.imgs[i]);
    }
    doc.body.appendChild(s.el);
    lunaCall(SERVICE_URI + '/listPhotos', {}, function (r) {
      if (show !== s) return;
      var photos = (r && r.photos) || [];
      if (!photos.length) { endShow(true); return; }
      s.photos = shuffle(photos, Math.random);
      showPhoto(0);
    }, function () { if (show === s) endShow(true); });
  }

  // Shows photo i in the hidden layer and fades it in; restarts the timer.
  function showPhoto(i) {
    var s = show;
    var n = s.photos.length;
    s.idx = ((i % n) + n) % n;
    s.cur = 1 - s.cur;
    s.imgs[s.cur].src = s.photos[s.idx];
    s.imgs[s.cur].className = 'on';
    s.imgs[1 - s.cur].className = '';
    clearTimeout(s.timer);
    s.timer = setTimeout(nextPhoto, SLIDE_MS);
  }

  // After the last photo, re-reads the stick: photos added or removed show
  // up, and an empty or pulled stick ends the show.
  function nextPhoto() {
    var s = show;
    if (!s) return;
    if (s.idx + 1 < s.photos.length) { showPhoto(s.idx + 1); return; }
    lunaCall(SERVICE_URI + '/listPhotos', {}, function (r) {
      if (show !== s) return;
      var photos = (r && r.photos) || [];
      if (!photos.length) { endShow(true); return; }
      s.photos = shuffle(photos, Math.random);
      showPhoto(0);
    }, function () { if (show === s) endShow(true); });
  }

  function stepShow(delta) {
    if (show && show.photos.length) showPhoto(show.idx + delta);
  }

  // An unreadable photo is skipped; if none can be shown, the show ends.
  function onPhotoError() {
    var s = show;
    if (!s) return;
    s.failed++;
    if (s.failed >= s.photos.length) { endShow(true); return; }
    showPhoto(s.idx + 1);
  }

  // Removes the show; handBack relaunches the HDMI input it covered.
  function endShow(handBack) {
    var s = show;
    if (!s) return;
    show = null;
    clearTimeout(s.timer);
    if (s.el && s.el.parentNode) s.el.parentNode.removeChild(s.el);
    if (handBack) lunaCall(SERVICE_URI + '/launch', { id: s.input }, function () {}, function () {});
  }

  doc.addEventListener('webOSRelaunch', function () {
    var p = slideshowParams(window.PalmSystem && window.PalmSystem.launchParams, '');
    if (p) startShow(p.input);
    else if (show) {
      // Home during the show: CustomWebOS stays in front, so the watcher
      // can't tell; without this its 15-min power-off would still fire.
      endShow(false);
      lunaCall(SERVICE_URI + '/showEnded', {}, function () {}, function () {});
    }
  });
  // A hidden page doesn't repaint, and webOS shows an app's last frame when
  // it comes back: a show that ends hidden would flash its photo on the next
  // Home press. So the app closes instead; that next Home is a fresh launch
  // (owner's choice: no flash over an instant Home after a slideshow).
  doc.addEventListener('visibilitychange', function () {
    if (doc.hidden && show) {
      endShow(false);
      window.close();
    }
  });

  doc.addEventListener('keydown', onKey);
  doc.addEventListener('visibilitychange', onVisibility);
  root.addEventListener('mousemove', onPointer('point'));
  root.addEventListener('click', onPointer('click'));
  render();
  tickClock();
  requestApps(0);
  var bootShow = slideshowParams(window.PalmSystem && window.PalmSystem.launchParams,
    window.location && window.location.search);
  if (bootShow) startShow(bootShow.input);
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
    unavailableText: unavailableText,
    focusIndexFor: focusIndexFor,
    retryDelayMs: retryDelayMs,
    scrollTopFor: scrollTopFor,
    ALL_APPS_ID: ALL_APPS_ID,
    GRID_COLS: GRID_COLS,
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
    sunTimesUtc: sunTimesUtc,
    FALLBACK_DAY: FALLBACK_DAY,
    themeFor: themeFor,
    wallpaperSrc: wallpaperSrc,
    forcedTheme: forcedTheme,
    slideshowParams: slideshowParams,
    shuffle: shuffle,
    SLIDE_MS: SLIDE_MS,
    FADE_MS: FADE_MS,
    msToNextMinute: msToNextMinute,
    PREFS_KEY: PREFS_KEY,
    loadPrefs: loadPrefs,
    savePrefs: savePrefs,
    frameStats: frameStats,
    formatDate: formatDate,
    LOADING_GRACE_MS: LOADING_GRACE_MS,
    failureView: failureView,
    APP_LOGOS: APP_LOGOS,
    logoFor: logoFor,
    perfParams: perfParams
  };
}
