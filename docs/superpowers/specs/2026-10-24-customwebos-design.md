# CustomWebOS — Design

Author: Michał Jaźwiński
Date: 2026-10-24
Status: Draft for review

## Intent

CustomWebOS is a personal platform that runs on Michał's rooted LG C8 TV. Its anchor piece is a custom home screen that fully replaces LG's native webOS home. Over time it grows into an orchestrator for other custom apps Michał builds — a background layer that watches events and renders overlays on top of whatever's currently foreground on the TV (Netflix, YouTube, etc.).

The name is deliberately broad. "Launcher" would be too narrow; "home screen" undersells the orchestrator. CustomWebOS is a thin platform that happens to ship a home screen as its first and most visible app.

## Why now

- Michał owns an LG OLED55C8PLA. The TV is rooted (dejavuln v0.0.10, firmware 05.50.70). Homebrew Channel 0.7.3 is persistent, SSH works, pubkey auth is set up. Everything in the way of running custom code is already handled.
- LG's native home has friction Michał wants to design out, and there's no vendor path that lets him customize it in-place.
- He has concrete future ideas (e.g. a doorbell-camera picture-in-picture that appears over whatever's on screen) that require a platform, not just a launcher. Starting with the right shape is cheaper than retrofitting a launcher later.
- A separate project named CleanFrameLG already contains the setup lessons (baseline, root, Hbchannel, SSH-on-port-22022). CustomWebOS inherits that knowledge but starts with its own git history and its own voice.

## Goals

1. **A home screen Michał is happy to look at every day**, fully replacing LG's native home on his C8. Pressing the Home button on the Magic Remote opens CustomWebOS, not LG's launcher.
2. **Proper integration with the TV's basic functions**: launching installed apps (Netflix, YouTube, Disney+, etc.), navigating with the remote, reaching LG's settings, input switching, volume/mute via the remote's own hardware keys.
3. **A rooting + install + rollback guide a stranger could follow** on an LG C8 running webOS 4.x firmware 05.50.70. The guide carries from CleanFrameLG in substance, is rewritten in Michał's voice, and strips Samsung/Tizen references.
4. **Credit CleanFrame** (Nathan's original) prominently in the README with a link to the upstream repo, as inspiration. No git-history or filesystem lineage.
5. **Shape the repo so an orchestrator layer can be added later** without redesign: a monorepo with clear boundaries between the home-screen app, background services, and future apps.

## Non-goals

- **Multi-vendor TV support.** LG C8 is the only reference. Running on other LG models or other webOS versions is welcome if it works, but not promised and not tested.
- **End-user theming or settings UI.** Michał is the user. Preferences can be edited directly in source.
- **Embedding streaming players.** CustomWebOS launches other installed apps for playback; it does not host an inline Netflix/YouTube player and does not touch account credentials.
- **A public app catalogue or distribution surface.** This is a personal platform, not an App Store.
- **A soft-fork of CleanFrame.** No ported Tizen `app/` code, no ported `scripts/package.py` or `scripts/tv.py`, no ported `scripts/native-home/` helper. webOS APIs are different enough that porting the code buys nothing.

## Anti-goals (would make this a failure even if it technically works)

- **Fragility against lost root.** If root is removed (OTA, factory reset, exploit patched), the TV must gracefully fall back to LG's native home. Nothing in CustomWebOS should assume root persists forever or make the TV unusable without it. The setup guide's rollback section stays load-bearing.
- **Blind trust in undocumented LG APIs.** Hbchannel-adjacent luna-service calls that are known to work on 05.50.70 are fine; anything deeper (modifying system partitions, bootloader, DRM) is out of bounds — the TV must stay bricked-proof.
- **Making the TV less useful than LG's home.** If a basic LG function (remote navigation, standby, input switch) regresses, that's a failure.
- **Hidden state Michał can't see.** No ad analytics, no telemetry back to anyone, no cloud sync. Logs live on the TV and on his workstation.

## Constraints

- **TV hardware/OS:** LG OLED55C8PLA, webOS 4.4.3-22 (codename `goldilocks` / `gorongosa`, 2018 OLED C-series). Firmware 05.50.70. Kernel Linux 4.4.84 armv7l (32-bit ARM). Hostname `LGwebOSTV`.
- **Root state:** persistent via Hbchannel 0.7.3. SSH via dropbear on **port 22022** (LAN router blocks :22 to clients; details in CleanFrameLG's baseline). Pubkey-only auth; webOS `/etc/shadow` is read-only so `passwd` can't change the password — security model relies on `/home/root/.ssh/authorized_keys` presence disabling the default `alpine` password at boot.
- **TV runtime:** the webOS web engine on 2018 hardware is older than modern Chromium. Keep application-tier JS **ES5-compatible by default**, with ES2015 features used only after confirming support on the actual TV. Build tooling (Node, bundlers if any) can use modern JS.
- **Packaging:** webOS `.ipk` built with the LG WebOS TV CLI's `ares-package`, installed via `ares-install`. These Node-based tools run on the development machine, not the TV.
- **Development machine:** Michał's Lenovo on Windows 11 Pro. PowerShell is the primary shell (`Bash` tool available but PowerShell is default). Python available. Node 22+ available (same stack as CleanFrameLG). Scripts should be PowerShell-first and work without WSL.
- **Repo visibility:** public, under Michał's GitHub account. Private state (device identifiers, keys, firmware .epk's) stays in `.local/` and `dist/`, both gitignored.
- **License:** MIT. Copyright `© 2026 Michał Jaźwiński`.

## The parts of the How decided

### Repo layout (monorepo)

```
CustomWebOS/
├── README.md                     # Project pitch, nod to CleanFrame, pointer to setup guide.
├── LICENSE                       # MIT, Michał's copyright.
├── docs/
│   ├── setup.md                  # The setup guide carried over from CleanFrameLG, reshaped.
│   └── superpowers/specs/        # This document and future design docs.
├── home/                         # The home-screen webOS app. Produces a .ipk.
│   ├── appinfo.json              # webOS app manifest.
│   ├── index.html                # Entry.
│   ├── main.js                   # Runtime logic. ES5.
│   └── (assets, styles)
├── services/                     # Background luna-services and daemons.
│                                 # Empty in M1. First inhabitant: the signal-loss switcher.
├── apps/                         # Placeholder for additional custom webOS apps built later.
│                                 # Empty in M1.
├── scripts/                      # Build / install / packaging helpers for Windows.
│   └── (PowerShell wrappers around ares-package, ares-install)
└── .local/                       # Gitignored. Private per-TV baseline, keys, firmware.
```

### Setup guide shape

The setup guide (`docs/setup.md`) inherits its structure from CleanFrameLG's `docs/lg-webos-setup.md`:

- **§0 Pre-flight / baseline capture** (offline, no device access): firmware `.epk` download, firmware string capture, LAN IP capture, deliberate skips where applicable.
- **§1 Pre-root checks** (TV side): Developer Mode app absent, Auto Update off, Quick Start+ off, USB stick ready (FAT32, non-exFAT).
- **§2 Root** with dejavuln-autoroot (vendored release URL + SHA256 in the doc).
- **§3 Hbchannel essentials**: toggles explained for 0.7.3 (Telnet / SSH server / Block system updates / Failsafe mode), pubkey auth (not `passwd`, because of read-only `/etc/shadow`), port-22-vs-router-firewall troubleshooting with the one-line init.d hook for :22022.
- **§4 Install CustomWebOS** (new section): `ares-package`, `ares-install`, autostart hook.
- **Rollback A/B/C/D**: unchanged in substance from CleanFrameLG; Samsung-era phrasing stripped.

Samsung-era phrasing stripped means: no references to Nathan's maintainer identity, no Samsung Frame or Tizen SDK, no Mac-specific paths, no proprietary Pangram fonts. Nathan's name appears exactly once, in the README's credit line.

### Credit line

In the README, close to the top:

> Inspired by [CleanFrame](https://github.com/nthnclrk/CleanFrame) by Nathan Clerk — a quieter home screen for the Samsung Frame. CustomWebOS carries over the shape of its setup playbook and reshapes it for LG webOS. No code is ported directly.

Exact wording the builder can tweak.

### Autostart / Home-button hijack

CustomWebOS replaces LG's home via the Hbchannel / webosbrew community's established autostart mechanism. **The setup guide §4 enumerates the known-working patterns** (candidates include: a `/var/lib/webosbrew/init.d/` script that sets the Home-button target via `luna-send`, overriding `applicationManager`'s default launchpoint, and others webosbrew-community currently recommends for 0.7.3). Each candidate ships with its own pros/cons and rollback. **Michał picks one at install time** (device-authorised task, separate from M1 artifact production). This respects the "builder can't test on the TV" constraint and keeps the install step reversible per-pattern.

The guide must document rollback for every enumerated pattern: how to stop CustomWebOS from being Home, cleanly, with a working path even if the TV won't boot into CustomWebOS successfully.

### Orchestrator layer (Milestone 2+, documented here so M1 doesn't paint itself into a corner)

The orchestrator is a long-running background component that:
- Subscribes to events from installed services and from Michał's own luna-services.
- Decides whether an event becomes an overlay, a notification, a background action, or is ignored.
- Can draw UI *over* the current foreground app without switching away from it (picture-in-picture over Netflix).

**Example events** (not exhaustive, not promised for any specific milestone):
- HDMI signal loss → switch to CustomWebOS (the "signal-loss switcher" from the LG level-2 plan).
- Doorbell camera event → render a camera-feed picture-in-picture overlay.
- Any future custom app can publish events it chooses.

**Open shape**: on webOS 4.4, overlays-over-foreground are tricky. Known community mechanisms:
- `luna://com.webos.notification/createAlert` and `createToast` (used by Hbchannel itself for Failsafe alerts).
- A transparent full-screen app that `ares-launch`-es over the current app via `applicationManager/launch` with a layered mode.

Which to pick, and whether the orchestrator uses one or combines them, is left to the builder. M1 only needs to **not foreclose either**: no monolithic design that assumes the home app owns the whole screen forever.

## Milestone 1 (first commit series into CustomWebOS)

Everything below is the minimum that lets Michał install CustomWebOS on his C8, see his own home screen, and launch Netflix from it.

**M1 ends when the artifacts below exist and build correctly on the development machine. Actually installing CustomWebOS on the TV, pressing Home, and launching Netflix is a *separate* device-authorised task that follows M1.** This matches the project's device-access convention: repo work and device work are different authority levels.

1. **This design document** as `commit 1` (the first commit of the new repo).
2. **README.md** with: one-line pitch, the credit line, link to the setup guide, link to this design doc.
3. **LICENSE** (MIT, Michał's copyright, 2026).
4. **`.gitignore`** for `.local/`, `dist/`, `node_modules/`, standard web/Node ignores.
5. **`AGENTS.md`** encoding maintainer-neutral project conventions: device-access tasks need explicit per-task authority from the owner; TV runtime JS stays ES5-compatible by default; scripts are PowerShell-first (Bash fallback acceptable); `.local/` and `dist/` are gitignored and never committed; upstream credit lives in README, not in file headers. **Not** a copy of CleanFrameLG's AGENTS.md — that one is Nathan-specific. CustomWebOS's AGENTS.md is written for anyone who later maintains the repo.
6. **`docs/setup.md`** — the full guide. **Full re-draft in Michał's own pragmatic, informal voice** (as it reads in his own writing: first-person, direct, no corporate-doc measured tone). CleanFrameLG's `lg-webos-setup.md` is a reference for *content*, not a template — the builder reads it, extracts the facts and sequence, then writes the new guide fresh. Lessons from today's session must be folded in: Hbchannel 0.7.3 toggles, pubkey-not-passwd (webOS `/etc/shadow` is read-only), port-22-vs-router-firewall troubleshooting with the one-line init.d hook for :22022. No Samsung/Tizen/Mac references. Nathan's name appears exactly once, in the README's credit line, not in this guide.
7. **`home/`** — the home-screen app:
   - `appinfo.json` with id `org.jazwinski.customwebos.home`, title `CustomWebOS Home`, type `web`, vendor `Michał Jaźwiński`, version `0.1.0`, icon `icon.png`.
   - `index.html` loading `main.js` and a stylesheet.
   - `main.js` that discovers installed apps via `luna-send com.webos.applicationManager/listLaunchPoints` and renders a minimal list the Magic Remote can navigate.
   - A placeholder icon (any 80×80 PNG; builder picks).
   - **M1 UI scope: enough to launch Netflix with the remote.** No wallpaper carousel, no settings, no appearance axes, no Glass materials, no theme system. The CleanFrame-style breadth of UI is explicitly deferred.
8. **`scripts/`** — PowerShell wrappers:
   - `scripts/package.ps1` — runs `ares-package home/` and drops the `.ipk` in `dist/`.
   - `scripts/install.ps1` — runs `ares-install -d <device>` where `<device>` is a `ares-setup-device` entry Michał set up for his TV (SSH already works via pubkey, so `ares-setup-device` should Just Work).
   - These wrappers do **not** sign anything; webOS user apps don't need signing on Hbchannel installations.
9. **Hbchannel autostart integration** — documented in `docs/setup.md` §4 and automated by a one-off script Michał runs after `ares-install`. Specifics left to the builder; see "Autostart / Home-button hijack" above.

### Workflow (process convention, not design)

This design doc is commit 1 of CustomWebOS after Michał approves it. The implementation plan is written and reviewed as a separate artifact before coding starts (standard brainstorming → plan → implementation pipeline). Michał answers the "Open questions" section inline; `commit 1` includes those answers, not the questions.

Not in M1: the full launcher UI (list/dock, wallpapers, settings, remote-focus niceties, clock, panel stack). Those are candidate M2 work.

## Later milestones (sketched, not committed)

- **M2 — Home screen depth**: wallpapers, clock, remote navigation that feels good, settings for the few things Michał cares about. CleanFrame is the reference for shape, not source.
- **M3 — First background service**: HDMI signal-loss switcher as a luna-service in `services/`. First inhabitant of the orchestrator pattern.
- **M4 — Overlay rendering**: picture-in-picture over foreground apps. The doorbell-camera example becomes testable.
- **M5+** — individual custom apps in `apps/` as Michał builds them.

## What's left to the builder

- **Exact autostart hook** for making CustomWebOS the Home-button target on Hbchannel 0.7.3. Pick from webosbrew-community-established patterns. Must have a clean rollback.
- **JS stack choice for the home app**: default is vanilla ES5. A tiny micro-framework is OK if it compiles to ES5 and ships small. React/Vue would be over-engineering for M1.
- **Build tooling**: default is no bundler for M1 (`main.js` is a single ES5 file). Add Rollup/esbuild later only when needed.
- **Overlay mechanism** for M4 (`luna://com.webos.notification` vs. transparent-full-screen-app vs. hybrid). Decide at M3/M4 time, not now.
- **Event-bus shape** for the orchestrator in M3+ (shared socket, our own luna-service, something else). Decide at M3 time.
- **How to migrate** CleanFrameLG's `docs/lg-webos-setup.md` into `docs/setup.md`: the builder can either copy-and-edit or re-draft. Content is more important than form. The lessons that aren't in the current guide (0.7.3 toggles, pubkey-not-passwd, port-22022) must land.
- **CleanFrameLG's fate**: it stays on Michał's GitHub as the record of this afternoon's work and the historical setup playbook. No further commits planned there. The builder doesn't need to touch it.

## Decisions resolved during the builder-check round

A reviewer read this doc and surfaced five places where a wrong guess would matter. Three were Michał's calls; two were conventions I settled. All resolved before commit 1.

- **M1 "done" bar** — Michał: artifacts ready for install. Device install is a separate authorised task. Section updated.
- **Autostart hook strategy** — Michał: enumerate the webosbrew-known candidates in the setup guide; Michał picks at install time, per-pattern rollback shipped with each. Section updated.
- **Setup guide voice depth** — Michał: full re-draft in his own voice, using CleanFrameLG's guide only as a content reference. Section updated.
- **Review workflow** — my call: design doc → approval → implementation plan (separate review) → execution. Standard brainstorming pipeline. Workflow note added.
- **CustomWebOS AGENTS.md** — my call: ship one in M1, maintainer-neutral, encoding device-authority / ES5 / PowerShell-first / `.local/` conventions. Added as M1 item.

