// Fake doorbell camera and door for testing the box on the TV without
// doorbell hardware. Cycles the wallpaper JPEGs, or with --webcam streams the
// PC's webcam (a headless Chromium grabs it; VLC's DirectShow capture hung on
// a PC-LM1E). Logs every request.
//
//   node dev/fake-camera.mjs [port] [--webcam ["<camera name>"]]   (default 8099)
//   GET  /mjpeg      multipart MJPEG at 5 fps   -> cameraMode "mjpeg"
//   GET  /frame.jpg  the current frame          -> cameraMode "snapshot"
//   POST /door       logs "door opened", 200    -> doorUrl
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIR = path.join(ROOT, 'home', 'assets', 'wallpapers')
const frames = fs.readdirSync(DIR).filter((f) => f.endsWith('.jpg')).map((f) => fs.readFileSync(path.join(DIR, f)))
const FPS = 5
const args = process.argv.slice(2)
const webcamAt = args.indexOf('--webcam')
const webcamName = webcamAt >= 0 && args[webcamAt + 1] && !args[webcamAt + 1].startsWith('--') ? args[webcamAt + 1] : ''
let webcamFrame = null
const current = () => webcamFrame || frames[Math.floor(Date.now() / 1000) % frames.length]

// The capture page: webcam -> canvas -> JPEG, POSTed to /frame FPS times a second.
const CAPTURE_PAGE = `<!doctype html><video autoplay muted playsinline></video><canvas></canvas><script>
(async () => {
  const want = ${JSON.stringify(webcamName)}
  const devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput')
  const dev = devices.find((d) => want && d.label.includes(want)) || devices[0]
  const stream = await navigator.mediaDevices.getUserMedia({ video: { deviceId: dev && dev.deviceId, width: 640, height: 360 } })
  const video = document.querySelector('video'); video.srcObject = stream; await video.play()
  const canvas = document.querySelector('canvas'); canvas.width = 640; canvas.height = 360
  const ctx = canvas.getContext('2d')
  console.log('webcam: ' + (dev ? dev.label : '?'))
  setInterval(() => {
    ctx.drawImage(video, 0, 0, 640, 360)
    canvas.toBlob((b) => fetch('/frame', { method: 'POST', body: b }), 'image/jpeg', 0.8)
  }, 1000 / ${FPS})
})().catch((e) => console.log('webcam error: ' + e))
</script>`
const log = (msg) => console.log(new Date().toISOString(), msg)

const server = http.createServer((req, res) => {
  if (req.url !== '/frame') log(`${req.socket.remoteAddress} ${req.method} ${req.url}`)
  const url = req.url.split('?')[0]
  if (url === '/frame' && req.method === 'POST') {
    const parts = []
    req.on('data', (c) => parts.push(c))
    req.on('end', () => { webcamFrame = Buffer.concat(parts); res.writeHead(204); res.end() })
    return
  }
  if (url === '/capture') {
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end(CAPTURE_PAGE)
    return
  }
  if (url === '/door' && req.method === 'POST') {
    log('door opened')
    res.writeHead(200, { 'content-type': 'text/plain' })
    res.end('ok')
  } else if (url === '/frame.jpg') {
    res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'no-store' })
    res.end(current())
  } else if (url === '/mjpeg') {
    res.writeHead(200, { 'content-type': 'multipart/x-mixed-replace; boundary=frame', 'cache-control': 'no-store' })
    const send = () => {
      const jpg = current()
      res.write(`--frame\r\ncontent-type: image/jpeg\r\ncontent-length: ${jpg.length}\r\n\r\n`)
      res.write(jpg)
      res.write('\r\n')
    }
    send()
    const timer = setInterval(send, 1000 / FPS)
    req.on('close', () => clearInterval(timer))
  } else {
    res.writeHead(404)
    res.end()
  }
})

const port = Number(args[0]) || 8099
server.listen(port, async () => {
  log(`fake camera on port ${port}: /mjpeg /frame.jpg POST /door`)
  if (webcamAt < 0) return
  const { chromium } = await import('playwright')
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream'] })
  const page = await browser.newPage()
  page.on('console', (m) => log(m.text()))
  await page.context().grantPermissions(['camera'], { origin: `http://127.0.0.1:${port}` })
  await page.goto(`http://127.0.0.1:${port}/capture`)
})
