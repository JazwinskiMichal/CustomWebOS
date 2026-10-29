// Fake WebOSServiceBridge for the browser preview (scripts/dev-server.mjs).
// Never packaged. Answers the home service's methods from fixtures; launch
// always reports that it needs the TV — the preview never fakes success.
//
// ?mock=ok     fixture after 150 ms (default)
// ?mock=slow   answers after 12 s, past main.js's 10 s timeout
// ?mock=error  {returnValue:false, errorText:'mock error'}
// ?mock=empty  {returnValue:true, apps:[]}
// ?mock=flaky  first listApps answers normally, later ones fail
// ?mock=errorlong  like error, with the real 10 s-timeout reason text
// ?mock=recover    first listApps fails, later ones answer normally
// ?mock=slowlaunch listApps as ok; launch answers after 12 s
// ?mock=few      only netflix, youtube and pl.cda are installed
// ?mock=recoverlate  the first three listApps fail, then it answers
// ?mock=photos   listPhotos answers three photos (other modes: none)
// ?mock=nophotos listPhotos answers no photos
// Doorbell box (/doorbell/): ?mock=ok snapshot camera from a fixture, door
// simulated; door (a doorUrl is set); doorfail (openDoor fails with HTTP 500);
// nocamera (no settings); deadcamera (the camera URL is a 404).
// &params=<json> stands in for PalmSystem.launchParams; window.close() only
// sets window.__closed.
(function () {
  var mode = (/[?&]mock=(\w+)/.exec(window.location.search) || [])[1] || 'ok'
  var SERVICE = 'luna://org.jazwinski.customwebos.home.service/'
  window.__mock = { mode: mode, launches: [], listAppsAnswered: 0, perfReports: [], showEnded: 0, openDoor: 0, openDoorPayloads: [] }
  var params = (/[?&]params=([^&]*)/.exec(window.location.search) || [])[1]
  if (params) window.PalmSystem = { launchParams: decodeURIComponent(params) }
  if (window.location.pathname.indexOf('/doorbell/') === 0) {
    if (!window.PalmSystem) window.PalmSystem = { launchParams: '{}' }
    window.close = function () { window.__closed = true }
  }

  function doorbellConfig() {
    if (mode === 'nocamera') return {}
    var config = { cameraUrl: mode === 'deadcamera' ? '/__dev/fixtures/no-such-camera.jpg' : '/__dev/fixtures/camera.jpg', cameraMode: 'snapshot' }
    if (mode === 'door') config.doorUrl = 'http://ha.local/api/webhook/door'
    return config
  }

  function listApps() {
    if (mode === 'error') return Promise.resolve({ returnValue: false, errorText: 'mock error' })
    if (mode === 'errorlong') {
      return Promise.resolve({ returnValue: false, errorText: 'no response from luna://org.jazwinski.customwebos.home.service/listApps within 10s (webOS 4 bus permission?)' })
    }
    if (mode === 'empty') return Promise.resolve({ returnValue: true, apps: [] })
    if (mode === 'flaky' && window.__mock.listAppsAnswered > 0) {
      return Promise.resolve({ returnValue: false, errorText: 'mock flaky' })
    }
    if (mode === 'recoverlate' && window.__mock.listAppsAnswered < 3) {
      return Promise.resolve({ returnValue: false, errorText: 'mock not yet' })
    }
    if (mode === 'recover' && window.__mock.listAppsAnswered === 0) {
      return Promise.resolve({ returnValue: false, errorText: 'mock not yet' })
    }
    return fetch('/__dev/fixtures/listApps.json').then(function (r) { return r.json() }).then(function (j) {
      if (mode !== 'few') return j
      var keep = { 'netflix': true, 'youtube.leanback.v4': true, 'pl.cda': true }
      return { returnValue: true, apps: j.apps.filter(function (a) { return keep[a.id] }) }
    })
  }

  function answer(uri, payload) {
    if (uri === SERVICE + 'listApps') return listApps()
    if (uri === SERVICE + 'listPhotos') {
      var photos = mode === 'photos' ? ['usb/sda/sda1/a.jpg', 'usb/sda/sda1/b.jpg', 'usb/sda/sda1/c.jpg'] : []
      return Promise.resolve({ returnValue: true, photos: photos })
    }
    if (uri === SERVICE + 'showEnded') {
      window.__mock.showEnded++
      return Promise.resolve({ returnValue: true })
    }
    if (uri === SERVICE + 'doorbellConfig') return Promise.resolve({ returnValue: true, config: doorbellConfig() })
    if (uri === SERVICE + 'openDoor') {
      window.__mock.openDoor++
      window.__mock.openDoorPayloads.push(payload)
      if (mode === 'doorfail') return Promise.resolve({ returnValue: false, errorText: 'HTTP 500' })
      return Promise.resolve({ returnValue: true, simulated: mode !== 'door' })
    }
    if (uri === SERVICE + 'perfReport') {
      window.__mock.perfReports.push(payload.report)
      return Promise.resolve({ returnValue: true })
    }
    if (uri === SERVICE + 'launch') {
      window.__mock.launches.push(payload.id)
      return Promise.resolve({ returnValue: false, errorText: 'preview: launching requires the TV' })
    }
    return Promise.resolve({ returnValue: false, errorCode: -1, errorText: 'mock: unknown method ' + uri })
  }

  function MockBridge() { this.onservicecallback = null }
  MockBridge.prototype.call = function (uri, payloadJson) {
    var self = this
    var slow = mode === 'slow' || (mode === 'slowlaunch' && uri === SERVICE + 'launch')
    var delay = slow ? 12000 : 150
    answer(uri, JSON.parse(payloadJson || '{}')).then(function (msg) {
      setTimeout(function () {
        if (uri === SERVICE + 'listApps') window.__mock.listAppsAnswered++
        if (self.onservicecallback) self.onservicecallback(JSON.stringify(msg))
      }, delay)
    })
  }

  window.WebOSServiceBridge = MockBridge
})()
