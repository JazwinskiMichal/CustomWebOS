// Browser preview for the home app (/) and the doorbell box (/doorbell/).
// Serves home/ and doorbell/ unmodified, except that each index.html gets dev/mock-bridge.js injected before main.js so luna calls
// hit a fake WebOSServiceBridge. Loopback only; never contacts the TV.
//
//   npm run dev            -> http://127.0.0.1:4795/
//   npm run dev -- 5000    -> custom port
import http from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const HOME_DIR = path.join(ROOT, 'home')
const DOORBELL_DIR = path.join(ROOT, 'doorbell')
const DOORBELL_PREFIX = '/doorbell/'
const DEV_DIR = path.join(ROOT, 'dev')
const DEV_PREFIX = '/__dev/'
const MOCK_TAG = '<script src="/__dev/mock-bridge.js"></script>'

export const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
}

// Maps a request path to a file under home/, doorbell/ or dev/, or null if it
// would escape them.
function resolveFile(urlPath) {
  let decoded
  try { decoded = decodeURIComponent(urlPath.split('?')[0]) } catch { return null }
  const [base, rel] = decoded.startsWith(DEV_PREFIX)
    ? [DEV_DIR, decoded.slice(DEV_PREFIX.length)]
    : decoded.startsWith(DOORBELL_PREFIX)
      ? [DOORBELL_DIR, decoded.slice(DOORBELL_PREFIX.length) || 'index.html']
      : [HOME_DIR, decoded.replace(/^\/+/, '') || 'index.html']
  const file = path.resolve(base, rel)
  return file.startsWith(base + path.sep) ? file : null
}

async function handle(req, res) {
  const file = resolveFile(req.url)
  let body
  try {
    body = file && await fs.readFile(file)
  } catch {
    body = null
  }
  if (!body) {
    res.writeHead(404, { 'content-type': 'text/plain' })
    res.end('not found')
    return
  }
  if (file === path.join(HOME_DIR, 'index.html') || file === path.join(DOORBELL_DIR, 'index.html')) {
    body = body.toString('utf8').replace('<script src="main.js">', MOCK_TAG + '\n  <script src="main.js">')
  }
  res.writeHead(200, {
    'content-type': TYPES[path.extname(file)] || 'application/octet-stream',
    'cache-control': 'no-store',
  })
  res.end(body)
}

export function startDevServer({ port = 4795, host = '127.0.0.1' } = {}) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      handle(req, res).catch(() => { res.writeHead(500); res.end() })
    })
    server.once('error', reject)
    server.listen(port, host, () => {
      const url = `http://${host}:${server.address().port}/`
      resolve({ url, close: () => new Promise((done) => server.close(() => done())) })
    })
  })
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.argv[2]) || 4795
  const { url } = await startDevServer({ port })
  console.log(`CustomWebOS preview: ${url}  (?mock=ok|slow|error|empty)`)
}
