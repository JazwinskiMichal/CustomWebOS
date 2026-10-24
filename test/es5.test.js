// Everything that runs on the TV must be ES5: home/ runs in the webOS 4.4 web
// engine, services/ runs under Node 0.12. Tests live in test/ precisely so
// they don't get bundled into the .ipk (ares-package ships whole dirs).
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const acorn = require('acorn')

const ROOT = path.join(__dirname, '..')
const RUNTIME_DIRS = ['home', 'services']

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name)
    return e.isDirectory() ? walk(p) : [p]
  })
}

const runtimeFiles = RUNTIME_DIRS.flatMap((d) => walk(path.join(ROOT, d)))

const jsFiles = runtimeFiles.filter((f) => f.endsWith('.js'))

test('there are runtime JS files to scan', () => {
  assert.ok(jsFiles.some((f) => f.endsWith(path.join('home', 'main.js'))))
  assert.ok(jsFiles.some((f) => f.endsWith('service.js')))
})

// Returns the ES5 parse errors in src (empty when clean). A real parse
// rather than regexes: catches for-of, default params, shorthand methods,
// and doesn't trip over comments.
function es5Problems(src) {
  try {
    acorn.parse(src, { ecmaVersion: 5, sourceType: 'script' })
    return []
  } catch (e) {
    return [e.message]
  }
}

test('es5Problems flags syntax the old regexes missed, and ignores comments', () => {
  assert.notDeepEqual(es5Problems('for (var x of y) {}'), [])
  assert.notDeepEqual(es5Problems('function f(a) { return a } function g(b = 1) {}'), [])
  assert.notDeepEqual(es5Problems('var o = { m() {} }'), [])
  assert.deepEqual(es5Problems('var o = { a: 1 }; // => `comment` ...rest'), [])
})

for (const file of jsFiles) {
  test('ES5 only: ' + path.relative(ROOT, file), () => {
    assert.deepEqual(es5Problems(fs.readFileSync(file, 'utf8')), [])
  })
}

test('acorn ES5 mode rejects what the TV cannot run', () => {
  const parse = (src) => acorn.parse(src, { ecmaVersion: 5, sourceType: 'script' })
  for (const src of [
    'for (var x of y) {}',
    'function f(a = 1) {}',
    'var o = { m() {} }',
    '`t`',
    'let a = 1',
    'var f = () => 1',
    'class A {}',
    'var {a} = b',
  ]) {
    assert.throws(() => parse(src), SyntaxError, src)
  }
  // Comments mentioning ES2015 syntax no longer false-positive.
  assert.doesNotThrow(() => parse('var o = { a: 1 }; // => `comment` ...rest'))
})

test('no test files inside packaged dirs', () => {
  const stray = runtimeFiles.filter((f) => /\.test\.js$|\.Tests\.ps1$/.test(f))
  assert.deepEqual(stray.map((f) => path.relative(ROOT, f)), [])
})
