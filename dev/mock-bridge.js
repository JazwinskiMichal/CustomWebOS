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
(function () {
  var mode = (/[?&]mock=(\w+)/.exec(window.location.search) || [])[1] || 'ok'
  var SERVICE = 'luna://org.jazwinski.customwebos.home.service/'
  window.__mock = { mode: mode, launches: [], listAppsAnswered: 0 }

  function listApps() {
    if (mode === 'error') return Promise.resolve({ returnValue: false, errorText: 'mock error' })
    if (mode === 'errorlong') {
      return Promise.resolve({ returnValue: false, errorText: 'no response from luna://org.jazwinski.customwebos.home.service/listApps within 10s (webOS 4 bus permission?)' })
    }
    if (mode === 'empty') return Promise.resolve({ returnValue: true, apps: [] })
    if (mode === 'flaky' && window.__mock.listAppsAnswered > 0) {
      return Promise.resolve({ returnValue: false, errorText: 'mock flaky' })
    }
    if (mode === 'recover' && window.__mock.listAppsAnswered === 0) {
      return Promise.resolve({ returnValue: false, errorText: 'mock not yet' })
    }
    return fetch('/__dev/fixtures/listApps.json').then(function (r) { return r.json() })
  }

  function answer(uri, payload) {
    if (uri === SERVICE + 'listApps') return listApps()
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
