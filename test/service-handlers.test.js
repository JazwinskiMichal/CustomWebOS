const test = require('node:test')
const assert = require('node:assert/strict')

const { createHandlers, APP_MANAGER } = require('../services/org.jazwinski.customwebos.home.service/handlers.js')

// Fake luna: records every outbound call and answers with a canned response.
function fakeCall(response) {
  const calls = []
  const call = (uri, params, cb) => {
    calls.push({ uri, params })
    cb(response)
  }
  return { call, calls }
}

function fakeMessage(payload) {
  const m = { payload, responses: [] }
  m.respond = (r) => m.responses.push(r)
  return m
}

test('listApps proxies listLaunchPoints and renames launchPoints to apps', () => {
  const lp = [{ id: 'netflix', title: 'Netflix' }]
  const { call, calls } = fakeCall({ payload: { returnValue: true, launchPoints: lp } })
  const msg = fakeMessage({})
  createHandlers(call).listApps(msg)
  assert.deepEqual(calls, [{ uri: APP_MANAGER + '/listLaunchPoints', params: {} }])
  assert.deepEqual(msg.responses, [{ returnValue: true, apps: lp }])
})

test('listApps returns an empty apps array when launchPoints is missing', () => {
  const { call } = fakeCall({ payload: { returnValue: true } })
  const msg = fakeMessage({})
  createHandlers(call).listApps(msg)
  assert.deepEqual(msg.responses, [{ returnValue: true, apps: [] }])
})

test('listApps passes the upstream errorText through on failure', () => {
  const { call } = fakeCall({ payload: { returnValue: false, errorText: 'denied' } })
  const msg = fakeMessage({})
  createHandlers(call).listApps(msg)
  assert.deepEqual(msg.responses, [{ returnValue: false, errorText: 'denied' }])
})

test('listApps reports a generic error when the response has no payload', () => {
  const { call } = fakeCall(undefined)
  const msg = fakeMessage({})
  createHandlers(call).listApps(msg)
  assert.equal(msg.responses[0].returnValue, false)
  assert.equal(msg.responses[0].errorText, 'listLaunchPoints failed')
})

test('launch rejects a missing or non-string id without calling out', () => {
  for (const payload of [undefined, {}, { id: '' }, { id: 42 }]) {
    const { call, calls } = fakeCall({ payload: { returnValue: true } })
    const msg = fakeMessage(payload)
    createHandlers(call).launch(msg)
    assert.equal(calls.length, 0, 'no luna call for payload ' + JSON.stringify(payload))
    assert.deepEqual(msg.responses, [{ returnValue: false, errorText: 'id required' }])
  }
})

test('launch forwards id and optional params to applicationManager/launch', () => {
  const { call, calls } = fakeCall({ payload: { returnValue: true, processId: '1' } })
  const msg = fakeMessage({ id: 'netflix', params: { contentTarget: 'x' } })
  createHandlers(call).launch(msg)
  assert.deepEqual(calls, [{ uri: APP_MANAGER + '/launch', params: { id: 'netflix', params: { contentTarget: 'x' } } }])
  assert.deepEqual(msg.responses, [{ returnValue: true, processId: '1' }])
})

test('launch omits params when none are given', () => {
  const { call, calls } = fakeCall({ payload: { returnValue: true } })
  createHandlers(call).launch(fakeMessage({ id: 'netflix' }))
  assert.deepEqual(calls[0].params, { id: 'netflix' })
})

test('launch responds with an error when applicationManager returns nothing', () => {
  const { call } = fakeCall({})
  const msg = fakeMessage({ id: 'netflix' })
  createHandlers(call).launch(msg)
  assert.deepEqual(msg.responses, [{ returnValue: false, errorText: 'empty response' }])
})

function fakeWrite(err) {
  const writes = []
  const writeFile = (p, text, cb) => { writes.push({ p, text }); cb(err || null) }
  return { writeFile, writes }
}

test('perfReport writes the report to /tmp/customwebos-perf.json', () => {
  const w = fakeWrite()
  const h = createHandlers(fakeCall({}).call, w.writeFile)
  const m = fakeMessage({ report: { frames: { p95: 20 } } })
  h.perfReport(m)
  assert.equal(w.writes.length, 1)
  assert.equal(w.writes[0].p, '/tmp/customwebos-perf.json')
  assert.deepEqual(JSON.parse(w.writes[0].text), { frames: { p95: 20 } })
  assert.deepEqual(m.responses, [{ returnValue: true }])
})

