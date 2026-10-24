# CustomWebOS M1 Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce the first commit series of CustomWebOS — a new personal webOS platform repo — containing the design doc, legal/convention artifacts, a Michał-voiced setup guide, a minimal home-screen app skeleton (ES5, enough to launch Netflix via the remote), and PowerShell build/install wrappers. M1 ends at artifacts; device install is a separate authorised task.

**Architecture:** Single new local repo at `C:\Users\Lenovo\source\repos\CustomWebOS`. Monorepo layout — `docs/`, `home/`, `scripts/`, top-level governance files. No framework, no bundler; vanilla ES5 in `home/`; Node's built-in `--test` runner for JS tests; PowerShell scripts testable via explicit `-WhatIf` output. Each task ends with a self-contained commit. GitHub remote creation and push are explicitly post-M1.

**Tech Stack:** webOS 4.4 web engine (ES5 runtime), Node 22+ (`node --test`), PowerShell 7+, `ares-cli` from LG WebOS TV SDK (invoked by scripts, not required by M1 tests).

**Spec:** `C:\Users\Lenovo\source\repos\CustomWebOS\docs\superpowers\specs\2026-10-24-customwebos-design.md`

## Global Constraints

Every task's requirements implicitly include these.

- **Target TV:** LG OLED55C8PLA, webOS 4.4.3-22 (codenames `goldilocks` / `gorongosa`), firmware **05.50.70**. All device-side examples assume this reference.
- **TV runtime JS: ES5-compatible by default.** No `const`, `let`, arrow functions, template literals, `class`, `async`/`await`, destructuring, spread, `Promise` without a polyfill in `home/` runtime code. Node tooling and tests may use modern JS.
- **SSH to the TV:** port **22022** (LAN router drops :22 to clients), pubkey auth only (`/etc/shadow` is read-only on webOS, `passwd` cannot change the password). Key pair reference: `C:\Users\Lenovo\.ssh\id_ed25519_lgtv`.
- **Dev machine:** Windows 11 Pro, PowerShell-first scripts, Bash fallback acceptable.
- **License:** MIT, copyright `© 2026 Michał Jaźwiński`.
- **Upstream credit:** README only, Nathan named exactly once there. No credit lines in file headers.
- **Private state:** `.local/` and `dist/` are gitignored and never committed.
- **Home app package id:** `org.jazwinski.customwebos.home`.
- **Repo is destined to be public**, but creating the GitHub remote and pushing is **a separate post-M1 task** requiring explicit authorization from Michał.

## Review Focus

Five input classes the spec implies that no obvious task test exercises, most likely to bite first:

1. **ES2015+ syntax sneaks into `home/main.js`.** TV's older Chromium rejects it; symptom is a silent white screen. Task 6 adds a syntax-scan test that rejects `const\s`, `let\s`, ` => `, backtick strings, `class\s`, `async\s`, `\.\.\.`, destructuring literals.
2. **`listLaunchPoints` returns an error object** (service denied, bridge missing, running in a non-webOS browser). The UI must show an error, not crash to a blank screen. Task 6 adds a mock-bridge-fails test.
3. **`listLaunchPoints` returns an empty array.** The UI must show a "no apps" state, not a silent blank. Task 6 adds a mock-empty-list test.
4. **Launch is invoked for an app id not in the current list** (stale UI state after a listing refresh). Task 6 adds a stale-id test: launch only succeeds for ids returned by the most recent `listLaunchPoints`.
5. **`home/appinfo.json` ships with a mistyped id.** Autostart hooks and installers key off `id`; a bad id installs the app under an unexpected identity. Task 5 adds a schema check: `id` must match `^org\.jazwinski\.customwebos\.[a-z]+$` and match the spec's constant `org.jazwinski.customwebos.home`.

---

### Task 1: Repo bootstrap + commit 1

**Files:**
- Create: `.gitignore`
- Create: `LICENSE`
- Already present: `docs/superpowers/specs/2026-10-24-customwebos-design.md`
- Already present: `docs/superpowers/plans/2026-10-24-m1-foundation.md` (this file)

