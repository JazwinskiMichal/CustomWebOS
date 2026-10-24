# M2 tracking — things discovered during the M1 on-device test

These are findings from installing M1 on my LG C8 and running it on 2026-10-24. None of them block the M1 artifact bar being met (install + register + open worked), but they're the first things M2 should pick up.

## The core webOS 4.4 permission wall

**Problem.** Dev-mode webapps on consumer webOS 4.4 cannot make `applicationManager` calls directly — not `listLaunchPoints`, not `launch`, not any of them. Confirmed in two independent ways:

1. **Bus registration (`ls-monitor -i com.webos.applicationManager`).** `listLaunchPoints` provides list contains `private / configurator.callbacks / all / applications.internal` — **no `"public"`**. `launch` has `"public"` in its list, which looks like it should be reachable, but see point 2.
2. **Live call from the webapp returns no response within 10 s.** Reproducing with `luna-send-pub -a org.jazwinski.customwebos.home ... /launch` from a root SSH session returns the actual error: `LUNASERVICE ERROR -1031: LSCallFromApplication with application ID org.jazwinski.customwebos.home but not privileged`. So even the `"public"` method is gated behind an "is the caller a privileged app" check that dev-mode apps fail.

**Impact.** CustomWebOS Home's hardcoded list renders fine, the remote navigates it, but pressing OK on any app does not launch it. Enumeration was already blocked; launch is blocked for the same underlying reason.

**Fix (first M2 task).** Bundle a service component — the Hbchannel pattern. Rough shape:

```
services/org.jazwinski.customwebos.home.service/
  package.json             # Node service metadata
  services.json            # luna manifest — declares service id and public methods
  <permissions files>      # declares applications.operation / applications.launcher ACGs
  service.js               # Node code — subscribes to luna, exposes:
                           #   luna://org.jazwinski.customwebos.home.service/listApps
                           #   luna://org.jazwinski.customwebos.home.service/launch
                           # Internally calls com.webos.applicationManager under
                           # the privileged service context.
```

Then update `scripts/package.ps1` to pass both `home/` and `services/` to `ares-package`, which bundles them into a single `.ipk`. The webapp's `main.js` replaces its luna URIs with the service's own public endpoints.

Hbchannel's own `services.json` and the methods it exposes (`spawn`, `install`, `exec`, …, all with `provides: ["…","all","public","ares.webos.cli"]`) are the reference. Introspection output I captured during the test is in [the chat log](https://github.com/JazwinskiMichal/CustomWebOS/issues?q=webOS+4) — grep for `ls-monitor -i org.webosbrew.hbchannel.service`.

Alternative that **does not work**: setting `requiredPermissions` in `appinfo.json` alone. Tried on 0.1.4 (`["application.operation","application.launcher"]`); call still times out. The field controls self-declared ACGs but doesn't grant them on a locked consumer firmware.

## Other things noticed

- **Launcher cache needs a reboot** to pick up a newly-installed developer app the first time. First install → reboot → tile appears. Later upgrades of an existing registration show up without reboot. Worth mentioning in `docs/setup.md` §4 before the install step.
- **`ares-package` minifies by default.** Confirmed on-TV: the installed `main.js` is one-line minified, variable names mangled. The scan test only runs against the source file, not the packaged file, so ES2015+ output from the minifier would slip past — if it ever used any, which it doesn't (observed output is ES5-safe). A `--no-minify` flag exists if we ever need readable logs on-device.
- **Test files bundle into the `.ipk`.** `ares-package home/` includes `home/appinfo.test.js` and `home/main.test.js`. Inert on the TV, ~5 KB of waste. Fix: relocate tests outside `home/` or configure ares to exclude them.
- **`ApplicationInstallerUtility` needs an explicit `-f /etc/palm/appinstalld/opkg.conf`** on this firmware, or `opkg_conf_load` fails with "no such file or directory". The ares-cli `ares-install` would handle this automatically if it worked — but see next item.
- **`ares-cli` 2.4.0 is broken on Node 25.** `TypeError: isDate is not a function` on install. Workaround used tonight: `scp` the `.ipk` to `/tmp/` and run `ApplicationInstallerUtility` over SSH directly. Pin a Node 18/20 LTS for ares-cli use, or wait for an ares-cli release that works with Node 25+.
- **Both `WebOSServiceBridge` and `PalmServiceBridge` exist** on this firmware; both get the exact same silent-no-response behavior when calling blocked methods. The class name wasn't the problem.

## What was proven on-device

- `.ipk` builds correctly from `home/` via `scripts/package.ps1`.
- Installs via `ApplicationInstallerUtility` (with the `-f opkg.conf` flag) → `AI_ERR_NONE`.
- Registers in the webOS launcher after one reboot (first install only).
- Opens cleanly as a webOS app; the service bridge is reachable from the app context.
- Hardcoded fallback list renders, Magic Remote up/down navigation works, focus ring behaves.
- Timeout path shows a user-visible error instead of hanging forever when a luna call is silently dropped.

Everything in the M1 goals except the final "launch Netflix from the list" step is working end-to-end. The service-component rework fixes the gap and unblocks M2 proper.

## Open iterations shipped tonight

Versions 0.1.1 → 0.1.5 are on-device-test iterations. 0.1.5 is the current `main` state.

- 0.1.1 — fix bridge call path from `webOS.service.request` (needed `webOSTV.js`) to raw `PalmServiceBridge`.
- 0.1.2 — add 10 s client-side timeout to the bridge call so the UI doesn't hang.
- 0.1.3 — switch to `WebOSServiceBridge` (LG canonical) with `PalmServiceBridge` fallback. No functional change in the end.
- 0.1.4 — declare `requiredPermissions` in `appinfo.json`. No effect on consumer webOS 4.4.
- 0.1.5 — remove `listLaunchPoints` call entirely; use a hardcoded fallback list of common streaming apps. Fix misleading "Could not list installed apps" error header → "Error:".
