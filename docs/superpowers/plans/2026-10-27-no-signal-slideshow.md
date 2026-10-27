# No-Signal Slideshow (M3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the HDMI input on screen loses its signal, CustomWebOS covers it with a full-screen slideshow of the USB stick's photos, until the signal returns or the source changes.

**Architecture:** A small boot-hook watcher (`sh` + `luna-send -i` subscriptions, no busy polling) follows the TV's input/signal state. After a settle delay with no signal on the foreground HDMI input, it launches CustomWebOS with `{"slideshow":{"input":"<hdmi app id>"}}`; when the signal returns it relaunches that HDMI app. The home app gets a slideshow view; the root home service lists the stick's photos.

**Tech Stack:** BusyBox sh (watcher), ES5 web app (Chrome 53), Node 0.12 luna service, node:test, Playwright, PowerShell installer.

**Spec:** `docs/superpowers/specs/2026-10-27-no-signal-slideshow-design.md`

## Global Constraints

- Only HDMI inputs (`com.webos.app.hdmi1`..`hdmi4`) trigger; never Live TV or apps.
- Settle delay **5 s** of continuous no-signal before covering; photo interval **30 s**; cross-fade **1 s**; shuffled order.
- No dismissing: Back does nothing; ← / → step photos; Home opens CustomWebOS (changes source). Only signal return or a source change ends the show.
- No usable stick (no stick / zero photos) → never cover; LG's normal screen stays. Stick removed mid-show → end the show and relaunch the HDMI app.
- Photos: `.jpg`, `.jpeg`, `.png` (case-insensitive), any folder depth on the stick, hidden files/folders (`.`-prefixed) skipped, at most **2000** listed.
- No network, no copies on flash. Idle costs nothing: the watcher only blocks on subscriptions (no `sleep` loops while a signal is present).
- Every `luna-send` gets `< /dev/null` and writes to a file or a read loop fed by a FIFO (tv-notes); BusyBox `timeout -t`.
- ES5 for TV web code; scripts PowerShell-first with `-WhatIf`; device work needs Michał's go-ahead per task; installs with `install.ps1 -Reboot`.
- LG's no-signal auto power-off must keep working, or Michał decides (spec anti-goal).

## Review Focus

