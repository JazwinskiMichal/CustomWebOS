// Dry-run checks for the scripts. Nothing here touches the TV: PowerShell
// scripts run with -WhatIf, register-service.sh runs with --dry-run.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const ROOT = path.join(__dirname, '..')
const SCRIPTS = path.join(ROOT, 'scripts')
const DIST = path.join(ROOT, 'dist')

function onPath(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8' })
  return !r.error && r.status === 0
}

const PS = ['pwsh', 'powershell'].find((c) => onPath(c, ['-NoProfile', '-Command', 'exit 0']))
const SH = onPath('sh', ['-c', 'exit 0']) ? 'sh' : null

function ps(script, args) {
  return spawnSync(PS, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(SCRIPTS, script), ...args], { encoding: 'utf8' })
}

function sh(args) {
  return spawnSync(SH, [path.join(SCRIPTS, 'register-service.sh'), ...args], { encoding: 'utf8' })
}

test('package.ps1 -WhatIf names ares-package, both sources and dist/, builds nothing', { skip: !PS && 'no PowerShell' }, () => {
  const before = fs.existsSync(DIST) ? fs.readdirSync(DIST) : []
  const r = ps('package.ps1', ['-WhatIf'])
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /ares-package/)
  assert.match(r.stdout, /home/)
  assert.match(r.stdout, /services[\\/]org\.jazwinski\.customwebos\.home\.service/)
  assert.match(r.stdout, /dist/)
  assert.match(r.stdout, /bin[\\/]remoteview/)
  assert.match(r.stdout, /libdile_vt_backend\.so/)
  assert.match(r.stdout, /libgm_backend\.so/)
  assert.match(r.stdout, /bin[\\/]libjpeg\.so\.8/)
  const after = fs.existsSync(DIST) ? fs.readdirSync(DIST) : []
  assert.deepEqual(after, before)
})

test('install.ps1 -WhatIf names ares-install, the device and the newest .ipk', { skip: !PS && 'no PowerShell' }, () => {
  const createdDist = !fs.existsSync(DIST)
  fs.mkdirSync(DIST, { recursive: true })
  const stub = path.join(DIST, 'org.jazwinski.customwebos.home_9.9.9-test_all.ipk')
  fs.writeFileSync(stub, 'stub')
  try {
    const r = ps('install.ps1', ['-Device', 'tv', '-WhatIf'])
    assert.equal(r.status, 0, r.stderr)
    assert.match(r.stdout, /ares-install -d tv/)
    assert.match(r.stdout, /org\.jazwinski\.customwebos\.home_9\.9\.9-test_all\.ipk/)
  } finally {
    fs.rmSync(stub)
    if (createdDist) fs.rmSync(DIST, { recursive: true })
  }
})

test('install.ps1 -TvHost -WhatIf installs as a developer app over ssh', { skip: !PS && 'no PowerShell' }, () => {
  const createdDist = !fs.existsSync(DIST)
  fs.mkdirSync(DIST, { recursive: true })
  const stub = path.join(DIST, 'org.jazwinski.customwebos.home_9.9.9-test_all.ipk')
  fs.writeFileSync(stub, 'stub')
  try {
    const r = ps('install.ps1', ['-TvHost', '192.0.2.1', '-WhatIf'])
    assert.equal(r.status, 0, r.stderr)
    assert.match(r.stdout, /scp -P 22022 .*root@192\.0\.2\.1:\/tmp\/org\.jazwinski\.customwebos\.home_9\.9\.9-test_all\.ipk/)
    const ssh = r.stdout.split(/\r?\n/).find((l) => l.startsWith('would run: ssh'))
    // -t developer: without it the app installs to /media/cryptofs (seen on-device).
    assert.match(ssh, /ApplicationInstallerUtility -c install -t developer -p \/tmp\/\S+\.ipk -f \/etc\/palm\/appinstalld\/opkg\.conf/)
    // Windows PowerShell strips embedded double quotes from native args.
    const remote = ssh.slice(ssh.indexOf('root@192.0.2.1 "') + 'root@192.0.2.1 "'.length, ssh.lastIndexOf('"'))
    assert.ok(remote.startsWith('ApplicationInstallerUtility'))
    assert.ok(!remote.includes('"'), 'remote command must not contain double quotes')
  } finally {
    fs.rmSync(stub)
    if (createdDist) fs.rmSync(DIST, { recursive: true })
  }
})

