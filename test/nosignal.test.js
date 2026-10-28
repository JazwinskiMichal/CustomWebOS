// scripts/nosignal.sh runs on the TV from /var/lib/webosbrew/init.d. Its
// decision logic is a pure function, run here as `nosignal.sh --decide …`;
// the rest is checked with stubs, like autostart.test.js.
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const SCRIPT = path.join(__dirname, '..', 'scripts', 'nosignal.sh')
const SH = spawnSync('sh', ['-c', 'exit 0']).status === 0 ? 'sh' : null

// Real eim/getAllInputStatus device entries for HDMI_1 (test/fixtures/nosignal).
const PS5_ON = '"id":"HDMI_1","label":"PlayStation5","port":1,"activate":true,"appId":"com.webos.app.hdmi1","spdProductDescription":"PS5","spdVendorName":"SCEI","spdSourceDeviceInfo":"GAME"'
const PS5_REST = '"id":"HDMI_1","label":"PlayStation5","port":1,"activate":true,"appId":"com.webos.app.hdmi1"'
const UNPLUGGED = '"id":"HDMI_1","label":"PlayStation5","port":1,"activate":false,"appId":"com.webos.app.hdmi1"'

// decide <current input> <foreground app> <device entry> <spd seen 0|1> <covering input or -> <seconds lost> <cover age s>
function decide(cur, fg, block, spdSeen, covering, lostFor, coverAge = 0) {
  const r = spawnSync(SH, [SCRIPT, '--decide', cur, fg, block, String(spdSeen), covering, String(lostFor), String(coverAge)], { encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  return r.stdout.trim()
}

const skip = { skip: !SH && 'no sh' }

test('nosignal.sh is valid sh', skip, () => {
  assert.equal(spawnSync(SH, ['-n', SCRIPT]).status, 0)
})

test('PS5 went to rest on the foreground HDMI 1: wait, then cover after 5 s', skip, () => {
  assert.equal(decide('HDMI_1', 'com.webos.app.hdmi1', PS5_REST, 1, '-', 0), 'wait')
  assert.equal(decide('HDMI_1', 'com.webos.app.hdmi1', PS5_REST, 1, '-', 4), 'wait')
  assert.equal(decide('HDMI_1', 'com.webos.app.hdmi1', PS5_REST, 1, '-', 5), 'cover')
})

test('another app in front of the covered input (Home, then Netflix): forget the cover, so its power-off timer is void', skip, () => {
  assert.equal(decide('HDMI_1', 'netflix', PS5_REST, 1, 'HDMI_1', 0, 300), 'clear')
  assert.equal(decide('HDMI_1', 'netflix', PS5_REST, 1, '-', 60), 'none')
})

test('a device switched off or unplugged (activate false) counts as lost', skip, () => {
  assert.equal(decide('HDMI_1', 'com.webos.app.hdmi1', UNPLUGGED, 0, '-', 6), 'cover')
})

test('a device that never sent ID info is never covered while it is connected', skip, () => {
  assert.equal(decide('HDMI_1', 'com.webos.app.hdmi1', PS5_REST, 0, '-', 60), 'none')
})

test('a picture on screen: nothing to do; back while covering: uncover', skip, () => {
  assert.equal(decide('HDMI_1', 'com.webos.app.hdmi1', PS5_ON, 1, '-', 0), 'none')
  assert.equal(decide('HDMI_1', 'org.jazwinski.customwebos.home', PS5_ON, 1, 'HDMI_1', 0), 'uncover')
})

test('while covering a still-dark input: keep covering', skip, () => {
  assert.equal(decide('HDMI_1', 'org.jazwinski.customwebos.home', PS5_REST, 1, 'HDMI_1', 120), 'none')
})

test('Live TV, apps, or the Home screen in front of a dark input: never cover', skip, () => {
  assert.equal(decide('DTV', 'com.webos.app.livetv', '', 0, '-', 60), 'none')
  assert.equal(decide('HDMI_1', 'netflix', PS5_REST, 1, '-', 60), 'none')
  assert.equal(decide('HDMI_1', 'org.jazwinski.customwebos.home', PS5_REST, 1, '-', 60), 'none')
})

test('the covered input back in front (Home pressed during the show, then its tile): forget the cover', skip, () => {
  assert.equal(decide('HDMI_1', 'com.webos.app.hdmi1', PS5_REST, 1, 'HDMI_1', 0, 300), 'clear')
  assert.equal(decide('HDMI_1', 'com.webos.app.hdmi1', PS5_REST, 1, '-', 5), 'cover')
})

test('a cover just launched, its app not in front yet: keep it', skip, () => {
  assert.equal(decide('HDMI_1', 'com.webos.app.hdmi1', PS5_REST, 1, 'HDMI_1', 0, 0), 'none')
  assert.equal(decide('HDMI_1', 'com.webos.app.hdmi1', PS5_REST, 1, 'HDMI_1', 0, 4), 'none')
})

test('the source changed while covering: forget the cover (the app hides itself)', skip, () => {
  assert.equal(decide('DTV', 'com.webos.app.livetv', '', 0, 'HDMI_1', 0), 'clear')
  assert.equal(decide('HDMI_2', 'com.webos.app.hdmi2', '', 0, 'HDMI_1', 0), 'clear')
})

const fs = require('node:fs')
const os = require('node:os')
const PS = ['pwsh', 'powershell'].find((c) => {
  const r = spawnSync(c, ['-NoProfile', '-Command', 'exit 0'])
  return !r.error && r.status === 0
})

test('without --foreground it returns at once (run-parts runs the hooks one after another)', skip, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cwo-nosignal-'))
  // Subscriptions that never end, as on the TV.
  fs.writeFileSync(path.join(dir, 'luna-send'), '#!/bin/sh\nexec sleep 30\n', { mode: 0o755 })
  const started = Date.now()
  const r = spawnSync(SH, [SCRIPT], {
    encoding: 'utf8',
    env: Object.assign({}, process.env, {
      PATH: dir + path.delimiter + process.env.PATH,
      STATE: path.join(dir, 'state'), LOG: path.join(dir, 'log'), APP_DIR: path.join(dir, 'app'),
    }),
  })
  assert.equal(r.status, 0, r.stderr)
  assert.ok(Date.now() - started < 1500, 'returned after ' + (Date.now() - started) + ' ms')
  // Stop the watcher it started (its pids file appears once it runs).
  const pidsFile = path.join(dir, 'state', 'pids')
  for (let i = 0; i < 50 && !fs.existsSync(pidsFile); i++) spawnSync(SH, ['-c', 'sleep 0.1'])
  // main, three loops and their three luna-send
  for (let i = 0; i < 50 && fs.readFileSync(pidsFile, 'utf8').trim().split(/\s+/).length < 7; i++) spawnSync(SH, ['-c', 'sleep 0.1'])
  const pids = fs.readFileSync(pidsFile, 'utf8').trim().split(/\s+/)
  assert.equal(pids.length, 7)
  spawnSync(SH, ['-c', 'kill ' + pids.join(' ')])
})

test('every luna-send in nosignal.sh gets /dev/null as stdin', () => {
  const src = fs.readFileSync(SCRIPT, 'utf8')
  const calls = src.split('\n').filter((l) => /luna-send /.test(l) && !/^\s*#/.test(l))
  assert.ok(calls.length >= 4)
  for (const l of calls) assert.match(l, /< \/dev\/null/, l)
})

function ps(args) {
  return spawnSync(PS, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, '..', 'scripts', 'nosignal.ps1'), ...args], { encoding: 'utf8' })
}

