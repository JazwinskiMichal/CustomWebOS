# Home button and power-on

How to make CustomWebOS what you see when you turn the TV on, and when you press Home. These are the findings of Task 12 in [`plans/2026-10-25-m2-preview-ui-hardening.md`](superpowers/plans/2026-10-25-m2-preview-ui-hardening.md), researched 2026-10-26 on the LG C8 (webOS 4.4, Homebrew Channel 0.7.3).

## Findings

- **No supported setting exists.** On this firmware, the Home button is handled inside LG's surface manager (`/usr/bin/surface-manager-starfish`, a compiled QML shell). There is no `com.webos.app.home` app to replace. Its config isn't exposed.
- **`applicationManager` has no "default app" or "home" method.** Introspection on the TV (`ls-monitor -i com.webos.applicationManager`) lists 55 methods: `launch`, `close…`, launch-point and handler methods. There's no `setDefaultLaunchpoint` or anything similar.
- **Homebrew Channel has no "set as Home" option.** Its `startup.sh` only knows these preferences: failsafe, `webosbrew_block_updates`, `webosbrew_telnet_disabled` and `webosbrew_sshd_enabled`.
- So `docs/setup.md` §4.4's first two candidates (an Hbchannel toggle and `setDefaultLaunchpoint`) **don't exist on 4.4**. Section 4.4 now points here.
- **Boot hooks do exist:** Homebrew Channel's `startup.sh` runs every executable in `/var/lib/webosbrew/init.d/` once per boot, as root (`run-parts`). It runs after its own SSH and elevation steps. This repo already uses that mechanism for `dropbear-22022`.
- **Remote buttons can be remapped:** [LG Input Hook](https://repo.webosbrew.org/apps/org.webosbrew.inputhook/) ([source](https://github.com/Simon34545/lginputhook)) injects a library (`ezinject` + `libinputhookpp.so`) into the input processes `lginput2`, `micomservice`, `tvservice` and `RELEASE`, whichever exist. It can **Disable**, **Replace** or **Execute a command** for any button ID. On this TV, `lginput2` and `RELEASE` are running. Its button-ID list gives Home as `773` on a 2021 Magic Remote. The C8's remote may differ; the app's log view shows the real ID.
- **Turning the TV on boots it:** each power-on so far has started from uptime ≈ 0. So init.d hooks run at every power-on, not only after a manual reboot. If the TV were ever set to resume from standby (Quick Start+), they wouldn't.

## Recovery: before applying anything

SSH doesn't depend on the screen. Homebrew Channel's own `dropbear` (port 22, `webosbrew_sshd_enabled`) and this repo's `init.d/dropbear-22022` start at boot from `startup.sh`, before any app is shown. Telnet is off (`webosbrew_telnet_disabled`). If a startup hook crashes a boot, Homebrew Channel's failsafe mode starts telnet on the next boot and skips the hooks. Keep the exact undo commands below in the private recovery sheet too (`.local/webos/recovery.md`).

## Candidates

### A. CustomWebOS on power-on (our own init.d hook): recommended first

- **Retired 2026-10-27 (owner: "the autostart of the custom web os is not needed, it should stay only under the home button").** The hook no longer opens CustomWebOS; it only stops LG Input Hook's config server (see section D). What follows describes what it did until then.
- **What:** `scripts/autostart.sh`, installed as `/var/lib/webosbrew/init.d/customwebos-autostart`.
  - At boot it waits in the background until `applicationManager` answers.
  - It waits a few seconds more, so the TV finishes restoring its last app.
  - Then it **closes and reopens** CustomWebOS. Reopening also replaces an instance the TV may have opened too early, which would otherwise stay stuck (see `docs/tv-log.md`).
  - It never blocks the other hooks and gives up after 4 minutes.
- **Install / remove:**
  - `scripts/autostart.ps1 -TvHost <tv-ip>` installs it.
  - `scripts/autostart.ps1 -TvHost <tv-ip> -Remove` removes it.
  - `-WhatIf` prints the commands for either.
- **Undo by hand:** `rm /var/lib/webosbrew/init.d/customwebos-autostart && reboot`.
- **Gives:** power-on shows CustomWebOS. **Doesn't give:** the Home button. LG's launcher bar still opens on Home; CustomWebOS is one tile on it, or recent-app switching.
- **Risk:** low. It's our own script with no system processes touched. The worst case is a CustomWebOS launch you didn't want, which the undo command or `-Remove` fixes.

### B. Home button → CustomWebOS (LG Input Hook): later, if A isn't enough

- **What:**
  1. Install LG Input Hook from Homebrew Channel and open it once (it sets up its own init.d hook).
  2. Find the Home button's ID in its log view.
  3. Add a keybind: that ID → **Execute** `luna-send -n 1 luna://com.webos.applicationManager/launch '{"id":"org.jazwinski.customwebos.home"}'`.
  - Keybinds are stored in `/home/root/.config/lginputhook/keybinds.json`.
- **Unknowns to test with the owner watching:**
  - Does it work on webOS 4.4 with the C8's remote?
  - Does Execute *replace* the Home action, or does LG's bar still open as well?
  - How does the TV behave with the library injected into `lginput2`?
- **Undo:**
  1. Delete the keybind in its UI.
  2. Uninstall the app from Homebrew Channel.
  3. `rm -f /var/lib/webosbrew/init.d/inputhook /home/root/.config/lginputhook/keybinds.json && reboot`. A reboot is needed to drop the injected library.
- **Costs:**
  - It injects third-party native code into LG's input daemon.
  - It runs a small HTTP config server, password-protected for non-localhost callers. Its Execute action runs commands as root, so anyone with that password gets root on the TV.
  - It's a third-party app the owner installs.

### Rejected

- **Replacing or patching LG's launcher:** the surface manager is a compiled binary on the read-only root filesystem. Bind-mount tricks would risk the TV's main UI for little gain over B.
- **`setDefaultLaunchpoint` / an Hbchannel "Home" toggle:** they don't exist on 4.4 (see Findings).

## Status: both applied (2026-10-26)

- [x] Research and recovery check.
- [x] **A applied and kept.**
  - Live TV was put in front, then the TV rebooted. At 44 s the hook launched CustomWebOS (`caller_id: com.webos.lunasend-…` in the SAM log), and it was in front at 79 s.
  - That instance reached its service (the service process was started by its call), so it isn't one of the stuck early ones.
  - **Rollback proven:** after `autostart.ps1 -Remove` and a reboot from Live TV, Live TV stayed in front and nothing launched CustomWebOS. The hook was then re-installed.
- [x] **B applied and kept:**
  1. Installed LG Input Hook 1.5.1 through Homebrew Channel's own service, so the hash was checked and the service elevated: `luna://org.webosbrew.hbchannel.service/install` with `ipkUrl` and `ipkHash` from `repo.webosbrew.org/api/apps/org.webosbrew.inputhook/releases/latest.json`.
  2. Opened it once: it injected into `lginput2` and `tvservice` and wrote `/var/lib/webosbrew/init.d/inputhook`.
  3. Wrote `/home/root/.config/lginputhook/keybinds.json` = `{"773":{"action":"launch","id":"org.jazwinski.customwebos.home"}}`. Its UI's **Launch App** action needs no shell command. The hook reloads the file as soon as it changes.
  - **The C8's Magic Remote Home button is ID 773** (log: `lginput_uinput_send_button … uinput_code=773`).
  - **The owner confirmed:** from another app, Home opens CustomWebOS and LG's bar no longer appears.
  - After a reboot, the hook re-injected and the keybind was intact.
  - **Rollback proven:** with `{}` in `keybinds.json`, Home opened LG's bar again (owner-confirmed). The mapping was then restored.
- **Config server switched off:**
  - **The exposure:** LG Input Hook's service runs a config server on **port 1842** (`:::1842`, every interface). It sits behind HTTP basic auth with a random 8-character password, shown in its app, and can set any button to run a command as root.
  - **Reach:** the TV has only a private IPv4 address and IPv6 link-local addresses. So the server was reachable from the LAN only, unless a router forwards port 1842. `ip6tables` is missing on this kernel, so a firewall couldn't have covered IPv6.
  - **Fix:** the remap lives in the library injected into `lginput2`, and the Launch action runs `luna-send` itself, so the service isn't needed after boot. `scripts/autostart.sh` now waits for LG Input Hook's injection marker (`/tmp/inputhook`), then stops its service.
  - **Verified after a reboot:** port 1842 is closed (the PC gets "connection refused"), and Home still opens CustomWebOS (owner-confirmed).
  - **Caveat:** opening LG Input Hook's app starts the server again until the next boot.
- **A gap in B's boot script:** it runs `luna-send` without `< /dev/null`, the trap noted in tv-log, and deletes itself if a reply contains `errorText`. It survived this reboot. If the Home remap is ever lost after a boot, check that `/var/lib/webosbrew/init.d/inputhook` still exists. Opening LG Input Hook once recreates it.

## Remote view hook

Not part of the Home/power-on work, but it is a boot hook with its own rollback. `scripts/remoteview.ps1` installs `/var/lib/webosbrew/init.d/customwebos-remoteview`, which starts the remote view daemon in the background at each boot.

- **Remove:** `scripts/remoteview.ps1 -TvHost <tv-ip> -Remove` (also stops the running daemon).
- **Undo by hand:** `rm /var/lib/webosbrew/init.d/customwebos-remoteview && reboot`.
- Keep that command in `.local/webos/recovery.md` too.

### No-signal slideshow watcher (not a Home/power-on mechanism)

`scripts/nosignal.ps1` installs `/var/lib/webosbrew/init.d/customwebos-nosignal`, which covers an HDMI input that loses its picture with the USB stick's photos (M3). It also links `<CustomWebOS dir>/usb` to `/tmp/usb`.

- **Remove:** `scripts/nosignal.ps1 -TvHost <tv-ip> -Remove`, then reboot.
- **Undo by hand:** `rm /var/lib/webosbrew/init.d/customwebos-nosignal && reboot`.
