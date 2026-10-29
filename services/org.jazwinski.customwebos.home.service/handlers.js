// Method handlers for the CustomWebOS home service. ES5 only (Node 0.12 on
// the TV). Kept free of webos-service so the logic is testable in plain Node:
// service.js injects call(uri, params, callback), which wraps service.call.

var APP_MANAGER = 'luna://com.webos.applicationManager';
var PERF_FILE = '/tmp/customwebos-perf.json';

// USB sticks mount below this on webOS (e.g. /tmp/usb/sda/sda1). The home
// app can't read it with file:// (sandbox), so the no-signal hook links
// <app dir>/usb to it and the app loads "usb/<path below USB_ROOT>".
var USB_ROOT = '/tmp/usb';
var MAX_PHOTOS = 2000;
// ponytail: a byte cap stands in for a pixel cap (the TV's browser decodes an
// <img> at full size); read the JPEG/PNG header if big-but-small files bite.
var MAX_PHOTO_BYTES = 20 * 1024 * 1024;
// The no-signal watcher's state (scripts/nosignal.sh).
var NOSIGNAL_DIR = '/tmp/nosignal';
var PHOTO_EXT = /\.(jpe?g|png)$/i;
// The doorbell box's settings (scripts/doorbell.ps1 -Configure writes them):
// {cameraUrl, cameraMode: "mjpeg"|"snapshot", doorUrl?}. Outside the app's
// folder so installs keep it.
var DOORBELL_FILE = '/var/lib/customwebos/doorbell.json';
var DOOR_TIMEOUT_MS = 5000;

// POSTs an empty body; cb(err, statusCode). The page can't do this itself: a
// webhook won't send CORS headers to the TV's browser.
function postEmpty(url, cb) {
    var done = false;
    function finish(err, status) { if (!done) { done = true; cb(err, status); } }
    var opts;
    try { opts = require('url').parse(url); } catch (e) { finish(e); return; }
    opts.method = 'POST';
    opts.headers = { 'Content-Length': 0 };
    var req = require(opts.protocol === 'https:' ? 'https' : 'http').request(opts, function (res) {
        res.resume();
        finish(null, res.statusCode);
    });
    req.setTimeout(DOOR_TIMEOUT_MS, function () { req.abort(); finish(new Error('timeout')); });
    req.on('error', function (err) { finish(err); });
    req.end();
}

// The photos among relative paths: JPEG/PNG, nothing hidden (a "."-prefixed
// file or folder anywhere in the path), sorted, at most MAX_PHOTOS.
function photoFiles(paths) {
    var out = [];
    for (var i = 0; i < paths.length; i++) {
        var p = paths[i];
        if (PHOTO_EXT.test(p) && !/(^|\/)\./.test(p)) out.push(p);
    }
    out.sort();
    return out.slice(0, MAX_PHOTOS);
}

// Every file below root, as paths relative to it, at most maxDepth folders
// deep and, if maxBytes is given, at most that big; [] if root is missing or
// unreadable. fsLike is Node's fs (injected for tests). Symlinks aren't
// followed, so a loop on a stick can't hang it.
function walkTree(fsLike, root, maxDepth, maxBytes) {
    var out = [];
    function walk(dir, rel, depth) {
        var names;
        try { names = fsLike.readdirSync(dir); } catch (e) { return; }
        for (var i = 0; i < names.length; i++) {
            var full = dir + '/' + names[i];
            var relPath = rel ? rel + '/' + names[i] : names[i];
            var st;
            try { st = fsLike.lstatSync(full); } catch (e) { continue; }
            if (st.isDirectory()) {
                if (depth < maxDepth) walk(full, relPath, depth + 1);
            } else if (st.isFile() && !(maxBytes && st.size > maxBytes)) {
                out.push(relPath);
            }
        }
    }
    walk(root, '', 0);
    return out;
}

