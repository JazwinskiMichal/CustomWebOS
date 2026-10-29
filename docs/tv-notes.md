# TV notes

Lasting facts and rules for the target TV. Read this before touching it. The evidence for each point, with dates, is in [tv-log.md](tv-log.md). **Anything that touches the TV needs the owner's go-ahead for that task** (AGENTS.md).

## The device

- **Hardware and OS:** LG C8 (OLED, 2018), webOS 4.4. Rooted, with Homebrew Channel 0.7.3.
- **SSH:** port 22022, from our `init.d/dropbear-22022`; Homebrew Channel's own sshd is on 22. Key at `~/.ssh/id_ed25519_lgtv`. Telnet is off. The TV's IP isn't in git.
- **Web engine:** Chromium 53 (`Chrome/53.0.2785.34`). Runtime JS stays ES5.
  - **Supported:** `-webkit-mask-image`, CSS custom properties, flexbox (prefix it).
  - **Not supported:** CSS Grid, flex `gap`, `backdrop-filter`, variable fonts (the default weight is used and bold is synthesised).
- **Services:** run under Node 0.12.
- **Locale:** `navigator.language` is `pl-PL`.
- **Every power-on is a full boot,** with uptime starting near 0. So `/var/lib/webosbrew/init.d/` hooks run each time the TV is switched on.

## How CustomWebOS works on it

- **A dev-mode web app can't call `applicationManager`** (`-1031 … not privileged`, even for "public" methods). So a bundled luna service, `org.jazwinski.customwebos.home.service`, lists and launches apps for it.
- **The service needs eleven luna-hub registration files,** written by `scripts/register-service.ps1`. Four of them give the web apps' bus names (`org.jazwinski.customwebos.home-<pid>`, `org.jazwinski.customwebos.doorbell-<pid>`) a role.
- **Installing:** `ApplicationInstallerUtility -c install -t developer -p <ipk> -f /etc/palm/appinstalld/opkg.conf`, wrapped by `install.ps1 -TvHost`.
  - Without `-t developer`, a second copy lands in cryptofs. `-c remove` deletes **both** copies.
  - Without `-f`, opkg fails with "no such file".
