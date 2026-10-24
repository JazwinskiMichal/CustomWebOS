const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const main = require('./main.js')

test('parseLaunchPoints returns id/title for a valid response', () => {
  const raw = {
    returnValue: true,
    launchPoints: [
      {id: 'netflix', title: 'Netflix'},
      {id: 'youtube.leanback.v4', title: 'YouTube'},
    ],
  }
  assert.deepEqual(main.parseLaunchPoints(raw), [
    {id: 'netflix', title: 'Netflix'},
    {id: 'youtube.leanback.v4', title: 'YouTube'},
  ])
})

test('parseLaunchPoints returns [] on error-shaped response', () => {
  assert.deepEqual(main.parseLaunchPoints({returnValue: false, errorText: 'denied'}), [])
})

test('parseLaunchPoints returns [] on empty launchpoints array', () => {
  assert.deepEqual(main.parseLaunchPoints({returnValue: true, launchPoints: []}), [])
})

test('buildLaunchParams accepts an id in the available list', () => {
  const r = main.buildLaunchParams('netflix', ['netflix', 'youtube.leanback.v4'])
  assert.equal(r.ok, true)
  assert.deepEqual(r.params, {id: 'netflix'})
})

test('buildLaunchParams rejects a stale id', () => {
  const r = main.buildLaunchParams('netflix', ['youtube.leanback.v4'])
  assert.equal(r.ok, false)
  assert.equal(r.reason, 'stale-id')
})

test('main.js source is ES5 only', () => {
  const src = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8')
  const banned = [
    { label: 'const',           re: /\bconst\s/ },
    { label: 'let',             re: /\blet\s/ },
    { label: 'arrow fn',        re: /=>/ },
    { label: 'template string', re: /`/ },
    { label: 'class',           re: /\bclass\s+\w/ },
    { label: 'async',           re: /\basync\s/ },
    { label: 'spread/rest',     re: /\.\.\./ },
    { label: 'destructuring',   re: /\b(?:var|let|const)\s*(?:\{|\[)/ },
  ]
  for (const b of banned) {
    assert.ok(!b.re.test(src), 'ES2015+ syntax found: ' + b.label)
  }
})
