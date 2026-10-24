# Setting up CustomWebOS on an LG C8

This is the whole path. Baseline capture, rooting, Homebrew Channel, SSH, installing CustomWebOS as the Home-button target, and a rollback for every step along the way.

Reference TV: **LG OLED55C8PLA, firmware 05.50.70, webOS 4.4.3-22** (platform codename `gorongosa`, 2018 OLED C-series). If your TV is close to that, this plays well. If it isn't, read §Rollback D before you start — the exits get narrower on older firmware or different models.

Read the whole thing before you start. The rooting step itself is low-risk on this firmware, but every step has a rollback and you want to know them in advance.

---

## §0 Pre-flight / baseline (offline, no TV involvement)

These are cheap, don't touch the TV, and give you an exit route if anything feels wrong later. Do them first.

### §0.1 Download your current firmware installer

The current firmware `.epk` is your "reinstall same version from USB" lifeline. If LG ever retires the download, you lose that option forever — grab it before anything else.

Model support page: <https://www.lg.com/ro/suport/produs/lg-OLED55C8PLA>. Even if you aren't in Romania, the file is on LG's global CDN and the Romanian page tends to still list it.

Current downloads (as of this writing, served from `gscs-b2c.lge.com`):

- **v05.50.70 (current, ZIP ~813 MB):** <https://gscs-b2c.lge.com/downloadFile?fileId=pgFUtZ7t6AdpgkRNnwZ1Q>
  - inner `.epk` SHA-256: `3b21a86ce1fb4c7055535f5ce08c1461b48cfb4da86f2873b12129e8490c6b55`
- **v05.50.60 (one version back, ZIP ~813 MB):** <https://gscs-b2c.lge.com/downloadFile?fileId=baMv1pcD2D3vCupIvTaMBw>
  - inner `.epk` SHA-256: `63bd13b6f92cafb318d54abfd7e27cbb796521534a13b1897ca6c11e7bcaf0e6`

Save both to `.local/webos/firmware/` in your working copy. Grab the older one too — a second lifeline costs nothing. The ZIP filenames LG hands you (`Software File(Version 05.50.70).zip`) wrap a single `.epk` named like `starfish-dvb-secured-o18-gorongosa-22-05.50.70_prodkey_usb_V3_SECURED.epk`. If the `o18-gorongosa` part doesn't match a 2018 C-series TV, stop and check what you actually downloaded.

### §0.2 Record the TV's own version string

On the TV: **Settings → All Settings → General → About This TV**. Write down:
- Software version (should read `05.50.70`).
- webOS TV version (should read `4.4.3-22 (goldilocks-gorongosa)` or similar).
- Model number (should be `OLED55C8PLA` exactly).
- Serial number.

Save these to `.local/webos/baseline.txt` or wherever you keep private notes. The version string is the one thing that decides whether dejavuln applies to your TV — if yours is newer than 05.50.70, go to <https://cani.rootmy.tv> first and check what still works.

### §0.3 Record LAN state

**Settings → All Settings → Network → Wi-Fi/Wired Connection → Advanced**. Note the TV's IP and whether it's on wired or Wi-Fi. The IP is what you'll SSH into after step 3.

Wired is better if you can swing it. The whole flow works over Wi-Fi too, but SSH stays steadier on wired.

### §0.4 Settings screenshots (optional)

If you want to be able to restore picture/sound presets after a factory reset, snap photos of each on your phone. Rooting itself does not wipe them, but factory reset — one of the rollback paths below — does.

Skip this if you'd happily reconfigure from scratch. Note the skip somewhere so your future self knows it was deliberate.

---

## §1 Pre-root checks (TV side, nothing destructive)

Fix each of these before step §2 or the exploit either won't run or won't persist.

- **Uninstall the LG Developer Mode app** if it's installed. The current build of that app actively blocks the exploit. Long-press its tile on the Home grid → delete. If you never installed it, skip this.
- **Disable Auto Update.** Settings → General → About This TV → Auto Update → **Off**. Set both "Software Update" and "Application Update" toggles off if your firmware shows both. Keep this permanently off once rooted — an OTA removes root and may patch the vulnerability so you can't re-root.
- **Disable Quick Start+.** Settings → General → Quick Start+ → **Off**. The rooting process reboots the TV, and Quick Start+ interferes with the clean boot the exploit needs.
- **Have a FAT32 USB stick.** Single partition, ≥1 GB, ideally empty. **Not exFAT** — the Media Player app that triggers the exploit doesn't enumerate exFAT reliably. NTFS also works, FAT32 is simpler.

