# M2 Day 1 — Preview Loop, First UI Slice, Hardening, Home-Button Spike

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make UI work possible without a TV round-trip, ship the first M2 home-screen slice (icons, curated Home + All apps, clock, remembered focus, Magic Remote pointer), close the M1-review hardening backlog, then — with device authorisation — verify on the TV, look for a reboot-free upgrade path, and spike the Home-button / power-on hook.

**Architecture:** Part A is repo-only. A zero-dependency Node dev server serves `home/` and injects a mock `WebOSServiceBridge` (fixtures + failure modes), so `main.js` runs unmodified in a desktop browser; a Playwright smoke test drives it at 1920×1080. UI logic stays in pure, Node-tested helpers in `home/main.js`; navigation becomes one pure reducer. Part B is device work, grouped at the end so it can be authorised in one go.

**Tech Stack:** ES5 for everything under `home/` and `services/`; Node 22+ (`node --test`) for tooling; devDependencies `acorn` (ES5 parse check) and `playwright` (browser smoke); PowerShell 5.1-compatible scripts.

**Spec:** `docs/superpowers/specs/2026-10-24-customwebos-design.md` (M2 sketch + non-goals) and `docs/m2-tracking.md` (on-device findings). UI behaviour is shaped by CleanFrame's interaction spec (`C:\Users\Lenovo\source\repos\CleanFrameLG\docs\interaction-behaviour.md`) — reference for shape, not source.

## Global Constraints

- TV runtime (`home/`, `services/`) is ES5; CSS must not rely on features newer than the webOS 4.4 engine (no flex/grid `gap`; prefix flex with `-webkit-`).
- Logical stage is 1920×1080.
- **Non-goal: end-user settings UI.** Home-app curation lives in source (`home/config.js`), not an on-device editor.
- Preview never fakes device success: a launch in the browser reports `preview: launching requires the TV`.
- Every script that touches the TV supports `-WhatIf`. Part B tasks need explicit device authorisation on the day, per AGENTS.md.
- Clock is 24-hour `HH:MM`, local time.
- Bump `home/appinfo.json` version for every TV install (0.3.0 for this slice); each install needs `install.ps1 -TvHost <ip> -Reboot` (see m2-tracking: upgrades break app → service calls until reboot).
- `dev/` and `browser-tests/` are never packaged (`package.ps1` packages `home/` and the service dir only).

## Review Focus

1. **Magic Remote pointer.** Users point and click as often as they use arrows; hover must move focus and click must launch. → Task 4 browser test.
2. **Unreadable or missing icon path.** The app list must not show broken-image glyphs; fall back to initials. → Task 5 unit + browser test.
3. **Curated id not installed** (e.g. Disney+ removed). It must be skipped silently, with no blank row, and the Home list must never end up empty. → Task 6 tests.
4. **localStorage throws or holds corrupt JSON.** The app must start normally with defaults. → Task 8 tests.
5. **Back on the top-level Home view.** Once this is the Home app, Back must not close it into a black screen; it is swallowed. → Task 4 reducer test.

---

## Part A — repo only

### Task 1: Dev server + mock bridge

**Files:**
- Create: `scripts/dev-server.mjs`, `dev/mock-bridge.js`, `dev/fixtures/listApps.json`, `test/dev-server.test.js`
- Modify: `package.json` (add `"dev": "node scripts/dev-server.mjs"`), `.gitattributes` untouched

**Interfaces:**
- Produces: `startDevServer({ port = 4795, host = '127.0.0.1' } = {}) -> Promise<{ url: string, close(): Promise<void> }>` exported from `scripts/dev-server.mjs`; running the file directly starts it and prints the URL.
- Produces: in the browser, `window.WebOSServiceBridge` (mock) with `call(uri, payloadJson)` → async `onservicecallback(json)`, and `window.__mock = { launches: string[] }`.
- Mock modes via query string `?mock=`: `ok` (default, fixture after 150 ms), `slow` (answers after 12 s — exercises the 10 s timeout + retry), `error` (`{"returnValue":false,"errorText":"mock error"}`), `empty` (`{"returnValue":true,"apps":[]}`). `launch` always answers `{"returnValue":false,"errorText":"preview: launching requires the TV"}` and pushes the id to `__mock.launches`.

