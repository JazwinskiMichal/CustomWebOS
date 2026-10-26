# Remote View (VNC) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A password-protected VNC server on the LG C8, started at boot, that shows the whole screen (video + UI) and takes mouse and keyboard input, costing nothing while nobody is connected.

**Architecture:** One native C daemon, `remoteview`, built in Docker with the webOS buildroot toolchain. LibVNCServer serves RFB; hyperion-webos's `unicapture` backends (`libdile_vt`, `libgm`) capture and composite; input goes through LG's second-screen API (`ws://127.0.0.1:3000`, pointer socket), which the TV treats like a phone remote. Pure logic (session state, key and pointer mapping, LAN filter, fps governor, config, toast command) lives in small host-testable C files; TV-only glue stays thin. It ships inside the existing `.ipk`, and an `init.d` hook supervises it.

**Tech Stack:** C99; CMake; Docker (`ubuntu:24.04` with the `openlgtv/buildroot-nc4` toolchain); LibVNCServer 0.9.14 (GPL-2.0, static, no TLS/websockets); hyperion-webos 0.2.1 `unicapture` + libyuv (MIT/BSD, git submodule); host unit tests with plain `assert` run by `ctest` in Docker and wrapped by `node --test`; PowerShell scripts with `-WhatIf`.

**Spec:** `docs/superpowers/specs/2026-10-26-remote-view-design.md`. Spike evidence: `docs/tv-log.md` ("Remote view spike", 2026-10-26). TV rules: `docs/tv-notes.md`.

## Global Constraints

- Port **5900**, RFB "VNC Authentication" only; **no password file → refuse every client**.
- **Idle costs nothing:** no capture context open, no capture thread, no timers spinning while no client is connected. Capture opens on the first authenticated client and closes on the last disconnect.
- **Budgets while connected:** default **960×540**, fps cap default **15** (raised from 10 after the Task 5 measurement: Netflix settles at 12 fps within budget), RSS **< 30 MB**, CPU **< 50% of one core** measured from `/proc/<pid>/stat` ticks (one core = 100%), not busybox `top`. **Over budget → lower fps first** (below 10 allowed, floor 2); never shrink size or drop video automatically.
- **Never leak `DILE_VT`:** SIGTERM, SIGINT, SIGHUP and client errors all run the same close path. If `DILE_VT` fails to open, serve the UI layer alone and log why.
- **No side effects:** never switch HDR or power state; nothing that blocks the OLED pixel-refresh screensaver.
- **LAN only:** refuse clients whose IPv4 source isn't 10/8, 172.16/12, 192.168/16, 169.254/16 or 127/8.
- **Toast** on first connect and last disconnect via `luna://com.webos.notification/createToast`; any `luna-send` gets `< /dev/null` (tv-notes.md).
- **No flash writes at runtime:** logs to syslog only.
- Licences: `native/remoteview/` is **GPL-2.0** with its own `LICENSE`; the README says which part is GPL; the rest of the repo stays MIT. Upstream credit in `README.md` only (AGENTS.md).
- Scripts PowerShell-first; every script that reaches the TV has `-WhatIf` via `SupportsShouldProcess` (`test/scripts.test.js` enforces it). TV shell files are LF-only.
- Device work needs Michał's go-ahead **per task**. TV at `192.168.88.244`, SSH port 22022, key `~/.ssh/id_ed25519_lgtv`. Installs: `scripts/install.ps1 -TvHost 192.168.88.244 -Reboot`. Stop any capture process on the TV with SIGINT (`timeout -s INT -t N`), never plain `timeout -t`.
- Paths on the TV: binary and backends in the installed service dir under `bin/`; password `/home/root/.config/customwebos/remoteview.passwd` (mode 600); optional config `/home/root/.config/customwebos/remoteview.conf`; pairing key `/home/root/.config/customwebos/remoteview.client-key` (mode 600); boot hook `/var/lib/webosbrew/init.d/customwebos-remoteview`.

## Review Focus

