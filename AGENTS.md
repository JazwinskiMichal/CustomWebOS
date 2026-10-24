# Project conventions

CustomWebOS is a personal webOS platform anchored by a home-screen replacement for a rooted LG C8; see the design doc at [`docs/superpowers/specs/2026-10-24-customwebos-design.md`](docs/superpowers/specs/2026-10-24-customwebos-design.md).

These conventions apply to everyone (and every agent) working on this repo.

## Device-access authority

Tasks that touch the TV — SSH sessions, `ares-install`, applying or removing an autostart hook, running a rollback drill, modifying anything under `/var/lib/webosbrew/` — require **explicit per-task authorisation** from the repo owner. Repo- and browser-only work (editing docs, authoring scripts, running unit tests on the dev machine) does not.

## TV runtime: ES5-compatible JS

The webOS 4.x web engine is older than modern Chromium. Anything that runs on the TV — code under `home/` and any future TV app — stays **ES5-compatible by default**. No `const`, `let`, arrow functions, template literals, `class`, `async`/`await`, destructuring, spread/rest in runtime files unless the specific feature has been confirmed on the actual device.

Development-side tooling (Node scripts, bundlers if any arrive later, test runners) may use modern JS.

## Scripts: PowerShell-first

Shell scripting in this repo is **PowerShell-first**. Bash is an acceptable fallback where PowerShell would be awkward (e.g. embedded in a cross-platform helper). Any script that calls out to the TV — `ares-cli`, SSH, luna-send — must support a `-WhatIf` / dry-run flag that prints the command it would run and exits cleanly without side effects.

## Package id namespace

webOS packages built here use the `org.jazwinski.customwebos.*` namespace. The home-screen app is `org.jazwinski.customwebos.home`.

## Private state

The `.local/` and `dist/` directories are gitignored and must never be committed. Firmware archives, SSH keys, device identifiers, recovery baselines, build output — all of it lives there and stays on the maintainer's machine.

## Upstream credit

Upstream project credit is maintained in the [README](README.md) only. No credit lines or acknowledgement comments in file headers; no mention of upstream maintainers elsewhere in the tree.
