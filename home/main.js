// CustomWebOS Home — launcher. ES5 only; the webOS 4.4 web engine does
// not reliably accept newer syntax.

var SELF_ID = 'org.jazwinski.customwebos.home';

// Dev-mode webapps on consumer webOS 4.4 can't call applicationManager
// directly (LSCallFromApplication is gated on caller privilege), so listing
// and launching go through the bundled service component instead.
var SERVICE_URI = 'luna://org.jazwinski.customwebos.home.service';

// Shown immediately on boot, and kept when the service can't be reached, so
// the screen is never empty while the service is down or still spawning.
var FALLBACK_APPS = [
  { id: 'netflix',             title: 'Netflix' },
  { id: 'youtube.leanback.v4', title: 'YouTube' },
  { id: 'amazon',              title: 'Prime Video' },
  { id: 'spotify-beehive',     title: 'Spotify' },
  { id: 'com.disney.disneyplus-prod', title: 'Disney+' },
  { id: 'com.apple.appletv',   title: 'Apple TV' },
  { id: 'com.webos.app.hdmi1', title: 'HDMI 1' },
  { id: 'com.webos.app.hdmi2', title: 'HDMI 2' },
  { id: 'org.webosbrew.hbchannel', title: 'Homebrew Channel' }
];

// Returns a tagged result so the caller can distinguish between:
//   - a successful response with zero apps installed  (ok:true,  items:[])
//   - a service-level error delivered via onSuccess   (ok:false, reason: string)
// webOS luna services sometimes route errors through onSuccess with
// returnValue:false, so collapsing both cases to [] would show "no apps"
// when we should show an error.
// Accepts both applicationManager's shape (launchPoints) and the home
// service's listApps shape (apps). Entries without an id and the home app
// itself are dropped.
function parseLaunchPoints(raw) {
  if (!raw) return { ok: false, reason: 'empty-response' };
  if (raw.returnValue !== true) {
    return { ok: false, reason: raw.errorText || 'service-error' };
  }
  var list = raw.apps || raw.launchPoints;
  var items = [];
  if (list && list.length) {
    for (var i = 0; i < list.length; i++) {
      var lp = list[i];
      if (!lp || !lp.id || lp.id === SELF_ID) continue;
      items.push({ id: lp.id, title: lp.title });
    }
  }
  return { ok: true, items: items };
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

function focusIndexFor(items, id) {
  for (var i = 0; i < items.length; i++) {
    if (items[i].id === id) return i;
  }
  return 0;
}

function buildLaunchParams(id, availableIds) {
  for (var i = 0; i < availableIds.length; i++) {
    if (availableIds[i] === id) {
      return { ok: true, params: { id: id } };
    }
  }
  return { ok: false, reason: 'stale-id' };
}

// --- Browser runtime (guarded; does not execute when required from Node) ---

function mountUI(doc) {
  var state = { items: [], focusIdx: 0, status: 'loading', statusText: '', note: '' };
  var root = doc.getElementById('root');

  function render() {
    while (root.firstChild) root.removeChild(root.firstChild);
    var h = doc.createElement('h1');
    h.textContent = 'CustomWebOS';
    root.appendChild(h);

    if (state.status === 'loading') {
      var p = doc.createElement('p');
      p.className = 'state';
      p.textContent = 'Loading installed apps…';
      root.appendChild(p);
      return;
    }
    if (state.status === 'error') {
      var pe = doc.createElement('p');
      pe.className = 'state error';
      pe.textContent = 'Error: ' + state.statusText;
      root.appendChild(pe);
      return;
    }
    if (!state.items.length) {
      var pn = doc.createElement('p');
      pn.className = 'state';
      pn.textContent = 'No apps found.';
      root.appendChild(pn);
      return;
    }

    var ul = doc.createElement('ul');
    ul.className = 'app-list';
    for (var i = 0; i < state.items.length; i++) {
      var li = doc.createElement('li');
      li.className = 'app-item' + (i === state.focusIdx ? ' focused' : '');
      li.setAttribute('tabindex', '-1');
      li.setAttribute('data-id', state.items[i].id);
      li.textContent = state.items[i].title || state.items[i].id;
      ul.appendChild(li);
    }
    root.appendChild(ul);

    if (state.note) {
      var pnote = doc.createElement('p');
      pnote.className = 'state note';
      pnote.textContent = state.note;
      root.appendChild(pnote);
    }
  }

  function moveFocus(delta) {
    if (!state.items.length) return;
    var next = state.focusIdx + delta;
    if (next < 0) next = 0;
    if (next > state.items.length - 1) next = state.items.length - 1;
    state.focusIdx = next;
    render();
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

  function activateFocused() {
    if (state.status !== 'ready' || !state.items.length) return;
    var pick = state.items[state.focusIdx];
    var ids = [];
    for (var j = 0; j < state.items.length; j++) ids.push(state.items[j].id);
    var r = buildLaunchParams(pick.id, ids);
    if (!r.ok) {
      state.status = 'error';
      state.statusText = r.reason;
      render();
      return;
    }
    lunaCall(
      SERVICE_URI + '/launch',
      r.params,
      function () {},
      function (err) {
        state.status = 'error';
        state.statusText = (err && err.errorText) || 'launch failed';
        render();
      }
    );
  }

  function onKey(e) {
    var code = e.keyCode;
    if (code === 38) { moveFocus(-1); e.preventDefault(); return; }
    if (code === 40) { moveFocus(1); e.preventDefault(); return; }
    if (code === 13) { activateFocused(); e.preventDefault(); return; }
  }

  function showApps(choice) {
    var focusedId = state.items.length ? state.items[state.focusIdx].id : null;
    state.items = choice.items;
    state.note = choice.note;
    state.status = 'ready';
    state.focusIdx = focusIndexFor(state.items, focusedId);
    render();
  }

  function fetchLaunchPoints() {
    showApps({ items: FALLBACK_APPS, note: '' });
    lunaCall(
      SERVICE_URI + '/listApps',
      {},
      function (msg) { showApps(chooseApps(parseLaunchPoints(msg), FALLBACK_APPS)); },
      function (err) {
        var reason = (err && err.errorText) || 'listApps failed';
        showApps(chooseApps({ ok: false, reason: reason }, FALLBACK_APPS));
      }
    );
  }

  doc.addEventListener('keydown', onKey);
  render();
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
    FALLBACK_APPS: FALLBACK_APPS,
    parseLaunchPoints: parseLaunchPoints,
    chooseApps: chooseApps,
    focusIndexFor: focusIndexFor,
    buildLaunchParams: buildLaunchParams
  };
}
