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

// $(mypid) runs mypid in a command-substitution subshell: BusyBox ash and
// dash then record that subshell's pid, not the loop's (bash gets it right),
// so -Remove left the loops running on the TV.
test('pids are recorded without a command substitution', () => {
  assert.doesNotMatch(fs.readFileSync(SCRIPT, 'utf8'), /\$\(mypid\)/)
})

// A running CustomWebOS would first show its last frame (Home) when brought
// back; a fresh launch has none.
test('a cover closes CustomWebOS first, then launches the slideshow', () => {
  const cover = fs.readFileSync(SCRIPT, 'utf8').split('\n        cover)')[1].split(';;')[0]
  const close = cover.indexOf('/closeByAppId')
  const launch = cover.indexOf('"$AM/launch"')
  assert.ok(close > 0, 'no closeByAppId in the cover branch')
  assert.ok(close < launch, 'closeByAppId must come before the launch')
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

// Photos from the NAS: -ConfigureNas turns .local/slideshow-nas.json into an
// NFS v3 fstab line on the TV (no credentials: the NAS allows the TV's IP, read-only).
function nasConfig(obj) {
  const dir = require('node:fs').mkdtempSync(path.join(require('node:os').tmpdir(), 'cwo-nas-'))
  const f = path.join(dir, 'nas.json')
  require('node:fs').writeFileSync(f, JSON.stringify(obj))
  return f
}
const NAS_LINE = '192.168.88.235:/CustomWebOS_Slideshow /tmp/customwebos-nas nfs ro,vers=3,nolock,soft,timeo=30,retrans=2,addr=192.168.88.235 0 0'

test('nosignal.ps1 -ConfigureNas -WhatIf shows the NFS fstab line and where it goes', { skip: !PS && 'no PowerShell' }, () => {
  const r = ps(['-TvHost', '192.0.2.1', '-ConfigureNas', '-NasConfigPath', nasConfig({ share: '//192.168.88.235/CustomWebOS_Slideshow', username: 'x', password: 'y' }), '-WhatIf'])
  assert.equal(r.status, 0, r.stderr)
  assert.ok(r.stdout.includes(NAS_LINE), r.stdout)
  assert.match(r.stdout, /\/var\/lib\/customwebos\/nas\.fstab\.tmp && chmod 600 .* && mv /)
  assert.doesNotMatch(r.stdout, /password|username/)
})

test('-ConfigureNas also takes an NFS path as it is', { skip: !PS && 'no PowerShell' }, () => {
  const r = ps(['-TvHost', '192.0.2.1', '-ConfigureNas', '-NasConfigPath', nasConfig({ share: '192.168.88.235:/CustomWebOS_Slideshow' }), '-WhatIf'])
  assert.equal(r.status, 0, r.stderr)
  assert.ok(r.stdout.includes(NAS_LINE), r.stdout)
})

test('-ConfigureNas refuses a settings file without a share', { skip: !PS && 'no PowerShell' }, () => {
  const r = ps(['-TvHost', '192.0.2.1', '-ConfigureNas', '-NasConfigPath', nasConfig({ username: 'x' }), '-WhatIf'])
  assert.notEqual(r.status, 0)
  assert.match(r.stdout + r.stderr, /share/)
})

test('nosignal.ps1 -RemoveNas -WhatIf unmounts and deletes the NAS settings', { skip: !PS && 'no PowerShell' }, () => {
  const r = ps(['-TvHost', '192.0.2.1', '-RemoveNas', '-WhatIf'])
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /umount -l \/tmp\/customwebos-nas/)
  assert.match(r.stdout, /rm -f \/var\/lib\/customwebos\/nas\.fstab/)
})

// nas_up / nas_down (via --nas-up / --nas-down) with stub mount, umount,
// timeout and ls that append their arguments to calls.log.
function nasRun(hook, { fstab = true, mounted = false, lsFails = false, mountFails = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cwo-nas-'))
  const calls = path.join(dir, 'calls.log')
  const stub = (name, body) => fs.writeFileSync(path.join(dir, name), '#!/bin/sh\necho "' + name + ' $*" >> "' + calls.replace(/\\/g, '/') + '"\n' + body, { mode: 0o755 })
  stub('timeout', 'shift 2\nexec "$@"\n')
  stub('mount', mountFails ? 'echo "mount: access denied by server while mounting 192.168.88.235:/x" >&2\nexit 32\n' : 'exit 0\n')
  stub('umount', 'exit 0\n')
  stub('ls', lsFails ? 'exit 1\n' : 'exit 0\n')
  const fstabPath = path.join(dir, 'nas.fstab')
  if (fstab) fs.writeFileSync(fstabPath, '192.168.88.235:/x /tmp/customwebos-nas nfs ro 0 0\n')
  const mnt = path.join(dir, 'mnt')
  const mounts = path.join(dir, 'mounts')
  fs.writeFileSync(mounts, mounted ? '192.168.88.235:/x ' + mnt.replace(/\\/g, '/') + ' nfs ro 0 0\n' : '')
  const log = path.join(dir, 'log')
  const r = spawnSync(SH, [SCRIPT, hook], {
    encoding: 'utf8',
    env: Object.assign({}, process.env, {
      PATH: dir + path.delimiter + process.env.PATH,
      NAS_FSTAB: fstabPath.replace(/\\/g, '/'), NAS_MNT: mnt.replace(/\\/g, '/'), MOUNTS: mounts, LOG: log,
    }),
  })
  assert.equal(r.status, 0, r.stderr)
  const read = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '')
  return { calls: read(calls), log: read(log), fstab: fstabPath.replace(/\\/g, '/'), mnt: mnt.replace(/\\/g, '/') }
}

test('no nas.fstab: no mount is tried', skip, () => {
  assert.equal(nasRun('--nas-up', { fstab: false }).calls, '')
})

test('nas_up mounts with the fstab, inside a 5 s limit', skip, () => {
  const r = nasRun('--nas-up')
  assert.ok(r.calls.includes('timeout -t 5 mount -T ' + r.fstab + ' ' + r.mnt), r.calls)
  assert.match(r.log, /NAS mounted/)
})

test('a stale mount is dropped and mounted again', skip, () => {
  const r = nasRun('--nas-up', { mounted: true, lsFails: true })
  const umount = r.calls.indexOf('umount -l ' + r.mnt)
  const mount = r.calls.indexOf('mount -T')
  assert.ok(umount >= 0 && mount > umount, r.calls)
})

test('a live mount is kept as it is', skip, () => {
  const r = nasRun('--nas-up', { mounted: true })
  assert.doesNotMatch(r.calls, /umount|mount -T/)
})

test('a failed mount is logged without the server\'s details', skip, () => {
  const r = nasRun('--nas-up', { mountFails: true })
  assert.match(r.log, /NAS not reachable: using the stick/)
  assert.doesNotMatch(r.log, /192\.168|access denied|password/)
})

test('nas_down unmounts only a mounted share', skip, () => {
  assert.match(nasRun('--nas-down', { mounted: true }).calls, /umount -l /)
  assert.equal(nasRun('--nas-down').calls, '')
})

test('the cover accepts NAS or stick photos, and the show\'s end unmounts', () => {
  const src = fs.readFileSync(SCRIPT, 'utf8')
  assert.match(src, /grep -qE '"\(usb\|nas\)\/'/)
  const cover = src.slice(src.indexOf('        cover)'), src.indexOf('        uncover)'))
  assert.ok(cover.indexOf('nas_up') >= 0 && cover.indexOf('nas_up') < cover.indexOf('listPhotos'), 'nas_up before listPhotos')
  for (const branch of ['        uncover)', '        clear)']) {
    const body = src.slice(src.indexOf(branch), src.indexOf(';;', src.indexOf(branch)))
    assert.match(body, /nas_down/, branch)
  }
  assert.match(src, /ln -sfn "\$NAS_MNT" "\$APP_DIR\/nas"/)
})
