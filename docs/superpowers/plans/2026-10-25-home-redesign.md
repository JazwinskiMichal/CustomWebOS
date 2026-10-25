# Home Screen Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the list UI of CustomWebOS Home with CleanFrame's look (full-screen photo, clock and Polish date, frosted dock of white logos, All apps grid) without it feeling slower than today on the LG C8.

**Architecture:** Same shape as today: pure, Node-tested helpers at the top of `home/main.js` and one `mountUI(doc)` that owns the DOM. Rendering changes from "rebuild everything per key" to "build once per view/list, then toggle classes". Glass is a pre-blurred photo copy clipped inside the dock. A launch-param-driven perf mode reports frame times through the home service to a file on the TV, so speed is measured, not guessed.

**Tech Stack:** ES5 + CSS for Chromium 53 (webOS 4.4), no framework or build step; Node 0.12 luna service (`webos-service`); `node --test`, acorn ES5 check, Playwright 1.63.0 browser suite against `scripts/dev-server.mjs` and `dev/mock-bridge.js`; PowerShell scripts with `-WhatIf`.

**Spec:** `docs/superpowers/specs/2026-10-25-home-redesign-design.md`. Parent: `docs/superpowers/specs/2026-10-24-customwebos-design.md`. Visual reference: `C:\Users\Lenovo\source\repos\CleanFrameLG\docs\images\cleanframe-dock.jpg`.

## Global Constraints

