# Day/night theme and glass clock — design

Date: 2026-10-26. Parent design: [`2026-10-24-customwebos-design.md`](2026-10-24-customwebos-design.md). Builds on the home redesign ([plan](../plans/2026-10-25-home-redesign.md)).

## Intent

Michał wants the home screen to follow the day the way macOS does: "dark wallpaper after sunset, back to light in the morning". He took the idea from macOS's paired light and dark wallpapers. Separately, the clock and date in the top-left are "hardly visible without background" on the photo, so they get the same glass as the dock.

## Goals

- **Day and night modes, switched by the sun.** Night mode from sunset to sunrise, day mode from sunrise to sunset, in Warsaw. The times are computed on the TV from Warsaw's latitude and longitude and today's date, with no internet. They follow the seasons (about 15:25 in December, about 21:00 in June).
- **One wallpaper: GNOME's Morphogenesis pair** (Michał: "we're using morphogenesis from now on, dont need other wallpapers"). The light version by day, the dark version at night.
- **Text and glass colours follow the mode,** like macOS: dark text on light glass by day (the existing `.theme-light` set), light text on dark glass at night (the existing `.theme-dark` set). Approved in a mockup ("it looks ok").
- **Glass behind the clock and date,** exactly like the dock: the same pre-blurred image, the same corner radius (48 px), sized to fit the clock and date (mockup option B, Michał's pick).
- **Switching while open:** if the home screen is on screen at sunset or sunrise, it switches without being reopened.

## Non-goals

- **Other wallpapers.** The three Unsplash photos (Alpine glow, Misty coast, Quiet cove), their glass images, their `SOURCES.json` entries and their README credits are removed.
- **Choosing wallpapers on the TV,** or a settings screen. The wallpaper is fixed; `config.js` holds the location.
- **Gradual dusk/dawn blending** (macOS's many-step dynamic wallpapers). Two states only.
- **Photographic day/night pairs.** They were searched for: no openly licensed same-view landscape pairs exist (only paid stock composites or copyrighted series), and Michał rejected simply dimmed photos ("those are just dimmed versions of the same images"). Apple's wallpapers are licensed only for Apple devices.

## Anti-goals

- **Unreadable text in either mode.** That's the whole reason for the clock glass. Contrast must be checked on the TV in both modes, not only in a PC browser.
- **Dropped frames on the home screen.** Animated effects over the glass already cost frames (tv-notes: a 120 ms fade dropped 6 of 32 frames). The switch is instant, with no fade. The dock must stay at 60 fps (`scripts/perf.ps1`), and the clock glass must not change that.
- **Wrong mode near midnight or at the clock change.** Sunset and sunrise use the TV's local time (CET/CEST, which the TV already gets right).
- **A broken look if an image is missing.** The existing fallbacks (background colour, translucent veil) keep working.

## Constraints

- **TV web engine:** Chrome 53, so runtime JS stays ES5 (AGENTS.md). No `backdrop-filter`, so glass is a pre-blurred copy of the wallpaper, clipped and lined up with the photo behind it (the dock's `.mat` technique).
- **Assets:** GNOME's `morphogenesis-l.svg` and `morphogenesis-d.svg` (4096×4096, by Jakub Steiner, CC BY-SA 3.0, gnome-backgrounds). They're converted offline to 1920×1080 JPEGs (center crop), plus a pre-blurred, tinted `-dock` JPEG of each for the glass. They aren't rendered as SVG on the TV: a 236 KB SVG with gradients would be redrawn and blurred on a slow GPU. The converted files are CC BY-SA 3.0 derivatives: credit in the README and `SOURCES.json`, licence noted beside them. The repo's code stays MIT.
- **Location in a public repo:** the city (Warsaw) and its coordinates go in `home/config.js`, which is public. City level is acceptable.
- **Tests:** the existing asset and config tests (`test/home-assets.test.js`, `test/home-config.test.js`) change to the new files; the sun calculation gets unit tests against known Warsaw times.

## The parts of the how decided

- **Sun times:** a small, pure ES5 function (the standard NOAA/"sunrise equation" approximation is accurate to about a minute; a few minutes is fine). The input is the date, latitude and longitude, and the output is today's sunrise and sunset in local time. The mode check runs on the existing minute tick (`tickClock` in `home/main.js`), so no new timer is needed.
- **Switching:** swap the `theme-light`/`theme-dark` class on `<html>` and the two image sources (wallpaper and glass) together, in one step. Preload the other mode's two images when the page opens, so the switch shows no blank frame.
- **Clock glass:** the same structure as the dock's glass (`.mat` + `.mat-img`, clipped, offset to line up with the wallpaper), around the existing `.clock` and `.date`. In the mockup it was placed at left 112 px, top 72 px, 560×200 px, radius 48 px, with 24/32 px padding; it should grow to fit a longer date.
- **Colours:** day mode uses the existing `.theme-light` set, night mode `.theme-dark`. The light set's glass tint may need tuning on the TV.
- **Config:** `HOME_WALLPAPER` goes away. `config.js` gets the location instead, for example `var HOME_LOCATION = { name: 'Warsaw', lat: 52.23, lon: 21.01 };`.

## Left to the builder

- The exact JPEG export (center crop vs a crop that keeps Morphogenesis's main shapes in frame), the blur radius and tint of the `-dock` images (match the current dock glass look), and JPEG quality within the app's size budget.
- What happens when the location is missing or the date is unusable: fall back to fixed times, for example day 07:00–19:00.
- Whether All apps' dark sheet (`--sheet`) needs its own day value. It has one already (`.theme-light`); check on the TV.
- Where the sun function lives (`home/main.js` or its own file) and its tests.
- Docs: `status.md` (move the time-of-day theme to done), `tv-notes.md` for anything learned on the TV, and the README credits.

## Decisions from the builder check

A reviewer read this cold and raised seven points. All are Claude's calls; Michał can overrule any of them.

1. **The clock glass shows only on Home.** In All apps, the dimmed sheet already sits behind the clock and keeps it readable. A bright glass patch inside the dimmed screen would look wrong. Loading and error states on Home get the glass like the normal Home.
2. **The images come from a repeatable script.** A PowerShell script in `scripts/` renders the two SVGs in the existing Docker toolchain, or any rasteriser available there (e.g. `rsvg-convert`/ImageMagick), into 1920×1080 JPEGs and makes the blurred, tinted `-dock` versions. Retuning the day tint on the TV is then one rerun, not hand work.
   - The night glass matches today's dock look. The day glass gets a light tint that's tuned on the TV.
   - Size budget: up to ~600 KB per wallpaper and ~120 KB per glass image, about what the current photos use (475 KB and 82 KB).
3. **TV icons without a bundled logo follow the text colour:** white at night, dark by day (in the light set, `invert(1)` is dropped).
4. **Readability:** if day contrast fails on the TV, tune the glass tint first. A subtle light text shadow in the light set is allowed if the tint alone isn't enough.
5. **An unsynced clock** (a year before 2026, as the TV may have just after boot) counts as an unusable date and uses the fixed fallback times (day 07:00–19:00) until the clock is right. The mode check runs every minute, so it corrects itself once the clock syncs.
6. **The mode is set before the first paint,** so a daytime start doesn't flash the night theme. `index.html` no longer hard-codes `theme-dark`; the script sets the class before `render()`.
7. **The sun calculation lives in `home/main.js`,** next to the other pure functions it already exports for tests. That way there's no new file to package.
