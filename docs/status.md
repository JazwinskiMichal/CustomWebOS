# Status

Where CustomWebOS stands and what's next. Last updated **2026-10-26**. Update it whenever something lands. Setting up a machine: [development.md](development.md). TV rules: [tv-notes.md](tv-notes.md).

## On the TV now

- **CustomWebOS 0.4.2** is the home screen:
  - a full-screen photo, clock and Polish date
  - a frosted-glass dock of white logos for the curated apps
  - an All apps grid
  - 60 fps, with apps shown in about 0.3–0.6 s
  - the owner accepted the look
- **Power-on opens CustomWebOS,** via our `init.d` hook.
- **The Home button opens CustomWebOS** (LG Input Hook, Home = ID 773). LG Input Hook's LAN config server is stopped after boot.
- **Both mechanisms have proven rollbacks:** [home-button.md](home-button.md).

## Milestones

From the [overall design](superpowers/specs/2026-10-24-customwebos-design.md):

| | What | State |
|---|---|---|
| M1 | Foundation: repo, setup guide, minimal home app that launches apps | Done ([plan](superpowers/plans/2026-10-24-m1-foundation.md)) |
| M2 | Home screen depth: wallpaper, clock, good remote navigation, settings | Mostly done. Preview loop and hardening ([plan](superpowers/plans/2026-10-25-m2-preview-ui-hardening.md)), the [redesign](superpowers/plans/2026-10-25-home-redesign.md), and Home button / power-on. Open: time-of-day theme, on-TV settings (none planned yet) |
| M3 | First background service: HDMI signal loss → NAS photo slideshow | Not started |
| M4 | Overlays over the foreground app (doorbell camera over Netflix) | Not started |
| M5+ | Custom apps | Not started |

Two more projects were agreed on 2026-10-25 (see Next steps): a Home Assistant connection with plugins, and overlays (M4).

**Remote view (VNC), in progress** on branch `feat/remote-view` (not merged): see the TV's screen on the PC and control it with mouse and keyboard ([design](superpowers/specs/2026-10-26-remote-view-design.md), [plan](superpowers/plans/2026-10-26-remote-view.md)). Tasks 1–7 of 8 are done (7: packaging into the `.ipk`, `scripts/remoteview.sh` boot hook, `scripts/remoteview.ps1`, version 0.5.0) and were tested on the TV from `/tmp` with a test password: live TV, Netflix and the home screen at 960×540, about 12 fps within half a CPU core and about 17 MB; correct colours; mouse, keys, and Home launching CustomWebOS. Nothing of it is installed on the TV yet (the `.ipk` and the hook come with Task 8); only the pairing key is in `/home/root/.config/customwebos/`.

## Next steps

In suggested order. Each new piece of work starts with a design (`docs/superpowers/specs/`).

0. **Finish remote view** (plan Task 8, ledger in `.superpowers/sdd/2026-10-26-remote-view/progress.md`):
   - Tasks 6 and 7 are done (toast on connect/disconnect; `.ipk` with `bin/remoteview`, its backends and `libjpeg.so.8`, plus the boot hook logging to `/tmp/remoteview.log`).
   - Task 8: on-TV acceptance, with a reboot-install of the 0.5.0 `.ipk` (`scripts/install.ps1 -Reboot`), `scripts/remoteview.ps1` (hook, `-Pair`) and the owner's own password (`-SetPassword`), connecting with TightVNC (development.md). Re-check the first click after the cursor was hidden, and that repeated connects don't grow open handles (libgm keeps `/dev/lg/gfx0` open).
   - Then the whole-branch review and merge.
1. **Time-of-day theme:** after a set hour, a dark wallpaper and colours, "similar to macOS".
   - Light and dark colour sets already exist (`.theme-dark` / `.theme-light` on `<html>`, `home/style.css`).
   - Each wallpaper needs its `-dock.jpg` glass image; three photos ship, see `home/assets/wallpapers/`.
2. **M3, the NAS photo slideshow on HDMI signal loss.**
   - The base URL is a setting.
   - Replacing LG's no-signal screen is ideal, but launching over it is acceptable.
   - It must not interfere with the OLED pixel-refresh screensaver.
3. **Home Assistant:**
   - The home service talks to a Home Assistant server; install one locally for testing.
   - "Plugins" are panels inside CustomWebOS, starting with a whole-house lights panel.
   - The dock's Up direction is reserved for a control row.
4. **Overlays (M4):** the doorbell camera feed over Netflix. The least certain part on webOS 4.4, so start with a small on-device spike of whether a video overlay over another app is possible.

## Small open items

From the redesign's review, deferred:

- **Nothing in code caps Home at 9 apps;** only the config test does. An 11th entry in `config.js` would overflow the dock. Fix with `home.slice(0, 9)` in `splitHomeApps` plus a test.
- **`perfReport` writes `/tmp/customwebos-perf.json` as root.** It follows symlinks and has no size cap. At the next service change: unlink first, write with `flag: 'wx'`, and cap the length.
- **The `max` logo's source record isn't pinned to a Simple Icons commit.**
- **A comment in `home/style.css` names CleanFrame,** while AGENTS.md keeps upstream mentions in the README. Rephrase it.
- **"Trying again in 1 s" can be wrong** when the 30 s grace timer fires during a retry. Cosmetic.

From the TV:

- **All apps icons:** apps without a bundled logo show the TV's icon turned white. An opaque square icon would become a white square. If one shows up, use initials for it.
- **Canal+ has no Simple Icons logo** and shows "C". A licensed white mark could be added with its record in `home/assets/icons/SOURCES.json`.
- **LG Input Hook's boot script** runs `luna-send` without `< /dev/null` and deletes itself if a reply contains `errorText`. If Home ever opens LG's bar after a boot, check that `/var/lib/webosbrew/init.d/inputhook` exists. Opening LG Input Hook once recreates it.
- **`docs/setup.md` mentions `pwsh`** in its script examples; Windows PowerShell 5.1 is used here (`powershell -ExecutionPolicy Bypass -File …`).
