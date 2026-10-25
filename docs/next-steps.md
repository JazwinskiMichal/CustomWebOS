# Where things stand, and what's next

Hand-off notes, so work can continue on another machine. Last updated 2026-10-25.

## State

- **The TV runs 0.4.1**, the redesigned home screen:
  - a full-screen photo, clock and Polish date
  - a frosted-glass dock of white logos
  - an All apps grid
  - steady 60 fps (measured; see `docs/m2-tracking.md`)
- **The owner accepted the look on the TV.**
- **A post-merge code review ran on the redesign.** It found no critical issues. Its two important findings are fixed on `main` (commit `f8dfb55`), and the rest are listed under "Small open items" below.
- **Those fixes are not on the TV yet; it still runs 0.4.1.**
- **`main` holds everything.**
  - Design: [`specs/2026-10-25-home-redesign-design.md`](superpowers/specs/2026-10-25-home-redesign-design.md)
  - Plan: [`plans/2026-10-25-home-redesign.md`](superpowers/plans/2026-10-25-home-redesign.md) (all 8 tasks done)
  - Parent design: [`specs/2026-10-24-customwebos-design.md`](superpowers/specs/2026-10-24-customwebos-design.md)
- **Tests:**
  - `npm test`: unit, ES5 check, script dry-runs
  - `npm run check:browser`: Playwright against the preview with a mock luna bridge
- **Preview:** `npm run dev` serves it at http://127.0.0.1:4795/. Add `?mock=error|slow|empty|few|flaky|recover|errorlong|slowlaunch` to see the other states.

## Setting up another machine

1. Clone, then run `npm ci` and `npx playwright install chromium`.
2. Get the LG CLI (`ares-package` is used by `scripts/package.ps1`): `npm i -g @webos-tools/cli`. Installing to the TV goes over SSH (`install.ps1 -TvHost`), so ares-install isn't needed.
3. Copy the TV's SSH key to `~/.ssh/id_ed25519_lgtv`. It isn't in git (see AGENTS.md, private state). SSH listens on port **22022** (setup.md §3.3).
4. The TV's LAN IP is not in git. Use it as `-TvHost <tv-ip>` below.
5. PowerShell may refuse to run scripts; use `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/<name>.ps1 …`.

## Working on the TV: what's been learned

Details and evidence are in `docs/m2-tracking.md`. Rules of thumb:

- **Every install needs a reboot:** `scripts/install.ps1 -TvHost <tv-ip> -Reboot`. Without one, the upgraded app's calls to its service are silently dropped. No reboot-free fix was found (Task 11: four candidates tried).
- **After a reboot, if the TV reopens CustomWebOS by itself** in the first ~30 s, that instance can stay stuck. Close it and open it again. `perf.ps1` does this for you.
- **The bus answers within about 40 s of boot.** The old "dead for 5 minutes" belief was a measurement mistake.
- **`luna-send` on the TV:**
  - Give it `< /dev/null` when its input would otherwise be a pipe. Otherwise it prints nothing and still exits 0.
  - Write its output to a file; don't pipe it under `timeout`.
  - BusyBox `timeout` takes `-t N`.
- **Measure speed** with `scripts/perf.ps1 -TvHost <tv-ip> -Action right -Steps 9`. It relaunches the app in perf mode and prints first-paint, frame and per-keypress timings. Today's numbers are in `docs/m2-tracking.md` to compare against.
- **Quick visual experiments without reinstalling:** edit the installed files under `/media/developer/apps/usr/palm/applications/org.jazwinski.customwebos.home/` and relaunch (back up first). Commit the result and install it properly afterwards.
- **Anything that touches the TV needs the owner's go-ahead per task** (AGENTS.md).

## Next steps

In suggested order:

0. **Install the review fixes and measure All apps (TV, needs the owner's go-ahead).**
   - Set `home/appinfo.json` to 0.4.2, then run `scripts/package.ps1` and `scripts/install.ps1 -TvHost <tv-ip> -Reboot`.
   - Run `scripts/perf.ps1 -TvHost <tv-ip> -Action down -Steps 9 -View all` twice. The design asked for All apps to be measured, and it never has been. The bar is p95 frame < 33 ms.
   - Check that a failed launch's note (now a dark pill above the dock) is readable on the photo.
   - Record the results in `docs/m2-tracking.md`.
1. **Home button / power-on (Task 12 of [`plans/2026-10-25-m2-preview-ui-hardening.md`](superpowers/plans/2026-10-25-m2-preview-ui-hardening.md)).**
   - Research first, writing nothing on the TV.
   - Fallback candidate: a `/var/lib/webosbrew/init.d/` script that waits for the bus, then closes and reopens CustomWebOS. That gives "power-on shows CustomWebOS" and also removes the stuck instance the TV reopens at boot.
   - Ship it as `scripts/autostart.sh` plus `autostart.ps1` (`-WhatIf`, `-Remove`), with a tested rollback.
2. **Time-of-day theme:** after a set hour, a dark wallpaper and colours, "similar to macOS".
   - Light and dark colour sets already exist (`.theme-dark` / `.theme-light` in `home/style.css`).
   - Each wallpaper needs its `-dock.jpg` glass image.
3. **M3, the NAS photo slideshow on HDMI signal loss** (parent design, M3). It's separate from the OLED pixel-refresh screensaver and doesn't have to replace LG's no-signal screen.
4. **Project 2, Home Assistant:**
   - The home service talks to a Home Assistant server; install one locally for testing.
   - "Plugins" are panels inside CustomWebOS, starting with a whole-house lights panel.
   - The dock's Up direction is reserved for a future control row.
5. **Project 3, overlays over other apps:** the doorbell camera feed over Netflix. The least certain part on webOS 4.4, so start with a small on-device spike of whether a video overlay is possible.

## Small open items

From the review, deferred:

- **Nothing in code caps Home at 9 apps;** only the config test does. An 11th entry in `config.js` would overflow the dock. Fix with `home.slice(0, 9)` in `splitHomeApps` plus a test.
- **`perfReport` writes `/tmp/customwebos-perf.json` as root.** It follows symlinks and has no size cap. At the next service bump: unlink first, write with `flag: 'wx'`, and cap the length.
- **The `max` logo's source record isn't pinned to a Simple Icons commit.**
- **A comment in `home/style.css` names CleanFrame,** while AGENTS.md keeps upstream mentions in the README. Rephrase it.
- **"Trying again in 1 s" can be wrong** when the 30 s grace timer fires while a retry is in flight. Cosmetic.

From the TV check:

- **All apps icons:** apps without a bundled logo show the TV's icon turned white. On the TV it looked fine, but an opaque square icon would turn into a white square. If one shows up, switch those to initials.
- **Manrope weights:** Chromium 53 predates variable fonts, so heavier weights are synthesised. Accepted on the TV.
- **Canal+ has no Simple Icons logo** and shows "C". A licensed white mark could be added to `home/assets/icons/` with its record in `SOURCES.json`.
