# Remote view (VNC) — design

Date: 2026-10-26. Parent design: [`2026-10-24-customwebos-design.md`](2026-10-24-customwebos-design.md). Spike evidence: [`docs/tv-log.md`](../../tv-log.md), 2026-10-26.

## Intent

Michał wants to see and control his TV from his PC **at any time**, "like real VNC": open a VNC viewer on the PC, connect, see exactly what the TV shows, and drive it with mouse and keyboard. Nothing is started on the TV first; CustomWebOS is always listening.

## Goals

- **A VNC server on the TV**, part of CustomWebOS, started at every boot. Any standard VNC viewer on the PC connects to `<tv-ip>:5900`.
- **The whole screen:** the video layer (live TV, Netflix, HDMI inputs) composited with the UI layer (CustomWebOS, LG menus, app UIs). Michał asked for "everything, including Netflix and HDMI"; the spike showed all of it captures on this C8 (see Spike results).
- **Control, not just viewing:** mouse moves and clicks the TV's pointer; keyboard keys act as remote buttons.
- **Password-protected** (Michał: "password for sure").
- **A toast on the TV** when a viewer connects and when it disconnects (Michał's choice for now; a persistent badge comes later, see Non-goals).

## Non-goals

- **A persistent "someone is watching" badge** over the foreground app. That is an overlay over another app, i.e. M4, which is unproven on webOS 4.4. Michał: "toast for now, badge later with M4".
- **Access from outside the home network**, tunnels, cloud relays.
- **Audio.**
- **A browser-based viewer** (noVNC etc.). Standard VNC viewers only.
- **Connecting while the TV is off** (Claude's call). "At any time" means while the TV is on; every power-on is a full boot, so an off TV runs nothing. No wake-on-LAN path. With the picture switched off (screen-off, audio playing), the viewer shows whatever capture returns.
- **Replacing LG's no-signal screen.** Michał raised it while testing; it is already **M3** (NAS slideshow on signal loss) and stays separate.
- **Full 4K / 60 fps.** A readable, responsive picture matters more.

## Anti-goals

- **The TV getting worse because remote view exists:** playback or the home screen stuttering while connected, memory pressure, or **any cost while nobody is connected**. Michał: "remember about the resources, memory and storage constraints of the TV itself."
- **Losing video capture until a reboot** (see Spike results: a leaked capture context does exactly this).
- **Reachable from the internet**, or connectable without the password.
- **Side effects of capturing:** HDR mode, power state or the OLED pixel-refresh screensaver being changed or blocked.
- Bricking risk: nothing touches system partitions; everything lives under `/media/developer` and `/var/lib/webosbrew/init.d/` with a one-line undo.

## Constraints

- **TV:** LG C8, webOS 4.4.3, kernel 4.4.84 armv7l, **2 cores**, load average ~10 at idle (normal here). **~650 MB RAM available** of 3 GB, 600 MB swap. `/media/developer` has 1.6 GB free. `/tmp` is RAM-backed. Measured 2026-10-26.
- **Capture APIs** (reverse-engineered, present on this TV): `libdile_vt` (video layer, webOS 3/4) and `libgm` (UI layer, webOS 3/4). Both need root. `libvtcapture`/`libhalgal` are for webOS 5+ and are not used.
- **Input:** uinput does **not** work: `surface-manager` opens `event0`–`event5` at start and never opens devices created later (tested 2026-10-26). LG's second-screen API does work: `ws://<tv>:3000`, register with a client key (one-time "allow" prompt on the TV), then `ssap://com.webos.service.networkinput/getPointerInputSocket` returns a WebSocket that takes text messages (`type:move dx dy`, `type:click`, `type:scroll`, `type:button name:<NAME>`). The cursor moved and the dock focus shifted.
- **Network:** home LAN only; the TV is at a DHCP address (not in git; `.local/webos/recovery.md`).
- **Repo rules (AGENTS.md):** PowerShell-first scripts with `-WhatIf` for anything reaching the TV; private state in `.local/`; device work needs Michał's per-task go-ahead; upstream credit in the README only. TV web code is ES5 — not relevant here, the server is native.
- **Public MIT repo.** Third-party code shipped must have compatible licences with their texts beside it.

## Spike results (2026-10-26)

Ran hyperion-webos 0.2.1's prebuilt binary (MIT, webosbrew) from `/tmp` with `--dump-frames`, `-b libdile_vt -u libgm -x 960 -y 540 -s -r`:

| On screen | Result |
|---|---|
| CustomWebOS home | clean frame |
| Live TV | clean frame |
| Netflix full-screen playback | **clean frame — no DRM blackout on this C8** |
| HDMI 1 (PS5) | clean frame |
| HDMI 1 no signal | LG's no-signal gallery, captured |

- **Speed:** ~13 fps with both layers at 960×540 (~35 ms/frame spent converting); ~30 fps UI-only. `DILE_VT` reports scale-up to 3840×2160, scale-down to 320×240, source 60 Hz.
- **Cost:** ~11 MB RSS, ~47% CPU while capturing (busybox `top`).
- **Fragility:** the first run was stopped with SIGTERM, which hyperion-webos doesn't clean up on; `DILE_VT_Create` then failed (`Failed to get DILE_VT context`, also with `CreateEx`) **until a reboot**. After the reboot, runs stopped with SIGINT (clean-up path) re-acquired the context every time. Matches PicCap users' C8 reports.

## The parts of the how decided

**Shape (Claude's call, from the spike).** One small native daemon, written in C, cross-compiled with the webOS buildroot toolchain (`openlgtv/buildroot-nc4`, the one hyperion-webos's CI uses) inside Docker on the Windows machine. It:

1. listens on TCP 5900 (RFB protocol) as root;
2. on the first authenticated client, opens the UI capture (`libgm`) and video capture (`libdile_vt`), composites them (video under UI, as hyperion-webos's unicapture does), and serves frames;
3. on the last client disconnecting, **closes both captures** and goes back to only listening;
4. turns VNC pointer and key events into LG remote input through the second-screen API's pointer socket (see Input mapping).

**RFB via LibVNCServer (Michał: "gpl is fine").** It brings compressing encodings (Tight/ZRLE), changed-region updates, multiple clients and VNC authentication. LibVNCServer is GPL-2.0, so the daemon binary is GPL-2.0 while the rest of the repo stays MIT: the daemon's directory carries its own GPL-2.0 `LICENSE`, the README says which part is GPL, and the source sits in the public repo (which meets the source-offer duty). Link it statically or ship the `.so` in the `.ipk`, the builder's choice.

Capture and compositing reuse hyperion-webos's `unicapture` backends for `libdile_vt` and `libgm` (MIT), vendored with their licence. Nothing from its Hyperion/flatbuffers client is needed.

**Idle costs nothing.** With no client, no capture context is open, no thread spins, and memory is a few MB. This is the line between "fine" and Michał's anti-goal.

**While connected: budgets.**
- Default 960×540 (the spike's size), configurable up to 1920×1080.
- Frame-rate cap, default ~10 fps; the daemon runs at low priority (`nice`), so the TV's own work wins.
- Under **~30 MB RSS** and under **~50% of one core** on average at the default size. Measure from `/proc/<pid>/stat` CPU ticks over a fixed interval (one core = 100%), not busybox `top`, whose %CPU is likely against both cores: the spike's ~47% may already be close to a full core before any encoding. Record numbers in `docs/tv-log.md`.
- **If the budget can't be met, frame rate gives first** (Michał). Lower the fps cap, below 10 if needed, before shrinking the picture or dropping the video layer. Only if the minimum useful rate (builder's call, ~2–3 fps) still breaks the budget, come back to Michał.
- Only changed regions are sent, with a compressing encoding (the C8 has 100 Mbit Ethernet; raw 960×540 at 10 fps would be ~160 Mbit/s).

**Capture handles must never leak.** SIGTERM, SIGINT, SIGHUP and client errors all go through the same close path; a crash should not leave a context open if avoidable (e.g. a supervisor or `atexit` path that calls the backends' cleanup). If `DILE_VT` still fails to open, the server keeps serving the UI layer alone rather than refusing the connection, and logs why.

**No side effects.** Never switch HDR or power state (hyperion-webos's `-r -s` behaviour as the only behaviour). Never hold anything that stops the OLED pixel-refresh screensaver.

**Password.** Standard VNC authentication (RFB "VNC Authentication"), so every common viewer works with no setup. Its known weaknesses (8-character limit, DES challenge, unencrypted traffic) are accepted **because it is LAN-only**; state this in the docs. The password lives on the TV in a root-only file (mode 600) and on the PC in `.local/`, never in git. A PowerShell script sets or changes it over SSH (`-WhatIf` supported). No password set → the server refuses all connections.

**Toast.** On the first client connecting: an LG toast ("Remote view started" — wording to taste, Polish or English per the TV's language like the home screen's date), and one on the last client leaving. Via `luna://com.webos.notification/createToast`, with `luna-send`'s `< /dev/null` rule (tv-notes.md) if shelling out.

**Input path (decided 2026-10-26 after the uinput test failed; Michał ran the pairing test).** The daemon connects to `ws://127.0.0.1:3000` (local only), registers with a client key stored on the TV (`/home/root/.config/customwebos/remoteview.client-key`, mode 600), and opens the pointer socket. It holds both connections only while a viewer is connected. Pairing is a one-time setup step: the TV shows LG's "allow" prompt, and Michał accepts it with the remote.

**Input mapping (Claude's call; tune on the TV).**
- Mouse movement → relative `move` messages. VNC gives absolute positions, so the daemon tracks where the cursor should be, snaps it to the top-left (one large negative move) when a session starts, and scales by a calibration factor in the config (default 1.0, tuned on the TV). Left click → `click`. Wheel → `scroll`.
- Arrow keys → `UP`/`DOWN`/`LEFT`/`RIGHT`, Enter → `ENTER`, Esc or Backspace → `BACK`, Home key → `HOME` (LG Input Hook maps Home to CustomWebOS).
- Other printable keys → typed text via `ssap://com.webos.service.ime/insertText` on the main connection.
- Right click → `BACK` is a nice-to-have.

**Packaging and start-up.** The daemon and the two backends ship inside the existing CustomWebOS `.ipk` (~1 MB). A boot hook in `/var/lib/webosbrew/init.d/` starts it, installed and removed by a script in the style of `scripts/autostart.ps1` (`-TvHost`, `-WhatIf`, `-Remove`). Undo goes into `home-button.md`'s rollback list and the private recovery sheet: `rm /var/lib/webosbrew/init.d/<hook> && reboot`.

**Logs** go to the system log or a small fixed-size file in `/tmp`; nothing grows on flash.

## Open risks (first tasks of the plan, on the TV)

1. **Input** — resolved 2026-10-26: uinput is ignored by `surface-manager`; the second-screen pointer socket works (cursor and focus moved). Still to tune on the TV: the move scale and whether keys reach Netflix and HDMI.
2. **Repeated open/close of `DILE_VT`** across many connect/disconnect cycles, with clean shutdown, must keep working without a reboot (the spike only showed a few cycles).
3. **Frame rate after encoding** at 960×540 and 1280×720 against the budget above.

## Left to the builder

- Encoding choice, dirty-region detection, threading, exact defaults (size, fps), config file format and location.
- Exact toast wording, how the daemon talks to luna (link `libluna-service2` or shell out to `luna-send`).
- Where the native source lives (`services/` alongside the home service, or a new `native/`), and how the Docker build is wired into `scripts/package.ps1` and `npm test` (dry-run checks like the other scripts).
- Docs: `development.md` (build + install), `setup.md` if a step changes, `status.md`, `tv-notes.md` for lasting rules (e.g. "SIGINT, never SIGTERM, for DILE_VT").
- Binding and source-address filtering to keep it LAN-only; what a second viewer sees (shared session is fine).

## Decisions from the builder check

A reviewer read this cold and raised three points.

- **Licence of the VNC part:** Michał — GPL (LibVNCServer) is fine. See "RFB via LibVNCServer".
- **What gives first over budget:** Michał — frame rate. See budgets.
- **TV off / screen off:** Claude's call — only while the TV is on. See Non-goals.
