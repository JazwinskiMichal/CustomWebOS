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
const NINE = [
  `/var/luna-service2-dev/services.d/${SVC}.service`,
  `/var/luna-service2-dev/roles.d/${SVC}.service.json`,
  `/var/luna-service2-dev/api-permissions.d/${SVC}.api.json`,
  `/var/luna-service2-dev/api-permissions.d/${SVC}.api.public.json`,
  `/var/luna-service2-dev/client-permissions.d/${SVC}.root.json`,
  `/var/luna-service2-dev/client-permissions.d/${SVC}.service.json`,
  '/var/luna-service2-dev/roles.d/org.jazwinski.customwebos.home.app.json',
  '/var/luna-service2-dev/client-permissions.d/org.jazwinski.customwebos.home.app.json',
  '/var/luna-service2-dev/manifests.d/org.jazwinski.customwebos.home.json',
]

test('register-service.sh --dry-run lists all nine files and writes nothing', { skip: !SH && 'no sh' }, () => {
  const r = sh(['--dry-run'])
  assert.equal(r.status, 0, r.stderr)
  for (const f of NINE) assert.ok(r.stdout.includes('would write ' + f + ':'), 'missing ' + f)
  assert.match(r.stdout, new RegExp('Exec=/media/developer/apps/usr/palm/services/' + SVC.replace(/\./g, '\\.') + '/run-js-service -n '))
  assert.match(r.stdout, /would run: pkill -SIGHUP ls-hubd/)
  assert.match(r.stdout, /dry run: nothing written/)
})

test('register-service.sh manifest enumerates the other eight files', { skip: !SH && 'no sh' }, () => {
  const r = sh(['--dry-run'])
  const line = r.stdout.split('\n').find((l) => l.startsWith('{"id":"org.jazwinski.customwebos.home"'))
  const manifest = JSON.parse(line)
  const listed = [...manifest.serviceFiles, ...manifest.roleFiles, ...manifest.apiPermissionFiles, ...manifest.clientPermissionFiles]
  assert.deepEqual(listed.sort(), NINE.slice(0, 8).sort())
  assert.ok(manifest.version, 'manifest has a version')
})

test('register-service.sh --system-wrapper points Exec at the stock run-js-service', { skip: !SH && 'no sh' }, () => {
  const r = sh(['--dry-run', '--system-wrapper'])
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /Exec=\/usr\/bin\/run-js-service -n /)
})

test('register-service.sh --unregister --dry-run would remove all nine files', { skip: !SH && 'no sh' }, () => {
  const r = sh(['--unregister', '--dry-run'])
  assert.equal(r.status, 0, r.stderr)
  for (const f of NINE) assert.ok(r.stdout.includes('would remove ' + f), 'missing ' + f)
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
  for (const f of ['scripts/register-service.sh', `services/${SVC}/run-js-service`]) {
    assert.ok(!fs.readFileSync(path.join(ROOT, f), 'utf8').includes('\r'), f + ' has CRLF')
  }
})

test('PowerShell scripts get -WhatIf from SupportsShouldProcess, not a hand-rolled switch', () => {
  for (const f of ['package.ps1', 'install.ps1', 'register-service.ps1']) {
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

test('perf.ps1 waits for the bus to answer before relaunching the app', { skip: !PS && 'no PowerShell' }, () => {
  // A close or launch sent while luna-send can't get an answer is silently
  // lost (docs/m2-tracking.md), so the script checks first.
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
