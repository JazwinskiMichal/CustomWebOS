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
var PHOTO_EXT = /\.(jpe?g|png)$/i;

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
// deep; [] if root is missing or unreadable. fsLike is Node's fs (injected
// for tests). Symlinks aren't followed, so a loop on a stick can't hang it.
function walkTree(fsLike, root, maxDepth) {
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
            } else if (st.isFile()) {
                out.push(relPath);
            }
        }
    }
    walk(root, '', 0);
    return out;
}

// writeFile(path, text, callback(err)) is injected too (fs.writeFile on the
// TV) so perfReport is testable without touching the disk; opts.fs and
// opts.usbRoot let tests point listPhotos at a temporary folder.
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
        var files = photoFiles(walkTree(opts.fs || require('fs'), opts.usbRoot || USB_ROOT, 8));
        var photos = [];
        for (var i = 0; i < files.length; i++) photos.push('usb/' + files[i]);
        message.respond({ returnValue: true, photos: photos });
    }

    return { listApps: listApps, launch: launch, perfReport: perfReport, listPhotos: listPhotos };
}

module.exports = {
    APP_MANAGER: APP_MANAGER,
    PERF_FILE: PERF_FILE,
    USB_ROOT: USB_ROOT,
    photoFiles: photoFiles,
    walkTree: walkTree,
    createHandlers: createHandlers
};
