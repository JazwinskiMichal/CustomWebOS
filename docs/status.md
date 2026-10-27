# Status

Where CustomWebOS stands and what's next. Last updated **2026-10-26**. Update it whenever something lands. Setting up a machine: [development.md](development.md). TV rules: [tv-notes.md](tv-notes.md).

## On the TV now

- **CustomWebOS 0.6.0** is the home screen:
  - GNOME's Morphogenesis wallpaper: light by day, dark from sunset to sunrise in Warsaw, with text and glass colours to match
  - the clock and Polish date on glass like the dock
  - a frosted-glass dock of white logos for the curated apps
  - an All apps grid
  - 60 fps, with apps shown in about 0.3–0.6 s
  - the owner accepted the look
- **CustomWebOS opens only with the Home button;** power-on leaves the TV on the source that was playing at switch-off (webOS restores it: Live TV or an HDMI input). Our boot hook only shuts LG Input Hook's root config server (port 1842) once the remap is active.
- **The Home button opens CustomWebOS** (LG Input Hook, Home = ID 773). LG Input Hook's LAN config server is stopped after boot.
- **Remote view (VNC):** connect TightVNC to `<tv>:5900` with the owner's password to see and control the TV, including live TV, Netflix and HDMI. It runs at 960×540, about 12 fps within half a CPU core and about 17 MB; idle it costs nothing. Started by the `customwebos-remoteview` boot hook; its log is `/tmp/remoteview.log`. Set up with [development.md](development.md); details in [tv-notes.md](tv-notes.md).
- **All three mechanisms have proven rollbacks:** [home-button.md](home-button.md).

## Milestones

From the [overall design](superpowers/specs/2026-10-24-customwebos-design.md):

| | What | State |
|---|---|---|
| M1 | Foundation: repo, setup guide, minimal home app that launches apps | Done ([plan](superpowers/plans/2026-10-24-m1-foundation.md)) |
| M2 | Home screen depth: wallpaper, clock, good remote navigation, settings | Mostly done. Preview loop and hardening ([plan](superpowers/plans/2026-10-25-m2-preview-ui-hardening.md)), the [redesign](superpowers/plans/2026-10-25-home-redesign.md), Home button / power-on, and the day/night theme ([plan](superpowers/plans/2026-10-26-day-night-theme.md)). Open: on-TV settings (none planned yet) |
| M3 | First background service: HDMI signal loss → NAS photo slideshow | Not started |
| M4 | Overlays over the foreground app (doorbell camera over Netflix) | Not started |
| M5+ | Custom apps | Not started |

Two more projects were agreed on 2026-10-25 (see Next steps): a Home Assistant connection with plugins, and overlays (M4).

## Next steps

In suggested order. Each new piece of work starts with a design (`docs/superpowers/specs/`).

0. **Remote view follow-ups** (small, none blocking):
   - The persistent "someone is watching" badge comes with M4; the toast is temporary.
   - Parked minors with reasons: the log rotates only at restart; pointer drift after using the Magic Remote mid-session; `pointer_scale` above 1.2 can drop big moves; capture-library waits have no time limit (not seen on this TV).
1. **Day/night theme follow-ups** (small, none blocking): a forced `theme` (perf runs, checks) stays until the app is next closed; only the first switch is preloaded; a few edge cases (local 00:30, clock-change days, switching during All apps) are checked by review only, not by tests.
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