test('install.ps1 -TvHost -Reboot reboots only after a successful install', { skip: !PS && 'no PowerShell' }, () => {
  const createdDist = !fs.existsSync(DIST)
  fs.mkdirSync(DIST, { recursive: true })
  const stub = path.join(DIST, 'org.jazwinski.customwebos.home_9.9.9-test_all.ipk')
  fs.writeFileSync(stub, 'stub')
  try {
    const withReboot = ps('install.ps1', ['-TvHost', '192.0.2.1', '-Reboot', '-WhatIf'])
    assert.equal(withReboot.status, 0, withReboot.stderr)
    assert.match(withReboot.stdout, /\[ \$rc -eq 0 \] && reboot; exit \$rc/)
    const without = ps('install.ps1', ['-TvHost', '192.0.2.1', '-WhatIf'])
    assert.doesNotMatch(without.stdout, /reboot/)
  } finally {
    fs.rmSync(stub)
    if (createdDist) fs.rmSync(DIST, { recursive: true })
  }
})

test('register-service.ps1 -WhatIf prints the ssh command without connecting', { skip: !PS && 'no PowerShell' }, () => {
  const r = ps('register-service.ps1', ['-TvHost', '192.0.2.1', '-WhatIf'])
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /ssh -p 22022 /)
  assert.match(r.stdout, /root@192\.0\.2\.1/)
  assert.match(r.stdout, /sh -s --/)
  assert.match(r.stdout, /register-service\.sh/)
})

test('register-service.ps1 -WhatIf forwards -Unregister and -SystemWrapper as flags', { skip: !PS && 'no PowerShell' }, () => {
  const r = ps('register-service.ps1', ['-TvHost', '192.0.2.1', '-Port', '22', '-Unregister', '-SystemWrapper', '-DryRunOnTv', '-WhatIf'])
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /ssh -p 22 /)
  assert.match(r.stdout, /--dry-run --unregister --system-wrapper/)
})

const SVC = 'org.jazwinski.customwebos.home.service'
const ELEVEN = [
  `/var/luna-service2-dev/services.d/${SVC}.service`,
  `/var/luna-service2-dev/roles.d/${SVC}.service.json`,
  `/var/luna-service2-dev/api-permissions.d/${SVC}.api.json`,
  `/var/luna-service2-dev/api-permissions.d/${SVC}.api.public.json`,
  `/var/luna-service2-dev/client-permissions.d/${SVC}.root.json`,
  `/var/luna-service2-dev/client-permissions.d/${SVC}.service.json`,
  '/var/luna-service2-dev/roles.d/org.jazwinski.customwebos.home.app.json',
  '/var/luna-service2-dev/client-permissions.d/org.jazwinski.customwebos.home.app.json',
  '/var/luna-service2-dev/roles.d/org.jazwinski.customwebos.doorbell.app.json',
  '/var/luna-service2-dev/client-permissions.d/org.jazwinski.customwebos.doorbell.app.json',
  '/var/luna-service2-dev/manifests.d/org.jazwinski.customwebos.home.json',
]

