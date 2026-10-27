# TV log

A dated log of on-device sessions on the LG C8, from the first install (2026-10-24) onwards. It's history: append new sessions at the end, and don't rewrite old entries. Correct them with a dated note, as done for the "bus dead for 5 minutes" entry. The lasting rules distilled from it are in [tv-notes.md](tv-notes.md).

(This file was `docs/m2-tracking.md` until 2026-10-26.)

## The core webOS 4.4 permission wall

**Problem.** Dev-mode webapps on consumer webOS 4.4 cannot make `applicationManager` calls directly — not `listLaunchPoints`, not `launch`, not any of them. Confirmed in two independent ways:

1. **Bus registration (`ls-monitor -i com.webos.applicationManager`).** `listLaunchPoints` provides list contains `private / configurator.callbacks / all / applications.internal` — **no `"public"`**. `launch` has `"public"` in its list, which looks like it should be reachable, but see point 2.
2. **Live call from the webapp returns no response within 10 s.** Reproducing with `luna-send-pub -a org.jazwinski.customwebos.home ... /launch` from a root SSH session returns the actual error: `LUNASERVICE ERROR -1031: LSCallFromApplication with application ID org.jazwinski.customwebos.home but not privileged`. So even the `"public"` method is gated behind an "is the caller a privileged app" check that dev-mode apps fail.

**Impact.** CustomWebOS Home's hardcoded list renders fine, the remote navigates it, but pressing OK on any app does not launch it. Enumeration was already blocked; launch is blocked for the same underlying reason.

**Fix (first M2 task).** Bundle a service component — the Hbchannel pattern. **Partially shipped in this repo as of 0.2.0** at `services/org.jazwinski.customwebos.home.service/`. State on 2026-10-24:

