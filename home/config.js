// CustomWebOS Home — the apps on the Home view, in order. Edit this file to
// change them (there's deliberately no on-device editor). Ids come from the
// TV's launch points; anything not installed is skipped. At most 9.
// Where the TV is: Home switches to its night look at sunset and back at
// sunrise, computed on the TV from these coordinates (no internet needed).
var HOME_LOCATION = { name: 'Warsaw', lat: 52.23, lon: 21.01 };

var HOME_APPS = [
  { id: 'com.webos.app.livetv',                  title: 'Live TV' },
  { id: 'netflix',                               title: 'Netflix' },
  { id: 'youtube.leanback.v4',                   title: 'YouTube' },
  { id: 'com.webos.app.hdmi1',                   title: 'PS5' },
  { id: 'com.appgeneration.app.radiobymytuner',  title: 'Radio' }
];