test('perfReport rejects a missing report', () => {
  const w = fakeWrite()
  const h = createHandlers(fakeCall({}).call, w.writeFile)
  const m = fakeMessage({})
  h.perfReport(m)
  assert.equal(w.writes.length, 0)
  assert.deepEqual(m.responses, [{ returnValue: false, errorText: 'report required' }])
})

test('perfReport reports a write error', () => {
  const w = fakeWrite(new Error('disk full'))
  const h = createHandlers(fakeCall({}).call, w.writeFile)
  const m = fakeMessage({ report: { a: 1 } })
  h.perfReport(m)
  assert.deepEqual(m.responses, [{ returnValue: false, errorText: 'disk full' }])
})

// Photos on USB sticks for the no-signal slideshow.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { photoFiles, walkTree, USB_ROOT } = require('../services/org.jazwinski.customwebos.home.service/handlers.js')

test('photoFiles keeps JPEG/PNG in any folder, skips hidden and other files, sorted', () => {
  assert.deepEqual(
    photoFiles(['b.png', 'a/IMG_1.JPG', 'c.jpeg', 'd.gif', '.hidden.jpg', '.thumbs/x.jpg', 'a/.x/y.png', 'notes.txt']),
    ['a/IMG_1.JPG', 'b.png', 'c.jpeg'])
})

test('photoFiles caps the list at 2000', () => {
  const many = []
  for (let i = 0; i < 2500; i++) many.push('p' + String(i).padStart(4, '0') + '.jpg')
  assert.equal(photoFiles(many).length, 2000)
})

test('walkTree lists files below a root, relative, and an empty list for a missing root', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cwo-usb-'))
  fs.mkdirSync(path.join(root, 'sda', 'sda1', 'Holiday'), { recursive: true })
  fs.writeFileSync(path.join(root, 'sda', 'sda1', 'E1.jpg'), 'x')
  fs.writeFileSync(path.join(root, 'sda', 'sda1', 'Holiday', 'beach.JPG'), 'x')
  assert.deepEqual(walkTree(fs, root, 8).sort(), ['sda/sda1/E1.jpg', 'sda/sda1/Holiday/beach.JPG'])
  assert.deepEqual(walkTree(fs, path.join(root, 'nope'), 8), [])
})

test('listPhotos answers usb/-relative paths of the photos on the sticks', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cwo-usb-'))
  fs.mkdirSync(path.join(root, 'sda', 'sda1'), { recursive: true })
  fs.writeFileSync(path.join(root, 'sda', 'sda1', 'E1.jpg'), 'x')
  fs.writeFileSync(path.join(root, 'sda', 'sda1', 'notes.txt'), 'x')
  const h = createHandlers(() => {}, () => {}, { fs, usbRoot: root })
  const msg = fakeMessage({})
  h.listPhotos(msg)
  assert.deepEqual(msg.responses, [{ returnValue: true, photos: ['usb/sda/sda1/E1.jpg'] }])
  assert.equal(USB_ROOT, '/tmp/usb')
})

// A fake fs: name -> size, or a nested object for a folder.
function fakeFs(tree) {
  function at(p) {
    let node = tree
    for (const part of p.split('/').filter(Boolean)) node = node && node[part]
    if (node === undefined) throw new Error('ENOENT ' + p)
    return node
  }
  return {
    readdirSync: (p) => Object.keys(at(p)),
    lstatSync: (p) => {
      const n = at(p)
      return { isDirectory: () => typeof n === 'object', isFile: () => typeof n === 'number', size: n }
    }
  }
}

test('walkTree leaves out files bigger than maxBytes (huge photos would stall the TV)', () => {
  const fsLike = fakeFs({ usb: { 'small.jpg': 5e6, 'huge.jpg': 30e6, Trip: { 'edge.jpg': 20 * 1024 * 1024 } } })
  assert.deepEqual(walkTree(fsLike, '/usb', 8, 20 * 1024 * 1024).sort(), ['Trip/edge.jpg', 'small.jpg'])
  assert.deepEqual(walkTree(fsLike, '/usb', 8).sort(), ['Trip/edge.jpg', 'huge.jpg', 'small.jpg'])
})

test('listPhotos skips photos over MAX_PHOTO_BYTES', () => {
  const { MAX_PHOTO_BYTES } = require('../services/org.jazwinski.customwebos.home.service/handlers.js')
  assert.equal(MAX_PHOTO_BYTES, 20 * 1024 * 1024)
  const fsLike = fakeFs({ usb: { 'a.jpg': 1e6, 'big.png': MAX_PHOTO_BYTES + 1 } })
  const h = createHandlers(() => {}, () => {}, { fs: fsLike, usbRoot: '/usb' })
  const msg = fakeMessage({})
  h.listPhotos(msg)
  assert.deepEqual(msg.responses, [{ returnValue: true, photos: ['usb/a.jpg'] }])
})