// writeFile(path, text, callback(err)) is injected too (fs.writeFile on the
// TV) so perfReport is testable without touching the disk; opts.fs and
// opts.usbRoot let tests point listPhotos at a temporary folder, and
// opts.nosignalDir showEnded.
function createHandlers(call, writeFile, opts) {
    opts = opts || {};
    function listApps(message) {
        call(APP_MANAGER + '/listLaunchPoints', {}, function (response) {
            var payload = response && response.payload;
            if (payload && payload.returnValue === true) {
                message.respond({
                    returnValue: true,
                    apps: payload.launchPoints || []
                });
            } else {
                message.respond({
                    returnValue: false,
                    errorText: (payload && payload.errorText) || 'listLaunchPoints failed'
                });
            }
        });
    }

    function launch(message) {
        var id = message.payload && message.payload.id;
        if (!id || typeof id !== 'string') {
            message.respond({ returnValue: false, errorText: 'id required' });
            return;
        }
        var params = { id: id };
        if (message.payload.params) params.params = message.payload.params;
        call(APP_MANAGER + '/launch', params, function (response) {
            message.respond((response && response.payload) || { returnValue: false, errorText: 'empty response' });
        });
    }

    // The home app's perf mode (scripts/perf.ps1) reports its timings here;
    // the script reads the file back over SSH.
    function perfReport(message) {
        var report = message.payload && message.payload.report;
        if (!report || typeof report !== 'object') {
            message.respond({ returnValue: false, errorText: 'report required' });
            return;
        }
        writeFile(PERF_FILE, JSON.stringify(report), function (err) {
            message.respond(err ? { returnValue: false, errorText: err.message } : { returnValue: true });
        });
    }

    // The photos on all USB sticks, for the no-signal slideshow; [] if none.
    function listPhotos(message) {
        var files = photoFiles(walkTree(opts.fs || require('fs'), opts.usbRoot || USB_ROOT, 8, MAX_PHOTO_BYTES));
        var photos = [];
        for (var i = 0; i < files.length; i++) photos.push('usb/' + files[i]);
        message.respond({ returnValue: true, photos: photos });
    }

    // Home ended a slideshow while CustomWebOS stays in front: the watcher
    // can't see that, so the app tells it here. Without its cover files it
    // drops the 15-min power-off and won't relaunch the input over Home.
    function showEnded(message) {
        var fsLike = opts.fs || require('fs');
        var dir = opts.nosignalDir || NOSIGNAL_DIR;
        var names = ['covering', 'cover-id'];
        for (var i = 0; i < names.length; i++) {
            try { fsLike.unlinkSync(dir + '/' + names[i]); } catch (e) { /* not covering */ }
        }
        message.respond({ returnValue: true });
    }

    function readDoorbell() {
        try {
            var config = JSON.parse((opts.fs || require('fs')).readFileSync(opts.doorbellFile || DOORBELL_FILE, 'utf8'));
            return config && typeof config === 'object' ? config : {};
        } catch (e) {
            return {};
        }
    }

    // {} until doorbell.ps1 -Configure has written the file; the box says so.
    function doorbellConfig(message) {
        message.respond({ returnValue: true, config: readDoorbell() });
    }

    // Always the file's doorUrl, never one from the caller: nothing that can
    // launch the box can point the door request elsewhere.
    function openDoor(message) {
        var url = readDoorbell().doorUrl;
        if (!url) {
            message.respond({ returnValue: true, simulated: true });
            return;
        }
        (opts.request || postEmpty)(url, function (err, status) {
            if (err) message.respond({ returnValue: false, errorText: err.message });
            else if (status >= 200 && status < 300) message.respond({ returnValue: true, simulated: false });
            else message.respond({ returnValue: false, errorText: 'HTTP ' + status });
        });
    }

    return {
        listApps: listApps, launch: launch, perfReport: perfReport, listPhotos: listPhotos, showEnded: showEnded,
        doorbellConfig: doorbellConfig, openDoor: openDoor
    };
}

module.exports = {
    APP_MANAGER: APP_MANAGER,
    PERF_FILE: PERF_FILE,
    USB_ROOT: USB_ROOT,
    MAX_PHOTO_BYTES: MAX_PHOTO_BYTES,
    DOORBELL_FILE: DOORBELL_FILE,
    photoFiles: photoFiles,
    walkTree: walkTree,
    createHandlers: createHandlers
};
