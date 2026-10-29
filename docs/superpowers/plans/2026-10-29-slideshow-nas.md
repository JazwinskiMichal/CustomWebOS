# No-signal slideshow from the NAS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The no-signal slideshow shows photos from `\\192.168.88.235\CustomWebOS_Slideshow` when that share has photos, else the USB stick's, else LG's screen.

**Architecture:** The PC script turns `.local/slideshow-nas.json` into a root-only fstab line on the TV. When the watcher is about to cover a dark input it mounts the share read-only (kernel CIFS, `mount -T <fstab>`, so the password never appears on a command line) at a fixed mount point that the app reaches through `<app dir>/nas`; the home service's `listPhotos` answers `nas/…` paths when the mount has photos, otherwise `usb/…` as today. The watcher unmounts when the show ends, so each show lists the folder fresh and nothing touches the NAS while HDMI has a picture.

**Tech Stack:** POSIX sh (BusyBox + util-linux `mount` on the TV), Node 0.12 service (ES5), PowerShell scripts, `node --test`.

**Spec:** `docs/superpowers/specs/2026-10-29-slideshow-nas-design.md`

## Global Constraints

- Settings on the TV: `/var/lib/customwebos/nas.fstab`, mode 600, one fstab line; PC source `.local/slideshow-nas.json` = `{"share": "//192.168.88.235/CustomWebOS_Slideshow", "username": "...", "password": "...", "vers": "3.0" (optional)}`. Never in git, chat, logs or a command line.
- Mount point `/tmp/customwebos-nas`; app link `<app dir>/nas` → it; photo paths `nas/<path>`.
- Mount options: `ro,username=…,password=…,ip=<host>,vers=<vers>,sec=ntlmssp,iocharset=utf8,soft,noserverino,nounix,file_mode=0444,dir_mode=0555`.
- Delay cap: mount + liveness check ≤ 5 s (`timeout -t 5`), on top of the 5 s settle; past it, that show falls back to the stick.
- NAS first, no mixing: any NAS photo → only NAS photos; empty, unmounted or failed → the stick's; none → LG's screen.
- Limits as for the stick: 2000 photos, 20 MB per file, 8 levels.
- Scripts: PowerShell with `[CmdletBinding(SupportsShouldProcess)]`; TV shell files LF-only; every `luna-send` gets `< /dev/null`; device work needs Michał's go-ahead.
- Home version bump for the install (opkg refuses a repeated version).

## Review Focus

1. **Password with `,` or spaces** → the fstab line still parses to the same password (`,` doubled for CIFS, whitespace as `\040`) (Task 2 test).
2. **NAS reachable but a mount left stale from an earlier show** (NAS rebooted) → the next show unmounts and remounts instead of hanging `listPhotos` (Task 4 test: a mounted-but-dead mount is unmounted before the remount).
3. **No `nas.fstab` on the TV** (feature not configured) → no mount attempt, the stick path exactly as today (Task 4 test).
4. **The NAS share empty, the stick has photos** → `usb/…` paths (Task 3 test).
5. **The log** → mentions mount success/failure and the photo source, never the password or the fstab line (Task 4 test: log after a failed mount contains no `password`).

---

### Task 1: Probe the mount on the TV (Michał's go-ahead)

**Files:** none in git; results go to `docs/tv-log.md` in Task 5.

- [ ] **Step 1:** Write a temporary root-only fstab on the TV from `.local/slideshow-nas.json` (piped over ssh stdin, never as an argument), `mkdir -p /tmp/customwebos-nas`.
- [ ] **Step 2:** Try `timeout -t 10 mount -T <tmp fstab> /tmp/customwebos-nas` with `vers=3.0`, then `2.1`, then `2.0`; record which mounts, how long it takes (cold NAS and warm), and `ls` of the share including a file with Polish letters.
  Expected: one version mounts read-only in < 5 s warm; names list correctly.