---

## §2 Root with dejavuln-autoroot v0.0.10

The actual root. On this firmware it's a USB-triggered exploit — no network, no Dev Mode, no scripts on your PC.

### §2.1 Grab the exploit payload

- **Release page:** <https://github.com/throwaway96/dejavuln-autoroot/releases/tag/v0.0.10>
- **Direct archive:** <https://github.com/throwaway96/dejavuln-autoroot/releases/download/v0.0.10/dejavuln-autoroot-0.0.10.zip>
- **Archive SHA-256:** `83F39E95EC702E6370DF65BDE16ACCED9861A87E473F763A9E55DE948AA7756F`

Verify the SHA-256 before you touch the TV. On Windows:

```powershell
certutil -hashfile dejavuln-autoroot-0.0.10.zip SHA256
```

### §2.2 Put it on the USB stick

Extract the archive **to the root of the USB stick**, not inside a subfolder. The archive contains four files: `autoroot.sh`, `hbchannel.ipk`, and a pair of files whose names start with `lol$(sh$IFS$(find$IFS…)` — the booby-trapped MP3 (0 bytes) and its matching LRC.

Two Windows gotchas:

- PowerShell's `Expand-Archive` **mangles** those names — don't use it. Open the ZIP in File Explorer and drag the four files to the stick's root instead, or use 7-Zip.
- Those two long-named files contain forward slashes, which Windows (and every other filesystem) treats as path separators. You will end up with a folder named `lol$(sh$IFS$(find$IFS` at the top of the stick, with a `tmp` subfolder inside, and the actual `.mp3`/`.lrc` two levels down. **That's correct** — the archive author built it that way on purpose, the TV navigates into those folders.

End state on the stick (short view):

```
E:\autoroot.sh
E:\hbchannel.ipk
E:\lol$(sh$IFS$(find$IFS\tmp\<two long-named files>
```

### §2.3 Trigger the exploit

- **Unplug every other USB device from the TV.** The exploit's `find` walks `/tmp/usb` and extra sticks confuse it.
- Eject the stick cleanly from your PC, plug it into the TV.
- Open the TV's Media Player / Music app. Browse to the folder with the odd `lol…` name.
- Navigate into it until you reach the MP3. Try to play it.
- You'll see an error popup — that's expected. Wait. Within ~15–30 seconds a popup should say rooting is in progress, then another saying it's done.

### §2.4 Reboot

- When the "reboot now" prompt appears, **unplug the USB stick first**, then confirm reboot.
- After the TV comes back up, look for a **Homebrew Channel** app on your home grid. If it's there and launches to a catalogue, root is persistent.

If the MP3 produced its error but no "rooting in progress" popup followed within ~1 minute — stop. Nothing has changed on the TV (§Rollback A). Reboot and check <https://cani.rootmy.tv> for your exact firmware before trying anything else.

---

## §3 Homebrew Channel essentials (SSH access)

Homebrew Channel 0.7.3 (bundled with dejavuln v0.0.10) ships dropbear and busybox-telnetd inside the app itself. You don't install a separate SSH package; you toggle one on.

### §3.1 Hbchannel settings end state

Inside Homebrew Channel → settings (gear icon), set:

| Toggle | Set to | Why |
|---|---|---|
| **SSH server** | **ON** | Starts dropbear on port 22 at boot. |
| **Telnet** | **OFF** | Unauthenticated plaintext — don't want it running once SSH works. |
| **Block system updates** | **ON** | Hbchannel's own OTA block, independent of the LG-side Auto Update toggle. |
| **Failsafe mode** | **OFF** | Emergency boot-crash recovery toggle. Leave it as the escape hatch, flip ON only if something later breaks. |

