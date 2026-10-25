# M2 tracking — things discovered during the M1 on-device test

These are findings from installing M1 on my LG C8 and running it on 2026-10-24. None of them block the M1 artifact bar being met (install + register + open worked), but they're the first things M2 should pick up.

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
