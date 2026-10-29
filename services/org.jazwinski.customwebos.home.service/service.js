// CustomWebOS home service — privileged luna proxy.
// Runs under Node 0.12 on the TV. ES5 only.
//
// Methods exposed:
//   luna://org.jazwinski.customwebos.home.service/listApps
//     -> {returnValue: true, apps: Array<launchPoint> (id, title, icon, etc.)}
//   luna://org.jazwinski.customwebos.home.service/launch
//     payload: {id: string}
//     -> whatever applicationManager/launch returned
//   luna://org.jazwinski.customwebos.home.service/perfReport
//     payload: {report: object}  (the home app's perf mode)
//     -> writes /tmp/customwebos-perf.json, {returnValue: true}
//   luna://org.jazwinski.customwebos.home.service/listPhotos
//     -> {returnValue: true, photos: ["usb/sda/sda1/E1.jpg", ...]} (USB sticks)
//   luna://org.jazwinski.customwebos.home.service/showEnded
//     -> {returnValue: true}; tells the no-signal watcher Home ended its show
//   luna://org.jazwinski.customwebos.home.service/doorbellConfig
//     -> {returnValue: true, config: {cameraUrl?, cameraMode?, doorUrl?}}
//   luna://org.jazwinski.customwebos.home.service/openDoor
//     -> {returnValue: true, simulated: bool} or {returnValue: false, errorText}
//
// The webapp (org.jazwinski.customwebos.home) runs unprivileged and cannot
// talk to com.webos.applicationManager directly (LSCallFromApplication is
// gated to privileged apps on consumer webOS 4.4). This service bridges
// that gap: it's elevated post-install via Hbchannel's elevateService, and
// from its privileged context the internal luna calls succeed.

var pkg = require('./package.json');
var Service = require('webos-service');
var service = new Service(pkg.name);

// webos-service exits via process.exit(0) when its ActivityManager fires
// an idle timeout. Turn that off: the hub still owns our lifetime via its
// dynamic-service dispatch, we don't need to self-exit on quiet.
service.activityManager.exitOnTimeout = false;

var fs = require('fs');
var handlers = require('./handlers.js').createHandlers(function (uri, params, callback) {
    service.call(uri, params, callback);
}, fs.writeFile);

service.register('listApps', handlers.listApps);
service.register('launch', handlers.launch);
service.register('perfReport', handlers.perfReport);
service.register('listPhotos', handlers.listPhotos);
service.register('showEnded', handlers.showEnded);
service.register('doorbellConfig', handlers.doorbellConfig);
service.register('openDoor', handlers.openDoor);
