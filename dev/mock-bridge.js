// Fake WebOSServiceBridge for the browser preview (scripts/dev-server.mjs).
// Never packaged. Answers the home service's methods from fixtures; launch
// always reports that it needs the TV — the preview never fakes success.
//
// ?mock=ok     fixture after 150 ms (default)
// ?mock=slow   answers after 12 s, past main.js's 10 s timeout
// ?mock=error  {returnValue:false, errorText:'mock error'}
// ?mock=empty  {returnValue:true, apps:[]}
(function () {
  var mode = (/[?&]mock=(\w+)/.exec(window.location.search) || [])[1] || 'ok'
  var SERVICE = 'luna://org.jazwinski.customwebos.home.service/'
  window.__mock = { mode: mode, launches: [], listAppsAnswered: 0 }

  function listApps() {
    if (mode === 'error') return Promise.resolve({ returnValue: false, errorText: 'mock error' })
    if (mode === 'empty') return Promise.resolve({ returnValue: true, apps: [] })
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
    var delay = mode === 'slow' ? 12000 : 150
    answer(uri, JSON.parse(payloadJson || '{}')).then(function (msg) {
      setTimeout(function () {
        if (uri === SERVICE + 'listApps') window.__mock.listAppsAnswered++
        if (self.onservicecallback) self.onservicecallback(JSON.stringify(msg))
      }, delay)
    })
  }

  window.WebOSServiceBridge = MockBridge
})()