test('showEnded forgets the no-signal cover (its 15-min power-off with it), keeps the watcher running', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cwo-nosignal-'))
  for (const f of ['covering', 'cover-id', 'pids']) fs.writeFileSync(path.join(dir, f), '1\n')
  const h = createHandlers(() => {}, () => {}, { fs, nosignalDir: dir })
  const msg = fakeMessage({})
  h.showEnded(msg)
  assert.deepEqual(msg.responses, [{ returnValue: true }])
  assert.deepEqual(fs.readdirSync(dir), ['pids'])
  const again = fakeMessage({})
  h.showEnded(again)
  assert.deepEqual(again.responses, [{ returnValue: true }])
})

// Doorbell (M4): settings from a JSON file on the TV, the door request through
// an injected request(url, cb(err, statusCode)).
function doorbellFs(content) {
  return { readFileSync: (p) => { if (content === undefined) throw new Error('ENOENT ' + p); return content } }
}

function doorbell(content, request) {
  return createHandlers(() => {}, () => {}, { fs: doorbellFs(content), doorbellFile: '/x/doorbell.json', request })
}

test('DOORBELL_FILE is where doorbell.ps1 -Configure writes', () => {
  const { DOORBELL_FILE } = require('../services/org.jazwinski.customwebos.home.service/handlers.js')
  assert.equal(DOORBELL_FILE, '/var/lib/customwebos/doorbell.json')
})

test('doorbellConfig returns the file\'s settings', () => {
  const msg = fakeMessage({})
  doorbell('{"cameraUrl":"http://cam/mjpeg","cameraMode":"mjpeg","doorUrl":"http://ha/hook"}').doorbellConfig(msg)
  assert.deepEqual(msg.responses, [{ returnValue: true, config: { cameraUrl: 'http://cam/mjpeg', cameraMode: 'mjpeg', doorUrl: 'http://ha/hook' } }])
})

test('doorbellConfig answers {} when the file is missing', () => {
  const msg = fakeMessage({})
  doorbell(undefined).doorbellConfig(msg)
  assert.deepEqual(msg.responses, [{ returnValue: true, config: {} }])
})

test('doorbellConfig answers {} when the file is not JSON', () => {
  const msg = fakeMessage({})
  doorbell('{nope').doorbellConfig(msg)
  assert.deepEqual(msg.responses, [{ returnValue: true, config: {} }])
})

test('openDoor without doorUrl is simulated', () => {
  let called = 0
  const msg = fakeMessage({})
  doorbell('{"cameraUrl":"http://cam/x"}', () => { called++ }).openDoor(msg)
  assert.equal(called, 0)
  assert.deepEqual(msg.responses, [{ returnValue: true, simulated: true }])
})

test('openDoor posts to doorUrl and reports 2xx', () => {
  const urls = []
  const msg = fakeMessage({})
  doorbell('{"doorUrl":"http://ha/hook"}', (url, cb) => { urls.push(url); cb(null, 200) }).openDoor(msg)
  assert.deepEqual(urls, ['http://ha/hook'])
  assert.deepEqual(msg.responses, [{ returnValue: true, simulated: false }])
})

test('openDoor reports a non-2xx status', () => {
  const msg = fakeMessage({})
  doorbell('{"doorUrl":"http://ha/hook"}', (url, cb) => cb(null, 404)).openDoor(msg)
  assert.deepEqual(msg.responses, [{ returnValue: false, errorText: 'HTTP 404' }])
})

test('openDoor reports a request error', () => {
  const msg = fakeMessage({})
  doorbell('{"doorUrl":"http://ha/hook"}', (url, cb) => cb(new Error('timeout'))).openDoor(msg)
  assert.deepEqual(msg.responses, [{ returnValue: false, errorText: 'timeout' }])
})

test('openDoor\'s default request really POSTs to the doorUrl', async () => {
  const http = require('http')
  const seen = []
  const server = http.createServer((req, res) => { seen.push(req.method + ' ' + req.url); res.writeHead(204); res.end() })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const url = 'http://127.0.0.1:' + server.address().port + '/api/webhook/door'
  const msg = fakeMessage({})
  await new Promise((resolve) => {
    msg.respond = (r) => { msg.responses.push(r); resolve() }
    createHandlers(() => {}, () => {}, { fs: doorbellFs(JSON.stringify({ doorUrl: url })) }).openDoor(msg)
  })
  server.close()
  assert.deepEqual(seen, ['POST /api/webhook/door'])
  assert.deepEqual(msg.responses, [{ returnValue: true, simulated: false }])
})