- Runtime JS under `home/` and `services/` is ES5 (AGENTS.md; `test/es5.test.js` parses every `.js` under both dirs, including anything you put in `home/assets/`).
- Chromium 53: no CSS Grid, no flex `gap`, no `position: sticky`, no `backdrop-filter`, no `:focus-within`, no ResizeObserver. Prefix flex/mask properties with `-webkit-` alongside the standard ones, as `home/style.css` does.
- Stage 1920×1080. Keys: arrows, OK=13, Back=461 (27/8 in the browser preview). Magic Remote pointer: hover focuses, click opens.
- **No app tiles before the service list arrives** (Michał removed the fallback list on 2026-10-25 because a list that can't launch is misleading). The error state keeps today's wording from `unavailableText`.
- Performance bar: first paint ≤ 1 s from launch; a focus move responds ≤ 100 ms; holding Right across the dock, p95 frame time < 33 ms. Only `transform`/`opacity` animate. If missed, give up in this order: (1) focus animations, (2) Manrope (system font), (3) frosted glass (plain translucent dock), (4) smaller/lower-quality photo.
- Brand logos only with their source and licence records beside them (public repo). Upstream credit lines go in `README.md` only (AGENTS.md).
- Device work (installs, perf runs) needs Michał's per-task go-ahead. Installs: `scripts/install.ps1 -TvHost 192.168.88.244 -Reboot`; after boot, if the TV reopened CustomWebOS by itself, close and reopen it. On the TV, never pipe `luna-send` under `timeout`; write to a file. BusyBox `timeout` takes `-t N`.
- Keep existing behaviour: launch guard (`shouldLaunch`, 1 s), `e.repeat` OK ignored, remembered last app, pointer `mousemove` coordinate filter, refresh on `visibilitychange`, failed refresh keeps the list, launch note single line.

## Review Focus

1. **Fewer than 9 curated apps installed** → the dock shrinks and centres; All apps is still the last tile. (Task 5 test.)
2. **Long titles** ("Homebrew Channel", long All apps names) → one line with ellipsis inside the tile, never overflowing or wrapping. (Task 5 and Task 6 tests.)
3. **Wallpaper or frost image fails to load** → a dark solid background and a dark translucent dock; text stays readable, no white page. (Task 7 test.)
4. **Date at month/day edges** → correct Polish genitive month names for all 12 months and all 7 day names. (Task 3 test.)
5. **Clock passes midnight while Home is open** → the date updates with the clock. (Task 5 test.)

---

## Part A — measure first

### Task 1: Perf mode and report

**Files:**
- Modify: `home/main.js` (pure helpers + perf driver in `mountUI`)
- Modify: `services/org.jazwinski.customwebos.home.service/handlers.js`, `service.js`
- Create: `scripts/perf.ps1`
- Test: `test/home-main.test.js`, `test/service-handlers.test.js`, `test/service-manifest.test.js` (existing method-parity tests must stay green), `test/scripts.test.js`

**Interfaces:**
- Produces (main.js, exported): `frameStats(deltas: number[]) -> {frames, p50, p95, max, over33}` (ms, rounded to 0.1); `perfParams(launchParamsJson: string|undefined) -> null | {action: 'right'|'down'|'left'|'up', steps: number, intervalMs: number}` (defaults steps 40, intervalMs 80; anything unparsable or without a `perf` object → null).
- Produces (service): method `perfReport`, payload `{report: object}` → writes `JSON.stringify(report)` to `/tmp/customwebos-perf.json`, responds `{returnValue: true}`; missing/non-object report → `{returnValue:false, errorText:'report required'}`. `createHandlers(call, writeFile)` where `writeFile(path, text, cb(err))` defaults to `fs.writeFile` in `service.js`.
- Produces (script): `scripts/perf.ps1 -TvHost <ip> [-Action right] [-Steps 40] [-IntervalMs 80] [-WhatIf]`.

- [ ] **Step 1: Write failing tests** in `test/home-main.test.js`:
  - `frameStats([16,16,17,50])` → `{frames:4, p50:16.5, p95:50, max:50, over33:1}` (p95 = nearest-rank on sorted values; p50 = mean of the two middle values for even counts).
  - `frameStats([])` → `{frames:0, p50:0, p95:0, max:0, over33:0}`.
  - `perfParams('{"perf":{"action":"down","steps":10,"intervalMs":50}}')` → `{action:'down', steps:10, intervalMs:50}`; `perfParams('{"perf":{}}')` → `{action:'right', steps:40, intervalMs:80}`; `perfParams(undefined)`, `perfParams('nope')`, `perfParams('{}')`, `perfParams('{"perf":{"action":"jump"}}')` → `null`.
  - In `test/service-handlers.test.js`: `perfReport writes the report to /tmp/customwebos-perf.json` (inject a fake `writeFile`, assert path and parsed text, response `{returnValue:true}`); `perfReport rejects a missing report` (no write); `perfReport reports a write error` (fake calls back with an Error → `{returnValue:false, errorText:<message>}`).
  - In `test/scripts.test.js`: `perf.ps1 -WhatIf prints the close, launch, wait and read commands` — output contains `closeByAppId`, `"perf":{"action":"right","steps":40,"intervalMs":80}` and `cat /tmp/customwebos-perf.json`, exit 0, no ssh run.
- [ ] **Step 2: Run** `npm test`. Expected: the new tests FAIL (functions/method/script missing); everything else passes.
- [ ] **Step 3: Implement.**
  - main.js: the two helpers. In `mountUI`, read `perfParams(window.PalmSystem && PalmSystem.launchParams)` once. If non-null: record `performance.now()` at the first render and at the first render that shows apps; after apps are shown, wait 1 s, then dispatch `params.action` every `params.intervalMs` for `params.steps` steps through the same `dispatch()` keys use, sampling `requestAnimationFrame` deltas throughout; then send `perfReport` with `{ua: navigator.userAgent, lang: navigator.language, firstPaintMs, appsShownMs, frames: frameStats(deltas), dispatchMs: frameStats(perDispatchDurations), datePl: new Date(2026, 9, 25).toLocaleDateString('pl-PL', {weekday:'long', day:'numeric', month:'long'}), supports: {grid: CSS.supports('display','grid'), backdrop: CSS.supports('-webkit-backdrop-filter','blur(1px)'), mask: CSS.supports('-webkit-mask-image','url(x.svg)')}}`. `perDispatchDurations` = `performance.now()` around each `dispatch()` call (synchronous render cost). Perf mode never launches apps (skip `ok`).
  - Service: `perfReport` handler and registration (`service.register('perfReport', handlers.perfReport)`); update the methods comment block.
  - perf.ps1: `[CmdletBinding(SupportsShouldProcess)]`, same SSH defaults as `install.ps1` (port 22022, key `~/.ssh/id_ed25519_lgtv`). One ssh session (`-tt`) that runs: `rm -f /tmp/customwebos-perf.json`; `closeByAppId`; `sleep 2`; `applicationManager/launch` with `{"id":"org.jazwinski.customwebos.home","params":{"perf":{…}}}`; poll every 2 s up to 60 s for the file; `cat` it. Write luna-send output to files, never pipe it.
- [ ] **Step 4: Run** `npm test` and `npm run check:browser`. Expected: all pass.
- [ ] **Step 5: Commit** `feat: perf mode reporting frame times to the TV`.

### Task 2: Baseline on the TV (device, needs go-ahead)

- [ ] Bump `home/appinfo.json` to `0.3.2`; `scripts/package.ps1`; `install.ps1 -TvHost 192.168.88.244 -Reboot`; after SSH is back, close+reopen the app if the TV reopened it.
- [ ] Run `scripts/perf.ps1 -TvHost 192.168.88.244 -Action down -Steps 9` twice (today's Home list moves with Down). Home only; perf mode doesn't open All apps.
- [ ] Record in `docs/m2-tracking.md` under a new "Home redesign baseline (0.3.2)" heading: ua, lang, firstPaintMs, appsShownMs, frames p50/p95/max/over33, dispatchMs p95, `datePl`, supports. **If `datePl` is exactly `niedziela, 25 października`, note that Chromium 53 Polish formatting works.**
- [ ] Commit `docs: home redesign perf baseline` (with the version bump).

## Part B — build

### Task 3: Date, logos and config

**Files:**
- Modify: `home/main.js`, `home/config.js`
- Test: `test/home-main.test.js`, `test/home-config.test.js`

**Interfaces:**
- Produces: `formatDate(date: Date, lang: string) -> string`. `lang` starting with `en` → `"Sunday, 25 October"`; anything else (including `pl`, empty, undefined) → Polish `"niedziela, 25 października"` (lower-case day, genitive month). Built-in tables only; do not depend on `Intl`. (Ruling recorded here: the spec's "use `toLocaleDateString` if correct on device" is replaced by built-in tables because the result is identical, testable, and doesn't depend on the TV's ICU build. Cost if wrong: TV languages other than pl/en get Polish.)
- Produces: `APP_LOGOS` (object, id → logo file stem): `netflix:'netflix'`, `'youtube.leanback.v4':'youtube'`, `amazon:'primevideo'`, `'com.wbd.stream':'max'`, `canalplus:'canalplus'`, `'com.apple.appletv':'appletv'`, `'com.webos.app.livetv':'livetv'`, `'com.webos.app.hdmi1':'hdmi'`, `'org.webosbrew.hbchannel':'homebrew'`, plus `ALL_APPS_ID:'apps'`. `logoFor(id) -> 'assets/icons/<stem>.svg' | null`.
- Produces (config.js): `var HOME_WALLPAPER = 'alpine';` (placeholder; Michał may change it).

- [ ] **Step 1: Failing tests:** `formatDate` for 2026-10-25 in `pl` and `en`; Polish for one date in each of the 12 months (`stycznia lutego marca kwietnia maja czerwca lipca sierpnia września października listopada grudnia`) and each weekday (`niedziela poniedziałek wtorek środa czwartek piątek sobota`); `formatDate(d, undefined)` is Polish. `logoFor('netflix') === 'assets/icons/netflix.svg'`, `logoFor(ALL_APPS_ID) === 'assets/icons/apps.svg'`, `logoFor('pl.cda') === null`. Config test: `HOME_WALLPAPER` is a non-empty string.
- [ ] **Step 2: Run** `npm test`. Expected: new tests FAIL.
- [ ] **Step 3: Implement** in main.js and config.js (export the new names).
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(home): Polish date, logo map, wallpaper setting`.

### Task 4: Dock and grid navigation

**Files:**
- Modify: `home/main.js` (`nextState`, `bootFocusIndex` unchanged in meaning)
- Test: `test/home-main.test.js`

**Interfaces:**
- Consumes: `rowsFor`, `ALL_APPS_ID` (unchanged).
- Produces: `GRID_COLS = 6` (exported). `nextState` semantics:
  - Home view (dock): `left`/`right` move by 1, clamped to `[0, last]`; `up`/`down` return the state with `launch: null` and focus unchanged (up is reserved for a future control row).
  - All view (grid): `left`/`right` move by 1 clamped; `up` moves by `-GRID_COLS` if `idx - GRID_COLS >= 0`, else stays; `down` moves to `min(idx + GRID_COLS, last)` only if a row below exists (`floor(idx/GRID_COLS) < floor(last/GRID_COLS)`), else stays.
  - `ok`, `back`, pointer actions unchanged.

- [ ] **Step 1: Failing tests** (replace the up/down list tests that no longer hold): dock Right/Left move and clamp at both ends; Up/Down on Home leave `focusIdx` unchanged; grid with 14 items: Down from 2 → 8, Down from 8 → 13 (partial last row), Down from 13 stays, Up from 13 → 7, Up from 3 stays, Right from 13 stays; Back from grid still focuses the All apps tile.
- [ ] **Step 2: Run** `npm test`. Expected: new tests FAIL.
- [ ] **Step 3: Implement** in `nextState`.
- [ ] **Step 4: Run** `npm test`. Expected: PASS. (Browser tests that press ArrowDown on Home will fail until Task 5; that's expected — run only `npm test` here.)
- [ ] **Step 5: Commit** `feat(home): dock and grid navigation`.

### Task 5: Home dock view

**Files:**
- Modify: `home/main.js` (`mountUI` rendering), `home/style.css`, `home/index.html` (if a static skeleton helps first paint)
- Test: `browser-tests/preview.spec.mjs`

**Interfaces:**
- Consumes: Task 3 `formatDate`, `logoFor`; Task 4 navigation.
- Produces (DOM contract the browser tests use): `.clock`, `.date`, `.dock` containing `.dock-track` of `.app-item[data-id][data-index]` tiles, each with `.logo` (masked span) or `.icon img` or `.initials`, and `.app-title`; `.app-item.focused` on the focused tile; state panel `.state-panel` holding the existing `.state`, `.state.error-title`, `.state.error-reason`, `.state.error-retry` and `.state.note` elements.

- [ ] **Step 1: Update/add failing browser tests** (keep ids/assertions of existing tests where the behaviour is unchanged; switch Home key presses from ArrowDown/Up to ArrowRight/Left):
  - `Home shows the curated apps in config order, then All apps` (unchanged assertion, now in `.dock`).
  - `focus moves along the dock without rebuilding it`: after the list shows, attach a MutationObserver on `#root` counting added nodes; press ArrowRight 5 times; assert focus moved 5 tiles and **0 added nodes**.
  - `all ten tiles fit inside the dock and the dock inside the stage`: every `.dock .app-item` box lies within `.dock`'s box, and `.dock`'s box within 1920×1080.
  - `fewer curated apps centre the dock and keep All apps last` (Review Focus 1): new mock mode `?mock=few` returning only netflix, youtube and pl.cda; Home tiles are `['netflix','youtube.leanback.v4','__all__']` and the dock's horizontal centre is within 2 px of 960.
  - `a long title stays on one line` (Review Focus 2): `org.webosbrew.hbchannel` tile title has `scrollHeight <= clientHeight + 1` and computed `text-overflow: ellipsis`.
  - `the date shows in Polish and updates at midnight` (Review Focus 5): install `page.clock` at `2026-10-25T23:59:30` before load; `.date` reads `niedziela, 25 października`; advance 60 s; `.date` reads `poniedziałek, 26 października`.
  - `curated logos render as masked white marks; other apps fall back`: `netflix` tile has `.logo`; `pl.cda` (in All apps, Task 6) is covered there.
  - `no app tiles before the service answers` (existing `slow` test, retargeted at `.dock .app-item`): count 0 while loading; the loading line sits in `.state-panel`.
  - Error, recover, keys-on-error-screen, launch, launch-note, pointer, remembered-app and visibility tests: keep, retargeted to dock selectors and ArrowRight.
  - Delete tests whose subject no longer exists: `Home fits on screen without scrolling` becomes `the dock fits on the stage` (dock box within 1920×1080); `focused item stays on screen while scrolling` moves to Task 6 (grid).
  - Add `?mock=few` to `dev/mock-bridge.js`.
- [ ] **Step 2: Run** `npm run check:browser`. Expected: the new/retargeted tests FAIL.
- [ ] **Step 3: Implement.**
  - Layout: tiles 168×200 px with 4 px side margins, so the maximum 10 tiles (9 curated + All apps; config caps Home at 9) need 1720 px; the dock is 16 px padding + tiles, centred horizontally, `top:676px`, radius 48px. No horizontal scrolling (Ruling: the spec allows scrolling "if the tiles don't fit"; at this size they always fit, so it isn't built. Cost if wrong: Home grows past 9 apps → add scroll then). Clock top-left at about `left:144px; top:96px`, date under it.
  - Logos: `.logo` = span with `-webkit-mask-image:url(<logoFor>)` (and `mask-image`), `-webkit-mask-size:contain`, no-repeat, centred, `background-color: var(--ink)`. Apps without a logo: the TV icon in `<img>` with `filter: brightness(0) invert(1)`; on `onerror` or no icon, `.initials` (existing `brokenIcons` cache).
  - Rendering: build the view's DOM when the view or the app list changes; a focus change only moves the `focused` class.
  - Clock tick also refreshes `.date` (same minute-aligned `setTimeout` chain).
- [ ] **Step 4: Run** `npm test` and `npm run check:browser`. Expected: all pass.
- [ ] **Step 5: Commit** `feat(home): dock layout with logos, Polish date, in-place focus`.

### Task 6: All apps grid

**Files:**
- Modify: `home/main.js`, `home/style.css`
- Test: `browser-tests/preview.spec.mjs`

**Interfaces:**
- Consumes: Task 4 grid navigation (`GRID_COLS`), Task 5 tile markup and in-place focus.
- Produces: `.grid` view (`h1` text `All apps`, unchanged) containing `.app-item` tiles in rows of `GRID_COLS`, built with flexbox wrap (no CSS Grid), vertical scroll keeping the focused row visible.

- [ ] **Step 1: Failing browser tests:** `All apps lists every service app alphabetically` (38 tiles, sorted) in `.grid`; `arrow keys move in two dimensions` (Down from tile 0 focuses tile 6; Right then Down focuses 7); `focused tile stays on screen while scrolling` (25× ArrowDown then Right… focused box within 1080, grid scrolled); `Back returns to the All apps tile` (existing); `remembered app outside Home opens the grid on it` (existing, retargeted); `apps without a bundled logo show the TV icon whitened or initials` (`pl.cda` tile has `.icon img` with computed filter containing `invert(1)` or `.initials`); long title one line with ellipsis (Review Focus 2); grid opening adds nodes but subsequent arrow presses add 0 (MutationObserver).
- [ ] **Step 2: Run** `npm run check:browser`. Expected: new tests FAIL.
- [ ] **Step 3: Implement** the grid view: tiles the same size as the dock's, 6 per row, vertical scroll via `scrollTopFor` keeping the focused row centred; pointer actions keep the scroll position (today's `keepScroll` rule).
- [ ] **Step 4: Run** `npm test` and `npm run check:browser`. Expected: all pass.
- [ ] **Step 5: Commit** `feat(home): All apps grid`.

### Task 7: Photo, frosted glass, font, theme tokens, assets

**Files:**
- Create: `home/assets/wallpapers/` (`alpine.jpg`, `alpine-field-frost.jpg` and the same pair for two more CleanFrame photos, e.g. `cove`, `misty`), `home/assets/wallpapers/SOURCES.md` (photographer, Unsplash page, licence, copied from `CleanFrameLG/docs/asset-sources.md` and `app/assets/wallpapers/SOURCES.json`)
- Create: `home/assets/icons/` (`netflix.svg`, `youtube.svg`, `primevideo.svg`, `max.svg` from CleanFrame's `hbomax.svg`, `appletv.svg`, `canalplus.svg` from Simple Icons at a pinned commit — if Simple Icons has none, omit it and let the fallback apply —, `apps.svg` from CleanFrame's original outline, and new original `livetv.svg`, `hdmi.svg`, `homebrew.svg` on the same 24px grid / 1.6px stroke), `SOURCES.json` (one entry per file, pinned URLs or "CustomWebOS original"), `SIMPLE-ICONS-LICENSE.txt`, and `CUSTOM-BRAND-ICONS-LICENSE.txt` only if a Custom Brand Icons file is used
- Create: `home/assets/fonts/manrope.woff2`, `home/assets/fonts/OFL.txt`
- Modify: `home/style.css`, `home/index.html`, `home/main.js` (wallpaper element), `README.md` (credits section: Simple Icons, Manrope, Unsplash photographers)
- Test: `test/home-assets.test.js` (new), `browser-tests/preview.spec.mjs`

**Interfaces:**
- Consumes: `HOME_WALLPAPER`, `logoFor`, `APP_LOGOS` (Task 3).
- Produces: `#wallpaper` (img, `object-fit:cover`, 1920×1080, behind everything); dock `.mat` containing `img.mat-img` (the `-field-frost.jpg`, positioned at the dock's negative stage offset so it registers with the photo) and `.mat-veil`; CSS custom properties on `:root.theme-light` / `:root.theme-dark` (`--ink`, `--ink-dim`, `--veil`, `--focus-fill`, `--focus-ring`, `--fallback-bg`); `<html class="theme-dark">` for now.

- [ ] **Step 1: Failing tests:**
  - `test/home-assets.test.js`: every stem in `APP_LOGOS` has `home/assets/icons/<stem>.svg` (if Simple Icons has no Canal+ mark, remove `canalplus` from `APP_LOGOS` and its Task 3 test — Ruling; Canal+ then uses the fallback); every SVG in `home/assets/icons` has a `SOURCES.json` entry; `HOME_WALLPAPER` has both `<name>.jpg` and `<name>-field-frost.jpg`; `OFL.txt` and `SIMPLE-ICONS-LICENSE.txt` exist; `README.md` mentions Simple Icons, Manrope and Unsplash.
  - Browser: `the photo and the frost layer are registered` (`.mat-img` offset equals minus the dock's stage position, ±1 px); `a missing wallpaper leaves a dark readable screen` (Review Focus 3: `page.route('**/assets/wallpapers/**', r => r.abort())` before load; `body`'s computed background colour has every RGB channel < 60 and `.clock`'s colour every channel > 200); `Manrope is the font` (`document.fonts.check('40px Manrope')` true after load).
- [ ] **Step 2: Run** `npm test` and `npm run check:browser`. Expected: new tests FAIL.
- [ ] **Step 3: Implement.** Copy assets with their records; `@font-face` for Manrope (`font-display` is not needed on Chromium 53, fallback stack `Manrope, 'LG Smart UI', sans-serif`). Focus transition: `transform: scale(1.04)` + background on `.focused`, `transition: transform 120ms, background-color 120ms`. 
- [ ] **Step 4: Run** `npm test` and `npm run check:browser`. Expected: all pass. Check `.ipk` size: run `scripts/package.ps1` and note the size in the commit message body.
- [ ] **Step 5: Commit** `feat(home): photo, frosted dock, Manrope, theme tokens`.

## Part C — on the TV

### Task 8: Install 0.4.0, measure, verify (device, needs go-ahead)

- [ ] Bump to `0.4.0`; package; `install.ps1 -TvHost 192.168.88.244 -Reboot`; close+reopen the app if the TV reopened it.
- [ ] `perf.ps1 -Action right -Steps 9` twice (dock). Compare with the Task 2 baseline and the bar (first paint ≤ 1000 ms, dispatch p95 ≤ 100 ms, frame p95 < 33 ms). If missed, apply the give-up order one step at a time (each a commit with its own re-measure), stopping at the first step that meets the bar.
- [ ] Owner checks with the remote: the look against `cleanframe-dock.jpg`; logos crisp and white; TV icons in All apps (whitened vs initials — decide and record); Polish date; pointer hover/click on dock and grid; Back from All apps. The error screen's look is checked in the browser preview (`?mock=error`), not provoked on the TV.
- [ ] Record numbers and decisions in `docs/m2-tracking.md` ("Home redesign 0.4.0"); commit `docs: 0.4.0 on-device results`.
