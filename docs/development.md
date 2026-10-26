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
| Preview in a browser | `npm run dev` → http://127.0.0.1:4795/ | Serves `home/` with a mock luna bridge. `?mock=error\|slow\|empty\|few\|flaky\|recover\|recoverlate\|errorlong\|slowlaunch` shows the other states. |
| Unit tests | `npm test` | Node's test runner. Covers pure logic, the ES5 parse of every TV file, assets and their records, the service handlers, and dry runs of every script. |
| Browser tests | `npm run check:browser` | Playwright against the preview at 1920×1080. |
| Package | `scripts/package.ps1` | Builds `dist/org.jazwinski.customwebos.home_<version>_all.ipk` from `home/` plus the service. Bump `home/appinfo.json` first. |
| Install | `scripts/install.ps1 -TvHost <tv-ip> -Reboot` | **Always `-Reboot`** (tv-notes.md). Needs the owner's go-ahead. |
| Measure | `scripts/perf.ps1 -TvHost <tv-ip> -Action right -Steps 9` | Add `-View all -Action down` for All apps. Prints first paint, frame times and per-keypress cost. The bar: p95 frame < 33 ms. Past numbers are in tv-log.md. |
| Power-on hook | `scripts/autostart.ps1 -TvHost <tv-ip> [-Remove]` | See home-button.md. |
| Service registration | `scripts/register-service.ps1 -TvHost <tv-ip> [-Unregister]` | Once per TV (setup.md §4.3b); not needed for upgrades. |

Every script that reaches the TV supports `-WhatIf`.

## Code map

- `home/`: the TV web app, **ES5 only**.
  - `main.js`: pure, unit-tested helpers at the top; `mountUI` at the bottom owns the DOM.
  - `config.js`: Home apps and wallpaper, edited by hand.
  - `style.css`: Chromium 53, no Grid, gap or backdrop-filter.
  - `assets/`: photos, logos and font, each with its source records.
- `services/org.jazwinski.customwebos.home.service/`: a Node 0.12 luna service. The web app can't call `applicationManager` itself, so this service lists and launches apps for it (`listApps`, `launch`, `perfReport`). `handlers.js` holds the testable logic.
- `scripts/`: PowerShell first. Each `.ps1` that reaches the TV has `-WhatIf`. `autostart.sh` and `register-service.sh` run on the TV.
- `dev/`: the mock bridge and fixtures for the preview. `scripts/dev-server.mjs` serves them.
- `test/`: Node tests; never shipped. `browser-tests/` holds Playwright tests (kept out of `test/` so `node --test` doesn't pick them up).

## How work is done here

New features go through a design (`docs/superpowers/specs/`), then a plan (`docs/superpowers/plans/`), then test-first execution and a whole-branch review before merging. Record on-device findings in [tv-log.md](tv-log.md), lift lasting rules into [tv-notes.md](tv-notes.md), and update [status.md](status.md) when something lands.
