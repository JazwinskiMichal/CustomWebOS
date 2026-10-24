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
