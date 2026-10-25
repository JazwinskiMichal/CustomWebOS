// Bundled assets and their records: every logo the app maps exists, every
// shipped file has a source/licence record, and the README credits them.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const main = require('../home/main.js')

const ROOT = path.join(__dirname, '..')
const ASSETS = path.join(ROOT, 'home', 'assets')
const ICONS = path.join(ASSETS, 'icons')
const WALLS = path.join(ASSETS, 'wallpapers')

function config() {
  const sandbox = {}
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'home', 'config.js'), 'utf8'), sandbox)
  return sandbox
}

test('every mapped logo is bundled', () => {
  for (const stem of Object.values(main.APP_LOGOS)) {
    assert.ok(fs.existsSync(path.join(ICONS, stem + '.svg')), 'missing assets/icons/' + stem + '.svg')
  }
})

test('every bundled logo has a source record', () => {
  const sources = JSON.parse(fs.readFileSync(path.join(ICONS, 'SOURCES.json'), 'utf8'))
  for (const f of fs.readdirSync(ICONS).filter((n) => n.endsWith('.svg'))) {
    const rec = sources[f.replace(/\.svg$/, '')]
    assert.ok(rec && rec.source && rec.licence, 'no source/licence record for ' + f)
  }
})

test('the configured wallpaper and its dock material are bundled', () => {
  const name = config().HOME_WALLPAPER
  assert.ok(fs.existsSync(path.join(WALLS, name + '.jpg')), name + '.jpg')
  assert.ok(fs.existsSync(path.join(WALLS, name + '-dock.jpg')), name + '-dock.jpg')
})

test('every bundled photo has its photographer and photo page recorded', () => {
  const sources = JSON.parse(fs.readFileSync(path.join(WALLS, 'SOURCES.json'), 'utf8'))
  const photos = fs.readdirSync(WALLS).filter((n) => /\.jpg$/.test(n) && !/-dock\.jpg$/.test(n))
  assert.ok(photos.length >= 1)
  for (const f of photos) {
    const id = f.replace(/\.jpg$/, '')
    const rec = sources.find((s) => s.id === id)
    assert.ok(rec && rec.credit && /^https:\/\/unsplash\.com\/photos\//.test(rec.source), 'no record for ' + f)
    assert.ok(fs.existsSync(path.join(WALLS, id + '-dock.jpg')), id + '-dock.jpg')
  }
})

test('licence texts sit beside the font and the icons', () => {
  // Two subsets; latin-ext carries the Polish letters of the date.
  assert.ok(fs.existsSync(path.join(ASSETS, 'fonts', 'manrope-latin.woff2')))
  assert.ok(fs.existsSync(path.join(ASSETS, 'fonts', 'manrope-latin-ext.woff2')))
  assert.match(fs.readFileSync(path.join(ASSETS, 'fonts', 'OFL.txt'), 'utf8'), /SIL OPEN FONT LICENSE/i)
  assert.match(fs.readFileSync(path.join(ICONS, 'SIMPLE-ICONS-LICENSE.txt'), 'utf8'), /CC0/)
})

test('the README credits the photos, icons and font', () => {
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8')
  for (const name of ['Simple Icons', 'Manrope', 'Unsplash']) assert.ok(readme.includes(name), name)
})
