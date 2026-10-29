# Day/Night Theme and Glass Clock Implementation Plan

> **Status (2026-10-26): complete.** On the TV; see [docs/status.md](../../status.md).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** CustomWebOS Home switches between GNOME's Morphogenesis light (day) and dark (night) wallpaper and colours at Warsaw's sunrise and sunset, and the clock and date sit on glass like the dock.

**Architecture:** Pure ES5 functions in `home/main.js` compute sunrise/sunset (NOAA approximation) and the mode; the existing minute tick re-evaluates it and swaps the `<html>` theme class plus the wallpaper and glass image sources together. Wallpapers are rendered offline from GNOME's SVGs by a Docker-run script into JPEGs and pre-blurred glass JPEGs. The clock glass reuses the dock's `.mat` technique.

**Tech Stack:** ES5 web app on webOS 4.4 (Chrome 53), node:test, PowerShell + Docker (ImageMagick/librsvg) for assets.

**Spec:** `docs/superpowers/specs/2026-10-26-day-night-theme-design.md`

## Global Constraints

- Runtime JS is ES5 (AGENTS.md; `test/es5.test.js` enforces it). No `backdrop-filter`; glass = pre-blurred image clipped and offset (`.mat`/`.mat-img`).
- One wallpaper pair only: `morphogenesis-day.jpg` / `morphogenesis-night.jpg` plus `morphogenesis-day-dock.jpg` / `morphogenesis-night-dock.jpg` in `home/assets/wallpapers/`. The Unsplash photos (alpine, misty, cove), their dock images, SOURCES entries and README photo credits are removed.
- Source: GNOME gnome-backgrounds `backgrounds/morphogenesis-l.svg` (day) and `morphogenesis-d.svg` (night), by Jakub Steiner, **CC BY-SA 3.0**; credited in README and `SOURCES.json`; derived JPEGs stay CC BY-SA 3.0.
- Sizes: each wallpaper JPEG ≤ 600 KB, each glass JPEG ≤ 120 KB; 1920×1080.
- Location: `var HOME_LOCATION = { name: 'Warsaw', lat: 52.23, lon: 21.01 };` in `home/config.js` (replaces `HOME_WALLPAPER`).
- Day = sunrise ≤ now < sunset → `theme-light`; otherwise `theme-dark`. Fallback when the location is missing/invalid or the clock is unsynced (`getFullYear() < 2026`): day 07:00 ≤ local time < 19:00.
- Switch is instant (no transition/animation). Mode is set before first paint.
- Clock glass on the Home view only (not All apps): radius 48px, at least 560×200 at left 112px / top 72px, padding 24px 32px, growing to fit the date.
- TV icons without a bundled logo (`.icon img`) follow the ink: white in `theme-dark`, dark in `theme-light`.
- Device work needs Michał's go-ahead per task; installs with `scripts/install.ps1 -TvHost <tv> -Reboot`; app version 0.6.0.

## Review Focus

1. **TV clock not yet synced after boot** (year 1970/2020): fallback times, then the real mode once the clock syncs — Task 1 tests the fallback; Task 3 re-evaluates on every minute tick.
2. **A wallpaper or glass image fails to load in one mode:** background colour and translucent veil remain, and the other mode still works after a switch — Task 3 keeps per-mode broken flags.
3. **The switch happens while All apps is open, or while another app is in front:** the whole Home re-themes; on return (visibility change) the mode is correct — Task 3 runs the mode check from `tickClock`, which the return path already calls.
4. **The longest Polish date** ("poniedziałek, 30 października") fits inside the clock glass — Task 4 checks it on the dev server and TV.
5. **Midnight, and the CET/CEST change days** (29 Mar, 25 Oct 2026): sun times computed in UTC for the right date — Task 1 tests a date on each side of a change.

---

### Task 1: Sun times and mode (pure functions)

**Files:**
- Modify: `home/main.js` (pure functions near `formatClock`, plus exports)
- Test: `test/home-main.test.js`

**Interfaces:**
- Produces: `sunTimesUtc(year, month, day, lat, lon)` → `{ rise: <minutes after 00:00 UTC>, set: <minutes after 00:00 UTC> }` (month 1–12; numbers, may be fractional); `themeFor(date, loc)` → `'light'` or `'dark'` (`loc` is `{lat, lon}` or undefined); `FALLBACK_DAY = { from: 7 * 60, to: 19 * 60 }` (local minutes).

