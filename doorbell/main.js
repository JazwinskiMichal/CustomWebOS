// CustomWebOS Doorbell — a floating camera box over whatever is on screen.
// Opened by launching the app (a ring); OK enlarges and centres it, a second
// OK opens the door, Back closes it. No timers: it stays, in either size,
// until Back (Michał). OK also arrives as a click on the box when the Magic
// Remote's pointer is showing. ES5 only (webOS 4.4 web engine).
(function () {
  'use strict';

  var SERVICE = 'luna://org.jazwinski.customwebos.home.service/';
  var CAMERA_TIMEOUT_MS = 5000;
  var CAMERA_RETRY_MS = 1000;
  var SNAPSHOT_MS = 200;
  var KEY_OK = 13;
  var KEY_BACK = 461;
  var KEY_ESC = 27;
  var HINT_CORNER = 'OK: open the door · Back: close';
  var HINT_BIG = 'OK again to open the door';

  var doc = document;
  var box = doc.querySelector('.box');
  var img = box.querySelector('img');
  var cameraMsg = box.querySelector('.camera-msg');
  var hint = box.querySelector('.hint');
  var status = box.querySelector('.status');

  var config = {};
  var confirming = false;
  var doorPending = false;
  var cameraGen = 0;
  var cameraTimer = null;
  var frameTimer = null;

  function newBridge() {
    if (typeof WebOSServiceBridge !== 'undefined') return new WebOSServiceBridge();
    if (typeof PalmServiceBridge !== 'undefined') return new PalmServiceBridge();
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
      if (msg && msg.returnValue === false) onFailure(msg);
      else onSuccess(msg);
    };
    setTimeout(function () {
      if (done) return;
      done = true;
      onFailure({ errorText: 'no response from ' + uri + ' within 10s (webOS 4 bus permission?)' });
    }, 10000);
    bridge.call(uri, JSON.stringify(payload));
  }

  // Launch parameters may override the camera for testing, never the door:
  // the door URL only ever comes from the settings file on the TV.
  function launchOverrides() {
    var raw = window.PalmSystem && window.PalmSystem.launchParams;
    var p = {};
    try { p = (typeof raw === 'string' ? JSON.parse(raw || '{}') : raw) || {}; } catch (e) { p = {}; }
    var out = {};
    if (typeof p.cameraUrl === 'string') out.cameraUrl = p.cameraUrl;
    if (p.cameraMode === 'mjpeg' || p.cameraMode === 'snapshot') out.cameraMode = p.cameraMode;
    return out;
  }

  function setBig(big) {
    box.className = big ? 'box big' : 'box';
    hint.textContent = big ? HINT_BIG : HINT_CORNER;
  }

  function withStamp(url) {
    return url + (url.indexOf('?') < 0 ? '?' : '&') + 't=' + new Date().getTime();
  }

  // MJPEG: one src, the browser keeps the stream. Snapshots: a fresh src
  // SNAPSHOT_MS after each frame. Either way, no picture within
  // CAMERA_TIMEOUT_MS says "not responding", and errors retry.
  function startCamera() {
    var gen = ++cameraGen;
    clearTimeout(cameraTimer);
    clearTimeout(frameTimer);
    var url = config.cameraUrl;
    if (!url) {
      img.removeAttribute('src');
      cameraMsg.textContent = 'Camera not set up';
      return;
    }
    var snapshot = config.cameraMode === 'snapshot';
    cameraMsg.textContent = '';
    img.onload = function () {
      if (gen !== cameraGen) return;
      cameraMsg.textContent = '';
      if (snapshot) frameTimer = setTimeout(function () { if (gen === cameraGen) img.src = withStamp(url); }, SNAPSHOT_MS);
    };
    img.onerror = function () {
      if (gen !== cameraGen) return;
      frameTimer = setTimeout(function () { if (gen === cameraGen) img.src = snapshot ? withStamp(url) : url; }, CAMERA_RETRY_MS);
    };
    cameraTimer = setTimeout(function () {
      if (gen === cameraGen && !(img.naturalWidth > 0)) cameraMsg.textContent = 'Camera not responding';
    }, CAMERA_TIMEOUT_MS);
    img.src = snapshot ? withStamp(url) : url;
  }

  function loadConfig() {
    lunaCall(SERVICE + 'doorbellConfig', {}, function (msg) {
      config = msg.config || {};
      var o = launchOverrides();
      for (var k in o) if (o.hasOwnProperty(k)) config[k] = o[k];
      startCamera();
    }, function () {
      config = launchOverrides();
      startCamera();
    });
  }

  function openDoor() {
    confirming = false;
    doorPending = true;
    status.textContent = '';
    hint.textContent = HINT_CORNER;
    lunaCall(SERVICE + 'openDoor', {}, function (msg) {
      doorPending = false;
      status.textContent = msg.simulated ? 'Door opened (test)' : 'Door opened';
    }, function (err) {
      doorPending = false;
      status.textContent = "Door didn't open: " + (err.errorText || 'unknown error');
    });
  }

  function onOk() {
    if (doorPending) return;
    if (confirming) {
      openDoor();
      return;
    }
    confirming = true;
    status.textContent = '';
    setBig(true);
  }

  // A ring while the box is open: back to the corner, fresh picture, and no
  // confirmation carries over.
  function reset() {
    confirming = false;
    status.textContent = '';
    setBig(false);
    loadConfig();
  }

  doc.addEventListener('keydown', function (e) {
    var k = e.keyCode;
    if (k === KEY_BACK || k === KEY_ESC) {
      e.preventDefault();
      window.close();
      return;
    }
    if (k === KEY_OK) {
      e.preventDefault();
      onOk();
    }
  });

  box.addEventListener('click', function (e) {
    e.preventDefault();
    onOk();
  });

  doc.addEventListener('webOSRelaunch', reset);

  reset();
})();