test('nosignal.ps1 -WhatIf shows the install into init.d', { skip: !PS && 'no PowerShell' }, () => {
  const r = ps(['-TvHost', '192.0.2.1', '-WhatIf'])
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /\/var\/lib\/webosbrew\/init\.d\/customwebos-nosignal/)
  assert.match(r.stdout, /tr -d/)
  assert.match(r.stdout, /chmod 755/)
})

test('nosignal.ps1 -Remove -WhatIf shows the removal', { skip: !PS && 'no PowerShell' }, () => {
  const r = ps(['-TvHost', '192.0.2.1', '-Remove', '-WhatIf'])
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /rm -f \/var\/lib\/webosbrew\/init\.d\/customwebos-nosignal/)
  assert.match(r.stdout, /kill .*\/tmp\/nosignal\/pids/)
})

// off_due <timer's cover id> <current cover id or -> <noSignalAutoOff value> -> yes|no
function offDue(id, current, setting) {
  const r = spawnSync(SH, [SCRIPT, '--off-due', id, current, setting], { encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  return r.stdout.trim()
}

test('15 min into the same cover, with LG\'s no-signal auto-off on, the TV is turned off', skip, () => {
  assert.equal(offDue('812', '812', 'on'), 'yes')
})

test('no power-off when the cover ended or changed, or LG\'s auto-off is off', skip, () => {
  assert.equal(offDue('812', '-', 'on'), 'no')
  assert.equal(offDue('812', '990', 'on'), 'no')
  assert.equal(offDue('812', '812', 'off'), 'no')
  assert.equal(offDue('812', '812', ''), 'no')
})