- [ ] **Step 1: Write `test/dev-server.test.js`**
  - `serves index.html with the mock injected before main.js`: start on port 0, GET `/` → 200, body matches `/<script src="\/__dev\/mock-bridge\.js"><\/script>\s*<script src="main\.js">/`.
  - `serves home/ assets and dev/ fixtures`: GET `/style.css` → 200 `text/css`; GET `/__dev/fixtures/listApps.json` → parses, `returnValue === true`, `apps.length >= 10`.
  - `refuses path traversal`: GET `/../package.json` and `/__dev/../../package.json` → 404.
  - `binds to loopback only`: returned `url` starts with `http://127.0.0.1:`.
- [ ] **Step 2: Run `node --test test/dev-server.test.js`** — expect FAIL (module missing).
- [ ] **Step 3: Implement `scripts/dev-server.mjs`** with `node:http`; `/__dev/*` maps to `dev/`, everything else to `home/`; rewrite only `index.html` by inserting the mock `<script>` immediately before `<script src="main.js">`; resolve paths and reject anything outside the two roots. Content types for `.html .js .css .json .png`.
- [ ] **Step 4: Write `dev/fixtures/listApps.json`** in the service's `listApps` shape, `{returnValue:true, apps:[{id,title,icon}]}`, with these ids in this order (titles as installed): `com.appgeneration.app.radiobymytuner`, `netflix`, `spotify-beehive`, `com.wbd.stream`, `amazon`, `canalplus`, `youtube.leanback.v4`, `org.jazwinski.customwebos.home`, `org.webosbrew.hbchannel`, `pl.tvp.vod.smarttv`, `com.webos.app.browser`, `ipla`, `pl.cda`, `com.webos.app.browser` (deliberate duplicate), `com.apple.appletv`, `com.webos.app.hdmi1`, `com.webos.app.hdmi2`, `com.webos.app.livetv`, plus 22 filler entries `dev.filler.01`…`dev.filler.22` titled `Filler 01`… so the list is ~40 long like the real TV. Give `netflix` an `icon` of `/__dev/fixtures/icon-netflix.png` (copy `home/icon.png`), and `amazon` an `icon` of `/__dev/fixtures/missing.png` (deliberately 404).
- [ ] **Step 5: Implement `dev/mock-bridge.js`** per the Interfaces block (ES5 not required; it never ships).
- [ ] **Step 6: Run `node --test`** — expect all PASS. Then `npm run dev`, open the URL, and confirm the list renders the fixture.
- [ ] **Step 7: Commit** `feat(dev): browser preview with mock luna bridge`.

### Task 2: Playwright smoke test

**Files:**
- Create: `browser-tests/preview.spec.mjs` (outside `test/` — `node --test` auto-discovers everything under `test/`)
- Modify: `package.json` (devDependency `playwright`; script `"check:browser": "node --test browser-tests/"`)

**Interfaces:** Consumes `startDevServer` (Task 1). Produces a helper in the spec file, `openPreview(mode = 'ok') -> Promise<{ page, close }>`, with the viewport at 1920×1080. Tasks 4–8 add cases to this file.

