// Prints the calibration page's clicks. On-TV use (owner's go-ahead):
//   1. node native/remoteview/calib/listen.mjs
//   2. back up the home app's index.html on the TV, copy index.html over it with
//      __LOG__ replaced by http://<pc-ip>:8765/hit, relaunch the app;
//   3. run `remoteview --input-test`; 4. restore the backup and relaunch.
import http from 'node:http';

http.createServer((req, res) => {
  const q = new URL(req.url, 'http://x').searchParams;
  console.log(Object.fromEntries(q));
  res.writeHead(204, { 'Access-Control-Allow-Origin': '*' }).end();
}).listen(8765, () => console.log('listening on :8765'));
