# Docs

Start with **[status.md](status.md)**: where things stand and what's next. To work from a new machine, read **[development.md](development.md)**.

| Doc | What it's for |
|---|---|
| [status.md](status.md) | Current state, milestones, next steps, small open items. Keep it current. |
| [development.md](development.md) | Setting up a machine; the dev loop: preview, tests, build the daemon, package, install, measure, remote view. |
| [tv-notes.md](tv-notes.md) | Lasting facts and rules about the TV (webOS 4.4 quirks, luna-send traps, install and boot behaviour). Read before touching the TV. |
| [tv-log.md](tv-log.md) | Dated log of on-device sessions, with the evidence behind `tv-notes.md`. History; append, don't rewrite. |
| [setup.md](setup.md) | One-time TV setup: baseline, rooting, Homebrew Channel, SSH, first install, service registration, rollbacks. |
| [home-button.md](home-button.md) | Power-on and Home button: findings, the two applied mechanisms, their rollbacks; the remote view boot hook's rollback. |
| [superpowers/specs/](superpowers/specs/) | Designs. [customwebos-design](superpowers/specs/2026-10-24-customwebos-design.md) is the overall vision and milestones. [home-redesign-design](superpowers/specs/2026-10-25-home-redesign-design.md) covers the current home screen. |
| [superpowers/plans/](superpowers/plans/) | Implementation plans; each starts with its status. All three are complete. |

Private material (SSH key, TV IP, recovery sheet `.local/webos/recovery.md`) lives in `.local/` and `~/.ssh/`, never in git; copy it between machines by hand.