- [ ] **Step 1: Write the cases.**
  - `renders the service list`: `.app-item` count equals the fixture's de-duplicated, self-filtered count (38).
  - `focused item stays on screen while scrolling` (tonight's regression): press ArrowDown 25×; the `.app-item.focused` bounding box satisfies `top >= 0 && bottom <= 1080`; `.app-list` `scrollTop > 0`.
  - `error mode keeps the fallback list and says it is retrying`: `?mock=error` → `.state.note` text matches `/mock error.*retrying/`.
  - `empty mode shows "No apps found."`.
  - `launch reports the preview limitation`: Enter on the first item → error text contains `launching requires the TV`; `window.__mock.launches` has length 1.
- [ ] **Step 2: Run `npx playwright install chromium`, then `npm run check:browser`** — all PASS against today's code (this task pins existing behaviour).
- [ ] **Step 3: Commit** `test(browser): Playwright smoke for the preview`.

### Task 3: ES5 check by parsing, not regex

**Files:** Modify `test/es5.test.js`, `package.json` (devDependency `acorn`).

- [ ] **Step 1: Replace the banned-regex loop** with `acorn.parse(src, { ecmaVersion: 5, sourceType: 'script' })` per runtime file; the assertion message is the file plus acorn's error message. Keep the "no test files in packaged dirs" and "files exist" tests.
- [ ] **Step 2: Add a self-test** `acorn ES5 mode rejects what the TV can't run`: each of these snippets throws: `for (var x of y) {}`, `function f(a = 1) {}`, `var o = { m() {} }`, `` `t` ``, `let a = 1`, `() => 1`, `class A {}`, `var {a} = b`. And `var o = { a: 1 }; // => \`comment\`` parses (comments no longer false-positive).
- [ ] **Step 3: Run `node --test`** — PASS.
- [ ] **Step 4: Commit** `test: ES5 check via acorn parse`.

### Task 4: Key/pointer input and the navigation reducer

**Files:** Modify `home/main.js`, `test/home-main.test.js`, `browser-tests/preview.spec.mjs`.

**Interfaces — Produces (exported from `main.js`):**
- `keyAction(keyCode: number) -> 'up'|'down'|'left'|'right'|'ok'|'back'|null` — 38/40/37/39 arrows, 13 ok, **461 back (webOS)**, 27 and 8 back (browser).
- `ALL_APPS_ID = '__all__'` — the sentinel row at the end of the Home view.
- `nextState(state, action) -> state'`, where `state = { view: 'home'|'all', focusIdx: number, homeItems: Item[], allItems: Item[], launch: string|null }`, `Item = { id: string, title: string, icon: string|null }`. Pure. `launch` is set only on the returned state when an app should be launched, and is null otherwise. Actions are `keyAction` values plus `{ type: 'point', index }` (pointer hover) and `{ type: 'click', index }`.

- [ ] **Step 1: Write the failing unit tests**
  - `keyAction maps webOS and browser keys`: `[38,40,37,39,13,461,27,8,65].map(keyAction)` deep-equals `['up','down','left','right','ok','back','back','back',null]`.
  - `down/up clamp without wrapping`: at the last index, `'down'` keeps the index; at 0, `'up'` keeps 0.
  - `ok on an app sets launch to its id`; `ok on ALL_APPS_ID switches to view 'all', focusIdx 0, launch null`.
  - `back from 'all' returns to 'home' focused on the ALL_APPS_ID row`.
  - `back on 'home' is swallowed` — state deep-equals the input (Review Focus 5).
  - `point moves focus without launching`; `click focuses and launches` (Review Focus 1).
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** and wire `mountUI`: `keydown` → `keyAction` → `nextState`, calling `preventDefault` for every non-null action (including the swallowed back); `mouseover`/`click` on `.app-item` (read `data-index`) → `point`/`click` actions; when `launch` is set, call the service `/launch` the same way `activateFocused` does today. `render()` draws whichever view is current; the All apps view gets a heading "All apps".
- [ ] **Step 4: Browser cases**: hovering the 3rd item gives it `.focused`; clicking it pushes its id to `__mock.launches`; Escape on Home leaves the list visible and unchanged.
- [ ] **Step 5: Run `node --test` and `npm run check:browser`** — PASS.
- [ ] **Step 6: Commit** `feat(home): navigation reducer, webOS Back, Magic Remote pointer`.

### Task 5: App icons with an initials fallback

**Files:** Modify `home/main.js`, `home/style.css`, the tests.

**Interfaces — Produces:**
- `parseLaunchPoints` items gain `icon: string|null` (the launch point's `icon`, else `largeIcon`, else null).
- `iconUrl(path: string|null) -> string|null` — returns null for null or empty. A path starting with `/__dev/` passes through (preview). Any other absolute path becomes `'file://' + path`.
- `appInitials(title: string) -> string` — first letters of the first two words, uppercased: `'Prime Video'` → `'PV'`, `'Netflix'` → `'N'`, `''` → `'?'`.

- [ ] **Step 1: Unit tests** for all three, including `parseLaunchPoints` keeping `icon` and preferring `icon` over `largeIcon`.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** Each row renders a 64×64 icon box before the title. When `iconUrl` is non-null, the box holds an `<img>` whose `onerror` swaps itself for the initials `<span class="initials">` (Review Focus 2); otherwise it renders the initials directly.
- [ ] **Step 4: Browser case**: the Netflix row has a loaded `img` (`naturalWidth > 0`); the Prime Video row shows `.initials` with text `PV` and has no `img`.
- [ ] **Step 5: Run both suites — PASS. Commit** `feat(home): app icons with initials fallback`.

### Task 6: Curated Home apps in source + All apps

**Files:** Create `home/config.js`, `test/home-config.test.js`. Modify `home/index.html` (load `config.js` before `main.js`), `home/main.js` (remove `FALLBACK_APPS`, read the global `HOME_APPS`), `test/home-appinfo.test.js`, `scripts/dev-server.mjs` (injection stays before `main.js`).

**Interfaces:**
- `home/config.js` defines the global `var HOME_APPS = [{ id, title }]` in order: `netflix` Netflix, `youtube.leanback.v4` YouTube, `amazon` Prime Video, `com.wbd.stream` Max, `canalplus` Canal+, `com.apple.appletv` Apple TV, `com.webos.app.livetv` Live TV, `com.webos.app.hdmi1` HDMI 1, `org.webosbrew.hbchannel` Homebrew Channel. It doubles as the fallback list when the service is unavailable.
- `splitHomeApps(installed: Item[], homeApps: {id,title}[]) -> { home: Item[], all: Item[] }`:
  - `home` holds the installed items whose id is in `homeApps`, in `homeApps` order.
  - `all` holds every installed item, sorted by title with `localeCompare`.
  - If `home` would be empty but `installed` isn't, `home` becomes the first 9 of `all`.
  - `home` never contains the ALL_APPS_ID row; the reducer appends it.
- The fallback path becomes `splitHomeApps(HOME_APPS with icon:null, HOME_APPS)`.

- [ ] **Step 1: Tests**:
  - `splitHomeApps keeps curated order`.
  - `skips curated ids that aren't installed` (Review Focus 3).
  - `falls back to the first 9 of all when no curated id is installed`.
  - `all is alphabetical and includes curated apps`.
  - config test: load `home/config.js` with `vm.runInNewContext`; ids unique; includes `netflix`; ≤ 9 entries.
  - appinfo test: `index.html` loads `config.js` before `main.js`.
- [ ] **Step 2: Run — FAIL. Step 3: Implement**; `chooseApps` and the fallback path feed `splitHomeApps`. Move or delete the `FALLBACK_APPS` tests (now covered by the config test).
- [ ] **Step 4: Browser cases**: Home shows the fixture's curated apps in config order, then "All apps". OK on "All apps" shows 38 rows, alphabetical; Back returns to the "All apps" row. **Move Task 2's `renders the service list` (38) and `focused item stays on screen` cases into the All apps view.** Home is now ~9 rows and no longer scrolls.
- [ ] **Step 5: Run both suites — PASS. Commit** `feat(home): curated Home apps in config.js plus All apps view`.

### Task 7: Clock

**Files:** Modify `home/main.js`, `home/style.css`, tests.

**Interfaces — Produces:** `formatClock(date: Date) -> 'HH:MM'` (24 h, zero-padded, local time) and `msToNextMinute(date: Date) -> number` (1…60000).

- [ ] **Step 1: Tests**: `formatClock(new Date(2026,9,25,7,5))` → `'07:05'`; `23:59` stays `'23:59'`; `0:00` → `'00:00'`. `msToNextMinute` at `:30.250` → `29750`; at exactly `:00.000` → `60000`.
- [ ] **Step 2: Run — FAIL. Step 3: Implement**; render the clock top-right in the header row, updating it on a `setTimeout(msToNextMinute(now))` chain (not `setInterval`) and on visibility return (Task 8).
- [ ] **Step 4: Browser case**: `.clock` text matches `/^\d{2}:\d{2}$/`.
- [ ] **Step 5: Commit** `feat(home): 24h clock`.

### Task 8: Remembered focus + visibility/resume

**Files:** Modify `home/main.js`, tests.

**Interfaces — Produces:** `PREFS_KEY = 'customwebos.home.v1'`, `loadPrefs(storage) -> { lastAppId: string|null }`, and `savePrefs(storage, prefs) -> boolean`. Neither ever throws: a null storage, a storage that throws, or corrupt JSON all yield the defaults (or `false` from `savePrefs`).

- [ ] **Step 1: Tests** with a fake storage object: round-trip; `loadPrefs` on `'{not json'` → defaults; on a storage whose `getItem` throws → defaults; `savePrefs` with a throwing `setItem` → `false`; `loadPrefs(null)` → defaults (Review Focus 4).
- [ ] **Step 2: Run — FAIL. Step 3: Implement**; save `lastAppId` on every launch. On mount and on list refresh, focus `lastAppId` in the Home view via `focusIndexFor`. On `visibilitychange` to visible: refresh the clock, and call `requestApps(0)` unless a retry is already scheduled.
- [ ] **Step 4: Browser case**: launch the 3rd Home app, reload the page, and the 3rd app is focused.
- [ ] **Step 5: Commit** `feat(home): remember last app, refresh on resume`.

### Task 9: PowerShell `SupportsShouldProcess`

**Files:** Modify `scripts/package.ps1`, `scripts/install.ps1`, `scripts/register-service.ps1`.

- [ ] **Step 1:** Replace each hand-rolled `[switch]$WhatIf` with `[CmdletBinding(SupportsShouldProcess)]` and gate side effects with `$PSCmdlet.ShouldProcess(target, action)`. Keep printing the exact `would run: …` lines, because `test/scripts.test.js` asserts them. `install.ps1` already has `[CmdletBinding]`, so add `SupportsShouldProcess` to it.
- [ ] **Step 2: Run `node --test`** — the existing `-WhatIf` tests stay green unchanged. That's the acceptance criterion.
- [ ] **Step 3: Commit** `refactor(scripts): use SupportsShouldProcess for -WhatIf`.

---

## Part B — on the TV (needs explicit authorisation on the day)

### Task 10: Install 0.3.0 and verify Part A on the device

- [ ] Bump to `0.3.0`; run `package.ps1`, then `install.ps1 -TvHost 192.168.88.244 -Reboot`. Wait for the bus (~5 min after boot).
- [ ] Owner checks with the remote:
  - curated Home order and "All apps"
  - Back behaviour
  - pointer hover and click
  - the clock
  - remembered app after relaunch
- [ ] **Added by the Part A final review:**
  - **Back on Home** (`disableBackHistoryAPI: true` is now set): confirm it stays on CustomWebOS and doesn't close or background it.
  - **OK with the pointer visible:** check whether it sends both keydown 13 and `click`, which would launch twice.
  - **The `⋯` glyph** on the All apps row: confirm it renders; if not, use `…`.
  - **Resume:** does `visibilitychange` fire when returning to the already-running app?
- [ ] **Icons:** confirm whether `file:///media/cryptofs/...` icons load inside the web app. If they don't, record it in `docs/m2-tracking.md` and choose a follow-up: either the service returns the icon as a data URL, or initials stay.
- [ ] Record the results in `docs/m2-tracking.md`; commit `docs: 0.3.0 on-device results`.

### Task 11: Reboot-free upgrade investigation

Each step is a hypothesis: install a version bump without `-Reboot`, try one candidate, and test with the app's `listApps` traced in `ls-monitor`. A trace showing `home-<pid> → home.service` with a reply counts as success.

- [ ] Candidate 1: `ls-control scan-volatile-dirs` (we already know `scan-services` doesn't help).
- [ ] Candidate 2: re-run `register-service.sh` (rewrites the files and SIGHUPs the hub).
- [ ] Candidate 3: restart WebAppMgr (find its upstart job name with `initctl list | grep -i webapp`). Only on the owner's say-so, because it closes every running web app.
- [ ] If one works, make it the default post-install step in `install.ps1`, keep `-Reboot` as an option, update `scripts.test.js`, setup.md §4.3 and m2-tracking, and commit. If none works, record the negative results.

### Task 12: Home button / power-on spike

**Deliverable:** `docs/home-button.md` with the candidates, evidence and a rollback for each, plus at most one applied candidate, with the owner watching.

- [ ] **Research (repo-only):**
  - webosbrew docs and Hbchannel source for 0.7.3: is there a supported way to replace the Home target or the boot app on webOS 4.x?
  - how LG's own home (`com.webos.app.home` and its launch point) is wired
  - whether `applicationManager` has a settable default/home app on 4.4
  - Record findings with links; write nothing on the TV yet.
- [ ] **Recovery first:** confirm SSH works independently of what's on screen; it does, since dropbear starts from init.d. Then write the exact undo command for each candidate into `docs/home-button.md` and into `.local/webos/recovery.md`.
- [ ] **Fallback candidate if no Home hook exists:** an `/var/lib/webosbrew/init.d/customwebos-autostart` script that waits until `applicationManager` answers, then launches `org.jazwinski.customwebos.home`. That gives "power-on shows CustomWebOS" even without the Home button. Rollback: delete the file and reboot. Ship it as `scripts/autostart.sh`, with a `scripts/autostart.ps1` wrapper that supports `-WhatIf` and `-Remove`, plus dry-run tests in `scripts.test.js`.
- [ ] Apply one candidate with the owner's go-ahead. The owner verifies power-on, and the Home button if attempted. Run the rollback once to prove it works, then re-apply if the owner wants to keep it. Record the results; commit.

---

## Self-review notes

- **Spec coverage:** M2 sketch items: clock (T7), remote navigation that feels good (T4, T8), "settings for the few things" → config.js per the non-goal (T6). Wallpapers moved to M3's slideshow (design doc updated 2026-10-24). Every M1-review minor is covered: ES5 holes (T3), `.focus()` replaced by the reducer and pointer (T4), visibility/resume (T8), ShouldProcess (T9), and the §4.4 offline fallback via `docs/home-button.md` (T12). CSS transitions are kept on purpose; they were verified harmless on-device.
- **Out of scope:** M3 signal-loss slideshow, orchestrator, overlays.