- [ ] **Step 1: Write failing tests** in `test/home-main.test.js` (Warsaw `{lat: 52.23, lon: 21.01}`, tolerance ±5 min):
  - `sunTimesUtc(2026, 6, 21, …)` → rise ≈ 02:14 UTC (134), set ≈ 19:01 UTC (1141).
  - `sunTimesUtc(2026, 12, 21, …)` → rise ≈ 06:43 (403), set ≈ 14:25 (865).
  - `sunTimesUtc(2026, 3, 28, …)` and `(2026, 3, 30, …)` → set differs by under 5 min (no DST jump, it's UTC).
  - `themeFor(new Date(Date.UTC(2026, 5, 21, 12, 0)), WAW)` → `'light'`; `Date.UTC(2026, 5, 21, 20, 0)` → `'dark'`; `Date.UTC(2026, 11, 21, 15, 0)` → `'dark'`; `Date.UTC(2026, 11, 21, 7, 0)` → `'light'`.
  - Unsynced clock: `themeFor(new Date(2020, 0, 1, 12, 0), WAW)` → `'light'`; `new Date(2020, 0, 1, 22, 0)` → `'dark'` (local-time fallback).
  - No location: `themeFor(new Date(2026, 5, 21, 6, 0), undefined)` → `'dark'`; at 07:00 → `'light'`; `{lat: 'x'}` behaves like undefined.
- [ ] **Step 2: Run** `node --test test/home-main.test.js`. Expected: FAIL (`sunTimesUtc is not a function`).
- [ ] **Step 3: Implement** both in ES5. `sunTimesUtc` uses the NOAA approximation (Julian day → solar mean anomaly → equation of centre → ecliptic longitude → declination → hour angle for −0.833°, equation of time); `themeFor` uses the UTC date of `date` and compares `date`'s UTC minutes with rise/set; for an unsynced clock or bad `loc` it compares local minutes with `FALLBACK_DAY`. Export both and `FALLBACK_DAY`.
- [ ] **Step 4: Run** `npm test`. Expected: PASS (all, including `test/es5.test.js`).
- [ ] **Step 5: Commit** `feat(home): sunrise/sunset and day/night mode`.

### Task 2: Morphogenesis wallpapers (assets, script, credits)

**Files:**
- Create: `scripts/wallpapers.ps1`
- Delete: `home/assets/wallpapers/{alpine,misty,cove}{,-dock}.jpg`
- Create (generated): `home/assets/wallpapers/morphogenesis-{day,night}{,-dock}.jpg`, `home/assets/wallpapers/LICENSE.CC-BY-SA-3.0.txt` (or a link line in SOURCES/README if the full text is impractical — prefer the text)
- Modify: `home/assets/wallpapers/SOURCES.json`, `README.md` (credits), `test/home-assets.test.js`, `test/scripts.test.js`

**Interfaces:**
- Produces: the four JPEG files named above (Task 3 loads them as `assets/wallpapers/morphogenesis-<day|night>[-dock].jpg`).

- [ ] **Step 1: Write failing tests:**
  - `home-assets.test.js`: replace the photo tests with `both modes' wallpapers and glass images are bundled within budget` (four files exist; wallpaper ≤ 600 KB, glass ≤ 120 KB; JPEG SOI bytes `FF D8`) and `the wallpaper source and licence are recorded` (SOURCES.json has one record with `id: 'morphogenesis'`, `credit` containing `Jakub Steiner`, `licence: 'CC BY-SA 3.0'`, `source` starting `https://gitlab.gnome.org/GNOME/gnome-backgrounds`); no `.jpg` in the folder outside those four.
  - `scripts.test.js`: `wallpapers.ps1 -WhatIf prints the docker render without running it` (mentions `morphogenesis-l.svg`, `morphogenesis-d.svg`, `1920x1080`, `-dock`).
- [ ] **Step 2: Run** `npm test`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement** `scripts/wallpapers.ps1` (`SupportsShouldProcess`): downloads the two SVGs from GNOME's gitlab at a pinned commit (record the commit in the script and SOURCES), runs a pinned `ubuntu:24.04` container with `imagemagick librsvg2-bin`, and for each of l→day, d→night: render with `rsvg-convert` to 1920 px wide, center-crop to 1920×1080, write the wallpaper JPEG; then the glass: Gaussian blur (`-blur 0x40` on the 1920×1080), tint (night: `#0a0c12` at 38 %; day: `#faf8f4` at 42 % — the mockup's values), JPEG quality chosen to meet the budget. Run it, delete the old photos, update SOURCES.json and the README credits (remove the Unsplash and CleanFrame-material lines for photos; add Morphogenesis, CC BY-SA 3.0, and that the glass images are derived from it).
- [ ] **Step 4: Run** `npm test`. Expected: PASS except the config/main tests that still name `HOME_WALLPAPER` (Task 3 fixes them) — if any fail, note it in the report rather than editing Task 3's files.
- [ ] **Step 5: Commit** `feat(home): Morphogenesis day/night wallpapers`.

### Task 3: Theme switching (config, boot, tick, images)