- **Every app upgrade needs a reboot.** Until then, the upgraded app's calls to its service are silently dropped. Four reboot-free fixes were tried and none worked: close and reopen, `ls-control scan-volatile-dirs`, re-registering, restarting WebAppMgr. Always `install.ps1 -Reboot`.
- **A CustomWebOS instance opened in the first ~30 s after boot can stay stuck,** with no bus calls ever, because the TV reopens the last app before Homebrew Channel's startup is done. Closing and reopening it fixes that. The power-on hook (`autostart.sh`) does exactly that after every boot.
- **Power-on and Home** (details in [home-button.md](home-button.md)):
  - Our `init.d/customwebos-autostart` opens CustomWebOS once the bus answers.
  - LG Input Hook maps the Home button (ID **773** on the C8's remote) to launch CustomWebOS.
  - The boot hook then stops LG Input Hook's service, closing its port-1842 config server.

## luna-send and the bus

- **`luna-send` returns nothing, and still exits 0, when its stdin is a pipe** (scripts piped over `ssh … sh -s`, `run-parts`). **Always give it `< /dev/null`.**
- **Write its output to a file;** don't pipe it under `timeout`, which loses buffered output.
- **BusyBox `timeout` takes `-t N`.** Plain `timeout 45 cmd` fails silently.
- **The bus answers within ~40 s of boot** (one clean measurement: 38 s). The old "dead for 5 minutes" belief came from the two pitfalls above.
- **`luna-send-pub -a <appId>` always fails with -1031.** It says nothing about the app's real permissions; test the app path by opening the app.
- **Watching traffic:** `ls-monitor`, filtered with `grep`, run in an `ssh -tt` session. `ls-monitor -i <service>` lists a service's methods.
- **A load average around 10 is normal** on this TV (driver kthreads in D state).

## Speed

- **The home screen is measured with `scripts/perf.ps1`** (development.md).
- **Current 0.4.2:**
  - first paint about 0.2–0.4 s
  - apps shown about 0.3–0.6 s; about 1.3 s right after a reboot, while the service cold-starts
  - 60 fps on the dock and in All apps
  - about 0.1 ms per key press
- **Animations over the glass dock drop frames:** a 120 ms focus scale and fade cost 6 of 32 frames. Focus is an instant fill.
- **Quick visual experiments:** edit the installed files under `/media/developer/apps/usr/palm/applications/org.jazwinski.customwebos.home/` and relaunch. No reinstall or reboot is needed. Back up first, then commit the result and install it properly.

## Other quirks

- **The first install of a new app id needs a reboot** before its launcher tile appears.
- **`ares-package` minifies `main.js`;** the output stays ES5.
- **`listLaunchPoints` lists the browser twice;** the app de-duplicates by id.
- **The service process survives `/quit`** and keeps running old code; `install.ps1` kills it after installing.
- **Injecting input: uinput devices are ignored.** `surface-manager` reads only the input devices present at its start. Use the second-screen API instead (`ws://<tv>:3000`, one-time pairing prompt, then `getPointerInputSocket` and text `move`/`click`/`scroll`/`button` messages), as phone remote apps do. A `HOME` button sent this way opens LG's home bar (it skips LG Input Hook); launch the app with `ssap://system.launcher/launch` instead. The pointer socket ignores large single moves: send steps of at most 30 per axis. One move unit is about 2 screen pixels (`pointer_scale` 0.51).
- **Screen capture: a leaked `DILE_VT` context lasts until reboot.** A capture process killed without releasing it (e.g. hyperion-webos under `timeout -t`, which sends SIGTERM) leaves every later `DILE_VT_Create` failing. Stop capture tools with SIGINT (`timeout -s INT -t N`), and make our own capture code release on every exit path. Block the termination signals while opening or closing a capture: a signal in between `DILE_VT_Create` and the code recording the context leaks it too.
- **The OLED screensaver covers captures.** With an app (e.g. CustomWebOS) idle on screen, the screensaver's opaque UI layer hides the video, so a capture shows black with coloured particles. Test video capture over live TV, where it doesn't appear.
- **Plain syslog is dropped.** PmLogDaemon doesn't put `syslog()`/`logger` lines in `/var/log/messages` at any level. Native daemons should write their log to stderr and have their hook send it to a file in `/tmp`.
- **Capture buffers are uncached memory.** Converting straight out of `DILE_VT`/libgm buffers is 10–15× slower than copying them out with `memcpy` first. Captured frames come out as bytes R,G,B,A.
- **`libjpeg.so.8` isn't on the TV** (only `libjpeg.so.62`). Native code built with the buildroot toolchain must ship its own copy.

## Remote view (VNC)

- **Where it lives:** `<service dir>/bin/remoteview` (service dir = `/media/developer/apps/usr/palm/services/org.jazwinski.customwebos.home.service/`), with its capture backends and `libjpeg.so.8` beside it; the binary finds them through RPATH `$ORIGIN`. `ares-package` on Windows drops exec bits, so the boot hook runs `chmod 755` on it.
- **Boot hook:** `init.d/customwebos-remoteview` runs it at `nice -n 10` and restarts it after it exits (5 s, doubling to 300 s). Its log, with the daemon's stdout and stderr, is `/tmp/remoteview.log` (one old generation, `.log.1`, past 256 KB). Stop the daemon with SIGINT only (see the `DILE_VT` note above); `remoteview.ps1 -Remove` does.
- **Cost:** 960×540, about 12 fps within 0.45 of a core, about 17 MB; 0 CPU when idle. Use TightVNC as the viewer: it picks Tight+JPEG, far cheaper here than UltraVNC's ZRLE.
- **Password:** VNC uses only the first 8 characters.
- **Keys:** arrows, Enter, Esc/Backspace (Back), Home (launches CustomWebOS, since a network HOME skips LG Input Hook), typed text, F1 = Input (`ssap://com.webos.surfacemanager/showInputPicker`; launching `com.webos.app.inputmgr` gives the full-screen Input Hub instead), F2 = Mute, F3/F4 = volume, Page Up/Down = channel. Edit `native/remoteview/src/keymap.c`.
- **Seeing the TV's screen from the PC:** with no VNC viewer connected, `<service dir>/bin/remoteview --capture-test 1` writes the current screen to `/tmp/rv/frame.data` (raw RGB24, 960×540). Handy for checking the home screen without someone at the TV.
- **A launch with `theme` or `perf` params sticks:** Home-button launches are relaunches, so the forced look stays until the app is closed. Close and launch it without params to go back to following the sun.
- **Nothing of ours runs before about +29–42 s after power-on.** Homebrew's boot hooks (and with them LG Input Hook's Home remap and our autostart) start then, and the time varies per boot. A boot ActivityManager activity can't beat it, because ActivityManager itself starts at about +26–29 s. Until then the TV shows its last input, and Home opens LG's bar (tv-log 2026-10-27).
- **LG Input Hook must inject into `lginput2` only** (`scripts/inputhook-patch.ps1`). As shipped, it also injects into `tvservice`, and after a boot that starts on an HDMI input the TV then can't switch to Live TV or any other source: every input stays black (MAIN sink `connected:false`, the source stuck on `HDMI_1`) while apps still play. The remap only needs `lginput2`. Reinstalling or updating LG Input Hook drops the patch; run the script again. If inputs go black anyway: pull the mains plug for 60 s (a reboot back onto the HDMI input re-breaks it). The earlier "never launch `inputcommon` by hand" rule blamed the wrong thing (tv-log 2026-10-27).
- **The power-on input comes from `externaldevice/getLastInput`:** whatever source was really playing at switch-off (`DTV` for Live TV, `HDMI_1`…). Apps don't count. A source only counts once its picture is actually connected (`tv.display/getScreenStatus` MAIN `connected:true`).
- **HDMI input state comes from `com.webos.service.eim`** (`getAllInputStatus`, `getCurrentInput`, both subscribable): `activate` = a device is connected and powered; the `spd*` fields = it's sending video. `externaldevice/getVideoInfo` is useless for this (0×0 even with a picture).
- **The web app can't read USB sticks with `file://`;** link a folder inside the app directory to `/tmp/usb` and use relative URLs. Sticks mount at `/tmp/usb/sd?/sd??`.
- **opkg won't reinstall the same version:** bump `home/appinfo.json` before every install to the TV.
- **A running web app brought back to the front first shows its last frame** (a hidden page doesn't repaint). Close it first (`applicationManager/closeByAppId`) when the old frame must not show.
- **An app in front of a dark HDMI input stops LG's no-signal auto power-off.** Keep that rule yourself if you cover an input.