test('register-service.sh --dry-run lists all eleven files and writes nothing', { skip: !SH && 'no sh' }, () => {
  const r = sh(['--dry-run'])
  assert.equal(r.status, 0, r.stderr)
  for (const f of ELEVEN) assert.ok(r.stdout.includes('would write ' + f + ':'), 'missing ' + f)
  assert.match(r.stdout, new RegExp('Exec=/media/developer/apps/usr/palm/services/' + SVC.replace(/\./g, '\\.') + '/run-js-service -n '))
  assert.match(r.stdout, /would run: pkill -SIGHUP ls-hubd/)
  assert.match(r.stdout, /dry run: nothing written/)
})

test('register-service.sh manifest enumerates the other ten files', { skip: !SH && 'no sh' }, () => {
  const r = sh(['--dry-run'])
  const line = r.stdout.split('\n').find((l) => l.startsWith('{"id":"org.jazwinski.customwebos.home"'))
  const manifest = JSON.parse(line)
  const listed = [...manifest.serviceFiles, ...manifest.roleFiles, ...manifest.apiPermissionFiles, ...manifest.clientPermissionFiles]
  assert.deepEqual(listed.sort(), ELEVEN.slice(0, 10).sort())
  assert.ok(manifest.version, 'manifest has a version')
})

test('register-service.sh --system-wrapper points Exec at the stock run-js-service', { skip: !SH && 'no sh' }, () => {
  const r = sh(['--dry-run', '--system-wrapper'])
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /Exec=\/usr\/bin\/run-js-service -n /)
})

test('register-service.sh --unregister --dry-run would remove all eleven files', { skip: !SH && 'no sh' }, () => {
  const r = sh(['--unregister', '--dry-run'])
  assert.equal(r.status, 0, r.stderr)
  for (const f of ELEVEN) assert.ok(r.stdout.includes('would remove ' + f), 'missing ' + f)
  assert.doesNotMatch(r.stdout, /would write/)
})

test('register-service.sh grants the webapp (<appId>-*) public + the service group', { skip: !SH && 'no sh' }, () => {
  // Without these the webapp's calls fail with -1031 "not privileged" (seen on-device).
  const r = sh(['--dry-run'])
  const written = (f) => JSON.parse(r.stdout.split('would write ' + f + ':\n')[1].split('\n')[0])
  const role = written('/var/luna-service2-dev/roles.d/org.jazwinski.customwebos.home.app.json')
  assert.equal(role.appId, 'org.jazwinski.customwebos.home')
  assert.deepEqual(role.allowedNames, ['org.jazwinski.customwebos.home-*'])
  const client = written('/var/luna-service2-dev/client-permissions.d/org.jazwinski.customwebos.home.app.json')
  assert.deepEqual(client, {'org.jazwinski.customwebos.home-*': ['public', SVC + '.group']})
  const api = written(`/var/luna-service2-dev/api-permissions.d/${SVC}.api.json`)
  assert.ok(api[SVC + '.group'], 'the group granted to the webapp must exist')
})

test('register-service.sh rejects unknown arguments', { skip: !SH && 'no sh' }, () => {
  const r = sh(['--bogus'])
  assert.equal(r.status, 2)
})

test('shell files that run on the TV are LF-only', () => {
  for (const f of ['scripts/register-service.sh', 'scripts/remoteview.sh', `services/${SVC}/run-js-service`]) {
    assert.ok(!fs.readFileSync(path.join(ROOT, f), 'utf8').includes('\r'), f + ' has CRLF')
  }
})