1. **A device waking up or changing resolution** (PS5 rest mode, CEC) drops the signal for 1–3 s → nothing happens (Task 4 test: a 3 s blip doesn't launch).
2. **Michał switches to another source with a signal while the show runs** → the show disappears and never relaunches over the new source (Task 4 test: foreground change to a non-HDMI or lit input → no launch).
3. **The stick is pulled mid-show** → the show ends and the HDMI app is back (Task 3 browser test with the mock returning no photos on refresh; Task 4 test on the storage event if Task 1 finds one).
4. **A huge photo** (e.g. 40 MP) doesn't stall or crash the app → decoded at screen size or skipped (Task 3: `<img>` only, no canvas; Task 5 on-TV check with a large file).
5. **TV left alone with the show running** → LG's power-off still happens, or Michał is asked (Task 5).

---

### Task 1: On-TV spike — signal events, USB, covering, power-off (go-ahead)

**Files:**
- Create: `test/fixtures/nosignal/` (captured real luna payloads: one with signal, one without, one input change; the storage list with a stick)
- Modify: `docs/tv-log.md`, `docs/tv-notes.md`

- [ ] **Step 1: Signal state.** With the PS5 on HDMI 1, run on the TV `luna-send -i` subscriptions (each `< /dev/null`, output to a file, stopped after the test) to the candidates, then switch the PS5 off and on, and switch inputs:
  - `luna://com.webos.service.eim/getAllInputStatus` `{"subscribe":true}`
  - `luna://com.webos.service.eim/getCurrentInput` `{"subscribe":true}`
  - `luna://com.webos.service.videooutput/getStatus` `{"subscribe":true}`
  
  Expected: at least one reports the current input and a signal on/off change. Save the real payloads as fixtures. If none do, look with `ls-monitor` while toggling the PS5 and record what does.
- [ ] **Step 2: USB.** Plug a stick with a few photos: record its mount path (expected `/tmp/usb/sd?/sd??`) and whether `luna://com.webos.service.pdm/getAttachedStorageDeviceList` `{"subscribe":true}` reports attach/detach; save the payload.
- [ ] **Step 3: Covering.** With HDMI 1 dark and LG's no-signal screen up, launch CustomWebOS from SSH. Expected: full screen, no LG popup over it after 60 s. Then launch `com.webos.app.hdmi1`: expected, back on the input.
- [ ] **Step 4: file:// from the app.** Temporarily (back up first, tv-notes) add an `<img src="file:///tmp/usb/…/x.jpg">` to the installed `index.html`, relaunch, grab a frame with `remoteview --capture-test 1`. Record whether it shows. Restore.
- [ ] **Step 5: Power-off.** Read the TV's no-signal power-off setting (settingsservice); if on, leave CustomWebOS over the dark input for 16 min and record whether the TV turns off.
- [ ] **Step 6:** Record everything in tv-log; ledger rulings: `SIGNAL_METHOD`, the field paths for input and signal, `STORAGE_METHOD` (or "none"), `PHOTO_URL` = `file://` or served by the service, and the power-off finding. Commit `docs: no-signal spike on the TV` with the fixtures.

### Task 2: Photo listing in the home service

**Files:**
- Modify: `services/org.jazwinski.customwebos.home.service/handlers.js` (the handler) and `service.js` (`service.register('listPhotos', handlers.listPhotos)`, next to `listApps`/`launch`/`perfReport`)
- Test: `test/service-handlers.test.js`

**Interfaces:**
- Produces: pure `photoFiles(paths)` → sorted array of paths, filtered per Global Constraints (extensions, hidden, cap 2000); luna method `listPhotos` `{}` → `{returnValue:true, photos:[<url>...]}` scanning the USB mount root from Task 1; `photos: []` when no stick.

- [ ] **Step 1:** Tests: `photoFiles` keeps `a/IMG_1.JPG`, `b.png`, `c.jpeg`; drops `d.gif`, `.hidden.jpg`, `.thumbs/x.jpg`; caps at 2000; `listPhotos` handler over a temp dir tree returns `file://`-prefixed (or Task 1's `PHOTO_URL` form) paths and `[]` for a missing root.
- [ ] **Step 2:** Run `npm test`. Expected: FAIL.
- [ ] **Step 3:** Implement (ES5/Node 0.12, `fs.readdirSync` recursion with a depth limit of 8).
- [ ] **Step 4:** `npm test`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(service): list photos on the USB stick`.

### Task 3: Slideshow view in the home app

**Files:**
- Modify: `home/main.js`, `home/style.css`, `dev/mock-bridge.js` (a `listPhotos` answer, `?mock=photos|nophotos`), `browser-tests/preview.spec.mjs`, `test/home-main.test.js`

**Interfaces:**
- Consumes: `listPhotos` (Task 2).
- Produces: launch param `{"slideshow":{"input":"com.webos.app.hdmiN"}}` → slideshow view; pure `slideshowParams(raw)` → `{input}` or null (only `com.webos.app.hdmi[1-4]`); pure `shuffle(list, rand)`; `SLIDE_MS = 30000`, `FADE_MS = 1000`.

- [ ] **Step 1:** Unit tests: `slideshowParams` accepts the four HDMI ids, rejects others and bad JSON; `shuffle` returns a permutation and uses `rand`. Browser tests (`?mock=photos&slideshow=com.webos.app.hdmi1` as the dev-server stand-in for launch params): full-screen photo, no clock/dock; after `SLIDE_MS` on a fake clock the photo changes; → / ← step; Back keeps the show; `?mock=nophotos` asks the service to launch the input (mock records `launch com.webos.app.hdmi1`); a relaunch without params shows Home.
- [ ] **Step 2:** Run tests. Expected: FAIL.
- [ ] **Step 3:** Implement: two stacked `<img>`, opacity transition `FADE_MS`, `object-fit: contain` on black; skip images that fail to load; refresh the list once per lap and end the show (launch the input via the home service's existing `launch` method) when it's empty. ES5.
- [ ] **Step 4:** `npm test` and `npm run check:browser`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(home): slideshow view`.

### Task 4: The watcher hook

**Files:**
- Create: `scripts/nosignal.sh` (init.d hook `customwebos-nosignal`), `scripts/nosignal.ps1` (`-TvHost`, `-Remove`, `-WhatIf`; same pattern as `autostart.ps1`), `test/nosignal.test.js`
- Modify: `test/scripts.test.js`, `docs/home-button.md` (rollback list), `docs/development.md`

**Interfaces:**
- Consumes: Task 1's `SIGNAL_METHOD` and field paths (fixtures), `listPhotos` (Task 2), the slideshow launch param (Task 3).
- Produces: hook behaviour below; `SETTLE_S=5`.

- [ ] **Step 1:** Tests in the `autostart.test.js` style (stub `luna-send` replaying the Task 1 fixtures line by line, stub `sleep`, `--foreground`, env overrides):
  - no signal on the foreground HDMI 1 for `SETTLE_S` and photos > 0 → one `launch` of CustomWebOS with `{"slideshow":{"input":"com.webos.app.hdmi1"}}`;
  - a 3 s blip → no launch;
  - no signal but `listPhotos` empty → no launch;
  - signal returns while CustomWebOS is in front → `launch com.webos.app.hdmi1`;
  - the foreground is Live TV or an app → nothing;
  - every `luna-send` has `/dev/null` stdin; without `--foreground` it returns at once.
- [ ] **Step 2:** `npm test`. Expected: FAIL.
- [ ] **Step 3:** Implement: background loop reading the subscription through a FIFO; on a no-signal event start a settle timer (`sleep $SETTLE_S` in a child that can be killed by the next event); restart the subscription with a 5 s back-off if `luna-send` exits; log to `/tmp/nosignal.log` (256 KB, one rotation, as `remoteview.sh`).
- [ ] **Step 4:** `npm test`. Expected: PASS.
- [ ] **Step 5:** Commit `feat: no-signal watcher hook`.

### Task 5: On the TV and docs (go-ahead)

- [ ] **Step 1:** Bump to 0.7.0; `package.ps1`; `install.ps1 -Reboot`; `nosignal.ps1 -TvHost …`; reboot.
- [ ] **Step 2:** With Michał: PS5 off → the show after ~5 s, no LG overlay; ← / →; Back stays; PS5 on → back to HDMI 1; switch to Live TV during the show → no relaunch; Home → CustomWebOS; back to the dark HDMI → the show again; pull the stick → show ends; a 40 MP photo on the stick; no stick → LG's screen.
- [ ] **Step 3:** Power-off: leave it running past LG's timer; record. If the TV no longer turns off, tell Michał and let him decide (spec anti-goal).
- [ ] **Step 4:** Idle cost: watcher RSS and CPU over 60 s with a signal present (expected ≈ 0 CPU).
- [ ] **Step 5:** tv-log, tv-notes (lasting facts), status.md (M3 done), development.md; commit `docs: no-signal slideshow on the TV`.