**Interfaces produced:** a git repo at `C:\Users\Lenovo\source\repos\CustomWebOS\`, default branch `main`, exactly one commit authored by Michał Jaźwiński <michal.jazwinski@gmail.com>, containing the four files above.

- [ ] **Step 1: Write `LICENSE`**

Standard MIT text, copyright line exactly `Copyright (c) 2026 Michał Jaźwiński`. No deviations from the OSI MIT template.

- [ ] **Step 2: Write `.gitignore`**

Entries (one per line, no comments): `/.local/`, `/dist/`, `/node_modules/`, `.DS_Store`, `*.ipk`, `.vs/`, `.idea/`, `__pycache__/`, `*.pyc`.

- [ ] **Step 3: Run the verification; expect fail**

From `C:\Users\Lenovo\source\repos\CustomWebOS`:
```powershell
git log --oneline 2>&1
```
Expected: fatal error — not a git repository (nothing initialised yet).

- [ ] **Step 4: Initialise repo and make commit 1**

```powershell
Push-Location C:\Users\Lenovo\source\repos\CustomWebOS
git init -b main
git add LICENSE .gitignore docs/
git commit -m @'
feat: initial design doc, implementation plan, and licence

CustomWebOS begins here. Credit to CleanFrame lives in the README
that follows.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
'@
Pop-Location
```

- [ ] **Step 5: Run verification; expect pass**

```powershell
Push-Location C:\Users\Lenovo\source\repos\CustomWebOS
$log = git log --format='%an|%ae|%s'
$files = git show --name-only --format='' HEAD
Pop-Location
```
Expected: `$log` is one line, author `Michał Jaźwiński`, email `michal.jazwinski@gmail.com`; `$files` contains `LICENSE`, `.gitignore`, `docs/superpowers/specs/2026-10-24-customwebos-design.md`, `docs/superpowers/plans/2026-10-24-m1-foundation.md`.

(No separate commit step — the commit is Step 4.)

---

### Task 2: README with upstream credit

**Files:**
- Create: `README.md`

**Interfaces produced:** none consumed by other tasks; this is reader-facing.

- [ ] **Step 1: Write the content-assertion test**

Create a scratch verification script invoked by `pwsh`:
```powershell
$r = Get-Content C:\Users\Lenovo\source\repos\CustomWebOS\README.md -Raw
if ($r -notmatch 'CustomWebOS') { throw 'missing project name' }
if ($r -notmatch '\[CleanFrame\]\(https://github\.com/nthnclrk/CleanFrame\)') { throw 'missing CleanFrame credit link' }
if ($r -notmatch 'Nathan Clerk') { throw 'missing Nathan Clerk name' }
if ((Select-String -Path C:\Users\Lenovo\source\repos\CustomWebOS\README.md -Pattern 'Nathan').Matches.Count -ne 1) { throw 'Nathan should appear exactly once' }
if ($r -notmatch '\]\(docs/superpowers/specs/2026-10-24-customwebos-design\.md\)') { throw 'missing design-doc link' }
if ($r -notmatch '\]\(docs/setup\.md\)') { throw 'missing setup-guide link' }
if ($r -notmatch 'LG') { throw 'missing LG context' }
if ($r -notmatch 'webOS') { throw 'missing webOS context' }
if ($r -notmatch 'MIT') { throw 'missing licence note' }
Write-Output OK
```
This is a one-shot verification; the test lives in-line, not as a committed file.

- [ ] **Step 2: Run; expect fail**

README doesn't exist; `Get-Content` throws. That's the fail state.

- [ ] **Step 3: Write `README.md`**

Structure:
- `# CustomWebOS` title.
- One-paragraph pitch: what it is (personal webOS platform anchored by a home-screen replacement; grows to orchestrate custom apps on the TV), target TV (LG C8, webOS 4.x).
- "## Credits" section with the credit line: *"Inspired by [CleanFrame](https://github.com/nthnclrk/CleanFrame) by Nathan Clerk — a quieter home screen for the Samsung Frame. CustomWebOS carries the shape of its setup playbook and reshapes it for LG webOS. No code is ported directly."*
- "## Status" one-line sentence noting it's at M1 Foundation; link to the design doc at `docs/superpowers/specs/2026-10-24-customwebos-design.md`.
- "## Setting it up" one-line pointer to `docs/setup.md`.
- "## Licence" one line: MIT, link to `LICENSE`.

