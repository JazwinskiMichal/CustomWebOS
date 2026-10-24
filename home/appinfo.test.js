const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const appinfo = JSON.parse(fs.readFileSync(path.join(__dirname, 'appinfo.json'), 'utf8'))

test('appinfo.id matches namespace and is the home app', () => {
  assert.match(appinfo.id, /^org\.jazwinski\.customwebos\.[a-z]+$/)
  assert.equal(appinfo.id, 'org.jazwinski.customwebos.home')
})

test('appinfo has required webOS fields', () => {
  for (const field of ['id', 'title', 'type', 'main', 'vendor', 'version', 'icon']) {
    assert.ok(appinfo[field], `missing field: ${field}`)
  }
  assert.equal(appinfo.type, 'web')
  assert.equal(appinfo.main, 'index.html')
})

test('index.html references style.css and main.js', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8')
  assert.match(html, /href=["']style\.css["']/)
  assert.match(html, /src=["']main\.js["']/)
})

test('icon.png exists and is a PNG', () => {
  const buf = fs.readFileSync(path.join(__dirname, 'icon.png'))
  assert.deepEqual(buf.subarray(0, 8), Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]))
})