1. **Viewer disconnects abruptly (network drop, viewer killed)** → capture closes and the next connect gets video again. (Task 4 session test; Task 8 on-TV check.)
2. **Two viewers at once, one leaves** → capture stays open for the other; it closes only when the last one leaves, with one "ended" toast. (Task 4 session test.)
3. **Daemon killed with SIGTERM while a viewer is connected** (the hook's stop, `install.ps1` upgrade) → `DILE_VT` is released; the next start captures video. (Task 3 on-TV check.)
4. **Wrong password, repeatedly** → refused each time, no capture opened, no toast. (Task 8 Step 2: three wrong tries.)
5. **Password file missing or empty after an install** → the daemon runs and refuses everyone; it doesn't crash-loop. (Task 8 Step 1, before `-SetPassword`.)

---

### Task 1: Toolchain, build skeleton and host-test harness

**Files:**
- Create: `native/remoteview/Dockerfile`, `native/remoteview/CMakeLists.txt`, `native/remoteview/src/main.c` (prints `remoteview <version>` for `--version`), `native/remoteview/LICENSE` (GPL-2.0 text), `native/remoteview/test/test_smoke.c`
- Create: `scripts/build-native.ps1`
- Create: `test/remoteview-native.test.js`
- Modify: `.gitattributes` (`native/**/*.sh` LF), `test/scripts.test.js`

**Interfaces:**
- Produces: `scripts/build-native.ps1 [-Test] [-WhatIf]`. Without `-Test` it builds the Docker image `customwebos-remoteview-build` (once, cached) and cross-compiles into `dist/native/remoteview/`. With `-Test` it builds host unit tests in the same image with host gcc and runs `ctest --output-on-failure`; exit code = ctest's.
- Produces: CMake option `REMOTEVIEW_HOST_TESTS` (ON → only the pure sources + tests are built with host gcc, no TV libraries).
- Produces: a test convention: each `test/test_<module>.c` is one executable using `assert`, registered with `add_test`.

- [ ] **Step 1: Write failing tests.**
  - `test/scripts.test.js`: `build-native.ps1 -WhatIf prints docker build and run, builds nothing`. Output matches `/docker build/`, `/customwebos-remoteview-build/` and `/dist[\\/]native[\\/]remoteview/`; exit 0; `dist/native` unchanged.
  - `test/remoteview-native.test.js`: `native host unit tests pass`, `{ skip: !dockerRunning && 'no docker' }` (where `dockerRunning` = `docker info` exits 0). It runs `build-native.ps1 -Test` and asserts status 0. Timeout 15 min on the first build.
- [ ] **Step 2: Run** `npm test`. Expected: both new tests FAIL (script missing).
- [ ] **Step 3: Implement.**
  - Dockerfile: `ubuntu:24.04` with `cmake build-essential git wget ca-certificates`. It downloads `https://github.com/openlgtv/buildroot-nc4/releases/download/webos-b17b4cc/arm-webos-linux-gnueabi_sdk-buildroot.tar.gz`, checks SHA256 `1f69af43caac4b6898d8f0323c975be60af04abdd1e1c144773072b28c961c20`, unpacks it to `/opt` and runs its `relocate-sdk.sh`. Toolchain file: `/opt/arm-webos-linux-gnueabi_sdk-buildroot/share/buildroot/toolchainfile.cmake`.
  - Mount the repo at `/src` and build in `/src/dist/native/build-{arm,host}`.
- [ ] **Step 4: Run** `npm test`. Expected: PASS, including `test_smoke`. Also run `scripts/build-native.ps1`; expect `dist/native/remoteview/remoteview`. `file` on it says `ELF 32-bit LSB executable, ARM, EABI5`.
- [ ] **Step 5: Commit** `build: remoteview toolchain and native test harness`.

### Task 2: Input — LG second-screen API (risk 1, on the TV)

> **Revised 2026-10-26.** The first version (uinput, commit `d1e9697`) ran on the TV and did nothing: `surface-manager` opens `event0`–`event5` at start and never opens new devices. Michał then ran a pairing test from the PC against `ws://<tv>:3000`: after he accepted the prompt, `getPointerInputSocket` + text `move`/`button` messages moved the cursor and the dock focus. This task replaces uinput with that path. Spike script for reference: `C:\Users\user\AppData\Local\Temp\claude\spike\ws\pair-test.mjs`; pairing manifest: `pairing.json` from lgtv2 (MIT, `https://raw.githubusercontent.com/hobbyquaker/lgtv2/master/pairing.json`).

**Files:**
- Delete: `native/remoteview/src/uinput.{c,h}`
- Modify: `src/keymap.{c,h}`, `src/pointer.{c,h}`, `test/test_keymap.c`, `test/test_pointer.c`, `src/main.c` (`--pair`, `--input-test` over the new path), `CMakeLists.txt`
- Create: `src/ws.{c,h}` (WebSocket client framing, pure), `src/ssap.{c,h}` (second-screen messages, pure), `src/pairing_manifest.h` (lgtv2's `pairing.json` as a C string, MIT notice beside it), `src/lginput.{c,h}` (TV-only: sockets, handshake), `test/test_ws.c`, `test/test_ssap.c`

**Interfaces:**
- Produces: `const char *keymap_button(uint32_t keysym)` returns `"LEFT"`/`"RIGHT"`/`"UP"`/`"DOWN"`/`"ENTER"`/`"BACK"`/`"HOME"` or NULL; `int keymap_text(uint32_t keysym, char out[2])` returns 1 and the character for printable ASCII 0x20–0x7e, else 0.
- Produces: `typedef struct { int x, y, buttons, synced; double scale; } pointer_state;` and `int pointer_update(pointer_state *s, int x, int y, int mask, char *out, size_t n)`, which writes zero or more pointer-socket messages back to back into `out` and returns the bytes written (-1 if `n` is too small). Each message is `type:<t>\n` + `key:value\n` lines + `\n`.
- Produces: `int ws_frame_text(const char *payload, size_t len, const uint8_t mask[4], uint8_t *out, size_t outsz)` (client frames are masked, FIN set, opcode 1; 7-bit, 16-bit and 64-bit lengths) returns the frame length or -1; `int ws_parse(const uint8_t *buf, size_t len, int *opcode, size_t *off, size_t *plen)` returns the whole frame's length, 0 if incomplete, -1 if invalid (server frames are unmasked); `int ws_handshake_request(char *out, size_t n, const char *host, int port, const char *path, const char *key_b64)`.
- Produces: `int ssap_register_msg(char *out, size_t n, const char *client_key)` (`client_key` NULL → no `client-key` field); `int ssap_request_msg(char *out, size_t n, const char *id, const char *uri, const char *payload_json)` (`payload_json` NULL → no payload); `int ssap_find_string(const char *json, const char *key, char *out, size_t n)` returns 1 if `"key":"value"` was found and copied; `int ssap_url_path(const char *url, char *path, size_t n)` (`ws://h:p/resources/x/netinput.pointer.sock` → `/resources/x/netinput.pointer.sock`).
- Produces (TV-only): `lginput *lginput_open(const char *key_path)` connects to `127.0.0.1:3000`, registers with the stored key, opens the pointer socket; NULL with a syslog reason on any failure. `int lginput_pointer(lginput *, const char *msgs, size_t len)` (one WebSocket frame per message), `int lginput_text(lginput *, const char *text)` (`ssap://com.webos.service.ime/insertText` with `{"text":..,"replace":false}`), `void lginput_close(lginput *)`, `int lginput_pair(const char *key_path)` (register without a key, wait up to 60 s for `registered`, write the key with mode 600, return 0).
- Key path on the TV: `/home/root/.config/customwebos/remoteview.client-key`.

- [ ] **Step 1: Write failing tests.**
  - `test_keymap.c`:
    - Buttons: `0xff51→"LEFT"`, `0xff52→"UP"`, `0xff53→"RIGHT"`, `0xff54→"DOWN"`, `0xff0d→"ENTER"`, `0xff1b→"BACK"`, `0xff08→"BACK"`, `0xff50→"HOME"`, and `0xffbe` → NULL.
    - Text: `'a'` → 1 and `"a"`, `'A'` → `"A"`, `'?'` → `"?"`, and `0xff0d` → 0.
  - `test_pointer.c` (scale 1.0):
    - The first update at (100,50) writes `type:move\ndx:-3000\ndy:-3000\ndown:0\n\n` then `type:move\ndx:100\ndy:50\ndown:0\n\n`.
    - The next at (110,50) writes only `type:move\ndx:10\ndy:0\ndown:0\n\n`.
    - The same position and mask writes nothing (returns 0).
    - Mask 0→1 writes `type:click\n\n`; mask 1→0 writes nothing; mask 0→4 writes `type:button\nname:BACK\n\n`.
    - Mask bit 3 (wheel up) writes `type:scroll\ndx:0\ndy:-1\n\n`; bit 4 writes `dy:1`.
    - With scale 2.0, a move of +10 writes `dx:20`.
    - Too small a buffer returns -1.
  - `test_ws.c`:
    - Frames a 5-byte payload with mask `{1,2,3,4}` → bytes `81 85 01 02 03 04` + the masked payload.
    - A 200-byte payload uses the 126 + 16-bit length form.
    - `ws_parse` handles an unmasked server text frame `81 03 'a' 'b' 'c'` → opcode 1, off 2, plen 3, returns 5.
    - A truncated frame returns 0.
    - The handshake request contains `GET /path HTTP/1.1`, `Upgrade: websocket`, `Sec-WebSocket-Key: <key>`, `Sec-WebSocket-Version: 13`.
  - `test_ssap.c`:
    - The register message with key `"abc"` contains `"type":"register"`, `"client-key":"abc"` and `"pairingType":"PROMPT"`; without a key it has no `client-key`.
    - The request message contains `"uri":"ssap://x/y"`.
    - `ssap_find_string` extracts `socketPath` from the spike's real response (`{"type":"response","id":"ptr","payload":{"socketPath":"ws://192.168.88.244:3000/resources/da557d6155080484091c2520f5f5d24037ea8004/netinput.pointer.sock","returnValue":true}}`).
    - `ssap_url_path` of that URL gives `/resources/da557d6155080484091c2520f5f5d24037ea8004/netinput.pointer.sock`.
    - A missing key returns 0.
- [ ] **Step 2: Run** `scripts/build-native.ps1 -Test`. Expected: the new and changed tests FAIL.
- [ ] **Step 3: Implement.**
  - **Handshake:** `lginput` checks only for `HTTP/1.1 101` (a local, trusted endpoint; no SHA-1 accept check).
  - **Mask bytes** come from `/dev/urandom`.
  - **`--pair`** calls `lginput_pair` on the key path and prints `accept the prompt on the TV` and then `paired` or the failure.
  - **`--input-test`** opens `lginput` and runs `pointer_update` from a fresh state through the 4 corners and the centre (1 s apart). It clicks at the centre, then sends RIGHT, RIGHT, LEFT, ENTER, BACK, HOME 1 s apart, printing one line per action, and closes on exit including SIGINT.
  - **Removal:** remove uinput and its keymap capability helpers.
- [ ] **Step 4: Run** `-Test`. Expected: PASS. `build-native.ps1` links the ARM binary.
- [ ] **Step 5 (on the TV; controller, with Michał's go-ahead and watching):**
  1. `scp` the binary to `/tmp/rv/`.
  2. Run `/tmp/rv/remoteview --pair`; Michał accepts the prompt.
  3. Run `--input-test` with CustomWebOS open.
  
  Record in `docs/tv-log.md`:
  - whether the cursor lands near each corner and the centre (if it overshoots or undershoots, note the factor; it becomes the default `pointer_scale` in Task 4's config);
  - whether the click opens the tile;
  - whether the buttons act.
- [ ] **Step 6: Commit** `feat(remoteview): input via LG second-screen pointer socket`, plus the tv-log entry and the lasting facts in `tv-notes.md`.

### Task 3: Capture — open, frame, close without leaks (risk 2, on the TV)

**Files:**
- Create: `native/remoteview/third_party/hyperion-webos` (git submodule at tag `0.2.1`, commit `10b638f`, recursive for libyuv), `src/capture.{c,h}` (TV-only), `src/shutdown.{c,h}`, `test/test_shutdown.c`
- Modify: `CMakeLists.txt` (builds only `unicapture`, `libdile_vt_backend.so`, `libgm_backend.so`, libyuv from the submodule; no flatbuffers/hyperion client), `src/main.c` (`--capture-test`), `native/remoteview/LICENSE` notes (MIT text for the vendored part beside it)

**Interfaces:**
- Produces: `int capture_open(int width, int height, int *has_video)` returns 0 if at least the UI layer opened. `*has_video` = 0 when `DILE_VT` failed, which is logged with the reason. `int capture_frame(uint8_t *argb_out, int stride)` writes one composited frame: video under UI, both layers when present. `void capture_close(void)` is idempotent and safe to call from the shutdown path.
- Produces: `void shutdown_install(void (*cleanup)(void))` registers handlers for SIGTERM/SIGINT/SIGHUP/SIGQUIT and `atexit`, so `cleanup` runs exactly once and then the process exits (128+sig for signals). `int shutdown_requested(void)`.

- [ ] **Step 1: Write the failing test** `test_shutdown.c`: fork a child that installs a cleanup writing a marker to a pipe, then `raise(SIGTERM)`. The parent reads exactly one marker and sees exit status 143. Do the same with SIGINT (130) and a normal `exit(0)` (one marker). Calling cleanup twice via the signal plus `atexit` still writes one marker.
- [ ] **Step 2: Run** `-Test`. Expected: FAIL.
- [ ] **Step 3: Implement** shutdown (sig_atomic flag + `atexit`; cleanup guarded by a once-flag). Implement capture over unicapture's backend interface (load the backends with `dlopen` from the binary's own `bin/` dir via `/proc/self/exe`; no `LD_LIBRARY_PATH` needed). Pass no HDR/power options. Add `remoteview --capture-test N --size WxH`: N times open → grab 5 frames → close, printing `cycle i: ui=1 video=1 ms=<per frame>`; after the last cycle it writes one frame as raw RGB24 to `/tmp/rv/frame.data`.
- [ ] **Step 4: Run** `-Test`. Expected: PASS.
- [ ] **Step 5 (on the TV; go-ahead):**
  1. Run `--capture-test 20 --size 960x540` while live TV plays. Expect `video=1` for all 20 cycles.
  2. Start `--capture-test 1000`, send it SIGTERM (`kill <pid>`) mid-run, then run `--capture-test 3`. Expect `video=1` (no leak).
  3. Convert `frame.data` to PNG on the PC and check it shows the picture.
  
  Record the results in tv-log.md.
- [ ] **Step 6: Commit** `feat(remoteview): leak-safe screen capture`.

### Task 4: VNC server — sessions, auth, LAN filter, config

**Files:**
- Create: `src/session.{c,h}`, `src/lanfilter.{c,h}`, `src/config.{c,h}`, `src/server.c` (TV-only LibVNCServer glue), `test/test_session.c`, `test/test_lanfilter.c`, `test/test_config.c`
- Modify: `Dockerfile` (LibVNCServer 0.9.14 source, built static for ARM with `-DWITH_OPENSSL=OFF -DWITH_GNUTLS=OFF -DWITH_WEBSOCKETS=OFF -DWITH_SYSTEMD=OFF -DWITH_GCRYPT=OFF`, zlib/libjpeg from the toolchain sysroot), `CMakeLists.txt`, `src/main.c` (default mode = serve)

**Interfaces:**
- Produces: `typedef struct { int clients; } session;` (zero-initialised), `typedef enum { SA_NONE=0, SA_OPEN_CAPTURE=1, SA_CLOSE_CAPTURE=2, SA_TOAST_START=4, SA_TOAST_END=8 } session_action;` with `int session_client_added(session *s)` and `int session_client_gone(session *s)` (bitmask of actions; only *authenticated* clients are added), and `int session_clients(const session *s)`.
- Produces: `int lan_allowed(uint32_t ipv4_host_order)`, 1 for 10/8, 172.16/12, 192.168/16, 169.254/16, 127/8.
- Produces: `typedef struct { int width, height, fps_max; double pointer_scale; } rv_config;` and `int config_parse(const char *text, rv_config *out)`. Defaults 960, 540, 10, and `pointer_scale` 0.51 (Task 2's on-TV result). Keys `width=`, `height=`, `fps=`, `pointer_scale=`, `#` comments. Clamps width 320..1920, height 240..1080, fps 1..30, pointer_scale 0.25..4. Unknown keys are ignored; returns the count of bad lines.
- Consumes: Task 2 `keymap_button`, `keymap_text`, `pointer_update`, `lginput_*`; Task 3 `capture_*`, `shutdown_install`.

- [ ] **Step 1: Write failing tests.**
  - `test_session.c`: the first add → `SA_OPEN_CAPTURE|SA_TOAST_START`; a second add → `SA_NONE`; one gone with 2 → `SA_NONE`; the last gone → `SA_CLOSE_CAPTURE|SA_TOAST_END`; gone at 0 → `SA_NONE` (no underflow).
  - `test_lanfilter.c`: `192.168.88.217`, `10.0.0.1`, `172.31.255.255`, `127.0.0.1` allowed; `172.32.0.1`, `8.8.8.8`, `100.64.0.1` refused.
  - `test_config.c`: empty text → defaults; `width=1280\nheight=720\nfps=5` parsed; `fps=999` → 30; `width=abc` → bad count 1, default kept.
- [ ] **Step 2: Run** `-Test`. Expected: FAIL.
- [ ] **Step 3: Implement** the pure modules, then `server.c`:
  - `rfbGetScreen` at the config size, 32 bpp, `authPasswdData` = the password file path (`rfbCheckPasswordByList`/`rfbEncryptAndStorePasswd` format).
  - `newClientHook` refuses non-LAN clients and, without a password file, refuses all of them.
  - The session is counted on auth success (`clientGoneHook` for removal).
  - On `SA_OPEN_CAPTURE` start a capture thread that paces at the current fps and marks dirty rects by diffing against the last frame in 64×64 tiles. On `SA_CLOSE_CAPTURE` stop the thread and `capture_close()`.
  - The main loop is `rfbProcessEvents` with a 100 ms timeout, so it sleeps when idle.
  - On `SA_OPEN_CAPTURE` also `lginput_open` (NULL → viewing still works, input is dropped and logged once). Reset the `pointer_state` (`synced=0`, `scale` from config) per session. `ptrAddEvent` → `pointer_update` → `lginput_pointer`; `kbdAddEvent` (key down only) → `keymap_button` → a `type:button` message, else `keymap_text` → `lginput_text`. On `SA_CLOSE_CAPTURE` also `lginput_close`.
  - `shutdown_install` cleanup closes capture, then lginput, then the server.
  - Add `remoteview --store-password` (reads one line from stdin, writes the passwd file with mode 600, max 8 chars, warns if longer).
- [ ] **Step 4: Run** `-Test`. Expected: PASS. Build ARM, expect a clean link.
- [ ] **Step 5: Commit** `feat(remoteview): VNC server with auth, LAN filter and on-demand capture`.

### Task 5: Budgets — fps governor, priority, measurement (risk 3, on the TV)

**Files:**
- Create: `src/governor.{c,h}`, `src/cpustat.{c,h}`, `test/test_governor.c`, `test/test_cpustat.c`
- Modify: `src/server.c` (feed the governor every 2 s), `src/main.c` (`setpriority(PRIO_PROCESS, 0, 10)` at start)

**Interfaces:**
- Produces: `int governor_next(int fps_now, int fps_max, double cpu_core_fraction)`. Over 0.50 → `max(2, fps_now/2)`; under 0.35 → `min(fps_max, fps_now+1)`; else unchanged.
- Produces: `double cpustat_fraction(const char *stat_before, const char *stat_after, double seconds, long hz)`. It parses utime+stime (fields 14, 15) from `/proc/self/stat` text; the process name in parentheses may contain spaces.

- [ ] **Step 1: Write failing tests.**
  - `test_governor.c`: `(10,10,0.8)→5`; `(3,10,0.9)→2`; `(2,10,0.9)→2`; `(5,10,0.2)→6`; `(10,10,0.2)→10`; `(6,10,0.4)→6`.
  - `test_cpustat.c`: two synthetic stat lines 100 ticks apart over 2 s at hz=100 → 0.5; a name `(remote view)` with a space still parses.
- [ ] **Step 2: Run** `-Test`. Expected: FAIL.
- [ ] **Step 3: Implement** both and wire them in. Log the fps changes to syslog.
- [ ] **Step 4: Run** `-Test`. Expected: PASS.
- [ ] **Step 5 (on the TV; go-ahead):** run the daemon from `/tmp/rv` with a test password and connect TigerVNC from the PC. For 60 s each:
  - home screen at 960×540
  - Netflix playback at 960×540
  - Netflix playback at 1280×720
  
  Record the settled fps, CPU fraction (the daemon's own log), `VmHWM` and a `perf.ps1` dock run done while connected (the home screen must still meet p95 < 33 ms) in tv-log.md. Also record the idle cost after disconnecting: CPU over 60 s ≈ 0, `VmRSS` in MB, and `ls -l /proc/<pid>/fd` shows no `/dev/dile_vt`-style handles. **If the fps settles at 2 and the CPU is still over budget, stop and ask Michał.**
- [ ] **Step 6: Commit** `feat(remoteview): fps governor within the CPU budget`.

### Task 6: Toast

**Files:**
- Create: `src/toast.{c,h}`, `test/test_toast.c`
- Modify: `src/server.c` (on `SA_TOAST_START`/`SA_TOAST_END`)

**Interfaces:**
- Produces: `int toast_command(char *buf, size_t n, int started, const char *lang)` builds `luna-send -n 1 luna://com.webos.notification/createToast '{"sourceId":"org.jazwinski.customwebos.home","message":"<text>"}' < /dev/null > /dev/null 2>&1`. Text: `pl*` → `Zdalny podgląd: połączono` / `Zdalny podgląd: rozłączono`; anything else → `Remote view started` / `Remote view ended`. Returns the length, or -1 if it doesn't fit.
- Produces: `void toast_send(int started)`. It reads the language once from `luna-send -n 1 luna://com.webos.settingsservice/getSystemSettings '{"keys":["localeInfo"]}' < /dev/null` (cached; falls back to `en` on any failure) and runs the command with `system()` from a detached thread so the server loop never waits.

- [ ] **Step 1: Write the failing test** `test_toast.c`: `pl-PL` started → the command contains `Zdalny podgląd: połączono` and ends with `< /dev/null > /dev/null 2>&1`; `en-GB` ended → `Remote view ended`; `NULL` lang → English; a 20-byte buffer → -1.
- [ ] **Step 2: Run** `-Test`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `-Test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(remoteview): toast on connect and disconnect`.

### Task 7: Packaging, boot hook, password script, docs

**Files:**
- Create: `scripts/remoteview.sh` (the init.d hook), `scripts/remoteview.ps1`, `test/remoteview-hook.test.js`
- Modify: `scripts/package.ps1` (stage the service + `bin/` into `dist/stage/` and package from there), `test/scripts.test.js`, `home/appinfo.json` (version bump to 0.5.0), `README.md` (GPL note for `native/remoteview/`, credits for LibVNCServer and hyperion-webos), `docs/development.md` (build-native, remoteview.ps1, loop table), `docs/home-button.md` (rollback list), `docs/status.md`, `docs/tv-notes.md`, `docs/README.md` (map)

**Interfaces:**
- Produces: `scripts/remoteview.ps1 -TvHost <ip> [-Remove] [-SetPassword] [-Pair] [-WhatIf]`. `-Pair` runs `<service dir>/bin/remoteview --pair` over SSH and tells Michał to accept the prompt on the TV.
  - default: install the hook (same stdin + `tr -d '\015'` pattern as `autostart.ps1`);
  - `-Remove`: delete the hook and stop the running daemon with SIGINT;
  - `-SetPassword`: `Read-Host -AsSecureString`, save it to `.local/remoteview/password.txt` (create the dir) and pipe it to `<service dir>/bin/remoteview --store-password` over SSH.
- Produces: the hook `customwebos-remoteview`. It backgrounds itself (`--foreground` for tests), `chmod 755`s the binary (ares-package on Windows drops exec bits), and runs it with `nice -n 10` in a respawn loop: restart after exit with a 5 s delay, doubling to at most 300 s, resetting after 10 min of uptime. If the binary is missing it exits 0 quietly. It logs via `logger -t remoteview`.
- Produces: `package.ps1` fails with a clear message when `dist/native/remoteview/remoteview` is missing ("run scripts/build-native.ps1 first").

- [ ] **Step 1: Write failing tests.**
  - `scripts.test.js`:
    - `remoteview.ps1 -WhatIf installs the hook over ssh` (matches `customwebos-remoteview`, `tr -d`, `chmod 755`, `-p 22022`);
    - `remoteview.ps1 -Remove -WhatIf stops with SIGINT` (`kill -INT` or `-s INT`, `rm -f`);
    - `remoteview.ps1 -SetPassword -WhatIf names --store-password and asks nothing` (no prompt in WhatIf);
    - `remoteview.ps1 -Pair -WhatIf names --pair`;
    - `package.ps1 -WhatIf stages bin/remoteview and the two backends` (`bin[\\/]remoteview`, `libdile_vt_backend.so`, `libgm_backend.so`).
  - `remoteview-hook.test.js` (sh with stub `remoteview`, `sleep`, `logger` on PATH, `--foreground`, like `autostart.test.js`):
    - `a missing binary exits 0 without looping`;
    - `the daemon is restarted after it exits, with growing delay` (the stub exits at once 3 times, then the hook gets a stop file; the logged sleeps are `5 10 20`);
    - `it runs the daemon under nice -n 10`;
    - `the hook file is LF-only` (also covered by the existing LF test once it's in `scripts/`).
- [ ] **Step 2: Run** `npm test`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement** the scripts, staging and docs:
  - **Hook undo:** `rm /var/lib/webosbrew/init.d/customwebos-remoteview && reboot`. It goes in `home-button.md`'s rollback list. Tell Michał to add it to `.local/webos/recovery.md` too (private; don't commit it).
  - **status.md:** a "Remote view" line under On the TV once Task 8 passes; until then, under Next steps.
  - **tv-notes.md:** the input facts from Task 2 and the cost numbers from Task 5.
- [ ] **Step 4: Run** `npm test` and `scripts/package.ps1`. Expected: everything passes, and the `.ipk` in `dist/` contains `bin/remoteview` (`tar -tzf` on its `data.tar.gz`).
- [ ] **Step 5: Commit** `feat(remoteview): package, boot hook and password script`.

### Task 8: On the TV — install and acceptance (go-ahead)

**Files:**
- Modify: `docs/tv-log.md`, `docs/status.md`

- [ ] **Step 1:** `scripts/install.ps1 -TvHost 192.168.88.244 -Reboot`, then `scripts/remoteview.ps1 -TvHost 192.168.88.244` (hook) and reboot. **Before any password is set**, a viewer is refused, and `pidof remoteview` shows the same PID 60 s later (no crash loop). Then `scripts/remoteview.ps1 -TvHost 192.168.88.244 -SetPassword` (Michał types it) and `-Pair` (Michał accepts on the TV; skip if Task 2's key is still in place). Expected: `pidof remoteview` returns a PID; idle CPU ≈ 0 over 60 s.
- [ ] **Step 2:** Connect TigerVNC to `192.168.88.244:5900` and check:
  - the wrong password, three times in a row, is refused each time, with no toast;
  - with a viewer connected and the TV left idle on the home screen, LG's screensaver still appears;
  - the right password works and the "started" toast appears;
  - home, live TV, Netflix playback and HDMI each show;
  - arrows/Enter/Esc/Home and mouse clicks work;
  - closing the viewer brings the "ended" toast;
  - reconnecting 10 times in a row shows video every time;
  - two viewers at once work, and when one leaves the other keeps the picture;
  - the PS5 or Netflix doesn't stutter while connected (Michał's eye).
- [ ] **Step 3:** `install.ps1 ... -Reboot` again (upgrade path: SIGTERM to a running daemon) and reconnect. Expected: video present.
- [ ] **Step 4:** Michał's check ("does it feel like real VNC?"). Record all of it in tv-log.md and update status.md.
- [ ] **Step 5: Commit** `docs: remote view on the TV`.