Michał's voice: direct, pragmatic first-person-singular, lowercase informal is fine. No corporate-doc measured tone.

- [ ] **Step 4: Run verification; expect pass**

Output `OK`.

- [ ] **Step 5: Commit**

```powershell
git add README.md
git commit -m @'
docs: add README with pitch and CleanFrame credit

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
'@
```

---

### Task 3: AGENTS.md with maintainer-neutral conventions

**Files:**
- Create: `AGENTS.md`

**Interfaces produced:** project conventions documented once; later tasks reference these rather than restate them.

- [ ] **Step 1: Write the content-assertion test**

```powershell
$a = Get-Content C:\Users\Lenovo\source\repos\CustomWebOS\AGENTS.md -Raw
foreach ($req in @(
  'device-access',          # the authority rule
  'ES5',                    # TV runtime constraint
  'PowerShell',             # scripts-first
  '\.local/', 'dist/',      # gitignored paths
  'README',                 # credit lives there
  'org\.jazwinski\.customwebos'  # package id namespace
)) { if ($a -notmatch $req) { throw "AGENTS.md missing: $req" } }
if ($a -match 'Nathan|CleanFrame|Samsung|Tizen|Pangram') { throw 'AGENTS.md must not reference upstream maintainer or Samsung lineage' }
Write-Output OK
```

- [ ] **Step 2: Run; expect fail**

File doesn't exist yet.

- [ ] **Step 3: Write `AGENTS.md`**

One-page document, no headers deeper than `##`. Required substance:
- Opening paragraph: what CustomWebOS is in one sentence, cross-link to design doc.
- Device-access rule: tasks that touch the TV (SSH, install, autostart changes, rollback drills) require explicit per-task authorisation from the repo owner. Browser/repo-only work does not.
- Runtime JS: ES5-compatible in `home/` and anything else that runs on the TV. Node tooling and tests may use modern JS.
- Scripts: PowerShell-first. Bash fallback acceptable where PowerShell is awkward. Scripts must support a `-WhatIf` / dry-run flag where they'd otherwise call out to `ares-cli` or SSH.
- Package id namespace: `org.jazwinski.customwebos.*`; the home app is `org.jazwinski.customwebos.home`.
- Private state: `.local/` and `dist/` are gitignored. Firmware archives, SSH keys, device identifiers, and recovery baselines live there.
- Upstream credit: the README is the only place that mentions CleanFrame or Nathan. No credit lines in file headers.

Maintainer-neutral: do not say "I" / "Michał" / "Nathan". Write as the project's rules, applicable to whoever maintains the repo.

- [ ] **Step 4: Run verification; expect pass**

- [ ] **Step 5: Commit**

```powershell
git add AGENTS.md
git commit -m @'
docs: add AGENTS.md with project conventions

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
'@
```

---

### Task 4: Setup guide in Michał's voice

**Files:**
- Create: `docs/setup.md`

**Interfaces produced:** none code-consumed; reader-facing. Later tasks (home app, scripts) reference it from their READMEs/comments by path only.