These toggles only take effect on **boot** — the services read their flag files once from `/var/luna/preferences/webosbrew_*` during startup. The "System reboot" option in Hbchannel settings does fire a full OS reboot and is enough; a physical power cycle also works.

### §3.2 Pubkey auth, not `passwd`

webOS keeps `/etc/shadow` on a read-only filesystem. If you try `passwd` after SSH-ing in, you'll get:

```
passwd: can't create /etc/shadow+: Read-only file system
```

That's by design, not a bug. The intended security model: Hbchannel's `startup.sh` bind-mounts a shadow file with a well-known default password (`alpine`) **only when `/home/root/.ssh/authorized_keys` doesn't exist**. The moment you drop an authorized_keys file in, that bind-mount stops happening at the next boot and password login goes away. Pubkey auth becomes the only way in.

Generate a keypair on your PC:

```powershell
ssh-keygen -t ed25519 -f $env:USERPROFILE\.ssh\id_ed25519_lgtv -C "me@my-pc-cleanframelg-tv"
```

Install the public key on the TV. First time, the easiest path is telnet (which the exploit left running until you flip the toggle off): connect without authentication, create the directory, write the key, chmod, done. After that first install, use SSH with the key.

### §3.3 Port 22, or port 22022 if your router hates you

Default dropbear binds to port 22. Try to connect:

```powershell
ssh -i $env:USERPROFILE\.ssh\id_ed25519_lgtv -p 22 root@<tv-ip>
```

If that hangs or times out while telnet on port 23 works, your LAN router is probably dropping SYNs to port 22 as an anti-brute-force default (common on Mikrotik, some ISP routers, enterprise APs). You can either fix the router firewall, or sidestep by running dropbear on a non-standard port.

To sidestep: SSH or telnet in, drop this one-liner into Hbchannel's init.d directory and reboot once:

```sh
mkdir -p /var/lib/webosbrew/init.d
cat > /var/lib/webosbrew/init.d/dropbear-22022 <<'EOF'
#!/bin/sh
/media/developer/apps/usr/palm/services/org.webosbrew.hbchannel.service/bin/dropbear -R -p 22022
EOF
chmod +x /var/lib/webosbrew/init.d/dropbear-22022
```

Hbchannel's own startup.sh runs `run-parts /var/lib/webosbrew/init.d` near the end of boot, so this script fires every boot without further intervention. From then on:

```powershell
ssh -i $env:USERPROFILE\.ssh\id_ed25519_lgtv -p 22022 root@<tv-ip>
```

The Hbchannel SSH toggle also continues to start a default dropbear on port 22 — if you'd rather have only one, flip the toggle off; the init.d script keeps 22022 alive on its own.

### §3.4 Flip telnet off

Once SSH pubkey login works end-to-end, turn Hbchannel's Telnet toggle off and reboot. Telnet is unauthenticated — don't leave it listening on your LAN.

---

## §4 Install CustomWebOS and make it the Home-button target

### §4.1 Install the LG WebOS TV SDK CLI

The CLI gives you `ares-package` (build) and `ares-install` (install). Follow LG's instructions: <https://webostv.developer.lge.com/develop/tools/cli-installation>. On Windows this is a Node-based npm install.

### §4.2 Register your TV as an ares device

```powershell
ares-setup-device --add tv --info "{\"host\":\"<tv-ip>\",\"port\":\"22022\",\"username\":\"root\",\"privateKey\":{\"openSsh\":\"id_ed25519_lgtv\"}}"
```

Adjust the port to 22 if you didn't need the 22022 workaround. The private key file reference is a filename inside `~/.ssh/`, not a full path.

### §4.3 Build and install

From the repo root:

```powershell
pwsh scripts/package.ps1               # produces dist/org.jazwinski.customwebos.home_0.1.0_all.ipk
pwsh scripts/install.ps1 -Device tv    # ares-install -d tv dist/*.ipk
```

Confirm the install landed:

```powershell
ssh -i $env:USERPROFILE\.ssh\id_ed25519_lgtv -p 22022 root@<tv-ip> 'ls /media/developer/apps/usr/palm/applications/'
```

You should see `org.jazwinski.customwebos.home` in the list. Launching it from the TV's app grid should show a CustomWebOS screen with the installed apps you can launch.

