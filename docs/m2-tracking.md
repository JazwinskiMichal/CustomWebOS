# M2 tracking — things discovered during the M1 on-device test

These are findings from installing M1 on my LG C8 and running it. None of them block the M1 artifact bar being met (install + register + open worked), but they're the first things M2 should pick up.

## webOS 4 bus-permission wall

**Problem.** From the home app, a raw `PalmServiceBridge` call to `luna://com.webos.applicationManager/listLaunchPoints` returns no response at all (not even a `returnValue:false`). The call is silently dropped by the service — the webapp is unprivileged on the bus and lacks the required permission to query the launcher's catalogue. Confirmed by: `luna-send-pub` from a root SSH session returns the same no-response for the same call. The 10 s client-side timeout in `home/main.js` surfaces this to the user instead of hanging on "Loading…".

**Impact.** The home app cannot enumerate installed apps on-TV until this is fixed. Everything else about the install path works.

**Fix options (pick one in M2).**

- **Ship `webOSTV.js` from the LG SDK** alongside the app, load it before `main.js`, use `webOS.service.request(...)` instead of raw `PalmServiceBridge`. The library handles bus plumbing / permissions correctly on webOS 4+. Need to verify its license permits redistribution — LG's SDK docs say yes, but worth re-checking before bundling.
- **Bundle an elevated service component.** Standard webOS pattern: `services/org.jazwinski.customwebos.home.service/` declares `applicationManager.query.launchPoints` (or whatever the real perm name is), runs under the SDK user, and the webapp calls into it on the public bus. More moving parts but more honest about what's happening.
- **Use `luna-send-pub` through SSH-adjacent tooling.** Not viable from the webapp. Rules this out.

The webOSTV.js route is cheaper for M1→M2 transition; the service-component route is where this ends up anyway if more privileged ops are needed later (install/uninstall, autostart hook management from inside the app, etc.).

## Also noticed during the test

- **Launcher cache needs a reboot** to pick up a newly installed developer app. First-time install → reboot → tile appears. Subsequent re-installs (upgrades of an existing registration) show up without reboot. Worth mentioning in `docs/setup.md` §4.
- **Test files land inside the installed `.ipk`.** `ares-package home/` bundles `home/appinfo.test.js` and `home/main.test.js`. They don't run on the TV (nothing loads them) but are ~2 KB of wasted bytes and leak intent. Deferred minor from the review; now confirmed in the installed app directory listing.
- **`ApplicationInstallerUtility` needs an explicit `-f /etc/palm/appinstalld/opkg.conf`** on this firmware, or `opkg_conf_load` fails. The scripts/install.ps1 wrapper uses `ares-install`, which handles this — but when sidestepping ares (we did when Node 25 broke `ares-install`), the direct `ApplicationInstallerUtility` invocation needs the flag.
- **`ares-cli` 2.4.0 ships broken on Node 25.** `TypeError: isDate is not a function` on `ares-install`. Pin a known-good Node (18/20 LTS) for ares-cli use, or wait for a release that works with Node 25+. For now, the scp + direct `ApplicationInstallerUtility` path is the workaround and it's documented in the fallback install note here.

## What was proven

- `.ipk` builds correctly from `home/` via `scripts/package.ps1`.
- Installs on the TV via `ApplicationInstallerUtility` (with the `-f opkg.conf` flag) → `AI_ERR_NONE`.
- Registers in the webOS launcher after one reboot.
- Opens cleanly as a webOS app; `PalmServiceBridge` is reachable from the app context.
- Timeout path shows a user-visible error instead of hanging forever.

Everything in the M1 goals except the final "launch Netflix from the list" step is working end-to-end.