**Content reference, not template:** `C:\Users\Lenovo\source\repos\CleanFrameLG\docs\lg-webos-setup.md` (CleanFrameLG's version). Read it for facts, timings, and the stage structure. Do not quote its prose; the final document is a full first-person re-draft in Michał's voice (pragmatic, direct, informal where natural).

**Session evidence to fold in** (not in the CleanFrameLG guide): read `C:\Users\Lenovo\source\repos\CleanFrameLG\.local\webos\baseline.txt` for the exact firmware SHA256s, port-22022 workaround details, pubkey-not-passwd rationale, and Hbchannel 0.7.3 toggle semantics.

- [ ] **Step 1: Write the content-assertion test**

```powershell
$s = Get-Content C:\Users\Lenovo\source\repos\CustomWebOS\docs\setup.md -Raw
# §0: pre-flight / baseline
if ($s -notmatch '0\.50\.70') { throw 'missing firmware version 05.50.70' }
if ($s -notmatch '3b21a86ce1fb4c7055535f5ce08c1461b48cfb4da86f2873b12129e8490c6b55') { throw 'missing dejavuln-era firmware SHA256' }
if ($s -notmatch 'OLED55C8PLA') { throw 'missing reference model' }
# §1: pre-flight checks
if ($s -notmatch 'Developer Mode') { throw 'missing Dev Mode warning' }
if ($s -notmatch 'FAT32') { throw 'missing USB-format note' }
# §2: root
if ($s -notmatch 'dejavuln-autoroot') { throw 'missing root tool name' }
if ($s -notmatch 'v?0\.0\.10') { throw 'missing dejavuln version' }
if ($s -notmatch '83F39E95EC702E6370DF65BDE16ACCED9861A87E473F763A9E55DE948AA7756F|83f39e95ec702e6370df65bde16acced9861a87e473f763a9e55de948aa7756f') { throw 'missing dejavuln SHA256' }
# §3: Hbchannel + SSH
if ($s -notmatch 'Homebrew Channel') { throw 'missing Hbchannel' }
if ($s -notmatch '0\.7\.3') { throw 'missing Hbchannel 0.7.3 version' }
if ($s -notmatch 'authorized_keys') { throw 'missing pubkey auth note' }
if ($s -notmatch '[Rr]ead-only.*shadow|/etc/shadow') { throw 'missing passwd/read-only-shadow note' }
if ($s -notmatch '22022') { throw 'missing port-22022 workaround' }
if ($s -notmatch 'init\.d') { throw 'missing init.d hook note' }
# §4: install enumeration (autostart candidates)
if ($s -notmatch 'autostart|Home.?button') { throw 'missing autostart section' }
if ($s -notmatch 'ares-package|ares-install') { throw 'missing ares-cli packaging references' }
# §Rollback: must have at least two tiers
$rollbacks = (Select-String -Path C:\Users\Lenovo\source\repos\CustomWebOS\docs\setup.md -Pattern 'Rollback|rollback' -AllMatches).Matches.Count
if ($rollbacks -lt 2) { throw 'rollback section too thin' }
# Voice / no leftover branding
if ($s -match 'Samsung|Tizen|Pangram|Nathan|CleanFrame') { throw 'leftover Samsung/Tizen/Nathan/CleanFrame reference (credit lives in README only)' }
Write-Output OK
```

- [ ] **Step 2: Run; expect fail**

File doesn't exist.

- [ ] **Step 3: Write `docs/setup.md`**

Structure (matches the spec's agreed shape):
- **§0 Pre-flight / baseline** (offline, no device access): firmware `.epk` download from LG support (give the gscs-b2c link format, SHA256s), firmware string capture, LAN IP capture, deliberate skip options.
- **§1 Pre-root checks** (TV side): Developer Mode app absent (uninstall or confirm not installed), Auto Update off, Quick Start+ off, FAT32 USB (not exFAT).
- **§2 Root with dejavuln-autoroot v0.0.10:** archive URL, SHA256, extraction note (Windows filesystems can't hold `/` in filenames so nested dirs are expected and correct), USB plug + Media Player steps, verification (Hbchannel app appears post-reboot).
- **§3 Homebrew Channel essentials for 0.7.3:**
  - Toggle semantics: Telnet, SSH server, Block system updates, Failsafe mode.
  - Pubkey auth is the only path (`passwd` doesn't work — `/etc/shadow` is read-only; startup.sh bind-mounts the default-`alpine` shadow until `authorized_keys` exists).
  - SSH key generation on Windows (`ssh-keygen -t ed25519`), pubkey install via the TV's telnet (or an initial password login), test SSH login.
  - **Port-22-vs-router troubleshooting:** if port 22 is unreachable from the LAN while telnet (23) works, drop the one-line init.d hook that runs `dropbear -R -p 22022`; show the exact script.
- **§4 Install CustomWebOS:**
  - Build with `ares-package home/` (produces `.ipk` in `dist/`).
  - Install with `ares-install -d <device>`.
  - **Autostart candidates (enumerated, each with rollback):** at least two patterns from current webosbrew-community recommendations for 0.7.3 (e.g., `/var/lib/webosbrew/init.d/` script setting Home via `luna-send`, and the `applicationManager/launch` default-launchpoint override). For each: how to apply, how to verify, how to roll back cleanly. If webosbrew docs change between now and install, Michał picks at install time.
- **§Rollback A / B / C / D:** inherit the ladder from CleanFrameLG's guide (nothing-rooted-yet, want-root-gone, TV-misbehaving, TV-won't-boot). Reshape in Michał's voice.

Voice: pragmatic first-person. Where the CleanFrameLG guide says "the maintainer" or hides agency, Michał writes "I". Avoid the corporate-doc measured tone; writing like it's a note to a smart friend is fine. No Samsung/Tizen/Mac references.

- [ ] **Step 4: Run verification; expect pass**

- [ ] **Step 5: Commit**

```powershell
git add docs/setup.md
git commit -m @'
docs: add setup guide (baseline → root → hbchannel → install → rollback)

Full re-draft in my voice. Content derived from the LG session but
reshaped — no Samsung/Tizen/Mac phrasing left. Lessons from the
actual run folded in: Hbchannel 0.7.3 toggle semantics, pubkey auth
only (read-only /etc/shadow), port-22022 workaround via init.d hook.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
'@
```

---

### Task 5: Home app manifest and static shell

**Files:**
- Create: `home/appinfo.json`
- Create: `home/index.html`
- Create: `home/style.css`
- Create: `home/icon.png`
- Create: `home/appinfo.test.js`

**Interfaces produced:**
- `home/appinfo.json` with `"id": "org.jazwinski.customwebos.home"`, `"title": "CustomWebOS Home"`, `"type": "web"`, `"main": "index.html"`, `"vendor": "Michał Jaźwiński"`, `"version": "0.1.0"`, `"icon": "icon.png"`. These are the exact field names and values later tasks (scripts/, main.js) expect.
- `home/index.html` loads `style.css` then `main.js` (both as same-directory relative paths).

- [ ] **Step 1: Write `home/appinfo.test.js`**

```javascript
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const appinfo = JSON.parse(fs.readFileSync(path.join(__dirname, 'appinfo.json'), 'utf8'))

test('appinfo.id matches namespace and is the home app', () => {
  assert.match(appinfo.id, /^org\.jazwinski\.customwebos\.[a-z]+$/)
  assert.equal(appinfo.id, 'org.jazwinski.customwebos.home')
})

test('appinfo has required webOS fields', () => {
  for (const field of ['id', 'title', 'type', 'main', 'vendor', 'version', 'icon']) {
    assert.ok(appinfo[field], `missing field: ${field}`)
  }
  assert.equal(appinfo.type, 'web')
  assert.equal(appinfo.main, 'index.html')
})

test('index.html references style.css and main.js', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8')
  assert.match(html, /href=["']style\.css["']/)
  assert.match(html, /src=["']main\.js["']/)
})

test('icon.png exists and is a PNG', () => {
  const buf = fs.readFileSync(path.join(__dirname, 'icon.png'))
  // PNG magic: 89 50 4E 47 0D 0A 1A 0A
  assert.deepEqual(buf.subarray(0, 8), Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]))
})
```

- [ ] **Step 2: Run; expect fail**

```powershell
node --test home/appinfo.test.js
```
Expected: all four tests fail (files don't exist).

- [ ] **Step 3: Write `home/appinfo.json`**

Exact content (values pinned by the test):
```json
{
  "id": "org.jazwinski.customwebos.home",
  "title": "CustomWebOS Home",
  "type": "web",
  "main": "index.html",
  "vendor": "Michał Jaźwiński",
  "version": "0.1.0",
  "icon": "icon.png"
}
```

- [ ] **Step 4: Write `home/index.html`**

Minimal HTML5 shell: `<!doctype html>`, `<html lang="en">`, `<head>` with `<meta charset="utf-8">`, `<meta name="viewport" content="width=1920, initial-scale=1">`, `<title>CustomWebOS Home</title>`, `<link rel="stylesheet" href="style.css">`. `<body>` with one `<main id="root">` and `<script src="main.js"></script>`.

- [ ] **Step 5: Write `home/style.css`**

Minimal for M1 UI scope ("enough to launch Netflix with the remote"): dark background, white text, a vertical list of app tiles with large hit targets, visible focus ring on the currently-focused item. No wallpapers, no clock, no decoration. 1920×1080 logical stage. Specifics are the builder's call within those constraints.

- [ ] **Step 6: Create `home/icon.png`**

An 80×80 PNG. For M1, generate a plain-colour placeholder (dark background, "CW" monogram, or a solid colour swatch). Any PNG that passes the magic-bytes test is fine; aesthetics come in a later milestone.

Generate it with PowerShell/.NET (System.Drawing) or Node's built-in buffer writing; whichever is simpler for the builder.

- [ ] **Step 7: Run; expect pass**

```powershell
node --test home/appinfo.test.js
```

- [ ] **Step 8: Commit**

```powershell
git add home/
git commit -m @'
feat(home): manifest, shell, placeholder icon

webOS app skeleton pinned to id org.jazwinski.customwebos.home. No
logic yet — that's the next task.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
'@
```

---

### Task 6: Home app logic (ES5) with unit tests

**Files:**
- Create: `home/main.js`
- Create: `home/main.test.js`
- Modify: nothing

**Interfaces consumed:** `home/appinfo.json` (not imported, but same package).

**Interfaces produced:** `home/main.js` is loaded by `home/index.html` and must expose, for testability, these pure helpers via a `module.exports` block that is a no-op in the browser:
- `parseLaunchPoints(raw: object) -> Array<{id: string, title: string}>` — pulls id/title pairs out of a `com.webos.applicationManager/listLaunchPoints` response; returns `[]` for an error-shaped response.
- `buildLaunchParams(id: string, availableIds: string[]) -> {ok: boolean, params?: object, reason?: string}` — returns `{ok: true, params: {id}}` when `id` is in `availableIds`, otherwise `{ok: false, reason: "stale-id"}`.
- `syntaxOk(source: string) -> boolean` — not an export; the ES5-only syntax scan test runs against `main.js`'s own source using a regex set in the test file.

- [ ] **Step 1: Write `home/main.test.js`**

```javascript
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

// Load main.js into Node; its export block runs only when `module` is defined.
const main = require('./main.js')

test('parseLaunchPoints returns id/title for a valid response', () => {
  const raw = {
    returnValue: true,
    launchPoints: [
      {id: 'netflix', title: 'Netflix'},
      {id: 'youtube.leanback.v4', title: 'YouTube'},
    ],
  }
  assert.deepEqual(main.parseLaunchPoints(raw), [
    {id: 'netflix', title: 'Netflix'},
    {id: 'youtube.leanback.v4', title: 'YouTube'},
  ])
})

test('parseLaunchPoints returns [] on error-shaped response', () => {
  assert.deepEqual(main.parseLaunchPoints({returnValue: false, errorText: 'denied'}), [])
})

test('parseLaunchPoints returns [] on empty launchpoints array', () => {
  assert.deepEqual(main.parseLaunchPoints({returnValue: true, launchPoints: []}), [])
})

test('buildLaunchParams accepts an id in the available list', () => {
  const r = main.buildLaunchParams('netflix', ['netflix', 'youtube.leanback.v4'])
  assert.equal(r.ok, true)
  assert.deepEqual(r.params, {id: 'netflix'})
})

test('buildLaunchParams rejects a stale id', () => {
  const r = main.buildLaunchParams('netflix', ['youtube.leanback.v4'])
  assert.equal(r.ok, false)
  assert.equal(r.reason, 'stale-id')
})

test('main.js source is ES5 only', () => {
  const src = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8')
  const banned = [
    { label: 'const',          re: /\bconst\s/ },
    { label: 'let',            re: /\blet\s/ },
    { label: 'arrow fn',       re: /=>/ },
    { label: 'template string', re: /`/ },
    { label: 'class',          re: /\bclass\s+\w/ },
    { label: 'async',          re: /\basync\s/ },
    { label: 'spread/rest',    re: /\.\.\./ },
    { label: 'destructuring',  re: /\b(?:var|let|const)\s*(?:\{|\[)/ },
  ]
  for (const b of banned) {
    assert.ok(!b.re.test(src), 'ES2015+ syntax found: ' + b.label)
  }
})
```

- [ ] **Step 2: Run; expect fail**

```powershell
node --test home/main.test.js
```
Expected: all tests fail — `main.js` not yet implementing the exports.

- [ ] **Step 3: Implement `home/main.js`**

ES5 only. Shape:
```javascript
// top of file: pure helpers
function parseLaunchPoints(raw) { /* body: return [] on bad shape, map {id,title} otherwise */ }
function buildLaunchParams(id, availableIds) { /* body: index check, return {ok,...} */ }

// browser-only runtime (guarded by typeof window): bridge call to
//   luna://com.webos.applicationManager/listLaunchPoints
// render the list in #root with keyboard focus/arrows/OK
// on OK, call buildLaunchParams; if ok, invoke
//   luna://com.webos.applicationManager/launch with its params

// Node-testable export (no-op in browser because `module` is undefined there)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { parseLaunchPoints: parseLaunchPoints, buildLaunchParams: buildLaunchParams }
}
```

The runtime body uses webOS's `webOS.service.request('luna://com.webos.applicationManager', {method, parameters, onSuccess, onFailure})` pattern. If `window.webOS` is undefined (dev-time, non-TV browser), render an error state in `#root`.

- [ ] **Step 4: Run; expect pass**

```powershell
node --test home/main.test.js
```

- [ ] **Step 5: Commit**

```powershell
git add home/main.js home/main.test.js
git commit -m @'
feat(home): ES5 launcher logic with unit tests

Pure helpers parseLaunchPoints and buildLaunchParams are testable in
Node; the browser-side bridge calls into webOS applicationManager.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
'@
```

---

### Task 7: `scripts/package.ps1` (ares-package wrapper)

**Files:**
- Create: `scripts/package.ps1`
- Create: `scripts/package.Tests.ps1` (Pester) OR inline verification; builder's call

**Interfaces consumed:**
- `home/appinfo.json` with id `org.jazwinski.customwebos.home` (Task 5).
- `home/` directory.

**Interfaces produced:**
- `scripts/package.ps1 -WhatIf` prints the exact `ares-package` command it would run, and exits 0 without side effects.
- `scripts/package.ps1` without `-WhatIf` invokes `ares-package home/ -o dist/`, producing a `.ipk` in `dist/`.

- [ ] **Step 1: Write the dry-run verification**

```powershell
$out = pwsh -NoProfile -File scripts/package.ps1 -WhatIf 2>&1 | Out-String
if ($LASTEXITCODE -ne 0) { throw "package.ps1 -WhatIf exit=$LASTEXITCODE" }
if ($out -notmatch 'ares-package') { throw '-WhatIf should print the ares-package command' }
if ($out -notmatch 'home[\\/]') { throw '-WhatIf should name the home/ source' }
if ($out -notmatch 'dist[\\/]?') { throw '-WhatIf should name the dist/ output' }
if (Test-Path dist/*.ipk) { throw 'nothing should be built in -WhatIf mode' }
Write-Output OK
```

- [ ] **Step 2: Run; expect fail**

Script doesn't exist.

- [ ] **Step 3: Implement `scripts/package.ps1`**

Shape:
- `[CmdletBinding(SupportsShouldProcess)]` header so `-WhatIf` is recognised.
- Resolve `$repoRoot` from the script's own path.
- Validate `home/appinfo.json` exists and parses as JSON before invoking anything.
- Ensure `dist/` exists.
- If `$PSCmdlet.ShouldProcess("home/", "ares-package to dist/")`, run `ares-package home/ -o dist/` via the call operator with proper path quoting.
- On non-WhatIf, write the produced `.ipk` filename to stdout for the install script's convenience.

The script does NOT handle sign/signing (webOS user apps don't need it on Hbchannel).

- [ ] **Step 4: Run; expect pass**

- [ ] **Step 5: Commit**

```powershell
git add scripts/package.ps1
git commit -m @'
feat(scripts): package.ps1 wraps ares-package

-WhatIf prints the command without side effects; real run writes
the .ipk to dist/.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
'@
```

---

### Task 8: `scripts/install.ps1` (ares-install wrapper)

**Files:**
- Create: `scripts/install.ps1`

**Interfaces consumed:**
- The `.ipk` produced by `scripts/package.ps1` under `dist/` (Task 7).
- An `ares-setup-device` entry on the dev machine configured for Michał's TV via its SSH pubkey (set up during device install, outside M1).

**Interfaces produced:**
- `scripts/install.ps1 -WhatIf` prints the exact `ares-install` command and exits 0 without side effects.
- `scripts/install.ps1 -Device <name>` runs `ares-install -d <name> dist/<app>.ipk`.

- [ ] **Step 1: Write the dry-run verification**

```powershell
# Pre-arrange a stub .ipk so the script has something to point at
New-Item -ItemType Directory -Force dist | Out-Null
Set-Content dist/org.jazwinski.customwebos.home_0.1.0_all.ipk 'stub'
$out = pwsh -NoProfile -File scripts/install.ps1 -Device tv -WhatIf 2>&1 | Out-String
if ($LASTEXITCODE -ne 0) { throw "install.ps1 -WhatIf exit=$LASTEXITCODE" }
if ($out -notmatch 'ares-install') { throw '-WhatIf should print ares-install' }
if ($out -notmatch '-d\s+tv') { throw '-WhatIf should name the -d device' }
if ($out -notmatch 'dist[\\/]org\.jazwinski\.customwebos\.home.*\.ipk') { throw '-WhatIf should name the .ipk path' }
Remove-Item dist/org.jazwinski.customwebos.home_0.1.0_all.ipk
Write-Output OK
```

- [ ] **Step 2: Run; expect fail**

- [ ] **Step 3: Implement `scripts/install.ps1`**

Shape:
- `[CmdletBinding(SupportsShouldProcess)]` + `-Device <string>` mandatory parameter.
- Find the newest `.ipk` in `dist/` whose name starts with `org.jazwinski.customwebos.home`. Error if none.
- If `$PSCmdlet.ShouldProcess($device, "ares-install")`, invoke `ares-install -d $device <path>`.
- No pre-uninstall step (ares-install handles upgrade in place).

- [ ] **Step 4: Run; expect pass**

- [ ] **Step 5: Commit**

```powershell
git add scripts/install.ps1
git commit -m @'
feat(scripts): install.ps1 wraps ares-install

-WhatIf prints the command without side effects; -Device names the
ares-setup-device entry to install onto.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
'@
```

---

## Post-M1 (explicitly out of scope, listed only to avoid surprise)

- Create GitHub repo `CustomWebOS` under Michał's account and push `main`. Requires explicit per-task authorisation.
- Device-authorised install task: `ares-setup-device`, `scripts/package.ps1`, `scripts/install.ps1`, pick one autostart candidate from `docs/setup.md` §4, apply, verify Home-button opens CustomWebOS, Netflix launches, roll back if anything regresses.
- M2+: wallpaper, clock, remote navigation polish, installed-app discovery deepening (icons/categorisation), orchestrator (background services + overlay), signal-loss switcher, doorbell-overlay prototype.