test('PowerShell scripts get -WhatIf from SupportsShouldProcess, not a hand-rolled switch', () => {
  for (const f of ['package.ps1', 'install.ps1', 'register-service.ps1', 'remoteview.ps1', 'inputhook-patch.ps1', 'doorbell.ps1']) {
    const src = fs.readFileSync(path.join(SCRIPTS, f), 'utf8')
    assert.match(src, /\[CmdletBinding\([^)]*SupportsShouldProcess/, f)
    assert.doesNotMatch(src, /\[switch\]\$WhatIf/, f)
    assert.match(src, /\$PSCmdlet\.ShouldProcess\(/, f)
  }
})

test('perf.ps1 -WhatIf prints the close, launch, wait and read commands', { skip: !PS && 'no PowerShell' }, () => {
  const r = ps('perf.ps1', ['-TvHost', '192.0.2.1', '-WhatIf'])
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /closeByAppId/)
  assert.ok(r.stdout.includes('"perf":{"action":"right","steps":40,"intervalMs":80}'), r.stdout)
  assert.match(r.stdout, /cat \/tmp\/customwebos-perf\.json/)
  assert.doesNotMatch(r.stdout, /^running:/m)
})

test('perf.ps1 -View all asks the app to open All apps first', { skip: !PS && 'no PowerShell' }, () => {
  const r = ps('perf.ps1', ['-TvHost', '192.0.2.1', '-Action', 'down', '-View', 'all', '-WhatIf'])
  assert.equal(r.status, 0, r.stderr)
  assert.ok(r.stdout.includes('"perf":{"action":"down","steps":40,"intervalMs":80,"view":"all"}'), r.stdout)
})

test('perf.ps1 waits for the bus to answer before relaunching the app', { skip: !PS && 'no PowerShell' }, () => {
  // A close or launch sent while luna-send can't get an answer is silently
  // lost (docs/tv-log.md), so the script checks first.
  const out = ps('perf.ps1', ['-TvHost', '192.0.2.1', '-WhatIf']).stdout
  const ready = out.indexOf('getForegroundAppInfo')
  assert.ok(ready > -1, out)
  assert.ok(ready < out.indexOf('closeByAppId'), 'readiness check comes first')
  assert.match(out, /bus not answering/)
})

test('perf.ps1 gives every luna-send /dev/null as stdin', { skip: !PS && 'no PowerShell' }, () => {
  // The script reaches the TV on sh's stdin; luna-send reading that pipe
  // returns nothing with rc 0 (seen on-device 2026-10-25).
  const out = ps('perf.ps1', ['-TvHost', '192.0.2.1', '-WhatIf']).stdout
  const lines = out.split(/\r?\n/).filter((l) => l.includes('luna-send'))
  assert.ok(lines.length >= 3, out)
  for (const l of lines) {
    assert.equal(l.split('< /dev/null').length, l.split('luna-send').length, l)
  }
})

test('build-native.ps1 -WhatIf prints docker build and run, builds nothing', { skip: !PS && 'no PowerShell' }, () => {
  const native = path.join(DIST, 'native')
  const before = fs.existsSync(native) ? fs.readdirSync(native) : null
  const r = ps('build-native.ps1', ['-WhatIf'])
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /docker build/)
  assert.match(r.stdout, /customwebos-remoteview-build/)
  assert.match(r.stdout, /dist[\/]native[\/]remoteview/)
  const after = fs.existsSync(native) ? fs.readdirSync(native) : null
  assert.deepEqual(after, before)
})

test('remoteview.ps1 -WhatIf installs the hook over ssh', { skip: !PS && 'no PowerShell' }, () => {
  const r = ps('remoteview.ps1', ['-TvHost', '192.0.2.1', '-WhatIf'])
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /customwebos-remoteview/)
  assert.match(r.stdout, /tr -d/)
  assert.match(r.stdout, /chmod 755/)
  assert.match(r.stdout, /-p 22022/)
  assert.doesNotMatch(r.stdout, /^running:/m)
})

test('remoteview.ps1 -Remove -WhatIf stops with SIGINT', { skip: !PS && 'no PowerShell' }, () => {
  const r = ps('remoteview.ps1', ['-TvHost', '192.0.2.1', '-Remove', '-WhatIf'])
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /kill -INT/)
  assert.match(r.stdout, /rm -f \/var\/lib\/webosbrew\/init\.d\/customwebos-remoteview/)
})

