// scripts/autostart.sh runs on the TV from /var/lib/webosbrew/init.d at
// boot. Here it runs under sh with stub luna-send and sleep on PATH, so its
// logic is tested without a TV; autostart.ps1 is checked with -WhatIf.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const ROOT = path.join(__dirname, '..')
const SCRIPT = path.join(ROOT, 'scripts', 'autostart.sh')
const SH = spawnSync('sh', ['-c', 'exit 0']).status === 0 ? 'sh' : null
const PS = ['pwsh', 'powershell'].find((c) => {
  const r = spawnSync(c, ['-NoProfile', '-Command', 'exit 0'])
  return !r.error && r.status === 0
})

// A stub bin dir: luna-send logs its args and stdin source, answering
// returnValue only from the Nth call on; sleep does nothing.
function stubs(answerFrom) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cwo-autostart-'))
  const log = path.join(dir, 'calls.log')
  const count = path.join(dir, 'count')
  fs.writeFileSync(count, '0')
  fs.writeFileSync(path.join(dir, 'luna-send'), [
    '#!/bin/sh',
    'n=$(cat "' + count.replace(/\\/g, '/') + '"); n=$((n+1)); echo $n > "' + count.replace(/\\/g, '/') + '"',
    '[ -t 0 ] && tty=tty || tty=notty',
    'if [ -p /dev/stdin ]; then src=pipe; else src=other; fi',
    'echo "$src $*" >> "' + log.replace(/\\/g, '/') + '"',
    'if [ $n -ge ' + answerFrom + ' ]; then echo \'{"returnValue":true}\'; fi',
    'exit 0',
  ].join('\n') + '\n', { mode: 0o755 })
  fs.writeFileSync(path.join(dir, 'sleep'), '#!/bin/sh\nexit 0\n', { mode: 0o755 })
  return { dir, log }
}

function run(answerFrom) {
  const s = stubs(answerFrom)
  const r = spawnSync(SH, [SCRIPT, '--foreground'], {
    encoding: 'utf8',
    env: Object.assign({}, process.env, { PATH: s.dir + path.delimiter + process.env.PATH }),
    input: 'stdin is a pipe here, like under run-parts',
  })
  const calls = fs.existsSync(s.log) ? fs.readFileSync(s.log, 'utf8').trim().split('\n') : []
  return { r, calls }
}

const APP = 'org.jazwinski.customwebos.home'

test('autostart.sh is valid sh', { skip: !SH && 'no sh' }, () => {
  const r = spawnSync(SH, ['-n', SCRIPT], { encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
})

test('once the bus answers, it closes and reopens CustomWebOS', { skip: !SH && 'no sh' }, () => {
  const { r, calls } = run(1)
  assert.equal(r.status, 0, r.stderr)
  const close = calls.findIndex((c) => c.includes('/closeByAppId') && c.includes(APP))
  const launch = calls.findIndex((c) => c.includes('/launch ') && c.includes(APP))
  assert.ok(close > -1 && launch > close, calls.join('\n'))
})

test('it keeps asking until the bus answers', { skip: !SH && 'no sh' }, () => {
  const { calls } = run(4)
  const probes = calls.filter((c) => c.includes('getForegroundAppInfo'))
  assert.ok(probes.length >= 4, calls.join('\n'))
  assert.ok(calls.some((c) => c.includes('/launch ')))
})

test('it gives up without launching if the bus never answers', { skip: !SH && 'no sh' }, () => {
  const { r, calls } = run(100000)
  assert.equal(r.status, 0)
  assert.equal(calls.filter((c) => c.includes('getForegroundAppInfo')).length, 120)
  assert.ok(!calls.some((c) => c.includes('/launch ') || c.includes('closeByAppId')))
})

test('every luna-send gets a stdin that is not the caller\'s pipe', { skip: !SH && 'no sh' }, () => {
  // luna-send returns nothing (rc 0) when its stdin is a pipe (m2-tracking).
  const { calls } = run(1)
  assert.ok(calls.length >= 3)
  for (const c of calls) assert.match(c, /^other /, c)
})

test('without --foreground it returns at once and works in the background', { skip: !SH && 'no sh' }, async () => {
  // run-parts runs the hooks one after another: this one must not hold the
  // others up while it waits for the bus.
  const s = stubs(1)
  // A sleep that really waits, so a blocking script would take seconds.
  fs.writeFileSync(path.join(s.dir, 'sleep'), ['#!/bin/sh', 'node -e "setTimeout(function () {}, 1000)"', ''].join('\n'), { mode: 0o755 })
  const started = Date.now()
  const r = spawnSync(SH, [SCRIPT], {
    encoding: 'utf8',
    env: Object.assign({}, process.env, { PATH: s.dir + path.delimiter + process.env.PATH }),
  })
  assert.equal(r.status, 0, r.stderr)
  assert.ok(Date.now() - started < 1000, 'returned after ' + (Date.now() - started) + ' ms')
  for (let i = 0; i < 150; i++) {
    const log = fs.existsSync(s.log) ? fs.readFileSync(s.log, 'utf8') : ''
    if (log.includes('/launch ')) return
    await new Promise((res) => setTimeout(res, 100))
  }
  assert.fail('the background run never launched the app')
})

function ps(args) {
  return spawnSync(PS, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(ROOT, 'scripts', 'autostart.ps1'), ...args], { encoding: 'utf8' })
}

test('autostart.ps1 -WhatIf shows the install into init.d', { skip: !PS && 'no PowerShell' }, () => {
  const r = ps(['-TvHost', '192.0.2.1', '-WhatIf'])
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /\/var\/lib\/webosbrew\/init\.d\/customwebos-autostart/)
  assert.match(r.stdout, /chmod 755/)
  assert.doesNotMatch(r.stdout, /^running:/m)
})

test('autostart.ps1 -Remove -WhatIf shows the removal', { skip: !PS && 'no PowerShell' }, () => {
  const r = ps(['-TvHost', '192.0.2.1', '-Remove', '-WhatIf'])
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /rm -f \/var\/lib\/webosbrew\/init\.d\/customwebos-autostart/)
  assert.doesNotMatch(r.stdout, /chmod/)
})
