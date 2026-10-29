# Doorbell overlay (M4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A ring opens a floating camera box over whatever is on the TV; OK enlarges and centres it, a second OK opens the door, Back closes it.

**Architecture:** A second web app, `org.jazwinski.customwebos.doorbell` (`doorbell/`, floating + transparent), launched by `applicationManager/launch` (from `scripts/doorbell.ps1 -Ring` now, from Home Assistant's `webostv.command` later). It reads its settings from, and sends the door request through, the existing root home service (two new methods), which keeps a JSON file on the TV.

**Tech Stack:** ES5 web app (Chrome 53), Node 0.12 luna service (`webos-service`, `http`/`https`), PowerShell + POSIX sh scripts, `node --test`, Playwright preview tests.

**Spec:** `docs/superpowers/specs/2026-10-29-doorbell-overlay-design.md`

## Global Constraints

- Runtime JS on the TV is ES5 (`test/es5.test.js` must scan `doorbell/` too).
- `doorbell/appinfo.json`: `"id":"org.jazwinski.customwebos.doorbell"`, `"type":"web"`, `"defaultWindowType":"floating"`, `"transparent":true`, `"version":"0.1.0"`.
- Settings file on the TV: `/var/lib/customwebos/doorbell.json`, shape `{"cameraUrl": string, "cameraMode": "mjpeg"|"snapshot", "doorUrl": string (optional)}`. Never in git; the PC copy is `.local/doorbell.json`.
- Box sizes (Claude's call): corner 640×400, 48 px from the right and bottom edges; enlarged 1280×800, centred on the 1920×1080 stage.
- Timers: confirm window 5 s after the first OK; idle close 60 s after the last key press or ring; camera "not responding" after 5 s without a picture; snapshot refresh every 200 ms.
- Keys: OK = 13; Back = 461 (and 27 for the PC preview), Back calls `window.close()`.
- Copy, exact strings: corner hint `OK: open the door · Back: close`; enlarged hint `OK again to open the door`; after the door request `Door opened` (or `Door opened (test)` when no `doorUrl` is set); errors `Camera not responding`, `Camera not set up`, `Door didn't open: <reason>`.
- Scripts are PowerShell-first with `[CmdletBinding(SupportsShouldProcess)]` (`-WhatIf`), `-TvHost`, `-Port 22022`, `-KeyPath ~/.ssh/id_ed25519_lgtv`, like `scripts/inputhook-patch.ps1`.
- Home app version bumps to `0.7.5` (opkg refuses the same version).
- `.local/` and `dist/` are never committed; upstream credit only in the README.

## Review Focus

1. **Settings file missing or broken JSON** → `doorbellConfig` answers `{returnValue:true, config:{}}` and the box shows `Camera not set up`, never a crash or a blank box (Task 1 test, Task 3 test).
2. **Door URL that hangs or refuses** → `openDoor` answers `returnValue:false` within 5 s with a reason; the box shows `Door didn't open: …` and stays usable (Task 1 tests).
3. **Second OK after the 5 s confirm window** → treated as a first OK again (enlarges, no door request) (Task 3 test).
4. **Ring while the box is open** (`webOSRelaunch`) → back to the corner size, picture reloaded, idle timer restarted, no second door request pending (Task 3 test).
5. **Launch params trying to set `doorUrl`** → ignored; only `cameraUrl`/`cameraMode` may be overridden (Task 3 test).

---

### Task 1: Home service — `doorbellConfig` and `openDoor`

**Files:**
- Modify: `services/org.jazwinski.customwebos.home.service/handlers.js`, `service.js` (register both, list them in the header comment)
- Test: `test/service-handlers.test.js`

**Interfaces:**
- Produces: luna methods `luna://org.jazwinski.customwebos.home.service/doorbellConfig` → `{returnValue:true, config:{cameraUrl?, cameraMode?, doorUrl?}}` (`{}` when the file is missing or not JSON); `.../openDoor` → `{returnValue:true, simulated:boolean}` or `{returnValue:false, errorText:string}`.
- `createHandlers(call, writeFile, opts)` gains `opts.doorbellFile` (default `/var/lib/customwebos/doorbell.json`) and `opts.request` (default: a function `(url, cb)` that POSTs an empty body with Node's `http`/`https`, 5 s timeout, `cb(err, statusCode)`). Export `DOORBELL_FILE`.

- [ ] **Step 1: Write the failing tests** (use the file's `fakeFs`/`fakeMessage` helpers)
  - `doorbellConfig returns the file's settings` — file `{"cameraUrl":"http://cam/mjpeg","cameraMode":"mjpeg","doorUrl":"http://ha/hook"}` → `responses[0]` deep-equals `{returnValue:true, config:{cameraUrl:'http://cam/mjpeg', cameraMode:'mjpeg', doorUrl:'http://ha/hook'}}`.
  - `doorbellConfig answers {} when the file is missing` and `… when the file is not JSON` → `{returnValue:true, config:{}}`.
  - `openDoor without doorUrl is simulated` → `{returnValue:true, simulated:true}`, `opts.request` never called.
  - `openDoor posts to doorUrl and reports 2xx` → request called once with `'http://ha/hook'`; status 200 → `{returnValue:true, simulated:false}`.
  - `openDoor reports a non-2xx status` → status 404 → `{returnValue:false, errorText:'HTTP 404'}`.
  - `openDoor reports a request error` → `cb(new Error('timeout'))` → `{returnValue:false, errorText:'timeout'}`.
- [ ] **Step 2: Run** `node --test test/service-handlers.test.js` — Expected: the new tests FAIL (`doorbellConfig is not a function`).
- [ ] **Step 3: Implement** both handlers and the default `request` (Node 0.12: `require(url.indexOf('https:') === 0 ? 'https' : 'http').request(require('url').parse(url) + method POST)`, `req.setTimeout(5000, …)` → `cb(new Error('timeout'))`); register them in `service.js`.
- [ ] **Step 4: Run** `npm test` — Expected: all PASS.
- [ ] **Step 5: Commit** `feat(service): doorbell settings and door request`.

### Task 2: Bus role for the doorbell app

**Files:**
- Modify: `scripts/register-service.sh` (the app-side role and client-permission files, the manifest's lists, `ALL_FILES`)
- Test: `test/scripts.test.js` (the existing `register-service` dry-run tests)

**Interfaces:**
- Produces: `roles.d/org.jazwinski.customwebos.doorbell.app.json` with `allowedNames:["org.jazwinski.customwebos.doorbell-*"]` and `client-permissions.d/org.jazwinski.customwebos.doorbell.app.json` with `{"org.jazwinski.customwebos.doorbell-*":["public","org.jazwinski.customwebos.home.service.group"]}`, both listed in the existing manifest, removed by `--unregister`.

- [ ] **Step 1: Write the failing test** `register-service dry run grants the doorbell app a role` — run the `.sh` with `--dry-run` as the existing tests do; assert the output contains `roles.d/org.jazwinski.customwebos.doorbell.app.json`, `"allowedNames":["org.jazwinski.customwebos.doorbell-*"]`, and the manifest line contains both app role files. And `--unregister --dry-run` prints `would remove …/org.jazwinski.customwebos.doorbell.app.json` twice (roles.d and client-permissions.d).
- [ ] **Step 2: Run** `node --test test/scripts.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement:** loop the two app-side writes over `org.jazwinski.customwebos.home org.jazwinski.customwebos.doorbell`; the header comment says eleven files.
- [ ] **Step 4: Run** `npm test` — Expected: all PASS.
- [ ] **Step 5: Commit** `feat(register): bus role for the doorbell app`.

### Task 3: The doorbell app and its preview

**Files:**
- Create: `doorbell/appinfo.json`, `doorbell/index.html`, `doorbell/main.js`, `doorbell/style.css`, `doorbell/icon.png` (copy of `home/icon.png`)
- Modify: `scripts/dev-server.mjs` (serve `/doorbell/…` from `doorbell/`, inject the mock bridge into `doorbell/index.html` the same way), `dev/mock-bridge.js` (answer `doorbellConfig` and `openDoor`), `test/es5.test.js` (scan `doorbell/`), `test/dev-server.test.js`
- Create: `dev/fixtures/camera.jpg` (any small JPEG, e.g. a downscaled wallpaper)
- Test: `browser-tests/doorbell.spec.mjs`

**Interfaces:**
- Consumes: Task 1's methods.
- Launch params (and `webOSRelaunch` detail): optional `cameraUrl`, `cameraMode`; any other key ignored.
- Mock modes (`?mock=`): `ok` (config `{cameraUrl:'/__dev/fixtures/camera.jpg', cameraMode:'snapshot'}`, openDoor simulated), `door` (as ok + `doorUrl`, openDoor `simulated:false`), `doorfail` (openDoor `{returnValue:false, errorText:'HTTP 500'}`), `nocamera` (config `{}`), `deadcamera` (cameraUrl to a 404 path). `window.__mock.openDoor` counts calls; `window.__closed` is set by a stubbed `window.close` in the mock.

- [ ] **Step 1: Write the failing browser tests** in `browser-tests/doorbell.spec.mjs` (1920×1080 viewport, page clock installed where timers matter):
  - `box starts in the corner with the camera picture` — `.box` bounding box is 640×400 at x=1232, y=632; its `img` has loaded (`naturalWidth > 0`); hint text `OK: open the door · Back: close`.
  - `first OK enlarges and centres the box` — press Enter → box 1280×800 at x=320, y=140; hint `OK again to open the door`; `__mock.openDoor === 0`.
  - `second OK within 5 s opens the door` — Enter, Enter → `__mock.openDoor === 1`, text `Door opened (test)`; with `?mock=door` the text is `Door opened`.
  - `second OK after 5 s only enlarges again` — Enter, `clock.runFor(5100)` → back to 640×400; Enter → 1280×800, `__mock.openDoor === 0`.
  - `door failure is shown` — `?mock=doorfail`, Enter, Enter → `Door didn't open: HTTP 500`.
  - `Back closes the box` — Escape → `__closed === true`.
  - `the box closes after 60 s idle` — `clock.runFor(60100)` → `__closed === true`; a key press at 59 s restarts it (not closed at 60.1 s).
  - `missing settings say so` — `?mock=nocamera` → `Camera not set up`.
  - `dead camera says so` — `?mock=deadcamera`, `clock.runFor(5100)` → `Camera not responding`.
  - `a ring while open resets the box` — Enter (enlarged), dispatch `webOSRelaunch` with `{cameraUrl:'/__dev/fixtures/camera.jpg'}` → 640×400, no pending confirm (next Enter enlarges, no door call).
  - `launch params cannot set the door URL` — open with launch params `{doorUrl:'http://evil/'}` (the mock exposes them as `PalmSystem.launchParams`) → Enter, Enter → mock received `openDoor` with no `doorUrl` in its payload.
- [ ] **Step 2: Run** `npm run check:browser` — Expected: the doorbell tests FAIL (404 for `/doorbell/`).
- [ ] **Step 3: Implement** the app: transparent `body`, one `.box` (glass look from `home/style.css`), `img` for the camera (`mjpeg` = `src` once; `snapshot` = new `src` with `?t=` every 200 ms after each load), a hint line, a status line. `lunaCall` copied from `home/main.js` (same bridge, same 10 s timeout). Settings: `doorbellConfig`, then launch-param overrides for `cameraUrl`/`cameraMode` only. `openDoor` is called with `{}`. Then the dev-server routing, mock answers and fixture.
- [ ] **Step 4: Run** `npm test` and `npm run check:browser` — Expected: all PASS (the known flaky "moving in the grid does not rebuild it" may need a rerun).
- [ ] **Step 5: Commit** `feat(doorbell): floating camera box with OK-OK door and Back`.

### Task 4: Packaging, install, ringing and settings

**Files:**
- Modify: `scripts/package.ps1` (a second `ares-package dist/stage/doorbell -o dist/`), `scripts/install.ps1` (install the newest `org.jazwinski.customwebos.home*.ipk` and the newest `org.jazwinski.customwebos.doorbell*.ipk`; doorbell optional with a warning if missing), `home/appinfo.json` (0.7.5)
- Create: `scripts/doorbell.ps1`, `dev/fake-camera.mjs`
- Test: `test/scripts.test.js`

**Interfaces:**
- `doorbell.ps1 -TvHost <ip> -Ring` → over SSH: `luna-send -n 1 luna://com.webos.applicationManager/launch '{"id":"org.jazwinski.customwebos.doorbell"}' < /dev/null`.
- `doorbell.ps1 -TvHost <ip> -Configure [-ConfigPath .local/doorbell.json]` → validates the JSON (`cameraUrl` required, `cameraMode` `mjpeg`|`snapshot`), `mkdir -p /var/lib/customwebos` and writes `/var/lib/customwebos/doorbell.json` (stdin over SSH, CR stripped as in `inputhook-patch.ps1`).
- `node dev/fake-camera.mjs [port=8099]` → `/mjpeg` (multipart, 5 fps, cycles `home/assets/wallpapers/*.jpg`), `/frame.jpg`, `POST /door` (logs "door opened", 200), logs every request.

- [ ] **Step 1: Write the failing tests:** `package.ps1 -WhatIf` prints `would run: ares-package "…dist/stage/doorbell" -o …`; `install.ps1 -TvHost 192.0.2.1 -WhatIf` mentions both ipk patterns; `doorbell.ps1 -TvHost 192.0.2.1 -Ring -WhatIf` prints the luna-send line with `org.jazwinski.customwebos.doorbell`; `-Configure -ConfigPath <tmp file without cameraUrl> -WhatIf` exits non-zero with `cameraUrl`; add `doorbell.ps1` to the SupportsShouldProcess list; `home appinfo is 0.7.5`.
- [ ] **Step 2: Run** `npm test` — Expected: the new tests FAIL.
- [ ] **Step 3: Implement** the scripts and the fake camera (the fake camera has no test; it's dev tooling).
- [ ] **Step 4: Run** `npm test` — Expected: all PASS.
- [ ] **Step 5: Commit** `feat(scripts): package, install, ring and configure the doorbell`.

### Task 5: On the TV and docs (needs Michał's go-ahead)

**Files:**
- Modify: `README.md` (Features: "Doorbell overlay (proof of concept)": what it does, `doorbell.ps1 -Configure` / `-Ring`, the fake camera, keys, HA's `webostv.command` example as "to be verified"), `docs/status.md` (M4 state, version), `docs/tv-notes.md` (window types: only `floating` stays; one video decoder; a source change closes floating windows), `docs/tv-log.md` (the on-TV results), `docs/development.md` (fake camera)

- [ ] **Step 1:** With Michał's go-ahead: package, install with `-Reboot` (first install of the new app id), `register-service.ps1` (the new role files), open VNC, start `dev/fake-camera.mjs`, write `.local/doorbell.json` pointing at it (`cameraMode: mjpeg`, `doorUrl: http://<pc>:8099/door`), `doorbell.ps1 -Configure`.
- [ ] **Step 2:** Ring over Netflix, Live TV and HDMI 1. Expected: box in the corner, moving picture, the app underneath keeps playing; OK enlarges and centres; OK again → fake camera logs `door opened`, box shows `Door opened`; Back closes; a ring left alone closes after 60 s. Michał confirms each.
- [ ] **Step 3:** Write the docs above; `npm test`.
- [ ] **Step 4: Commit** `docs: doorbell overlay`.
