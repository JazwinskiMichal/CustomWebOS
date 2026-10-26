// scripts/remoteview.sh runs on the TV from /var/lib/webosbrew/init.d at
// boot. Here it runs under sh with stub remoteview, nice, sleep and date on
// PATH (and BIN, LOG, STOP overrides), so its logic is tested without a TV.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const ROOT = path.join(__dirname, '..')
const SCRIPT = path.join(ROOT, 'scripts', 'remoteview.sh')
const SH = spawnSync('sh', ['-c', 'exit 0']).status === 0 ? 'sh' : null
const fwd = (p) => p.split(String.fromCharCode(92)).join("/")

// The stub daemon logs a call and, on its Nth run, creates the stop file.
// The stub sleep logs its argument; nice logs its arguments and runs the rest.
// With clock set, date +%s advances that many seconds per call.
function setup(stopAfter, clock) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cwo-remoteview-'))
  const calls = path.join(dir, 'calls.log')
  const count = path.join(dir, 'count')
  const bin = path.join(dir, 'remoteview')
  fs.writeFileSync(count, '0')
  fs.writeFileSync(bin, [
    '#!/bin/sh',
    'n=$(cat "' + fwd(count) + '"); n=$((n+1)); echo $n > "' + fwd(count) + '"',
    'echo "daemon $n out"; echo "daemon $n err" >&2',
    '[ $n -ge ' + stopAfter + ' ] && touch "' + fwd(path.join(dir, 'stop')) + '"',
    'exit 3',
  ].join('\n') + '\n', { mode: 0o644 }) // the hook must chmod it
  fs.writeFileSync(path.join(dir, 'sleep'), '#!/bin/sh\necho "sleep $1" >> "' + fwd(calls) + '"\n', { mode: 0o755 })
  fs.writeFileSync(path.join(dir, 'nice'), '#!/bin/sh\necho "nice $*" >> "' + fwd(calls) + '"\nshift 2\nexec "$@"\n', { mode: 0o755 })
  if (clock) {
    const t = path.join(dir, 'time')
    fs.writeFileSync(t, '0')
    fs.writeFileSync(path.join(dir, 'date'), [
      '#!/bin/sh',
      'if [ "$1" = +%s ]; then n=$(cat "' + fwd(t) + '"); echo $((n+' + clock + ')) > "' + fwd(t) + '"; echo $n; else echo TIME; fi',
    ].join('\n') + '\n', { mode: 0o755 })
  }
  return { dir, calls, bin, log: path.join(dir, 'remoteview.log'), stop: path.join(dir, 'stop') }
}

function run(s, env) {
  const r = spawnSync(SH, [SCRIPT, '--foreground'], {
    encoding: 'utf8',
    env: Object.assign({}, process.env, {
      PATH: s.dir + path.delimiter + process.env.PATH,
      BIN: fwd(s.bin), LOG: fwd(s.log), STOP: fwd(s.stop),
    }, env),
    input: 'stdin is a pipe here, like under run-parts',
    timeout: 20000,
  })
  const calls = fs.existsSync(s.calls) ? fs.readFileSync(s.calls, 'utf8').trim().split('\n') : []
  const log = fs.existsSync(s.log) ? fs.readFileSync(s.log, 'utf8') : ''
  return { r, calls, log }
}

const skip = !SH && 'no sh'

test('remoteview.sh is valid sh', { skip }, () => {
  const r = spawnSync(SH, ['-n', SCRIPT], { encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
})

test('a missing binary exits 0 without looping or logging', { skip }, () => {
  const s = setup(1)
  fs.rmSync(s.bin)
  const { r, calls, log } = run(s)
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(calls, [])
  assert.equal(log, '')
})

test('the daemon is restarted after it exits, with growing delay', { skip }, () => {
  const s = setup(3)
  const { r, calls, log } = run(s)
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(calls.filter((c) => c.startsWith('sleep')), ['sleep 5', 'sleep 10', 'sleep 20'])
  assert.equal((log.match(/daemon \d out/g) || []).length, 3)
})

test('the delay stops doubling at 300 s', { skip }, () => {
  const s = setup(9)
  const { calls } = run(s)
  assert.deepEqual(calls.filter((c) => c.startsWith('sleep')).map((c) => c.slice(6)),
    ['5', '10', '20', '40', '80', '160', '300', '300', '300'])
})

test('after a run of 10 minutes the delay starts over', { skip }, () => {
  const s = setup(3, 700) // every date +%s call is 700 s after the last
  const { calls } = run(s)
  assert.deepEqual(calls.filter((c) => c.startsWith('sleep')), ['sleep 5', 'sleep 5', 'sleep 5'])
})

test('it runs the daemon under nice -n 10, with the binary made executable', { skip }, () => {
  const s = setup(1)
  const { r, calls } = run(s)
  assert.equal(r.status, 0, r.stderr)
  assert.ok(calls.includes('nice -n 10 ' + fwd(s.bin)), calls.join('\n'))
})

test('hook lines and the daemon\'s stdout and stderr land in the log file, not syslog', { skip }, () => {
  const s = setup(1)
  const { log } = run(s)
  assert.match(log, /remoteview-hook: starting /)
  assert.match(log, /daemon 1 out/)
  assert.match(log, /daemon 1 err/)
  assert.match(log, /exited with 3 after /)
})

test('a log over 256 KB moves to .1 before the start; a small one stays', { skip }, () => {
  const big = setup(1)
  fs.writeFileSync(big.log, 'x'.repeat(262145))
  run(big)
  assert.equal(fs.readFileSync(big.log + '.1', 'utf8').length, 262145)
  assert.ok(fs.statSync(big.log).size < 1000)

  const small = setup(1)
  fs.writeFileSync(small.log, 'old\n')
  const { log } = run(small)
  assert.ok(log.startsWith('old\n'))
  assert.ok(!fs.existsSync(small.log + '.1'))
})

test('without --foreground it returns at once and works in the background', { skip }, async () => {
  const s = setup(1)
  const started = Date.now()
  const r = spawnSync(SH, [SCRIPT], {
    encoding: 'utf8',
    env: Object.assign({}, process.env, { PATH: s.dir + path.delimiter + process.env.PATH, BIN: fwd(s.bin), LOG: fwd(s.log), STOP: fwd(s.stop) }),
  })
  assert.equal(r.status, 0, r.stderr)
  assert.ok(Date.now() - started < 2000)
  for (let i = 0; i < 100; i++) {
    if (fs.existsSync(s.log) && fs.readFileSync(s.log, 'utf8').includes('daemon 1 out')) return
    await new Promise((res) => setTimeout(res, 100))
  }
  assert.fail('the background run never started the daemon')
})