### §4.4 Autostart hook — pick one

Making CustomWebOS the destination when you press the Magic Remote's Home button is a webOS-side configuration. There's more than one way to do it, each with its own tradeoffs and its own rollback. Pick one at install time rather than committing to one in the repo.

Candidates in current webosbrew-community practice (verify against <https://www.webosbrew.org/pages/autostart> or the Hbchannel repo at the time you're installing — these move):

- **Hbchannel's own "set as Home" option** if your Hbchannel version exposes one in Settings. Rollback: flip the same toggle off.
- **`luna-send` default-launchpoint override via an init.d script.** Add a script under `/var/lib/webosbrew/init.d/` that calls `luna-send -n 1 luna://com.webos.applicationManager/setDefaultLaunchpoint` with the CustomWebOS id. Rollback: delete the init.d script, reboot; LG's native home comes back.
- **webosbrew's `webos-remote` / `autostart-apps` pattern** for the Hbchannel apps that already handle this cleanly. Rollback: uninstall the autostart-apps package or clear its config.

**Before you apply any of them, write the rollback down.** The guarantee you want: if CustomWebOS misbehaves after you set it as home, you can get back to LG's native home with telnet (not SSH, in case CustomWebOS crashes the whole display) and a known set of commands. Keep that recovery sheet in `.local/webos/`.

---

## §Rollback

Severity ladder. Try A before B, B before C, C before D.

### §Rollback A — rooting attempt failed, TV behaves normally

Nothing to roll back. The exploit either triggered or didn't. Unplug the stick, reboot, carry on. No state changed on the TV.

### §Rollback B — rooted, but you want root gone

Two options:

- **Clean uninstall:** inside Homebrew Channel there's a "Remove root" / "Uninstall Hbchannel" option. It unwinds the persistence hooks, removes dropbear/telnetd, removes Hbchannel itself. Reboot. Flip Auto Update back on if you want.
- **Factory reset:** Settings → General → Reset to Initial Settings. Wipes your settings, installed apps, Wi-Fi. Keeps firmware. On most C-series builds Homebrew Channel does **not** survive a reset, which is what you want in this scenario.

### §Rollback C — something's off (apps crash, UI slow, autostart hook stuck)

- **Soft recovery:** full power cycle. Unplug mains for 60 seconds. Clears most transient weirdness.
- **Settings reset only:** keeps firmware, wipes config. Rebuild from your §0 screenshots.
- **Autostart hook rollback:** if the Home-button override is the thing misbehaving, telnet in (flip Hbchannel's Telnet toggle back on first if you turned it off), undo whichever autostart candidate you chose per §4.4, reboot. LG's native home comes back.
- **Reinstall same firmware from USB** using the `.epk` you saved in §0.1. Settings → Support → Software Update → "Install from USB". Takes ~20 minutes. This will remove root cleanly and restore the firmware to a known-good state; you can re-root the same way afterward.

### §Rollback D — TV won't boot past the LG logo

You almost certainly cannot get here from the steps above — the exploit does not touch the bootloader or system partition. If you do get here:

- **Power cycle at mains.** Holding power on the remote during boot does nothing on webOS.
- **Service menu** — model-specific, don't go in blind. Contact LG service.
- **Do not pursue serial-pad firmware flashing** unless you've done it before. Real brick risk.

### Things rollback can't restore

- **ESN / serial / signing material** — unchanged by all steps above, nothing to restore.
- **Channel list** (tuned terrestrial/satellite channels) — wiped by factory reset. Re-tune after.
- **App logins (Netflix, YouTube, etc.)** — wiped by factory reset. Sign back in. Harmless but tedious.

---

## When *not* to proceed

Stop and figure something out before starting if any of these are true:

- You skipped §0 (no firmware `.epk` saved, no baseline notes).
- The TV is under active warranty and you need it to stay that way.
- You rely on this TV with no spare. Do this on a weekend evening, not before a dinner party.
- You can't find your firmware version on LG's support site. Without it, your "reinstall same firmware" escape hatch is gone.
- Your firmware string is newer than 05.50.70 and <https://cani.rootmy.tv> says your version is patched.

Everything else is reversible.
