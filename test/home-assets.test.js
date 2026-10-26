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

const WALL_FILES = ['morphogenesis-day', 'morphogenesis-night']

test("both modes' wallpapers and glass images are bundled within budget", () => {
  for (const stem of WALL_FILES) {
    for (const [file, max] of [[stem + '.jpg', 600 * 1024], [stem + '-dock.jpg', 120 * 1024]]) {
      const buf = fs.readFileSync(path.join(WALLS, file))
      assert.ok(buf[0] === 0xff && buf[1] === 0xd8, file + ' is not a JPEG')
      assert.ok(buf.length <= max, file + ' is ' + buf.length + ' bytes')
    }
  }
  const jpgs = fs.readdirSync(WALLS).filter((n) => n.endsWith('.jpg')).sort()
  assert.deepEqual(jpgs, WALL_FILES.flatMap((s) => [s + '-dock.jpg', s + '.jpg']).sort())
})

test('the wallpaper source and licence are recorded', () => {
  const sources = JSON.parse(fs.readFileSync(path.join(WALLS, 'SOURCES.json'), 'utf8'))
  assert.equal(sources.length, 1)
  const rec = sources[0]
  assert.equal(rec.id, 'morphogenesis')
  assert.match(rec.credit, /Jakub Steiner/)
  assert.equal(rec.licence, 'CC BY-SA 3.0')
  assert.ok(rec.source.startsWith('https://gitlab.gnome.org/GNOME/gnome-backgrounds'))
  assert.match(fs.readFileSync(path.join(WALLS, 'LICENSE.CC-BY-SA-3.0.txt'), 'utf8'), /Attribution-ShareAlike 3\.0/)
})

test('licence texts sit beside the font and the icons', () => {
  // Two subsets; latin-ext carries the Polish letters of the date.
  assert.ok(fs.existsSync(path.join(ASSETS, 'fonts', 'manrope-latin.woff2')))
  assert.ok(fs.existsSync(path.join(ASSETS, 'fonts', 'manrope-latin-ext.woff2')))
  assert.match(fs.readFileSync(path.join(ASSETS, 'fonts', 'OFL.txt'), 'utf8'), /SIL OPEN FONT LICENSE/i)
  assert.match(fs.readFileSync(path.join(ICONS, 'SIMPLE-ICONS-LICENSE.txt'), 'utf8'), /CC0/)
})

test('the README credits the wallpaper, icons and font', () => {
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8')
  for (const name of ['Simple Icons', 'Manrope', 'Morphogenesis', 'CC BY-SA 3.0']) assert.ok(readme.includes(name), name)
})
