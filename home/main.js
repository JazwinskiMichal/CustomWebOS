// CustomWebOS Home — M1 launcher. ES5 only; the webOS 4.4 web engine does
// not reliably accept newer syntax.

// Returns a tagged result so the caller can distinguish between:
//   - a successful response with zero apps installed  (ok:true,  items:[])
//   - a service-level error delivered via onSuccess   (ok:false, reason: string)
// webOS luna services sometimes route errors through onSuccess with
// returnValue:false, so collapsing both cases to [] would show "no apps"
// when we should show an error.
function parseLaunchPoints(raw) {
  if (!raw) return { ok: false, reason: 'empty-response' };
  if (raw.returnValue !== true) {
    return { ok: false, reason: raw.errorText || 'service-error' };
  }
  var items = [];
  if (raw.launchPoints && raw.launchPoints.length) {
    for (var i = 0; i < raw.launchPoints.length; i++) {
      var lp = raw.launchPoints[i];
      items.push({ id: lp.id, title: lp.title });
    }
  }
  return { ok: true, items: items };
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
  var state = { items: [], focusIdx: 0, status: 'loading', statusText: '' };
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
      pe.textContent = 'Could not list installed apps: ' + state.statusText;
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
  }

  function moveFocus(delta) {
    if (!state.items.length) return;
    var next = state.focusIdx + delta;
    if (next < 0) next = 0;
    if (next > state.items.length - 1) next = state.items.length - 1;
    state.focusIdx = next;
    render();
  }

  // On webOS 4.x the raw PalmServiceBridge from an unprivileged webapp
  // silently gets no response for calls like applicationManager/listLaunchPoints
  // (service drops the call because the caller lacks a required permission).
  // Proper fix is to either ship webOSTV.js from the LG SDK (handles the
  // bus plumbing) or bundle a service component with the right manifest.
  // Both are M2 work; for M1 we at least surface a timeout instead of
  // hanging forever on "Loading…".
  function lunaCall(uri, payload, onSuccess, onFailure) {
    if (typeof PalmServiceBridge === 'undefined') {
      onFailure({ errorText: 'PalmServiceBridge unavailable (not running on TV?)' });
      return;
    }
    var done = false;
    var bridge = new PalmServiceBridge();
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
      'luna://com.webos.applicationManager/launch',
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

  function fetchLaunchPoints() {
    lunaCall(
      'luna://com.webos.applicationManager/listLaunchPoints',
      {},
      function (raw) {
        var r = parseLaunchPoints(raw);
        if (!r.ok) {
          state.status = 'error';
          state.statusText = r.reason;
          render();
          return;
        }
        state.items = r.items;
        state.status = 'ready';
        state.focusIdx = 0;
        render();
      },
      function (err) {
        state.status = 'error';
        state.statusText = (err && err.errorText) || 'listLaunchPoints failed';
        render();
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
    parseLaunchPoints: parseLaunchPoints,
    buildLaunchParams: buildLaunchParams
  };
}