test('remoteview.ps1 -SetPassword -WhatIf names --store-password and asks nothing', { skip: !PS && 'no PowerShell' }, () => {
  const r = ps('remoteview.ps1', ['-TvHost', '192.0.2.1', '-SetPassword', '-WhatIf'])
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /--store-password/)
  assert.match(r.stdout, /password\.txt/)
  assert.doesNotMatch(r.stdout, /VNC password:/)
})

test('remoteview.ps1 -Pair -WhatIf names --pair', { skip: !PS && 'no PowerShell' }, () => {
  const r = ps('remoteview.ps1', ['-TvHost', '192.0.2.1', '-Pair', '-WhatIf'])
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /remoteview --pair/)
})

test('wallpapers.ps1 -WhatIf prints the docker render without running it', { skip: !PS && 'no PowerShell' }, () => {
  const r = ps('wallpapers.ps1', ['-WhatIf'])
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /docker/)
  assert.match(r.stdout, /morphogenesis-l\.svg/)
  assert.match(r.stdout, /morphogenesis-d\.svg/)
  assert.match(r.stdout, /1920x1080/)
  assert.match(r.stdout, /-dock/)
})

test('perf.ps1 -Theme light -WhatIf forces the mode in the launch params', { skip: !PS && 'no PowerShell' }, () => {
  const r = ps('perf.ps1', ['-TvHost', '192.0.2.1', '-Theme', 'light', '-WhatIf'])
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /"theme":"light"/)
  assert.match(r.stdout, /"perf":\{/)
})

test('register-service.sh grants the doorbell box (<appId>-*) the service group too', { skip: !SH && 'no sh' }, () => {
  const r = sh(['--dry-run'])
  const written = (f) => JSON.parse(r.stdout.split('would write ' + f + ':\n')[1].split('\n')[0])
  const role = written('/var/luna-service2-dev/roles.d/org.jazwinski.customwebos.doorbell.app.json')
  assert.equal(role.appId, 'org.jazwinski.customwebos.doorbell')
  assert.deepEqual(role.allowedNames, ['org.jazwinski.customwebos.doorbell-*'])
  const client = written('/var/luna-service2-dev/client-permissions.d/org.jazwinski.customwebos.doorbell.app.json')
  assert.deepEqual(client, { 'org.jazwinski.customwebos.doorbell-*': ['public', SVC + '.group'] })
})

// Doorbell (M4): a second app, packaged and installed next to home.
test('package.ps1 -WhatIf also packages the doorbell box', { skip: !PS && 'no PowerShell' }, () => {
  const r = ps('package.ps1', ['-WhatIf'])
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /would run: ares-package "[^"]*dist[\\/]stage[\\/]doorbell" -o /)
})

test('install.ps1 -TvHost -WhatIf installs the doorbell .ipk too', { skip: !PS && 'no PowerShell' }, () => {
  const createdDist = !fs.existsSync(DIST)
  fs.mkdirSync(DIST, { recursive: true })
  const stubs = ['org.jazwinski.customwebos.home_9.9.9-test_all.ipk', 'org.jazwinski.customwebos.doorbell_9.9.9-test_all.ipk'].map((n) => path.join(DIST, n))
  for (const s of stubs) fs.writeFileSync(s, 'stub')
  try {
    const r = ps('install.ps1', ['-TvHost', '192.0.2.1', '-WhatIf'])
    assert.equal(r.status, 0, r.stderr)
    assert.match(r.stdout, /scp .*doorbell_9\.9\.9-test_all\.ipk" root@192\.0\.2\.1:\/tmp\//)
    const ssh = r.stdout.split(/\r?\n/).find((l) => l.startsWith('would run: ssh'))
    assert.equal(ssh.split('ApplicationInstallerUtility -c install -t developer').length - 1, 2)
    assert.match(ssh, /\/tmp\/org\.jazwinski\.customwebos\.doorbell_9\.9\.9-test_all\.ipk/)
    // The doorbell is often already at its version (opkg refuses); only home decides rc.
    assert.equal(ssh.split('rc=').length - 1, 1)
  } finally {
    for (const s of stubs) fs.rmSync(s)
    if (createdDist) fs.rmSync(DIST, { recursive: true })
  }
})

test('doorbell.ps1 -Ring -WhatIf launches the box over ssh', { skip: !PS && 'no PowerShell' }, () => {
  const r = ps('doorbell.ps1', ['-TvHost', '192.0.2.1', '-Ring', '-WhatIf'])
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /ssh -p 22022 /)
  assert.match(r.stdout, /luna-send -n 1 luna:\/\/com\.webos\.applicationManager\/launch/)
  assert.match(r.stdout, /org\.jazwinski\.customwebos\.doorbell/)
  assert.match(r.stdout, /< \/dev\/null/)
})

