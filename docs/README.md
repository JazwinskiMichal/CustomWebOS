# Docs

Start with **[status.md](status.md)**: where things stand (paused since 2026-10-29) and where to pick up. To work from a new machine, read **[development.md](development.md)**.

| Doc | What it's for |
|---|---|
| [status.md](status.md) | Current state, milestones, next steps, small open items. Keep it current. |
| [development.md](development.md) | Setting up a machine; the dev loop: preview, tests, build the daemon, package, install, measure, remote view. |
| [tv-notes.md](tv-notes.md) | Lasting facts and rules about the TV (webOS 4.4 quirks, luna-send traps, install and boot behaviour). Read before touching the TV. |
| [tv-log.md](tv-log.md) | Dated log of on-device sessions, with the evidence behind `tv-notes.md`. History; append, don't rewrite. |
| [setup.md](setup.md) | One-time TV setup: baseline, rooting, Homebrew Channel, SSH, first install, service registration, rollbacks. |
| [home-button.md](home-button.md) | Power-on and Home button: findings, the applied mechanisms and the LG Input Hook patch; rollbacks for every boot hook and the doorbell box. |
| [superpowers/specs/](superpowers/specs/) | Designs: the [overall vision and milestones](superpowers/specs/2026-10-24-customwebos-design.md), the [home screen](superpowers/specs/2026-10-25-home-redesign-design.md), the [day/night theme](superpowers/specs/2026-10-26-day-night-theme-design.md), [remote view](superpowers/specs/2026-10-26-remote-view-design.md), the [no-signal slideshow](superpowers/specs/2026-10-27-no-signal-slideshow-design.md) and the [doorbell overlay](superpowers/specs/2026-10-29-doorbell-overlay-design.md). Later decisions are recorded inside each. |
| [superpowers/plans/](superpowers/plans/) | Implementation plans; each starts with its status. All seven are complete. |

Private material (SSH key, TV IP, recovery sheet `.local/webos/recovery.md`) lives in `.local/` and `~/.ssh/`, never in git; copy it between machines by hand.