- `services.json`, `package.json`, `service.js` (ES5 for Node 0.12 on the TV), `run-js-service` wrapper (copied verbatim from Hbchannel's `thirdparty_jail=off` sed trick) — all committed.
- `scripts/package.ps1` passes both `home/` and `services/org.jazwinski.customwebos.home.service/` to `ares-package`. Produced `.ipk` installs cleanly via `ApplicationInstallerUtility`.
- `scripts/register-service.sh` writes the seven service-side files the luna hub needs (now nine; see the 22:30 session below) (`services.d/`, `roles.d/`, two in `api-permissions.d/`, two in `client-permissions.d/`, one in **`manifests.d/`** — the top-level manifest JSON that enumerates the rest). Ships to the TV and runs over SSH after install.
- After reboot: `ls-monitor -i org.jazwinski.customwebos.home.service` lists `listApps`, `launch`, `info`, `quit` all with `"public"` in their provides. **The hub knows about the service.**

**Where it currently gets stuck.** First `luna-send-pub` to any of our methods — including the built-in `info` — hangs indefinitely. `ps -ef` shows the hub (ls-hubd, pid 1404) spawned `/bin/sh ... run-js-service -n ...` as our service, but the actual Node process never comes up — our shell wrapper is sitting in the fork-server handoff that `/usr/bin/run-js-service` does when `/var/run/node/fork` exists (lines ~160 of the system wrapper: `printf "$request" | nc 127.0.0.1 9000`). Either the fork server isn't accepting our request, or our `thirdparty_jail=off` sed modification subtly breaks the request shape. The devmode-check sed modification in the same wrapper is irrelevant (only affects whether `-d` keeps the debugger on).

**Where to pick up next session.**
1. On the TV: `cat /var/run/node/fork` (confirm fork server is enabled) and `nc 127.0.0.1 9000` (manually try a fork request). Compare Hbchannel's working case against ours by watching the fork server socket while invoking each.
2. Try shipping our service **without** the Hbchannel `run-js-service` wrapper — directly point the services.d `Exec=` at `/usr/bin/run-js-service` with the right flags. Risk: `thirdparty_jail=individual` kicks in; our service may run jailed. May still work for our use case since we're only calling applicationManager, which is public.
3. If none of that works: inspect Hbchannel's actual spawn via `strace -p 1404 -f -e trace=execve` on the TV while opening Hbchannel; compare to our spawn.

Alternative that **does not work** (confirmed): setting `requiredPermissions` in `appinfo.json` alone. Tried on 0.1.4 (`["application.operation","application.launcher"]`); call still times out. The field controls self-declared ACGs but doesn't grant them on a locked consumer firmware. The service-component path is the only way.

## On-device session, 2026-10-24 ~22:30 (0.2.1)

- **The fork-server hang is gone.** After the evening reboot the hub spawns the service as a plain Node process (process title `org.jazwinski.customwebos.home.service`); `/var/run/node/fork` doesn't exist. `info` answers instantly. `listApps` as root returns the real launch-point list (~26 KB, Netflix/YouTube/Prime/Canal+/TVP/HDMI…), confirmed end to end in `ls-monitor`: home.service → `applicationManager/listLaunchPoints` → reply → `{"returnValue":true,"apps":[…]}` in ~25 ms. The service cold-starts in about 1 s after being killed.
- **`luna-send-pub -a org.jazwinski.customwebos.home …` is not a valid test of the webapp path.** It fails with -1031 (`LSCallFromApplication … not privileged`) before reaching our service, because the error comes from luna-send-pub itself. Testing the webapp path means opening the app on the TV.
- **The service process survives `/quit`** and keeps running old code after an upgrade. `scripts/install.ps1 -TvHost` kills it after installing; the hub respawns it on the next call. No reboot is needed for a service-code-only upgrade.
- **`ApplicationInstallerUtility` needs `-t developer`.** Without it, the `.ipk` installs as an internal app under `/media/cryptofs/apps`, alongside the developer copy, with a separate opkg status in each location. `-c remove -p <id>` then removed **both** copies. Recovered by reinstalling with `-t developer` (the registration files were untouched) and rebooting.
- `listLaunchPoints` returns `com.webos.app.browser` twice. The home app now de-duplicates by id.
- **Why the app showed the fallback list and launch failed:** our registration had only the seven *service*-side files. Hbchannel registers two more for its **web app**: `roles.d/<appId>.app.json` (`allowedNames: ["<appId>-*"]`; a web app's bus name is `<appId>-<pid>`) and `client-permissions.d/<appId>.app.json` (`{"<appId>-*": ["public", "<service>.group"]}`). Without them the web app has no bus role, so every call it makes is refused. `register-service.sh` now writes all nine. This needs a reboot.
- ~~**The bus is dead for ~5 min after boot.**~~ **Wrong, see 2026-10-25:** a measurement artifact of piping `luna-send` under `timeout`. Even `com.palm.systemservice/time/getSystemTime` seemed not to answer. The 10 s one-shot `listApps` in 0.2.1 therefore always fell back when opened early. 0.2.2 retries with backoff (5/10/20 s, then every 30 s).
- **Every app upgrade breaks app → service calls until the next reboot.** After installing 0.2.3 over 0.2.2, the web app's `listApps` was silently dropped; it never showed up in `ls-monitor`. All nine registration files were unchanged on disk, and `ls-control scan-services` didn't help. A reboot with nothing else changed fixed it. The installer evidently resets the hub's in-memory permissions for the app id. `install.ps1 -TvHost -Reboot` handles it; an open question is whether there's a lighter fix than a full reboot (e.g. restarting WebAppMgr).
- **Testing pitfalls:** (1) `luna-send` writing to a pipe can get killed by `timeout` with its output still buffered, which looks like "no answer". Use `ssh -tt` or watch `ls-monitor`. (2) `luna-send-pub -a <appId>` always fails with -1031 because luna-send-pub itself isn't allowed to call as an app. It tells you nothing about the app's real permissions. (3) Load average ~10 is normal on this TV: driver kthreads sit in D state.

## On-device session, 2026-10-25 morning (0.3.0)

- **Installed 0.3.0 with `install.ps1 -TvHost 192.168.88.244 -Reboot`.** Only the developer copy exists afterwards (no duplicate under `/media/cryptofs/apps`).
- **After the reboot the app showed the fallback list and could not launch, but the install and permissions were fine.** As root, `listApps` returned the real list. The system log shows the TV **relaunched CustomWebOS itself 31 s after boot** (`SAM NL_APP_LAUNCH_BEGIN … "caller_id":"com.webos.surfacemanager","mode":"recent"`, i.e. it was the last app), before Homebrew Channel's startup had loaded the dev-dir permissions (see the boot measurement below). That app instance never got a call onto the bus: a 40 s `ls-monitor` trace at 8+ min uptime showed nothing from `org.jazwinski.customwebos.home-*`, although it retries every 30 s.
- **Closing and relaunching the app fixes it.** `applicationManager/closeByAppId`, then `launch`: the fresh instance's `listApps` goes home-<pid> → home.service → `listLaunchPoints` → reply in ~25 ms.
- **Untested:** whether `location.reload()` inside a stuck instance is enough to recover it.
- **Boot measurement (probe from the PC as soon as SSH is up, luna-send written to a file):** at **38.3 s** uptime, on the first probe round, `systemservice/time/getSystemTime`, `applicationManager/getForegroundAppInfo` and our `home.service/listApps` all answered. bootd logs `boot-done` at 31 s and `boot-complete` at 32 s; Netflix calls `getBootStatus` at 64 s. **The bus is not dead after boot.** The earlier "~5 min" came from `luna-send … | grep` under `timeout`, which loses the output even when the call succeeds: the first probe run, written that way, saw nothing for 5+ min while hand-run calls at 291 s answered. **Unexplained:** on that same boot a hand-run call written to a file at 165 s also came back empty (rc 0). One clean measurement isn't conclusive; repeat it on a boot where the TV reopens CustomWebOS.
- **So the stuck instance is a timing problem, not a slow bus:** SSH comes from the last step of Homebrew Channel's `startup.sh` (`/var/lib/webosbrew/init.d`, after elevation) and was reachable at ~30 s. An app instance that connects before that (this morning's relaunch at 31 s) apparently never gets its dev-dir role. The boot that was measured opened AirPlay and Live TV, not CustomWebOS, so the stuck case wasn't re-observed. A Task 12 autostart hook in `init.d` runs after the permissions exist, so it can close and reopen CustomWebOS cleanly.
- **Task 11 (reboot-free upgrade): no candidate works; upgrades still need a reboot.** Installed 0.3.1 over 0.3.0 without `-Reboot`. After each candidate, the app was closed (`closeByAppId`), relaunched, and traced in `ls-monitor` for 30–35 s. Every time, it put **no calls on the bus** (nothing from `org.jazwinski.customwebos.home-*`) and showed "Can't reach the home service".
  1. Close + relaunch alone: no calls. So the upgrade problem is *not* the boot-relaunch problem above.
  2. `ls-control scan-volatile-dirs` (rc 0): no calls.
  3. Re-running `register-service.ps1` (rewrote all nine files with version 0.3.1, `pkill -SIGHUP ls-hubd`): no calls.
  4. `restart WebAppMgr` (the upstart job is `WebAppMgr`; it closes every web app): the app relaunched in the foreground, still no calls.
  A reboot is the only fix found. `install.ps1 -TvHost -Reboot` stays the documented route.
- The registration manifest still says `"version":"0.2.2"` (written at 0.2.2, never rewritten). Harmless: 0.2.3 and 0.3.0 both work with it.
- **Testing pitfall:** BusyBox `timeout` needs `-t <secs>`. `timeout 45 cmd` fails with "can't execute '45'" and produces no output, which looks like an empty trace.
- **UI change prompted by this session:** the built-in fallback list was misleading (it looked like a working Home but couldn't launch anything). It's replaced by an error screen showing the reason and when the next try is.

## Home redesign baseline (0.3.2, 2026-10-25)

Today's list UI plus perf mode, measured with `scripts/perf.ps1 -TvHost 192.168.88.244 -Action down -Steps 9` (two runs; the app relaunched with perf params, 9 focus steps 80 ms apart):

| | run 1 | run 2 |
|---|---|---|
| first render (ms from navigation start) | 214 | 195 |
| app list shown | 324 | 321 |
| frame time p50 / p95 / max (ms) | 16.7 / 16.7 / 16.7 | 16.7 / 16.7 / 16.7 |
| frames over 33 ms | 0 of 46 | 0 of 47 |
| one focus step, synchronous render (p50 / p95 ms) | 5.7 / 7.3 | 5.2 / 7.5 |

- User agent `Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/53.0.2785.34 Safari/537.36 WebAppManager`; `navigator.language` is `pl-PL`.
- `toLocaleDateString('pl-PL', …)` returns `niedziela, 25 października`, so the TV's Polish date formatting works. The redesign uses built-in tables anyway (same output, testable).
- `CSS.supports`: grid **false**, `-webkit-backdrop-filter` **false**, `-webkit-mask-image` **true** (the logo masks will work).
- The list holds a steady 60 fps, and a full re-render costs ~6 ms per key press. The redesign must stay within the bar (first paint ≤ 1 s, focus response ≤ 100 ms, p95 frame < 33 ms) and should not be much worse than this.
- **`luna-send` returns nothing (rc 0) when its stdin is a pipe.** perf.ps1 sends its script over `ssh … sh -s`, so every `luna-send` inherited that pipe and silently produced no output: the first runs reported "no perf report" and then "bus not answering after 5 min" while hand-run calls worked. Giving each `luna-send` `< /dev/null` fixes it (tested side by side: piped stdin 0 bytes, `/dev/null` 91 bytes). This may also explain the unexplained empty answer at 165 s noted above. `perf.ps1` now redirects stdin and waits for the bus to answer before closing and relaunching the app.

## Home redesign on the TV (0.4.0 / 0.4.1, 2026-10-25)

Dock layout, white logos, photo with pre-blurred glass, Manrope, Polish date. Measured with `scripts/perf.ps1 -TvHost 192.168.88.244 -Action right -Steps 9`:

| | 0.4.0 | 0.4.0, no focus animation (CSS edited in place) | 0.4.1 (committed, after reboot) | bar |
|---|---|---|---|---|
| first render (ms) | 322 / 287 | 229 / 259 | 367 / 310 | ≤ 1000 |
| app list shown (ms) | 1266 / 452 | 397 / 350 | 1307 / 428 | |
| frame p95 (ms) | **66.7 / 83.3** | 16.7 / 16.7 | 16.7 / 16.7 | < 33 |
| frames over 33 ms | **6 of 32**, 6 of 32 | 0 of 44, 0 of 44 | 0 of 44, 0 of 45 | |
| one focus step, p95 (ms) | 2.4 / 3.6 | 2.9 / 2.4 | 2.4 / 2.7 | ≤ 100 |

- The JS side is ~60× cheaper per key press than the old list (p50 0.1 ms vs ~6 ms), because focus moves only swap a class.
- The 120 ms scale/fade on the focused tile over the glass dock was what dropped frames. Giving it up (step 1 of the agreed order) was enough: font, glass and photo stay. The ~1.3 s "app list shown" on the first run after a reboot is the service cold start.
- Editing the installed `style.css` in place under `/media/developer/apps/usr/palm/applications/org.jazwinski.customwebos.home/` and relaunching (perf.ps1 does that) takes effect without a reinstall or reboot. A quick loop for visual experiments; the committed build was then installed normally.
- **Owner check, 0.4.1:** "its all looking very good" — look, logos, All apps, date, pointer, Back and speed all accepted.

## 0.4.2: review fixes, All apps measured (2026-10-26)

Installed with `-Reboot`. All apps measured for the first time with `scripts/perf.ps1 -TvHost 192.168.88.244 -Action down -Steps 9 -View all` (opens All apps, then 9 row moves 80 ms apart):

| | All apps run 1 | All apps run 2 | dock run 1 | dock run 2 | dock run 3 |
|---|---|---|---|---|---|
| first render (ms) | 307 | 261 | 437 | 238 | 216 |
| app list shown (ms) | 1324 (first after boot) | 453 | 581 | 331 | 337 |
| frame p95 / max (ms) | 16.7 / 16.7 | 16.7 / 16.7 | 16.7 / 50 | 16.7 / 16.7 | 16.7 / 16.7 |
| frames over 33 ms | 0 of 44 | 0 of 44 | 1 of 42 | 0 of 43 | 0 of 43 |
| one focus step, p95 (ms) | 1.8 | 1.8 | 3.1 | 2.2 | 2.3 |

- All apps, with its whitened TV icons, masked logos and grid scrolling, holds 60 fps. It meets the bar.
- One 50 ms frame in one dock run didn't repeat in two more runs; p95 stayed at 16.7 ms.
- The launch-note pill (review fix) shows only when a launch fails, so it wasn't provoked on the TV; the browser suite checks its colours.

## Remote view spike: screen capture (2026-10-26)

For the [remote view design](superpowers/specs/2026-10-26-remote-view-design.md). Ran hyperion-webos 0.2.1's release binary and its `libdile_vt` / `libgm` backends from `/tmp/hwspike` (owner's go-ahead), as `hyperion-webos -a 127.0.0.1 -b libdile_vt -u libgm -x 960 -y 540 -s -r -d -v`, and pulled the `--dump-frames` output back as PNGs. Removed afterwards.

- **Everything captures:** CustomWebOS home, live TV, Netflix **full-screen playback** (no DRM blackout), HDMI 1 with the PS5, and LG's no-signal screen.
- **Speed and cost at 960×540:** ~13 fps with video + UI (~35 ms/frame converting), ~30 fps UI-only; ~11 MB RSS, ~47% CPU.
- **`DILE_VT` leaks on SIGTERM.** The first run was stopped by `timeout -t` (SIGTERM); hyperion-webos only cleans up on SIGINT. Every later `DILE_VT_Create` (and `CreateEx`, quirk 1) failed with "Failed to get DILE_VT context" until a `reboot`. After it, runs stopped with `timeout -s INT` re-acquired the context every time.
- `DILE_VT` reports scale-up to 3840×2160, scale-down to 320×240, 60 Hz source, framerate divider 2.
- Resources: 2 cores, ~650 MB RAM available, 600 MB swap, 1.6 GB free in `/media/developer`; `/tmp` is RAM-backed. `/dev/uinput` exists.
- Apps can be opened over SSH with `luna-send -n 1 luna://com.webos.applicationManager/launch '{"id":"netflix"}' < /dev/null` (`com.webos.app.hdmi1` for HDMI 1).

## Repo-side progress (no device access)

Done on 2026-10-24, all covered by `node --test`:

- **Home app talks to the service.** `home/main.js` lists apps via `…home.service/listApps` and launches via `…home.service/launch`. It no longer calls `applicationManager` directly. The fallback list renders immediately and stays up, with a note giving the reason, if the service fails or times out. If the service answers, its list replaces the fallback and focus stays on the same app. The home app hides itself from the list.
- **Service logic is unit-tested.** Handlers moved to `services/…/handlers.js` (pure, `call` is injected); `service.js` only wires them to `webos-service`.
- **Tests moved to `test/`**, so they no longer ship in the `.ipk`. A guard test fails if a `*.test.js` reappears under `home/` or `services/`.
- **The ES5 scan covers every TV-runtime file**: `home/**/*.js` and `services/**/*.js`.
- **`register-service.sh`** now reads the manifest version from the installed `appinfo.json` instead of hardcoding it. New flags: `--dry-run`, `--unregister` (rollback), and `--system-wrapper` (pick-up step 2 below: `Exec=/usr/bin/run-js-service`).
- **`scripts/register-service.ps1`** pipes the `.sh` file to the TV over SSH (no scp/sftp needed) and supports `-WhatIf`, `-DryRunOnTv`, `-Unregister`, `-SystemWrapper`.
- **`.gitattributes`** pins `*.sh` and `run-js-service` to LF; `core.autocrlf=true` would otherwise break them on the TV.
- **`docs/setup.md` §4** covers the first-install reboot, ares-cli on Node 25, service registration (§4.3b), and service rollback.

Still device-side and needing authorisation: the fork-server hang (pick-up steps 1–3), on-device check of the service-backed list and launch, and the autostart hook.

## Other things noticed

- **Launcher cache needs a reboot** to pick up a newly-installed developer app the first time. First install → reboot → tile appears. Later upgrades of an existing registration show up without reboot. Worth mentioning in `docs/setup.md` §4 before the install step.
- **`ares-package` minifies by default.** Confirmed on-TV: the installed `main.js` is one-line minified, variable names mangled. The scan test only runs against the source file, not the packaged file, so ES2015+ output from the minifier would slip past — if it ever used any, which it doesn't (observed output is ES5-safe). A `--no-minify` flag exists if we ever need readable logs on-device.
- ~~**Test files bundle into the `.ipk`.**~~ Fixed: tests live in `test/` now.
- **`ApplicationInstallerUtility` needs an explicit `-f /etc/palm/appinstalld/opkg.conf`** on this firmware, or `opkg_conf_load` fails with "no such file or directory". The ares-cli `ares-install` would handle this automatically if it worked — but see next item.
- **`ares-cli` 2.4.0 is broken on Node 25.** `TypeError: isDate is not a function` on install. Workaround used tonight: `scp` the `.ipk` to `/tmp/` and run `ApplicationInstallerUtility` over SSH directly. Pin a Node 18/20 LTS for ares-cli use, or wait for an ares-cli release that works with Node 25+.
- **Both `WebOSServiceBridge` and `PalmServiceBridge` exist** on this firmware; both get the exact same silent-no-response behavior when calling blocked methods. The class name wasn't the problem.

## What was proven on-device

- `.ipk` builds correctly from `home/` via `scripts/package.ps1`.
- Installs via `ApplicationInstallerUtility` (with the `-f opkg.conf` flag) → `AI_ERR_NONE`.
- Registers in the webOS launcher after one reboot (first install only).
- Opens cleanly as a webOS app; the service bridge is reachable from the app context.
- Hardcoded fallback list renders, Magic Remote up/down navigation works, focus ring behaves.
- Timeout path shows a user-visible error instead of hanging forever when a luna call is silently dropped.

Everything in the M1 goals except the final "launch Netflix from the list" step is working end-to-end. The service-component rework fixes the gap and unblocks M2 proper.

## Open iterations shipped tonight

Versions 0.1.1 → 0.1.5 are on-device-test iterations. 0.1.5 is the current `main` state.

- 0.1.1 — fix bridge call path from `webOS.service.request` (needed `webOSTV.js`) to raw `PalmServiceBridge`.
- 0.1.2 — add 10 s client-side timeout to the bridge call so the UI doesn't hang.
- 0.1.3 — switch to `WebOSServiceBridge` (LG canonical) with `PalmServiceBridge` fallback. No functional change in the end.
- 0.1.4 — declare `requiredPermissions` in `appinfo.json`. No effect on consumer webOS 4.4.
- 0.1.5 — remove `listLaunchPoints` call entirely; use a hardcoded fallback list of common streaming apps. Fix misleading "Could not list installed apps" error header → "Error:".

## Remote view: input paths (2026-10-26)

- **uinput doesn't reach webOS.** A uinput device (`remoteview`, became `event6`, `mouse3`) was created and every event written, but nothing happened on screen. `surface-manager-starfish` holds `event0`–`event5` (CHECK INPUT, LGE RCU, Bluetooth-audio-source, two LGE M-RCU Builtin, LGE Simple Premium) and never opened `event6`. No udevd runs; the kernel hotplug helper is `/mnt/lg/bin/hotplug`.
- **The raw network-input socket is binary.** `luna://com.webos.service.networkinput/getPointerInputSocket` (from SSH) returns `/tmp/netinput.pointer.sock`, served by `/usr/sbin/network-input-service` (its own `UInputWriter`). Text messages make it log "packet too large, shutting down socket".
- **The second-screen API works.** From the PC: `ws://192.168.88.244:3000`, `register` with lgtv2's signed `pairing.json` → "allow" prompt on the TV, accepted by the owner → `client-key` (saved in `.local/webos/`). `ssap://com.webos.service.networkinput/getPointerInputSocket` → `ws://…:3000/resources/<hash>/netinput.pointer.sock`; text messages `type:move\ndx:20\ndy:0\ndown:0\n\n` and `type:button\nname:RIGHT\n\n` moved the cursor and the dock focus.
- **Pointer calibration (`remoteview --input-test`, run on the TV).** One large move (`dx:-3000`) barely moved the cursor; the TV clamps or drops big single deltas. 30-unit steps sent 40 ms apart from the PC reached every edge. `pointer_update` now splits moves into steps of at most 30 per axis, sent back to back with no pacing, and that works. Measured with the calibration page (`native/remoteview/calib/`, swapped in for the home app's `index.html` and restored after), which posts each click's screen position to the PC:
  - Scale 1.0: 100 units from the corner → 205 px; a centre move of +860/−440 units → +1682/−870 px. **About 1.96–1.98 px per unit**; the other targets overshot to the screen edges.
  - Scale 0.5: four of five clicks landed within 22 px of their target (1798,116 / 1798,986 / 116,986 / 959,549). The first click of the run (top-left) never reached the page, probably because it only woke the hidden cursor; the 1.0 run's first click did register.
  - Default `pointer_scale` set to **0.51**.

## Remote view: leak-safe capture (2026-10-26)

`remoteview --capture-test` (our own capture over hyperion-webos 0.2.1's `libdile_vt` and `libgm` backends), run from `/tmp/rv` with live TV playing:

- **20 open → 5 frames → close cycles at 960×540:** all `ui=1 video=1`, about 50–65 ms per composited frame.
- **A signal during open leaked `DILE_VT`.** Three SIGTERMs a few ms after start, while `DILE_VT_Create` had run but the code hadn't yet recorded the context, left every later open failing (`Failed to get DILE_VT context`) until a reboot. The UI-only fallback worked and logged why. Fixed by blocking SIGTERM/SIGINT/SIGHUP/SIGQUIT inside `capture_open`/`capture_frame`/`capture_close`. After the fix, SIGTERM at 0, 1, 2 and 4 s into a run was followed each time by a clean `video=1` run.
- **No vsync wait.** `capture_frame` no longer calls `DILE_VT_WaitVsync` (unbounded with no video signal). Frames still carry the live picture: video layer non-black, UI layer alpha 0 over live TV, composited frame correct.
- **An all-black frame was the OLED screensaver, not a bug.** With CustomWebOS open and idle the screensaver starts. Both our capture and hyperion-webos then show a black screen with a cloud of coloured particles, with an opaque UI layer covering the video. It doesn't appear over live TV.

## Remote view: first VNC sessions and budgets (2026-10-26)

`remoteview` serving from `/tmp/rv` with a test password; viewers on the PC: UltraVNC (picked ZRLE) and TightVNC (picked Tight with JPEG, quality 6). CPU from `/proc/<pid>/stat` ticks (fraction of one core), memory from `VmHWM`.

- **Missing library.** The binary needs `libjpeg.so.8` (libjpeg-turbo, from the toolchain); the TV has only `libjpeg.so.62`. For these runs it sat beside the binary with `LD_LIBRARY_PATH`; packaging has to ship it.
- **Logs.** PmLogDaemon on this TV drops plain `syslog()` (no `logger` level reached `/var/log/messages`), and the capture backends re-run `openlog()`. The daemon now also writes every log line to stderr.
- **First run (ZRLE, 10 fps cap):** 0.87 of a core at 10 fps, so the governor held 2–3 fps. ZRLE sent ~540 KB per frame. Colours were wrong (red as blue).
- **Per-step capture timing (960×540, ms per frame):** video acquire 0.1, video NV21→ARGB 30, UI acquire 9, UI convert 9, blend 2. The capture buffers are slow uncached memory: one `memcpy` out and converting the copy cuts video to ~5 ms and the whole frame from ~51 to ~26 ms.
- **Colours.** The composited frame is bytes R,G,B,A in memory, not libyuv's documented B,G,R,A for "ARGB". Confirmed by swapping a captured Netflix frame's channels. The server now declares red shift 0, blue shift 16. Owner: "colors are correct".
- **After the fixes (copy-first capture, Tight/JPEG, 960×540):**
  - home screen, 10 fps cap: 10 fps steady, 0.41 of a core, VmHWM 16 MB; `perf.ps1 -Action right -Steps 9` while connected: p95 16.7 ms, 0 frames over 33 ms;
  - Netflix, 10 fps cap: 10 fps steady, 0.37 (0.19 encoding, 0.18 capture), VmHWM 16.6 MB;
  - Netflix at 1280×720: settles at 6 fps, 0.39–0.40, VmHWM 26 MB (close to the 30 MB budget, so 960×540 stays the default);
  - Netflix, cap raised to 15 with a proportional governor (fps × 0.45/cpu when over 0.50): 15 → 12, then 12 fps steady at 0.44–0.45, VmHWM 16.5 MB.
- **Idle after disconnecting:** 0.00 CPU over 30 s, one thread, VmRSS 7.2 MB. `/dev/lg/gfx0` and the `gm` message queues stay open (libgm keeps them); no DILE_VT handle.
- **The OLED screensaver came on over the idle home screen during the session** (`tvpowerd … "Screen Saver"`).
- **Live TV, 15 fps cap:** 15 → 12, then 12 fps steady at 0.45–0.47 of a core (about 0.24 encoding, 0.22 capture), VmHWM 16.6 MB.
- **Home key.** A network `HOME` button press opens LG's home bar, because it skips LG Input Hook. The daemon now launches CustomWebOS instead (`ssap://system.launcher/launch`); owner: "indeed its working now".
- **Cleanup:** test server stopped; `/tmp/rv`, `/tmp/hwspike` and the test password removed. Only `remoteview.client-key` stays in `/home/root/.config/customwebos/`.

## Remote view: installed and accepted (2026-10-26)

CustomWebOS 0.5.0, then 0.5.1, installed with `install.ps1`. The `customwebos-remoteview` hook installed with `scripts/remoteview.ps1`, then rebooted. Viewer: TightVNC.

- **Boot:** the hook started the daemon (log in `/tmp/remoteview.log`). Idle: 1.2 MB, listening on 5900.
- **No password set:** a connection got the RFB greeting and was then refused. Same PID 60 s later; the hook started the daemon only once.
- **Password:** the owner set it with `-SetPassword` (stored mode 600). Pairing key from Task 2 reused.
- **Wrong password ×3:** "auth FAILED" each time, no capture opened, no toast.
- **Right password:** Tight encoding, capture opened with video, and the Polish toast "Zdalny podgląd: połączono" (owner: "i saw the toast with correct locale"). The owner checked the first click, the arrows, Enter, Esc, Home, and the HDMI input (PS5) with no stutter on the TV: "everything looks correct".
- **The screensaver still starts with a viewer connected:** `tvpowerd … "Screen Saver"` at 18:15 local, with one viewer established.
- **Leak found and fixed:** every session leaked one `/dev/mem` handle (fds 22 → 23 → 24 idle). The cause is hyperion-webos's `libdile_vt.c`, whose `capture_cleanup` never unmaps the 10 frame-buffer mappings or closes `/dev/mem` (~5 MB of address space per session on a 32-bit process). It's now built from our fixed copy in `native/remoteview/backends/`. After the fix: 21 fds idle / 26 connected, and VmSize steady at ~164 / ~178 MB, over 10 reconnects in a row, with video every time.
- **Two viewers at once** both worked; when one left, the other kept the picture and capture stayed open.
- **A clean SIGINT exits 130** and the hook restarts it (5 s, then 10 s). One exit 139 happened only because the backend `.so` was overwritten in place under the running daemon (not a code path in use).
- **Upgrade path:** reinstalling the same version is refused by opkg, so 0.5.1 was installed with `install.ps1 -Reboot` while the daemon ran. After the reboot the fixed backend was in place (checksum matches), and reconnecting gave video.
- **Idle cost after a session:** 2 CPU ticks in 60 s (~0.03% of a core), 7.2 MB, one thread, 21 fds.
- **0.5.2, after the final review:** TCP keepalive on viewer sockets. A viewer whose packets were silently dropped mid-session (two temporary `iptables` DROP rules on the TV, removed afterwards) was detected and capture closed after **28 s**.
- **Rollback proven:** `scripts/remoteview.ps1 -Remove` stopped the daemon (exit 130), the hook's loop logged "stopped", port 5900 closed, and the hook file was gone. After a reboot nothing started (no process, no port, no log). The hook was then reinstalled, and after a reboot the daemon was back on 5900.

## Day/night theme, 0.6.0 (2026-10-26)

Installed with `install.ps1 -Reboot`; the old photos were removed by the installer. Checked from the PC by grabbing frames with remote view's `remoteview --capture-test 1` (no viewer connected), then reading `/tmp/rv/frame.data`.

- **Following the sun:** at 19:50 CET, after Warsaw's sunset, CustomWebOS came up after the boot in the night look: dark Morphogenesis, light text on dark glass, clock and date on glass like the dock.
- **Forced day look** (`perf.ps1 -Theme light`): light Morphogenesis, dark text and icons on light glass, readable; the day tint needed no retuning.
- **Dock speed:** `perf.ps1 -Action right -Steps 9` with `-Theme light`: p95 16.7 ms, 0 frames over 33 ms (first paint 199 ms, apps 381 ms); with `-Theme dark`: p95 16.7 ms, 0 over 33 ms. The clock glass costs no frames.
- **Back to normal:** a plain close and launch put it back on the sun (night look at 19:51).

## Power-on: how early can CustomWebOS open? (2026-10-27)

Prompted by a rough morning start: the PS5 (last input) came up first, Home opened LG's bar, and Netflix got opened before CustomWebOS appeared at +47 s. Times are seconds after power-on (bootd's clock).

- **Boot milestones** (bootd.log): core-boot-done 17.9, init-boot-done 20.0, minimal-boot-done 20.4–20.6, boot-done 29–34. The TV puts the last input full screen at ~18.7.
- **Homebrew's hooks start late, and how late varies:** at +40, +29 and +41 s on three boots. Homebrew's own trigger is a persistent ActivityManager activity on core-boot-done that starts its Node service, which spawns `startup.sh`. That script waits 2 s, starts telnet/SSH, bind-mounts, runs `elevate-service`, then `run-parts` our hooks. LG Input Hook is injected right after (+41/+42 s); before that, Home opens LG's bar.
- **Our own boot activity doesn't help.** Registered with a callback that launches CustomWebOS at minimal-boot-done, it never fired at +20 s: ActivityManager itself only starts serving at +26–29 s (its first getBootStatus subscriptions in bootd.log). At best it would equal the hooks' earliest run. Cancelled and removed.
- **Faster autostart hook:** it opens CustomWebOS as soon as the bus answers, and closes and reopens it only when the TV had already reopened it. CustomWebOS was requested at +29.1 s and full screen at +31.3 s on one boot; requested at +41.9 s and full screen at +43.8 s on another. Before, it was +47/48 s.
- **LG's home bar** opened at +21–23 s on these boots, either by Home presses before Input Hook was active, or by itself on the micom (reboot) power-on. webOS's "Home Auto Launch" is off.

## Inputs went black after a hand-made input switch; failsafe boot (2026-10-27)

While trying to make the TV start on Live TV:

- **Power-on input.** At boot bootd calls `luna://com.webos.service.utp.externaldevice/getLastInput` and starts that input (`changeRunningAppId`). During the tests below it stayed `HDMI_1` through every switch to Live TV, and every reboot came back on HDMI 1; at the time this was wrongly read as "it only records external inputs". The `lastInputApp` / `physicalLastInputApp` settings are copies, rewritten at boot.
- **Black inputs.** After launching `com.webos.app.inputcommon` by hand with `{"changeRunningAppId":"com.webos.app.livetv"}` (mimicking bootd), every broadcast and HDMI source stayed black, including no "No signal" text, while Netflix and the UI worked. `tv.display/getScreenStatus` showed the MAIN sink `connected:false`, and `externaldevice` calls hung. Soft reboots (`reboot`, micomPower) didn't fix it; **pulling the mains plug for 60 s did.** No capture was running on the boot that was still black, so remote view was ruled out.
- **Failsafe boot.** The cold start came up in Homebrew's failsafe mode (hooks skipped, unauthenticated telnet on 23). The previous boot's `startup.sh` never finished (it clears its flag 10 s after the hooks), most likely blocked by the same stuck services. The next normal boot finished cleanly (flag cleared, hooks at +38–39 s).
- **Power-on autostart retired** at the owner's request: `customwebos-autostart` now only stops LG Input Hook's port-1842 server.
- **Correction, after the cold start.** With Live TV really playing (MAIN sink `connected:true`), unmuted, then `reboot`: `getLastInput` answered `DTV`, bootd started `com.webos.app.livetv`, and nothing opened CustomWebOS (0 launches; the retired autostart). The earlier "stays HDMI_1" results came from the broken state: Live TV never got a picture, so it was never recorded.
