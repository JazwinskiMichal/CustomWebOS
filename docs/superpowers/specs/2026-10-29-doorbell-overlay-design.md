# Doorbell overlay (M4) — design

Date: 2026-10-29. Parent design: [`2026-10-24-customwebos-design.md`](2026-10-24-customwebos-design.md) (M4: "picture-in-picture over foreground apps. The doorbell-camera example becomes testable"). Spike results: [tv-log, overlay spike](../../tv-log.md#overlay-spike-m4-2026-102829).

## Intent

When someone rings at the door, Michał wants to see who it is without leaving what he's watching. In his words, the overlay "needs to be above ALL ideally, so not only netflix, or youtube, but live tv as well", showing "the video output from the camera and possibly a button to open the door". There is no doorbell or camera yet; it should be "home assistant ready", and "we're building poc here". Talking through the Magic Remote's microphone would be "rocket science".

## Goals

- **A ring opens a camera box over whatever is on screen:** Netflix, YouTube, Live TV, HDMI inputs, CustomWebOS itself. What's underneath keeps playing.
- **The box shows the camera's live picture,** as MJPEG (or JPEG snapshots, refreshed several times a second, for cameras without MJPEG).
- **OK opens the door; Back closes the box.** In the proof of concept, "open the door" calls a configurable HTTP URL (later a Home Assistant webhook or script); with no URL set, it only shows "Door opened" (what the spike did).
- **Testable today without hardware:** a fake camera on the PC (as in the spike) and a script that rings.
- **Home Assistant ready:** HA can ring by launching the box through the TV's own remote-control API (below), and the camera and door URLs are plain settings.

## Non-goals

- **Two-way audio** (the remote's microphone, the TV's speakers for the visitor). Michał: "rocket science".
- **Real video in the box** (HLS, WebRTC, H.264). The spike showed the TV decodes one video at a time: either the box or the app underneath goes black.
- **Choosing or buying the camera and doorbell.** Michał hasn't researched hardware yet.
- **Recording, history, motion alerts, several cameras.**
- **Waking the TV** when it's off. A ring while the TV is off does nothing.

## Anti-goals

- **Breaking what's playing:** Netflix or Live TV going black, pausing or losing sound because of the box.
- **The box vanishing on its own** while Michał looks at it (what the `overlay` window type did), or **lingering** and holding the remote's keys after he's done.
- **A door opened by accident:** a stray key press must not open the door (see "The parts of the how decided").
- **Cost when idle:** nothing running or polling between rings (the "idle costs nothing" rule of remote view and the slideshow).

## Constraints

- **TV:** LG C8, webOS 4.4, rooted with Homebrew Channel; Chrome 53 (runtime JS ES5); CustomWebOS 0.7.4 with its root home service (Node 0.12). Facts and traps: `docs/tv-notes.md`.
- **Window type:** only `"defaultWindowType":"floating"` (+ `"transparent":true`) stays in front (spike). The window type is fixed per app in `appinfo.json`, so the box is **its own app**, not a view of CustomWebOS Home (a full-screen card).
- **The box takes the remote's keys** while open; Back returns them to the app underneath (spike).
- **A source change closes the box** (spike). Acceptable: the next ring opens it again.
- **A new app id needs a reboot after its first install** before SAM can launch it (tv-notes).
- **Repo rules (AGENTS.md):** PowerShell-first scripts with `-WhatIf`; device work needs Michał's go-ahead per task; private data (camera URLs, tokens, the TV's IP) in `.local/` or on the TV, never in git.

## The parts of the how decided

- **A separate web app, `org.jazwinski.customwebos.doorbell`**, packaged and installed with CustomWebOS. Floating, transparent, a box in the bottom-right corner (the spike's 640×400 is the starting size; Claude's call). Nothing of it runs between rings.
- **Ringing = launching that app,** with the camera and door settings in its launch parameters or its own config. The ways to ring:
  - **from the PC:** `scripts/doorbell.ps1 -TvHost <tv-ip> -Ring` (SSH + `luna-send … applicationManager/launch`);
  - **from Home Assistant later:** its LG webOS integration's `webostv.command` with `command: system.launcher/launch` and `payload: {id: org.jazwinski.customwebos.doorbell, params: …}`. This is the same SSAP API remote view already uses; `system.launcher/launch` with an app `id` and extra keys is community-tested in HA ([HA forum](https://community.home-assistant.io/t/play-youtube-on-smart-tv/101407), [`webostv.command`](https://www.home-assistant.io/actions/webostv.command/)), so no listener of our own on the TV is needed. To verify when HA exists.
- **A ring while the box is open** relaunches it (refreshes the picture), no second box.
- **The box closes itself** after 60 s without a key press (Claude's call), so it never holds the remote's keys for long. Back closes it at once.
- **Opening the door needs a confirmation:** the first OK enlarges the box and moves it to the centre of the screen (Michał: "increase the size and center the box on first ok"), with "OK again to open the door"; only a second OK within a few seconds sends the request (Claude's call, against the "door opened by accident" anti-goal). If no second OK comes, the box goes back to its corner size.
- **Camera unreachable:** the box says so ("Camera not responding") instead of a blank square; OK/Back still work.
- **Fake camera for development:** the spike's PC server (MJPEG at 5 fps, `/frame.jpg`, request log) moves into the repo under `dev/`.

## Decisions from the builder check (Claude's calls)

- **Settings live on the TV, not in git or in each ring:** a JSON file the root home service reads (written by `scripts/doorbell.ps1 -Configure` from `.local/`, kept across app installs, so outside the app's folder). A ring needs only the app id; launch parameters may override the camera values (`cameraUrl`, `cameraMode`) for testing, never the door URL, so nothing that can launch an app can point the door request elsewhere. HA then never carries URLs or tokens.
- **The door request goes through the home service** (root, Node), not the page: a webhook or camera won't send CORS headers to Chrome 53. The page asks the service; the service makes the HTTP call and answers ok or error.
- **First install:** the box's first install needs one reboot before it can be launched. The install step says so and offers it (`install.ps1 -Reboot`, as today); later updates of the box don't need one (tv-notes: updating an already-registered app's files works without a reboot, only the home app's service calls need it).
- **A ring while the box is open** arrives as `webOSRelaunch` (as for CustomWebOS Home today); the box reloads the picture and restarts its 60 s timer.
- **Keys:** the page handles them itself, as in the spike: OK (13) and Back (461, and 27 for the PC preview) on `keydown`; Back calls `window.close()`. A source change closes the window by itself (spike); the 60 s timer is the page's.

## Fallback (not built unless the floating box fails later)

An LG alert (`com.webos.notification/createAlert`) with a "Show" button that launches the box. It works over HDMI (spike), and is kept in mind if a firmware update or an app ever stops the floating window. Not part of this milestone.

## Left to the builder

- How the box gets its settings: launch parameters, a config file in the app like `home/config.js`, or the home service. Defaults point at the fake camera.
- MJPEG vs snapshot polling detection, the refresh rate, the confirmation timeout, exact copy and styling (CustomWebOS's glass look).
- The door request's shape (method, body) as long as an HA webhook URL works (`POST`, no auth header needed for webhooks). Chrome 53 sends cross-origin requests from the app; whether it goes from the page or the home service is the builder's call.
- Whether `install.ps1` handles the second app or a separate install step does.
- Tests in the repo's style (Node unit tests, Playwright preview); the on-TV checks are Michał's: a ring over Netflix, Live TV and HDMI 1; OK-OK; Back; the 60 s close.
- Docs: README feature section, status.md, tv-notes.md for lasting facts (window types, one video decoder).
