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
    // getForegroundAppInfo names $STUB_FG (default: the PS5's HDMI input).
    'fg=${STUB_FG:-com.webos.app.hdmi1}',
    'if [ $n -ge ' + answerFrom + ' ]; then',
    '  case "$*" in',
    '    *getForegroundAppInfo*) echo "{\\"appId\\":\\"$fg\\",\\"returnValue\\":true}" ;;',
    '    *) echo \'{"returnValue":true}\' ;;',
    '  esac',
    'fi',
    'exit 0',
  ].join('\n') + '\n', { mode: 0o755 })
  fs.writeFileSync(path.join(dir, 'sleep'), '#!/bin/sh\necho "sleep $*" >> "' + log.replace(/\\/g, '/') + '"\n', { mode: 0o755 })
  fs.writeFileSync(path.join(dir, 'ps'), [
    '#!/bin/sh',
    'echo "UID        PID  PPID  C STIME TTY          TIME CMD"',
    'echo "root      4402  1404  1 09:09 ?        00:00:00 org.webosbrew.inputhook.service"',
    'echo "root      4483  1404  1 08:59 ?        00:00:00 org.jazwinski.customwebos.home.service"',
  ].join('\n') + '\n', { mode: 0o755 })
  fs.writeFileSync(path.join(dir, 'kill'), '#!/bin/sh\necho "kill $*" >> "' + log.replace(/\\/g, '/') + '"\n', { mode: 0o755 })
  return { dir, log }
}

// By default LG Input Hook looks absent (its app dir doesn't exist).
function run(answerFrom, extraEnv) {
  const s = stubs(answerFrom)
  const r = spawnSync(SH, [SCRIPT, '--foreground'], {
    encoding: 'utf8',
    env: Object.assign({}, process.env, {
      PATH: s.dir + path.delimiter + process.env.PATH,
      INPUTHOOK_DIR: path.join(s.dir, 'no-such-app'),
      INPUTHOOK_MARKER: path.join(s.dir, 'no-such-marker'),
      KILL: path.join(s.dir, 'kill'), // kill is a shell builtin; PATH can't stub it
    }, extraEnv && extraEnv(s.dir)),
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

test('with another app in front, it opens CustomWebOS as soon as the bus answers', { skip: !SH && 'no sh' }, () => {
  const { r, calls } = run(1)
  assert.equal(r.status, 0, r.stderr)
  const probe = calls.findIndex((c) => c.includes('getForegroundAppInfo'))
  const launch = calls.findIndex((c) => c.includes('/launch ') && c.includes(APP))
  assert.equal(launch, probe + 1, 'no wait and no close in between:\n' + calls.join('\n'))
  assert.ok(!calls.some((c) => c.includes('/closeByAppId')), calls.join('\n'))
})

test('with CustomWebOS already in front (it may be stuck), it closes and reopens it', { skip: !SH && 'no sh' }, () => {
  const { r, calls } = run(1, () => ({ STUB_FG: APP }))
  assert.equal(r.status, 0, r.stderr)
  const close = calls.findIndex((c) => c.includes('/closeByAppId') && c.includes(APP))
  const launch = calls.findIndex((c) => c.includes('/launch ') && c.includes(APP))
  assert.ok(close > -1 && launch > close, calls.join('\n'))
  assert.deepEqual(calls.slice(close + 1, launch), ['sleep 1'])
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
  // luna-send returns nothing (rc 0) when its stdin is a pipe (tv-log).
  const { calls } = run(1, () => ({ STUB_FG: APP }))
  const luna = calls.filter((c) => !c.startsWith('sleep ') && !c.startsWith('kill '))
  assert.ok(luna.length >= 3)
  for (const c of luna) assert.match(c, /^other /, c)
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

// LG Input Hook's config server (port 1842, root command execution behind
// a password) isn't needed once its library is injected; the hook stops it.
function withInputHook(markerExists) {
  return (dir) => {
    fs.mkdirSync(path.join(dir, 'inputhook-app'))
    if (markerExists) fs.writeFileSync(path.join(dir, 'inputhook-marker'), '')
    return { INPUTHOOK_DIR: path.join(dir, 'inputhook-app'), INPUTHOOK_MARKER: path.join(dir, 'inputhook-marker') }
  }
}

test('once LG Input Hook has injected, its config server is stopped', { skip: !SH && 'no sh' }, () => {
  const { r, calls } = run(1, withInputHook(true))
  assert.equal(r.status, 0, r.stderr)
  const kill = calls.findIndex((c) => c === 'kill 4402')
  assert.ok(kill > -1, calls.join('\n'))
  assert.ok(kill > calls.findIndex((c) => c.includes('/launch ')), 'after CustomWebOS opens')
  assert.ok(!calls.includes('kill 4483'), 'never the home service')
})

test('without LG Input Hook installed, nothing is stopped', { skip: !SH && 'no sh' }, () => {
  const { calls } = run(1)
  assert.ok(!calls.some((c) => c.startsWith('kill')), calls.join('\n'))
})

test('if LG Input Hook never injects, it gives up without stopping anything', { skip: !SH && 'no sh' }, () => {
  const { r, calls } = run(1, withInputHook(false))
  assert.equal(r.status, 0)
  assert.ok(!calls.some((c) => c.startsWith('kill')), calls.join('\n'))
})
