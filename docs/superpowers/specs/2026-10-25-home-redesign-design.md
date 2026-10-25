# Home screen redesign — design

Date: 2026-10-25. Parent design: [`2026-10-24-customwebos-design.md`](2026-10-24-customwebos-design.md).

## Intent

CustomWebOS Home works (curated apps, All apps, launch, remembered app, error screen) but looks like a debug list: a dark page with a column of rows. Michał wants it to look like **CleanFrame's dock** (the legacy repo at `C:\Users\Lenovo\source\repos\CleanFrameLG`, screenshot `docs/images/cleanframe-dock.jpg`): a full-screen photograph, a clock, and a frosted-glass dock of white app logos.

This is the first of three projects agreed on 2026-10-25, in this order:
1. **This redesign.**
2. Home Assistant connection and "plugins" (e.g. a whole-house lights panel). A local Home Assistant server can be installed for testing.
3. Overlays over other apps (doorbell camera feed over Netflix). Least certain on webOS 4.4; starts with an on-device spike.

The redesign must not paint 2 and 3 into a corner, but builds neither.

## Goals

- Layout "A — Dock", chosen by Michał from three mockups (`.superpowers/brainstorm/…/layout.html`, untracked): full-screen photo, clock and date top-left, one glass dock across the lower third holding the curated Home apps from `config.js` plus an **All apps** tile as the last tile.
- **White monochrome logos**, as in CleanFrame (Michał's choice), not the TV's colourful icons.
- One wallpaper, chosen in `config.js` (no on-device picker in this iteration).
- **It must not feel laggy or slow on the TV.** This is the anti-goal that would make the work a failure even if everything else is right (Michał's words: "if it's laggy or slow on the TV").

## Non-goals (this iteration)

- On-device settings, wallpaper picker, app reordering (config.js stays the editor; there is deliberately no on-device editor).
- Time-of-day / light-dark theme switching. **Later** Michał wants it "similar to macOS": after a certain hour the theme and wallpaper turn dark. Only the groundwork is in scope (see Theming).
- NAS photos (M3), Home Assistant panels, notifications, overlays.
- A framework or build step (see How it's built).

## Anti-goals

- Lag: focus moves, opening All apps, or the first paint feeling slower than today's list.
- A home screen that looks finished but hides failure: the error screen ("Can't reach the home service" + reason + retry) must stay as clear as today, restyled to fit.
- Brand marks shipped without licence records in this **public** repo.

## Constraints

- **Engine:** webOS 4.4 = Chromium 53 (LG's spec; UA `Chrome/53.0.2785.34`). Available: flexbox (use `-webkit-` prefixes as the current CSS does), CSS custom properties, transforms/transitions, `object-fit`, `-webkit-mask-image`, CSS `filter`, WOFF2, WebGL 1. **Not available:** CSS Grid, flex `gap`, `position: sticky`, `backdrop-filter`, `:focus-within`, ResizeObserver. Runtime JS stays **ES5** (AGENTS.md).
- Stage is 1920×1080 (`<meta name="viewport" content="width=1920">`).
- Input: LG remote keys (arrows, OK=13, Back=461 plus 27/8 as today) and the Magic Remote pointer (hover focuses, click opens), exactly as `home/main.js` handles them now.
- Device work (installs, measurements) needs Michał's per-task go-ahead (AGENTS.md). Every app upgrade needs `install.ps1 -TvHost <ip> -Reboot`; after boot, if the TV reopened CustomWebOS itself, close and reopen it (see `docs/m2-tracking.md`).

## The screen

**Home (layout A).** Full-bleed photo. Clock (24h, as today) top-left with the date beneath it **in the TV's language** (Michał: Polish, or follow the TV locale if possible), e.g. "niedziela, 25 października". Use `toLocaleDateString` with the TV's locale if Chromium 53 on the TV actually produces correct Polish (check on device; the TV's language is readable from the system settings service). If it doesn't, use built-in Polish day and month names (genitive month forms). Keep the formatting in a pure, unit-tested helper. The dock is a rounded glass panel spanning most of the width in the lower third (CleanFrame's geometry is a good start: `left:208px; top:676px; width:1504px; height:232px`, radius 48px); tiles show a white logo above the app name; the focused tile gets a lighter fill. Left/right move focus along the dock; OK opens; Back on Home is swallowed (as today). Up from the dock is reserved for a future top-right control row and does nothing now.

**More than fits.** Home holds at most 9 curated apps + All apps (config.js already caps at 9). If the tiles don't fit the dock width, the dock scrolls horizontally keeping focus visible (CleanFrame's last tile is cut off at the edge, which is acceptable as a scroll cue).

**All apps.** Opens from the All apps tile as its own full-screen view over the same photo: every installed app in a grid of the same tile style (built with flexbox wrapping — no CSS Grid), arrow keys move in 2-D, Back returns to Home with the All apps tile focused. Remembered-last-app behaviour stays as today (focus starts on that app; if it's only in All apps, focus starts on the All apps tile and the grid opens on it).

**States.** Loading, error ("Can't reach the home service", reason, retry line) and "No apps found" keep their wording from `home/main.js` but sit on the photo in the new type, e.g. inside a glass panel where the dock would be. The one-line launch-failure note stays (single line, ellipsis).

## Logos

- Source as CleanFrame did: **Simple Icons** (CC0, trademark notice retained) and, where needed, **Custom Brand Icons** (MIT). CleanFrame's `app/assets/icons/` already has Netflix, YouTube, Prime Video, Max (`hbomax.svg`), Apple TV, Disney+ with `SOURCES.json` and licence files; copy what's needed together with their source/licence records. Canal+: look it up in Simple Icons.
- No brand exists for Live TV, HDMI 1, Homebrew Channel or All apps: draw simple original line glyphs in the same weight (a TV, an HDMI plug, a small brew mark, a grid).
- Logos render white via a CSS mask (`-webkit-mask-image` with the SVG, background colour = ink), as CleanFrame does, so colour follows the theme.
- Apps without a bundled logo (most of All apps): show the TV's own icon turned white with `filter: brightness(0) invert(1)`; if that looks bad on device for opaque square icons, fall back to white initials. Decide on device.
- Upstream credit goes in the README only (AGENTS.md); licence texts sit beside the assets.

## Wallpaper and glass

- Ship a few of CleanFrame's Unsplash photos (licence + credit records copied with them); `config.js` gets e.g. `var HOME_WALLPAPER = 'alpine';`. The builder picks a placeholder default; Michał's pick is a one-line config change and does not block sign-off (Claude's call).
- Tile sizing (builder's call, noted because it bites): CleanFrame-sized tiles fit only ~5 of the 10 Home tiles in a 1504px dock, so either shrink tiles, widen the dock, or scroll.
- **Glass without `backdrop-filter`:** CleanFrame's method. Each photo has a pre-blurred full-stage 1920×1080 "frost" JPEG generated offline (`CleanFrameLG/scripts/build-materials.mjs`, outputs like `alpine-field-frost.jpg`). The dock is a clipped box (`overflow:hidden; border-radius; transform: translateZ(0)`) containing that frost image positioned at the same stage coordinates as the background, plus a translucent veil. The TV never blurs at runtime. Copy the existing materials for the chosen photos rather than porting the generator, unless new photos are added.

## Theming groundwork

All colours (ink, glass veil, focus fill, shadows) come from CSS custom properties on `:root`, grouped as a light set and a dark set selected by a class on the root element. Wallpaper is referenced by name, so a later time-of-day switch only changes the class and the photo name. No switching logic now.

## Performance (the bar)

- Only `transform` and `opacity` animate; focus changes are a class swap with a short transition (≤150 ms). No live blur, no large box-shadows on moving elements.
- First paint does not wait for the service: photo, clock and the empty glass dock (with the loading line) render immediately. App tiles appear only once the service list arrives; Michał asked on 2026-10-25 for the built-in fallback list to be removed because a list that can't launch anything is misleading, so the dock must not show curated apps before then. The error state replaces the loading line if the service fails, as today.
- Re-rendering: focus moves must not rebuild the whole DOM each keypress as `render()` does today; update classes in place.
- **Baseline first** (Claude's call): before changing code, measure today's 0.3.1 list on the TV the same way, so "slower than today" has numbers. CleanFrame's look has only ever run on a Samsung (Tizen), never on webOS 4.4, so expect to need the fallback order below.
- **The bar** (Claude's call, numbers can be tuned after the baseline): first paint within 1 s of launch; a focus move visibly responds within 100 ms; while holding Right across the dock, 95% of frames under 33 ms (30 fps).
- **If the TV misses the bar, give things up in this order** (Michał's order): (1) focus animations, (2) the Manrope web font (fall back to the TV's system font), (3) the frosted glass (plain dark translucent dock instead), (4) last, a smaller or lower-quality photo.
- **Measure on the TV before calling it done:** time from launch to first paint, and smoothness while holding Right across the dock and moving through All apps (e.g. a `requestAnimationFrame` frame-time log for a few seconds, read back over SSH/console). Record numbers in `docs/m2-tracking.md`.

## How it's built (Claude's call, not Michał's)

- **Plain ES5 + CSS, no framework, no build step.** CleanFrame shipped this look that way; it keeps the existing pure-helper/`mountUI` structure, `node --test` units, the ES5 parse check, the dev server, the mock bridge and the Playwright browser suite. Preact behind a small esbuild step stays an option if the Home Assistant panels get complex.
- Font: **Manrope** (SIL OFL 1.1, WOFF2, licence beside it), as CleanFrame.
- Navigation logic stays in pure, unit-tested functions (`nextState` extended for 1-D dock and 2-D grid movement).

## Left to the builder

Exact tile sizes, type scale, spacing, focus treatment, how the error panel sits, which photos ship, the grid's column count, the scroll treatment of the dock, and the shape of the original glyphs — within the look of `cleanframe-dock.jpg` and the constraints above.
