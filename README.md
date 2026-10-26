# CustomWebOS

my own webOS platform. starts as a home-screen replacement for my rooted LG C8 (webOS 4.x), grows into an orchestrator for other custom apps i build on top of the TV — background services that watch events (HDMI signal loss, a doorbell camera at the door) and render overlays over whatever's foreground (Netflix, YouTube), without switching away.

## Credits

Inspired by [CleanFrame](https://github.com/nthnclrk/CleanFrame) by Nathan Clerk — a quieter home screen for the Samsung Frame. CustomWebOS carries the shape of its setup playbook and reshapes it for LG webOS. No code is ported directly.

The home screen's look follows CleanFrame's dock, and its glass dock images (`home/assets/wallpapers/*-dock.jpg`) are CleanFrame's pre-blurred "soft" materials for the bundled photos. Other bundled assets keep their own terms:

- **Photos:** from [Unsplash](https://unsplash.com/license) — "Alpine glow" by Cristina Gottardi, "Misty coast" by Ganapathy Kumar, "Quiet cove" by Joshua Wordel. Pages in `home/assets/wallpapers/SOURCES.json`.
- **App logos:** Netflix, YouTube, Prime Video, Max and Apple TV marks from [Simple Icons](https://simpleicons.org/) (CC0). Trademarks belong to their owners. Sources in `home/assets/icons/SOURCES.json`.
- **Font:** [Manrope](https://github.com/googlefonts/manrope), SIL Open Font License 1.1 (`home/assets/fonts/OFL.txt`).
- **Screen capture (remote view):** `native/remoteview/` builds the capture code of [hyperion-webos](https://github.com/webosbrew/hyperion-webos) 0.2.1 (MIT, `native/remoteview/third_party/LICENSE.hyperion-webos`) as a git submodule.
- **Pairing manifest (remote view):** `native/remoteview/src/pairing_manifest.h` embeds the `pairing.json` of [lgtv2](https://github.com/hobbyquaker/lgtv2) (MIT).
- **VNC server and JPEG:** `native/remoteview/` links [LibVNCServer](https://github.com/LibVNC/libvncserver) 0.9.14 (GPL-2.0, statically) and ships [libjpeg-turbo](https://libjpeg-turbo.org/) (BSD-style and IJG licences) as `libjpeg.so.8`, taken from the webOS buildroot toolchain's sysroot. Its licence text ships beside it as `bin/LICENSE.libjpeg-turbo`.

## Status

On the TV today:
- A CleanFrame-style home screen: a photo, clock and Polish date, a glass dock of white logos, and All apps. It runs at 60 fps.
- The TV opens it at power-on, and the Home button opens it.

**Start at [docs/status.md](docs/status.md)** for the current state and next steps, and [docs/README.md](docs/README.md) for the map of all docs. The [design doc](docs/superpowers/specs/2026-10-24-customwebos-design.md) holds the overall vision and milestones.

## Setting it up

Follow the [setup guide](docs/setup.md). It walks the whole path on an LG C8: baseline capture, rooting, Homebrew Channel, SSH, installing CustomWebOS, and rollbacks for every step. Power-on and the Home button are in [docs/home-button.md](docs/home-button.md). Development (preview, tests, install, measuring on the TV) is in [docs/development.md](docs/development.md).

## Licence

[MIT](LICENSE), except `native/remoteview/` (the remote view daemon), which is [GPL-2.0](native/remoteview/LICENSE) because it links LibVNCServer. The exceptions are `native/remoteview/backends/libdile_vt.c` (a modified copy of hyperion-webos's backend, with its licence beside it) and `native/remoteview/third_party/`, which keep their MIT licences. The rest of the repo does not link it.
