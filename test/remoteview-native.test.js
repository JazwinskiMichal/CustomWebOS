// Host unit tests for native/remoteview, run in the Docker build image.
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const SCRIPT = path.join(__dirname, '..', 'scripts', 'build-native.ps1')
const onPath = (cmd, args) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8' })
  return !r.error && r.status === 0
}
const PS = ['pwsh', 'powershell'].find((c) => onPath(c, ['-NoProfile', '-Command', 'exit 0']))
const dockerRunning = onPath('docker', ['info'])

test('native host unit tests pass', { skip: (!dockerRunning && 'no docker') || (!PS && 'no PowerShell'), timeout: 15 * 60 * 1000 }, () => {
  const r = spawnSync(PS, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT, '-Test'], { encoding: 'utf8' })
  assert.equal(r.status, 0, r.stdout + r.stderr)
})