**Files:**
- Modify: `home/config.js` (`HOME_LOCATION`, drop `HOME_WALLPAPER`), `home/index.html` (no hard-coded theme class), `home/main.js` (boot + tick + image swap), `home/style.css` (`.theme-light .icon img`), `home/appinfo.json` (0.6.0), `test/home-config.test.js`, `test/home-main.test.js`

**Interfaces:**
- Consumes: `themeFor(date, loc)` (Task 1); the four JPEGs (Task 2).
- Produces: `wallpaperSrc(mode, glass)` → `'assets/wallpapers/morphogenesis-' + (mode === 'light' ? 'day' : 'night') + (glass ? '-dock' : '') + '.jpg'` (pure, exported); a launch param `theme: 'light'|'dark'` that forces the mode (for TV checks, like `perf`).

- [ ] **Step 1: Write failing tests:** `home-config.test.js`: `config.js names the location` (`HOME_LOCATION.name === 'Warsaw'`, lat 52.23, lon 21.01) and no `HOME_WALLPAPER`; `home-main.test.js`: `wallpaperSrc` for the four combinations.
- [ ] **Step 2: Run** `npm test`. Expected: FAIL.
- [ ] **Step 3: Implement:**
  - The forced mode comes from the same launch params `perfParams` reads (`theme: 'light'|'dark'`), or, when there are none, from a `?theme=` query (dev server); anything else is ignored.
  - Before the first `render()`, compute the mode (forced mode wins, else `themeFor(new Date(), HOME_LOCATION)`) and set `document.documentElement.className = 'theme-' + mode`; set the wallpaper `src`; preload the other mode's two images (`new Image()`).
  - In `tickClock`, recompute; on a change, swap the class, the wallpaper `src` and every `.mat-img` `src` in one go (no transition), then `render()`.
  - Keep a glass-broken flag per mode (Review Focus 2).
  - CSS: `.theme-light .icon img { filter: brightness(0); -webkit-filter: brightness(0); }`.
  - Bump `home/appinfo.json` to `0.6.0`.
- [ ] **Step 4: Run** `npm test`; then `node scripts/dev-server.mjs` (see docs/development.md) and check both modes in a browser via the `theme` param. Expected: tests PASS; light mode shows dark text on the day wallpaper, dark mode the night look.
- [ ] **Step 5: Commit** `feat(home): switch day/night with the sun`.

### Task 4: Glass behind the clock

**Files:**
- Modify: `home/main.js` (`renderView`, `alignGlass`), `home/style.css` (`.top`)
- Test: `test/home-main.test.js` only if a pure helper is added

**Interfaces:**
- Consumes: the `.mat`/`.mat-img` structure and `wallpaperSrc(mode, true)` (Task 3).

- [ ] **Step 1:** In `renderView`, when `nav.view === 'home'`, give `.top` a `.mat` with a `.mat-img` (current mode's glass) before the clock and date; generalise `alignGlass` to align every `.mat-img` against `root` (dock and clock). In All apps, `.top` stays as today (no glass).
- [ ] **Step 2:** CSS: on Home, `.top` becomes `position:absolute; left:112px; top:72px; min-width:560px; min-height:200px; padding:24px 32px; border-radius:48px; overflow:hidden; display:inline-block` with the veil background (shown only if the glass image is missing), its text above the glass (`position:relative`). All apps keeps `left:144px; top:96px`.
- [ ] **Step 3: Check** on the dev server in both modes, first with today's date, then with the longest date set by hand in the console (`document.querySelector('.date').textContent = 'poniedziałek, 30 października'`). Expected: the text fits inside the glass with padding; glass lines up with the wallpaper (no visible seam).
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(home): glass behind the clock`.

### Task 5: On the TV (owner's go-ahead) and docs

**Files:**
- Modify: `docs/tv-log.md`, `docs/tv-notes.md` (lasting facts only), `docs/status.md`, `docs/development.md` (wallpapers.ps1, `theme` param)

- [ ] **Step 1:** `scripts/package.ps1`; `scripts/install.ps1 -TvHost 192.168.88.244 -Reboot`.
- [ ] **Step 2:** With Michał watching: the current real mode shows correctly; then launch with `theme: 'light'` and `theme: 'dark'` (luna `launch` params, as `perf.ps1` does) and check both: readable clock and date on glass, dock glass lined up, icons the right colour, All apps readable. Tune the day glass tint via `wallpapers.ps1` if day text is hard to read (repackage, reinstall).
- [ ] **Step 3:** `scripts/perf.ps1 -TvHost 192.168.88.244 -Action right -Steps 9` in each mode. Expected: p95 ≤ 16.7 ms, 0 frames over 33 ms.
- [ ] **Step 4:** Record results in `docs/tv-log.md`; status.md: time-of-day theme done (milestone M2 row), remove it from Next steps; development.md: `wallpapers.ps1` and the `theme` launch param.
- [ ] **Step 5: Commit** `docs: day/night theme on the TV`.
