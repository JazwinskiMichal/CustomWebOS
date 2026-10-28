# CustomWebOS

my own webOS platform. starts as a home-screen replacement for my rooted LG C8 (webOS 4.x), grows into an orchestrator for other custom apps i build on top of the TV — background services that watch events (HDMI signal loss, a doorbell camera at the door) and render overlays over whatever's foreground (Netflix, YouTube), without switching away.

## Credits

Inspired by [CleanFrame](https://github.com/nthnclrk/CleanFrame) by Nathan Clerk — a quieter home screen for the Samsung Frame. CustomWebOS carries the shape of its setup playbook and reshapes it for LG webOS. No code is ported directly.

The home screen's look follows CleanFrame's dock. Bundled assets keep their own terms:

- **Wallpaper:** "Morphogenesis" by Jakub Steiner, from GNOME's [gnome-backgrounds](https://gitlab.gnome.org/GNOME/gnome-backgrounds), [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) (`home/assets/wallpapers/LICENSE.CC-BY-SA-3.0.txt`). The day and night JPEGs and their blurred glass versions are derived from its light and dark SVGs by `scripts/wallpapers.ps1` and stay CC BY-SA 3.0. Source in `home/assets/wallpapers/SOURCES.json`.
- **App logos:** Netflix, YouTube, Prime Video, Max and Apple TV marks from [Simple Icons](https://simpleicons.org/) (CC0). Trademarks belong to their owners. Sources in `home/assets/icons/SOURCES.json`.
- **Font:** [Manrope](https://github.com/googlefonts/manrope), SIL Open Font License 1.1 (`home/assets/fonts/OFL.txt`).
- **Screen capture (remote view):** `native/remoteview/` builds the capture code of [hyperion-webos](https://github.com/webosbrew/hyperion-webos) 0.2.1 (MIT, `native/remoteview/third_party/LICENSE.hyperion-webos`) as a git submodule.
- **Pairing manifest (remote view):** `native/remoteview/src/pairing_manifest.h` embeds the `pairing.json` of [lgtv2](https://github.com/hobbyquaker/lgtv2) (MIT).
- **VNC server and JPEG:** `native/remoteview/` links [LibVNCServer](https://github.com/LibVNC/libvncserver) 0.9.14 (GPL-2.0, statically) and ships [libjpeg-turbo](https://libjpeg-turbo.org/) (BSD-style and IJG licences) as `libjpeg.so.8`, taken from the webOS buildroot toolchain's sysroot. Its licence text ships beside it as `bin/LICENSE.libjpeg-turbo`.

## Features

What runs on the TV today, and how to use each part. Installing it: [Setting it up](#setting-it-up).

### Home screen

A CleanFrame-style home screen: a clock and Polish date on glass, a frosted-glass dock of white app logos, and an All apps grid. It runs at 60 fps.

- **Open it:** press **Home** on the remote.
- **Move around:** arrows and **OK**, or point and click with the Magic Remote. The last dock tile opens **All apps** (every installed app); **Back** leaves it. Back on Home itself does nothing.
- **Day and night:** the Morphogenesis wallpaper is light by day and dark from sunset to sunrise, computed on the TV for its location (no internet needed).
- **Change the dock apps or the location:** edit `home/config.js` (`HOME_APPS`, at most 9; `HOME_LOCATION`), then package and install. Live TV and HDMI inputs can be dock tiles too.

### Home button and power-on

- **Home** opens CustomWebOS instead of LG's home bar ([LG Input Hook](https://repo.webosbrew.org/apps/org.webosbrew.inputhook/), Home = ID 773). It works from about 30–40 s after power-on, when Homebrew's boot hooks run; before that, Home opens LG's bar.
- **Power-on** comes back on whatever was playing at switch-off (Live TV or an HDMI input). CustomWebOS doesn't open by itself.
- **LG Input Hook must be patched** to inject into `lginput2` only: `scripts/inputhook-patch.ps1 -TvHost <tv-ip>`, then reboot. Unpatched, a TV that starts on an HDMI input turns every source black after the next switch until it's unplugged. Run it again after reinstalling or updating LG Input Hook; `-Undo` reverts it.
- Details and rollbacks: [docs/home-button.md](docs/home-button.md).

### No-signal slideshow

When the HDMI input on screen loses its picture (the PS5 is switched off, or goes to rest after it has sent a picture since the TV started), a full-screen slideshow of your photos replaces LG's "No signal" screen.

- **Photos:** put `.jpg`, `.jpeg` or `.png` files on a USB stick, in any folders (up to 8 levels deep), and plug it into the TV. Files over 20 MB are skipped. Without a stick or photos, LG's own screen stays.
- **When it starts:** 5 s after the input on screen goes dark. It covers any HDMI input, and only when that input is in front; Live TV and apps are never covered.
- **During the show:** a new photo every 30 s, in random order; **←/→** step through them. **Back** does nothing. **Home** opens CustomWebOS.
- **When it ends:** the device's picture comes back (the input reappears by itself), or you change the source with **Input**. Picking the dark input again (e.g. from the dock) brings the slideshow back after 5 s.
- **Power-off:** covering the input stops LG's own no-signal timer, so if LG's no-signal auto power-off is on, the slideshow turns the TV off after 15 min itself. LG's screensaver may also come on over it.
- **Install or remove:** `scripts/nosignal.ps1 -TvHost <tv-ip>` installs the boot hook (`-Remove` deletes it); it runs from the next boot. Its log on the TV is `/tmp/nosignal.log`.

### Remote view (VNC)

See and control the TV from a PC on your home network: the home screen, Live TV, Netflix and HDMI inputs. 960×540 at about 12 fps; it costs nothing while no one is connected, and the TV shows a short notice when someone connects.

- **Connect:** [TightVNC](https://www.tightvnc.com/) `tvnviewer.exe <tv-ip>::5900` with the password set by `scripts/remoteview.ps1 -SetPassword` (only the first 8 characters count). Connections are accepted from private network addresses only.
- **Mouse:** moves the TV's pointer; click to select.
- **Keys** (click into the viewer first):

  | PC key | TV |
  |---|---|
  | arrows, Enter | arrows, OK |
  | Esc, Backspace | Back |
  | Home | Home (opens CustomWebOS) |
  | F1 | Input (LG's source picker) |
  | F2 | Mute |
  | F3 / F4 | Volume down / up |
  | Page Up / Page Down | Channel up / down |
  | letters, digits, symbols | typed into the focused text field |

- **Set up:** `scripts/remoteview.ps1 -TvHost <tv-ip>` installs the boot hook, `-Pair` pairs it with the TV (accept the prompt on the TV), `-Remove` takes it off. More in [docs/development.md](docs/development.md#connecting-to-remote-view).

## Status

**Start at [docs/status.md](docs/status.md)** for the current state and next steps, and [docs/README.md](docs/README.md) for the map of all docs. The [design doc](docs/superpowers/specs/2026-10-24-customwebos-design.md) holds the overall vision and milestones.

## Setting it up

Follow the [setup guide](docs/setup.md). It walks the whole path on an LG C8: baseline capture, rooting, Homebrew Channel, SSH, installing CustomWebOS, and rollbacks for every step. Power-on and the Home button are in [docs/home-button.md](docs/home-button.md). Development (preview, tests, install, measuring on the TV) is in [docs/development.md](docs/development.md).

## Licence

[MIT](LICENSE), except `native/remoteview/` (the remote view daemon), which is [GPL-2.0](native/remoteview/LICENSE) because it links LibVNCServer. The exceptions are `native/remoteview/backends/libdile_vt.c` (a modified copy of hyperion-webos's backend, with its licence beside it) and `native/remoteview/third_party/`, which keep their MIT licences. The rest of the repo does not link it.
