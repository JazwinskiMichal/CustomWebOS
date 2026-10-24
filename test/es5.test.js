// Everything that runs on the TV must be ES5: home/ runs in the webOS 4.4 web
// engine, services/ runs under Node 0.12. Tests live in test/ precisely so
// they don't get bundled into the .ipk (ares-package ships whole dirs).
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..')
const RUNTIME_DIRS = ['home', 'services']

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name)
    return e.isDirectory() ? walk(p) : [p]
  })
}

const runtimeFiles = RUNTIME_DIRS.flatMap((d) => walk(path.join(ROOT, d)))

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

const jsFiles = runtimeFiles.filter((f) => f.endsWith('.js'))

test('there are runtime JS files to scan', () => {
  assert.ok(jsFiles.some((f) => f.endsWith(path.join('home', 'main.js'))))
  assert.ok(jsFiles.some((f) => f.endsWith('service.js')))
})

for (const file of jsFiles) {
  test('ES5 only: ' + path.relative(ROOT, file), () => {
    const src = fs.readFileSync(file, 'utf8')
    for (const b of banned) {
      assert.ok(!b.re.test(src), 'ES2015+ syntax found: ' + b.label)
    }
  })
}

test('no test files inside packaged dirs', () => {
  const stray = runtimeFiles.filter((f) => /\.test\.js$|\.Tests\.ps1$/.test(f))
  assert.deepEqual(stray.map((f) => path.relative(ROOT, f)), [])
})