test('doorbell.ps1 -Configure checks the settings before sending them', { skip: !PS && 'no PowerShell' }, () => {
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'cwo-doorbell-'))
  const bad = path.join(dir, 'bad.json')
  const good = path.join(dir, 'good.json')
  fs.writeFileSync(bad, JSON.stringify({ cameraMode: 'mjpeg' }))
  fs.writeFileSync(good, JSON.stringify({ cameraUrl: 'http://192.0.2.9:8099/mjpeg', cameraMode: 'mjpeg', doorUrl: 'http://192.0.2.9:8099/door' }))
  try {
    const r = ps('doorbell.ps1', ['-TvHost', '192.0.2.1', '-Configure', '-ConfigPath', bad, '-WhatIf'])
    assert.notEqual(r.status, 0)
    assert.match(r.stdout + r.stderr, /cameraUrl/)
    const mode = ps('doorbell.ps1', ['-TvHost', '192.0.2.1', '-Configure', '-ConfigPath', bad.replace('bad', 'mode'), '-WhatIf'])
    assert.notEqual(mode.status, 0)
    const ok = ps('doorbell.ps1', ['-TvHost', '192.0.2.1', '-Configure', '-ConfigPath', good, '-WhatIf'])
    assert.equal(ok.status, 0, ok.stderr)
    assert.match(ok.stdout, /mkdir -p \/var\/lib\/customwebos/)
    assert.match(ok.stdout, /\/var\/lib\/customwebos\/doorbell\.json/)
  } finally {
    fs.rmSync(dir, { recursive: true })
  }
})

test('register-service.sh keeps openDoor and doorbellConfig off the public API', { skip: !SH && 'no sh' }, () => {
  // Review finding: with "$SVC/*" public, any app on the TV could open the door.
  const r = sh(['--dry-run'])
  const written = (f) => JSON.parse(r.stdout.split('would write ' + f + ':\n')[1].split('\n')[0])
  const pub = written(`/var/luna-service2-dev/api-permissions.d/${SVC}.api.public.json`).public
  assert.deepEqual(pub.sort(), ['listApps', 'launch', 'perfReport', 'listPhotos', 'showEnded'].map((m) => `${SVC}/${m}`).sort())
  assert.deepEqual(written(`/var/luna-service2-dev/api-permissions.d/${SVC}.api.json`), { [`${SVC}.group`]: [`${SVC}/*`] })
})

test('doorbell.ps1 -Configure rejects a doorUrl that isn\'t http(s)', { skip: !PS && 'no PowerShell' }, () => {
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'cwo-doorbell-'))
  const f = path.join(dir, 'd.json')
  fs.writeFileSync(f, JSON.stringify({ cameraUrl: 'http://cam/mjpeg', cameraMode: 'mjpeg', doorUrl: 'ftp://ha/hook' }))
  try {
    const r = ps('doorbell.ps1', ['-TvHost', '192.0.2.1', '-Configure', '-ConfigPath', f, '-WhatIf'])
    assert.notEqual(r.status, 0)
    assert.match(r.stdout + r.stderr, /doorUrl/)
  } finally {
    fs.rmSync(dir, { recursive: true })
  }
})
