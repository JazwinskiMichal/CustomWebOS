# No-signal slideshow from the NAS — design

Date: 2026-10-29. Extends [`2026-10-27-no-signal-slideshow-design.md`](2026-10-27-no-signal-slideshow-design.md) (M3), whose original idea was photos "from my NAS over LAN"; M3 shipped with a USB stick instead.

## Intent

Michał wants the no-signal slideshow to show photos from a shared folder on his local network, "not only from a stick". His photos-to-share live behind Windows shares; he picked the **NAS** (`\\192.168.88.235`, named NASMIHOW) over his PC because the NAS is always on, while the PC may be asleep when the PS5 goes off. He'll **create a new folder just for this**, so the slideshow only ever sees photos put there on purpose. The share needs a **username and password** (remembered on his PC today).

## Goals

- **The slideshow reads photos from one folder on the NAS** (SMB share + optional subfolder, set by Michał), with the same behaviour as today: 5 s after the HDMI input on screen goes dark, full screen, 30 s per photo in random order, ←/→ step, Back does nothing, ends when the picture returns or the source changes.
- **NAS first, no mixing (Michał):** if the NAS folder is reachable and has photos, the show uses only those; otherwise the USB stick's photos; otherwise LG's own screen, as today.
- **Photos added to the NAS folder show up** at the next show without touching the TV (Claude's call).
- **Settings from the PC:** the share path, username and password go in `.local/` on the PC and a script sends them to the TV, where only root can read them (Claude's proposal, following the doorbell's `-Configure`; Michał agreed to keep them out of chat and git).

## Non-goals

- **Mixing stick and NAS photos** (Michał: "do not mix").
- **The PC's shared folder** as a source (Michał chose the NAS); nothing stops pointing the setting at a PC share later.
- **Writing to the NAS.** Read-only.
- **An on-TV settings screen.** Wanted, recorded in status.md as its own project.
- **Other protocols** (DLNA, NFS, HTTP) unless SMB turns out impossible on the TV (see Open risks).

## Anti-goals

- **Anything from the internet.** Still home-only (M3).
- **A slower or stuck no-signal path:** an unreachable, asleep or misconfigured NAS must not delay the cover beyond today's 5 s by more than a few seconds, nor leave a black or half-loaded screen; it falls back to the stick or LG's screen.
- **Costs when the PS5 is on:** nothing polling the NAS while HDMI has a picture (M3's "idle costs nothing").
- **Credentials leaking:** never in git, chat, logs (`/tmp/nosignal.log`), process lists the app can see, or a world-readable file.
- **Hurting the NAS or the TV's flash:** no copying photos to the TV's storage; no hammering the NAS with retries.

## Constraints

- **TV:** LG C8, webOS 4.4.3, kernel 4.4.84; rooted. Checked 2026-10-29: the kernel has `cifs` (and `nfs`) built in (`/proc/filesystems`), util-linux `mount` is present, no `mount.cifs` helper, no `smbclient`; the NAS answers ping from the TV. Not yet checked: an actual SMB login/mount (protocol version, NTLMv2/SMB2+ on this kernel), and how mounted file names with Polish letters reach the web app.
- **How M3 reaches photos today:** the boot watcher (`scripts/nosignal.sh`) links `<CustomWebOS dir>/usb` → `/tmp/usb`; the home service's `listPhotos` walks `/tmp/usb` (8 levels, JPEG/PNG, ≤ 20 MB, ≤ 2000) and returns `usb/<path>`; the app loads them relative to its folder (it can't use `file://`). The watcher calls `listPhotos` before covering and covers only when it lists photos.
- **Repo rules (AGENTS.md):** PowerShell-first scripts with `-WhatIf`; device work needs Michał's go-ahead per task; ES5 on the TV; private data in `.local/`.

## The parts of the how decided

- **The TV mounts the share itself** (kernel CIFS, read-only), so the slideshow sees the NAS folder as a local directory, the same way it sees the stick. Credentials are passed to `mount` in a way that keeps them out of the command line other processes can read (e.g. a root-only credentials file), never logged.
- **Settings file on the TV**, root-only, outside the app's folder so installs keep it (like `/var/lib/customwebos/doorbell.json`); written by a PowerShell script from `.local/` (`-Configure`, `-WhatIf`), which also offers a `-Remove`.
- **NAS before stick:** the source decision is made where `listPhotos` answers, so the watcher's "cover only when there are photos" rule stays as it is.

## Changed by the first TV test: NFS, not SMB (2026-10-30)

The TV's kernel CIFS knows only SMB1 (`Unknown vers= option specified: 3.0/2.1/2.0`), and the NAS refuses SMB1 (`cifs_mount failed w/return code = -95`), rightly. Michał switched on **NFS v2/v3** on the NAS (the kernel has `CONFIG_NFS_V2/V3`, no v4) and gave the share NFS access for **192.168.88.244, read-only, root squashed**. `mount -t nfs -o ro,vers=3,nolock,soft,timeo=30,retrans=2,addr=192.168.88.235 192.168.88.235:/CustomWebOS_Slideshow …` mounts in 0.05 s. So:

- **No credentials:** access is limited by the NAS to the TV's address, read-only. The read-only NAS account and the password in `.local/` are no longer used (Michał may delete them).
- Everything else in this design stands: NAS first, no mixing, mount only for a show, the 5 s cap, fresh per show, the same limits. Where the text below says SMB, CIFS, credentials or account, read NFS and "none".

## Decided after the builder check (Michał)

- **The share:** `\\192.168.88.235\CustomWebOS_Slideshow` (its own top-level share, created 2026-10-29; no subfolder). The account name and password live only in `.local/` and on the TV.
- **A dedicated read-only NAS account for the TV**, with access to the new photos folder only; Michał creates it. The TV never holds his own NAS password. `-Configure` should remind of this (and must not need write access to anything).

## Decisions from the builder check (Claude's calls)

- **The NAS's make and SMB settings aren't needed up front:** the first plan task probes the mount on the TV (`vers=3.0`, then `2.1`, then `2.0`; `sec=ntlmssp`) and records what works; if none does, NFS, then HTTP (risk 1).
- **Delay cap: at most 5 s added** to today's 5 s settle for the NAS (mount + listing). Past it, that show uses the stick (or LG's screen), and the next show tries the NAS again.
- **Fallback granularity:** an empty NAS folder, a failed mount and a listing that times out all mean "use the stick". A half-finished listing is never shown.
- **Fresh per show:** the NAS folder is listed again for every show (new photos appear), and remounted if the mount is stale; CIFS directory caching must not hide new files.
- **Contract:** `listPhotos` answers `nas/<path>` for NAS photos (through a second link, `<app dir>/nas`), exactly as `usb/<path>` for the stick; the app loads either unchanged, and the watcher's "has photos" check accepts both prefixes.
- **Limits:** the stick's caps apply to the NAS folder too (2000 photos, 20 MB per file, 8 levels).

