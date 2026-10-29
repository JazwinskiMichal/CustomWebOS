// Fake doorbell camera and door for testing the box on the TV without
// hardware. Cycles the wallpaper JPEGs; logs every request.
//
//   node dev/fake-camera.mjs [port]      (default 8099, all interfaces)
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
const current = () => frames[Math.floor(Date.now() / 1000) % frames.length]
const log = (msg) => console.log(new Date().toISOString(), msg)

const server = http.createServer((req, res) => {
  log(`${req.socket.remoteAddress} ${req.method} ${req.url}`)
  const url = req.url.split('?')[0]
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

const port = Number(process.argv[2]) || 8099
server.listen(port, () => log(`fake camera on port ${port}: /mjpeg /frame.jpg POST /door`))
