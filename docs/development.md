# Development

How to work on CustomWebOS from a machine (Windows is the one in use). Rules for anything that touches the TV are in [tv-notes.md](tv-notes.md); conventions are in [AGENTS.md](../AGENTS.md).

## Setting up a machine

1. Clone the repo, then run `npm ci` and `npx playwright install chromium`.
2. Install the LG CLI: `npm i -g @webos-tools/cli`. Only `ares-package` is needed (`scripts/package.ps1`). Installing to the TV goes over SSH, and `ares-install` is broken on Node 25 anyway.
3. Copy these private files by hand. They're never in git (AGENTS.md):
   - the TV's SSH key, to `~/.ssh/id_ed25519_lgtv`
   - the recovery sheet, to `.local/webos/recovery.md`

   SSH listens on port **22022** (setup.md §3.3). The scripts take the TV's LAN IP as `-TvHost <tv-ip>`.
4. If PowerShell refuses to run scripts, call them as `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/<name>.ps1 …`.

## The loop

| Step | Command | Notes |
|---|---|---|
| Preview in a browser | `npm run dev` → http://127.0.0.1:4795/ | Serves `home/` with a mock luna bridge. `?mock=error\|slow\|empty\|few\|flaky\|recover\|recoverlate\|errorlong\|slowlaunch` shows the other states; `&theme=light\|dark` forces the day or night look. |
| Unit tests | `npm test` | Node's test runner. Covers pure logic, the ES5 parse of every TV file, assets and their records, the service handlers, and dry runs of every script. |
| Browser tests | `npm run check:browser` | Playwright against the preview at 1920×1080. |
| Package | `scripts/package.ps1` | Builds `dist/org.jazwinski.customwebos.home_<version>_all.ipk` from `home/` plus the service and the daemon (staged in `dist/stage/`; the daemon ends up in `<service dir>/bin/`), and `dist/org.jazwinski.customwebos.doorbell_<version>_all.ipk` from `doorbell/`. Bump `home/appinfo.json` (and `doorbell/appinfo.json` when the box changed) first. |
| Build the daemon | `scripts/build-native.ps1` | Cross-compiles `native/remoteview/` in Docker into `dist/native/remoteview/` (the `remoteview` binary, its two capture backends, `libjpeg.so.8` and its licence). `-Test` runs its host unit tests instead. Needed before `package.ps1`, which stops with a clear message without it. |
| Install | `scripts/install.ps1 -TvHost <tv-ip> -Reboot` | **Always `-Reboot`** (tv-notes.md). Needs the owner's go-ahead. |
| Measure | `scripts/perf.ps1 -TvHost <tv-ip> -Action right -Steps 9` | Add `-View all -Action down` for All apps, `-Theme light\|dark` to force the day or night look (it stays until the app is next closed). Prints first paint, frame times and per-keypress cost. The bar: p95 frame < 33 ms. Past numbers are in tv-log.md. |
| Wallpapers | `scripts/wallpapers.ps1 [-DayTint "#rrggbb pct"] [-NightTint ...]` | Re-renders the day/night JPEGs and their glass from GNOME's Morphogenesis SVGs in Docker into `home/assets/wallpapers/`. Only needed to change the crop or retune the glass tint. |
| No-signal slideshow | `scripts/nosignal.ps1 -TvHost <tv-ip> [-Remove]` | Installs the watcher `init.d/customwebos-nosignal`: an HDMI input that loses its picture is covered with the USB stick's photos. Log: `/tmp/nosignal.log` on the TV. |
| Doorbell | `scripts/doorbell.ps1 -TvHost <tv-ip> -Configure\|-Ring` | `-Configure` sends `.local/doorbell.json` to the TV; `-Ring` opens the box. `node dev/fake-camera.mjs [port] [--webcam "<name>"]` is a camera (wallpapers or a PC webcam) and door on port 8099. Preview: http://127.0.0.1:4795/doorbell/ (`?mock=door\|doorfail\|nocamera\|deadcamera`). |
| Boot hook | `scripts/autostart.ps1 -TvHost <tv-ip> [-Remove]` | Stops LG Input Hook's root config server once its remap is active (it no longer opens CustomWebOS). See home-button.md. |
| Remote view | `scripts/remoteview.ps1 -TvHost <tv-ip> [-SetPassword] [-Pair] [-Remove]` | After installing the `.ipk` (with `-Reboot`): the default installs the boot hook `init.d/customwebos-remoteview`; `-SetPassword` asks for the VNC password (only the first 8 characters count), saves it to `.local/remoteview/password.txt` and stores it on the TV; `-Pair` pairs with the TV's second-screen API (accept the prompt on the TV); `-Remove` deletes the hook and stops the daemon. The daemon's log is `/tmp/remoteview.log` on the TV. |
| Service registration | `scripts/register-service.ps1 -TvHost <tv-ip> [-Unregister]` | Once per TV (setup.md §4.3b); not needed for upgrades. |

Every script that reaches the TV supports `-WhatIf`.

### Connecting to remote view

Use TightVNC: `tvnviewer.exe <tv-ip>::5900` (two colons mean a port number). TightVNC picks Tight with JPEG, which is much cheaper for the TV than UltraVNC's ZRLE. The image is 960×540. Costs are in [tv-log.md](tv-log.md) ("first VNC sessions and budgets").

## Code map

- `home/`: the TV web app, **ES5 only**.
  - `main.js`: pure, unit-tested helpers at the top; `mountUI` at the bottom owns the DOM.
  - `config.js`: Home apps and the location for sunrise/sunset (day/night look), edited by hand.
  - `style.css`: Chromium 53, no Grid, gap or backdrop-filter.
  - `assets/`: the day/night wallpapers and their glass images, logos and font, each with its source records.
- `doorbell/`: the doorbell box, a second web app (floating, transparent), **ES5 only**.
- `services/org.jazwinski.customwebos.home.service/`: a Node 0.12 luna service. The web apps can't call `applicationManager` itself, so this service lists and launches apps for them (`listApps`, `launch`, `perfReport`), and reads the doorbell settings and sends the door request (`doorbellConfig`, `openDoor`; not public). `handlers.js` holds the testable logic.
- `scripts/`: PowerShell first. Each `.ps1` that reaches the TV has `-WhatIf`. `autostart.sh`, `remoteview.sh` and `register-service.sh` run on the TV.
- `native/remoteview/`: the remote view daemon in C (GPL-2.0, own licence), built by `scripts/build-native.ps1`.
- `dev/`: the mock bridge and fixtures for the preview (`scripts/dev-server.mjs` serves them), and `fake-camera.mjs`.
- `test/`: Node tests; never shipped. `browser-tests/` holds Playwright tests (kept out of `test/` so `node --test` doesn't pick them up).

## How work is done here

New features go through a design (`docs/superpowers/specs/`), then a plan (`docs/superpowers/plans/`), then test-first execution and a whole-branch review before merging. Record on-device findings in [tv-log.md](tv-log.md), lift lasting rules into [tv-notes.md](tv-notes.md), and update [status.md](status.md) when something lands.