## Open risks (first tasks of the plan, on the TV)

1. **Mounting the share:** does kernel CIFS on 4.4 mount Synology/QNAP-style shares with the TV's read-only account (`vers=2.0/2.1/3.0`, `sec=ntlmssp`), without a `mount.cifs` helper (options and the IP passed straight to `mount -t cifs`)? If not, fall back to NFS on the NAS, or the NAS serving the folder over HTTP.
2. **Timing:** how long a mount or a listing takes on the TV, and whether the NAS sleeping (disks spun down) pushes the cover well past 5 s; a short timeout and a fallback to the stick if so.
3. **Keeping the mount healthy:** mount on demand when a show is about to start vs. once at boot and re-check; a NAS that rebooted leaves a stale mount that must not hang `listPhotos` (soft mount, timeouts).
4. **File names with Polish letters** through the mount (`iocharset=utf8`) and the app's URLs.

## Left to the builder

- Mount point and link name for the app (e.g. `/tmp/nosignal/nas` and `<app dir>/nas`), and which process mounts (the watcher, as root, is the natural place).
- Mount-on-demand vs. at-boot (risk 3), timeouts and the retry policy within the anti-goals.
- The settings file's name and shape (share path, subfolder, username, password; SMB version if needed) and the script's name (a `-Nas` switch on `nosignal.ps1`, or its own script).
- What the log says about the NAS (reachable, mounted, photo count, why it fell back) without secrets.
- Tests in the repo's style (shell tests for the watcher, handler tests for the source choice, script dry runs); the on-TV checks with Michał: NAS photos shown with the PS5 off, the stick ignored while the NAS has photos, the fallback with the NAS unreachable, a newly added photo showing up.
- Docs: README's slideshow section, status.md, tv-notes (mount facts), tv-log.
