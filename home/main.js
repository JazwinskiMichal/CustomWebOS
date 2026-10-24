// CustomWebOS Home — M1 launcher. ES5 only; the webOS 4.4 web engine does
// not reliably accept newer syntax.

function parseLaunchPoints(raw) {
  if (!raw || raw.returnValue !== true) return [];
  if (!raw.launchPoints || !raw.launchPoints.length) return [];
  var out = [];
  for (var i = 0; i < raw.launchPoints.length; i++) {
    var lp = raw.launchPoints[i];
    out.push({ id: lp.id, title: lp.title });
  }
  return out;
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
    if (!window.webOS || !window.webOS.service) {
      state.status = 'error';
      state.statusText = 'webOS bridge unavailable';
      render();
      return;
    }
    window.webOS.service.request('luna://com.webos.applicationManager', {
      method: 'launch',
      parameters: r.params,
      onSuccess: function () {},
      onFailure: function (err) {
        state.status = 'error';
        state.statusText = (err && err.errorText) || 'launch failed';
        render();
      }
    });
  }

  function onKey(e) {
    var code = e.keyCode;
    if (code === 38) { moveFocus(-1); e.preventDefault(); return; }
    if (code === 40) { moveFocus(1); e.preventDefault(); return; }
    if (code === 13) { activateFocused(); e.preventDefault(); return; }
  }

  function fetchLaunchPoints() {
    if (!window.webOS || !window.webOS.service) {
      state.status = 'error';
      state.statusText = 'webOS bridge unavailable (not running on TV?)';
      render();
      return;
    }
    window.webOS.service.request('luna://com.webos.applicationManager', {
      method: 'listLaunchPoints',
      parameters: {},
      onSuccess: function (raw) {
        state.items = parseLaunchPoints(raw);
        state.status = 'ready';
        state.focusIdx = 0;
        render();
      },
      onFailure: function (err) {
        state.status = 'error';
        state.statusText = (err && err.errorText) || 'listLaunchPoints failed';
        render();
      }
    });
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