- [ ] **Step 3:** `umount /tmp/customwebos-nas`, delete the temp fstab. If no version mounts: stop and report (the spec's fallback is NFS, then HTTP — a re-plan, not a guess).
- [ ] **Step 4:** Ledger: the working `vers`, timings, any error text (without the password).

### Task 2: `nosignal.ps1 -ConfigureNas` / `-RemoveNas`

**Files:**
- Modify: `scripts/nosignal.ps1`
- Test: `test/nosignal.test.js`

**Interfaces:**
- Produces: `/var/lib/customwebos/nas.fstab` = `<share> /tmp/customwebos-nas cifs <options> 0 0`, `vers` defaulting to Task 1's result; `-RemoveNas` deletes it (and unmounts). `-NasConfigPath` defaults to `.local/slideshow-nas.json`.

- [ ] **Step 1: Write the failing tests** (dry runs; the fstab line is printed by `-WhatIf` with the password replaced by `***`, and written to a file given by a test-only `-FstabOut <path>` so the escaping can be checked):
  - `nosignal.ps1 -ConfigureNas -WhatIf shows where the settings go` → output contains `/var/lib/customwebos/nas.fstab`, `chmod 600`, `***`, and not the password.
  - `the fstab line escapes the password for CIFS and fstab` → password `a,b c` → options contain `password=a,,b\040c`; share `//192.168.88.235/CustomWebOS_Slideshow` → `ip=192.168.88.235`.
  - `-ConfigureNas refuses a settings file without share, username or password` → non-zero exit naming the missing key.
  - `-RemoveNas -WhatIf removes the settings and unmounts` → `umount` and `rm` of the fstab.
- [ ] **Step 2: Run** `node --test test/nosignal.test.js` — Expected: the new tests FAIL.
- [ ] **Step 3: Implement** in `nosignal.ps1`: parameter sets for `-ConfigureNas` / `-RemoveNas`; the line is sent over ssh stdin to `mkdir -p /var/lib/customwebos && tr -d '\015' > <file>.tmp && chmod 600 <file>.tmp && mv <file>.tmp <file>`.
- [ ] **Step 4: Run** `npm test` — Expected: all PASS.
- [ ] **Step 5: Commit** `feat(nosignal): send the NAS share settings to the TV`.

### Task 3: `listPhotos` prefers the NAS

**Files:**
- Modify: `services/org.jazwinski.customwebos.home.service/handlers.js` (`NAS_ROOT = '/tmp/customwebos-nas'`, `opts.nasRoot`)
- Modify: `home/main.js` (`photoUrl`)
- Test: `test/service-handlers.test.js`, `test/home-main.test.js`

**Interfaces:**
- Produces: `listPhotos` → `{returnValue:true, photos:["nas/…"]}` when the NAS root has photos, else `["usb/…"]` as today, else `[]`. Export `NAS_ROOT`.

- [ ] **Step 1: Write the failing tests** (with the file's `fakeFs`):
  - `listPhotos uses only the NAS when it has photos` → nas `{a.jpg}`, usb `{b.jpg}` → `['nas/a.jpg']`.
  - `listPhotos falls back to the stick when the NAS folder is empty or missing` → nas `{}` (and nas absent) with usb `{b.jpg}` → `['usb/b.jpg']`.
  - `listPhotos applies the stick's limits to the NAS` → a NAS file over `MAX_PHOTO_BYTES` is skipped.
- [ ] **Step 2: Run** `node --test test/service-handlers.test.js` — Expected: FAIL.
  - In `test/home-main.test.js`: `photoUrl encodes each path segment` → `photoUrl('nas/Wakacje 2024/łódź #1.jpg')` === `'nas/Wakacje%202024/%C5%82%C3%B3d%C5%BA%20%231.jpg'` (a `#` or `%` in a file name would otherwise break the photo; the stick has the same gap today).
- [ ] **Step 3: Implement** with the existing `walkTree`/`photoFiles`, NAS first; add `photoUrl(path) -> string` (each `/`-separated segment through `encodeURIComponent`) to `home/main.js`, exported for tests, and use it where the slideshow sets `img.src` from `s.photos`.
- [ ] **Step 4: Run** `npm test` — Expected: all PASS.
- [ ] **Step 5: Commit** `feat(service): slideshow photos from the NAS first`.

### Task 4: The watcher mounts for a show and unmounts after

**Files:**
- Modify: `scripts/nosignal.sh`
- Test: `test/nosignal.test.js`

**Interfaces:**
- Consumes: Task 2's fstab, Task 3's `nas/` paths.
- Produces: `nas_up` (if `$NAS_FSTAB` exists: if `$NAS_MNT` is in `$MOUNTS` and `timeout -t 3 ls "$NAS_MNT"` fails, `umount -l` it; if not mounted, `timeout -t 5 mount -T "$NAS_FSTAB" "$NAS_MNT"`; logs "NAS mounted" / "NAS not reachable: using the stick" with no secrets) and `nas_down` (`umount -l` if mounted). Env overrides for tests: `NAS_FSTAB` (default `/var/lib/customwebos/nas.fstab`), `NAS_MNT` (default `/tmp/customwebos-nas`), `MOUNTS` (default `/proc/mounts`). Test hooks `--nas-up` / `--nas-down` like `--decide`.

- [ ] **Step 1: Write the failing tests** (stub `mount`, `umount`, `timeout`, `ls` on `PATH` as the file's other stub tests do; each stub appends its arguments to a log):
  - `no nas.fstab: no mount is tried` → stub log empty.
  - `nas_up mounts with the fstab, inside a 5 s limit` → log has `timeout -t 5 mount -T <fstab> <mnt>`.
  - `a stale mount is dropped and mounted again` → `MOUNTS` lists the mount point, `ls` stub fails → `umount -l <mnt>` before `mount -T`.
  - `a failed mount is logged without secrets` → mount stub exits 32 with `password=x` in its stderr → `/tmp` log line says the NAS isn't reachable and contains no `password`.
  - `nas_down unmounts only a mounted share`.
  - Static: `the cover accepts nas/ or usb/ photos` (the `listPhotos` check matches `"(usb|nas)/`), `main links <app dir>/nas`, and `uncover and clear call nas_down`.
- [ ] **Step 2: Run** `node --test test/nosignal.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement:** `nas_up` right before the `listPhotos` check in `cover`; `nas_down` in `uncover` and `clear`; `ln -sfn "$NAS_MNT" "$APP_DIR/nas"` and `mkdir -p "$NAS_MNT"` in `main`; the "no photos" log line names both sources.
- [ ] **Step 4: Run** `npm test` and `npm run check:browser` — Expected: all PASS.
- [ ] **Step 5: Commit** `feat(nosignal): mount the NAS share for a show, unmount after`.

### Task 5: On the TV and docs (Michał's go-ahead)

**Files:**
- Modify: `home/appinfo.json` (version bump), `README.md` (slideshow section: NAS first, `-ConfigureNas`, the read-only account), `docs/status.md`, `docs/tv-notes.md` (kernel CIFS without `mount.cifs`, `mount -T`, the working `vers`), `docs/tv-log.md` (Task 1 and these results), `docs/home-button.md` (rollback: `-RemoveNas`)

- [ ] **Step 1:** Package, install with `-Reboot`, `nosignal.ps1 -TvHost <tv> ` (re-install the watcher), `nosignal.ps1 -TvHost <tv> -ConfigureNas`; open VNC.
- [ ] **Step 2:** With Michał: PS5 off → NAS photos within ~10 s; stick plugged in too → still only NAS photos; NAS share made unreachable (wrong password via a test config, or NAS cable) → the stick's photos; a photo added to the share → appears at the next show; PS5 on → show ends and the share is unmounted (`grep customwebos-nas /proc/mounts` empty); `/tmp/nosignal.log` has no password.
- [ ] **Step 3:** Docs as listed; `npm test`.
- [ ] **Step 4: Commit** `docs: slideshow from the NAS`.
