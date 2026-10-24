# CustomWebOS

my own webOS platform. starts as a home-screen replacement for my rooted LG C8 (webOS 4.x), grows into an orchestrator for other custom apps i build on top of the TV — background services that watch events (HDMI signal loss, a doorbell camera at the door) and render overlays over whatever's foreground (Netflix, YouTube), without switching away.

## Credits

Inspired by [CleanFrame](https://github.com/nthnclrk/CleanFrame) by Nathan Clerk — a quieter home screen for the Samsung Frame. CustomWebOS carries the shape of its setup playbook and reshapes it for LG webOS. No code is ported directly.

## Status

M1 foundation — repo skeleton, setup guide, and a minimal home-screen app that can launch installed apps. See the [design doc](docs/superpowers/specs/2026-10-24-customwebos-design.md) for what's planned beyond that.

## Setting it up

Follow the [setup guide](docs/setup.md). It walks the whole path on an LG C8: baseline capture, rooting, Homebrew Channel, SSH, installing CustomWebOS as the Home-button target, and rollbacks for every step.

## Licence

[MIT](LICENSE).
