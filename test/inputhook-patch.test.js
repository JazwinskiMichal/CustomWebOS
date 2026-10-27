// scripts/inputhook-patch.sh runs on the TV (piped by inputhook-patch.ps1).
// It limits LG Input Hook's injection to lginput2; here it runs against a
// copy of the service.js line it edits.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const SCRIPT = path.join(__dirname, '..', 'scripts', 'inputhook-patch.sh')
const SH = spawnSync('sh', ['-c', 'exit 0']).status === 0 ? 'sh' : null
const skip = { skip: !SH && 'no sh' }

// The line as shipped in LG Input Hook's service.js (line 171 on the TV).
const ORIGINAL = "var targetNames = ['RELEASE', 'lginput2', 'micomservice', 'tvservice', 'testapp'];"
const PATCHED = "var targetNames = ['lginput2'];"
const SERVICE_JS = 'var fs = require("fs");\n' + ORIGINAL + '\nvar targets = [];\n'

function serviceDir(content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inputhook-'))
  fs.writeFileSync(path.join(dir, 'service.js'), content)
  return dir
}

function run(dir, ...args) {
  return spawnSync(SH, [SCRIPT, ...args], { encoding: 'utf8', env: { ...process.env, INPUTHOOK_SERVICE_DIR: dir } })
}

const read = (dir, name) => fs.readFileSync(path.join(dir, name), 'utf8')

test('inputhook-patch.sh is valid sh', skip, () => {
  assert.equal(spawnSync(SH, ['-n', SCRIPT]).status, 0)
})

test('injects into lginput2 only, keeping the original as service.js.orig', skip, () => {
  const dir = serviceDir(SERVICE_JS)
  const r = run(dir)
  assert.equal(r.status, 0, r.stderr)
  assert.equal(read(dir, 'service.js'), SERVICE_JS.replace(ORIGINAL, PATCHED))
  assert.equal(read(dir, 'service.js.orig'), SERVICE_JS)
})

test('a second run changes nothing', skip, () => {
  const dir = serviceDir(SERVICE_JS)
  run(dir)
  const r = run(dir)
  assert.equal(r.status, 0, r.stderr)
  assert.equal(read(dir, 'service.js'), SERVICE_JS.replace(ORIGINAL, PATCHED))
  assert.equal(read(dir, 'service.js.orig'), SERVICE_JS)
})

test('--undo puts the original back', skip, () => {
  const dir = serviceDir(SERVICE_JS)
  run(dir)
  const r = run(dir, '--undo')
  assert.equal(r.status, 0, r.stderr)
  assert.equal(read(dir, 'service.js'), SERVICE_JS)
  assert.equal(fs.existsSync(path.join(dir, 'service.js.orig')), false)
})

test('an Input Hook without that line (a newer version) is left alone and fails', skip, () => {
  const other = 'var targets = ["lginput2", "tvservice"];\n'
  const dir = serviceDir(other)
  const r = run(dir)
  assert.notEqual(r.status, 0)
  assert.equal(read(dir, 'service.js'), other)
})

test('no Input Hook installed: fails without creating anything', skip, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inputhook-'))
  const r = run(path.join(dir, 'missing'))
  assert.notEqual(r.status, 0)
  assert.equal(fs.existsSync(path.join(dir, 'missing')), false)
})

const PS = spawnSync('powershell', ['-NoProfile', '-Command', 'exit 0']).status === 0 ? 'powershell' : null
const PS1 = path.join(__dirname, '..', 'scripts', 'inputhook-patch.ps1')
const ps = (args) => spawnSync(PS, ['-NoProfile', '-File', PS1, ...args], { encoding: 'utf8' })

test('inputhook-patch.ps1 -WhatIf prints the ssh command without connecting', { skip: !PS && 'no PowerShell' }, () => {
  const r = ps(['-TvHost', '192.0.2.1', '-WhatIf'])
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /would run: ssh -p 22022 .*root@192\.0\.2\.1 .*sh -s.* < .*inputhook-patch\.sh/)
  assert.doesNotMatch(r.stdout, /--undo/)
})

test('inputhook-patch.ps1 -Undo -WhatIf passes --undo', { skip: !PS && 'no PowerShell' }, () => {
  const r = ps(['-TvHost', '192.0.2.1', '-Undo', '-WhatIf'])
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /sh -s -- --undo/)
})
