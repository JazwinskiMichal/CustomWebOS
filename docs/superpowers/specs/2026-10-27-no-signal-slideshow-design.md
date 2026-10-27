# No-signal slideshow (M3) — design

Date: 2026-10-27. Parent design: [`2026-10-24-customwebos-design.md`](2026-10-24-customwebos-design.md) (M3: "first background service: HDMI signal loss → photo slideshow").

## Intent

When the HDMI device Michał was watching goes off (the PS5 in practice, but "this applies to any HDMI really"), the TV shows LG's no-signal screen. He wants his own pictures there instead, full screen and **"WITHOUT no signal overlay on those"**. The pictures must stay at home: "definitely I do not want to fetch images from the internet … either on a USB stick or in a local LAN". For now: **a USB stick**.

## Goals

- **Trigger:** the HDMI input on screen loses its signal → after a short settle delay, CustomWebOS shows a full-screen slideshow of the photos on the USB stick. Any HDMI input.
- **Nothing of LG's on top:** no "No signal" box, toast or overlay over the photos.
- **It ends when the source becomes active again,** in which case the TV goes back to that HDMI input by itself, **or when Michał changes the source** (Michał's words).
- **Photos:** every JPEG/PNG on the stick, in any folder, shuffled; one every ~30 s with a soft cross-fade (Claude's call, accepted in playback).
- **No dismissing it** (Michał: "I don't see the point of having the feature to dismiss it"). The slideshow stays as long as the HDMI input has no signal; only the signal coming back or a change of source ends it. Opening CustomWebOS with Home counts as changing the source; going back to the still-dark input brings the slideshow back after the settle delay.
- **Remote** (Claude's call, accepted): ← / → step through the photos; Back does nothing; Home opens CustomWebOS as usual.
- **No usable stick** (no stick, or no photos on it), accepted in playback: nothing changes, LG's normal no-signal screen shows. The watcher checks for photos before covering the input. If the stick is removed mid-show, the slideshow ends and the TV goes back to the HDMI input (Claude's call).

## Non-goals

- **Photos from the LAN (NAS, PC share, DLNA) or the internet.** LAN is a possible later step; the internet is out entirely.
- **Live TV, apps and other sources:** only HDMI inputs trigger it.
- **Editing or choosing photos on the TV.** The stick's contents are the selection.
- **Clocks, weather or any other content over the photos.** Just photos.

## Anti-goals

- **LG's overlay showing through,** or the slideshow fighting LG's no-signal screen and both flickering.
- **Stealing the screen when Michał didn't lose a signal:** a device switching resolution or waking up must not trigger it (hence the settle delay), and it must never trigger over Live TV or an app.
- **OLED harm:** no static image for long periods (the slideshow keeps changing), and nothing that blocks the OLED pixel-refresh/screensaver behaviour (spec of the parent design and M3 in status.md).
- **A worse TV:** no busy polling or timers while HDMI has a signal; no noticeable cost when the feature isn't active (same spirit as remote view's "idle costs nothing").
- **Breaking power behaviour:** the TV must still turn itself off as before when left alone (LG's "no signal → power off after 15 min", if enabled). Since the slideshow can't be dismissed, if it stops that from happening the plan must keep the TV's power-off working (for example by ending the show and letting the TV's own timer run), or Michał is told and decides.

## Constraints

- **TV:** LG C8, webOS 4.4.3, rooted with Homebrew Channel; web engine Chrome 53 (runtime JS ES5); CustomWebOS 0.6.0 with its root home service (Node 0.12) and the remote-view daemon. Facts and traps: `docs/tv-notes.md`.
- **Nothing of ours runs before ~30–45 s after power-on** (tv-notes). Signal loss within that window may be missed until the watcher starts; acceptable.
- **USB sticks** mount under `/tmp/usb/…` on webOS (to be confirmed on this TV).
- **Repo rules (AGENTS.md):** PowerShell-first scripts with `-WhatIf`; device work needs Michał's go-ahead per task; private data in `.local/`.

## The parts of the how decided

- **The slideshow is part of CustomWebOS** (a view of the home app, or a sibling page in the same package), so it can cover the whole screen as the foreground app. Covering the HDMI input with our app is what removes LG's overlay.
- **Detection is resident and event-driven:** something already running as root subscribes to the TV's input/signal state and opens the slideshow when the current HDMI input reports no signal for the settle delay, and closes it (switching back to that input) when the signal returns.
- **Photos never leave the TV and stick:** read locally; no copies on flash, no network.

## Open risks (first tasks of the plan, on the TV)

1. **Detecting signal loss.** Which luna service and method on webOS 4.4 reports HDMI signal state and changes (e.g. `com.webos.service.eim`, `com.webos.service.tvsignal…`, surface-manager events), and whether it can be subscribed to.
2. **Covering LG's no-signal screen** cleanly: launching CustomWebOS over the HDMI app without LG's popup re-appearing, and returning to the HDMI input afterwards.
3. **Reading the stick from the web app:** whether the app can load `file://` images from `/tmp/usb/…` directly, or the root service must list (and maybe serve) them.
4. **LG's auto power-off and screensaver** while our slideshow covers a signal-less input.

## Decisions from the builder check

- **No usable stick:** see Goals (accepted in playback; mid-show removal ends the show, Claude's call).
- **Dismissing:** none (Michał's answer); see Goals.

## Left to the builder

- Which resident process watches (the home service if it can stay alive, the remote-view daemon, or a small boot-hook watcher) — with the "idle costs nothing" rule.
- The settle delay (a few seconds), the photo interval and fade, shuffle details, supported formats and size limits (huge photos must not exhaust memory; downscale or skip).
- What "Michał changes the source" looks like in events, and how the slideshow learns it.
- Docs: status.md, tv-notes.md for lasting facts, development.md if a step changes.
