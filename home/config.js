// CustomWebOS Home — the apps on the Home view, in order. Edit this file to
// change them (there's deliberately no on-device editor). Ids come from the
// TV's launch points; anything not installed is skipped. At most 9.
// Background photo: a name from assets/wallpapers/ (<name>.jpg plus its
// pre-blurred <name>-dock.jpg for the glass dock; record new photos in
// assets/wallpapers/SOURCES.json).
var HOME_WALLPAPER = 'alpine';

var HOME_APPS = [
  { id: 'netflix',                 title: 'Netflix' },
  { id: 'youtube.leanback.v4',     title: 'YouTube' },
  { id: 'amazon',                  title: 'Prime Video' },
  { id: 'com.wbd.stream',          title: 'Max' },
  { id: 'canalplus',               title: 'Canal+' },
  { id: 'com.apple.appletv',       title: 'Apple TV' },
  { id: 'com.webos.app.livetv',    title: 'Live TV' },
  { id: 'com.webos.app.hdmi1',     title: 'HDMI 1' },
  { id: 'org.webosbrew.hbchannel', title: 'Homebrew Channel' }
];
