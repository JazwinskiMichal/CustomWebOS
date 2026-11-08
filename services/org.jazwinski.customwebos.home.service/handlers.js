// Method handlers for the CustomWebOS home service. ES5 only (Node 0.12 on
// the TV). Kept free of webos-service so the logic is testable in plain Node:
// service.js injects call(uri, params, callback), which wraps service.call.

var APP_MANAGER = 'luna://com.webos.applicationManager';
var PERF_FILE = '/tmp/customwebos-perf.json';

// USB sticks mount below this on webOS (e.g. /tmp/usb/sda/sda1). The home
// app can't read it with file:// (sandbox), so the no-signal hook links
// <app dir>/usb to it and the app loads "usb/<path below USB_ROOT>".
var USB_ROOT = '/tmp/usb';
// The no-signal watcher mounts the NAS share here for a show (NFS v3,
// read-only) and links <app dir>/nas to it; empty when not mounted.
var NAS_ROOT = '/tmp/customwebos-nas';
var MAX_PHOTOS = 2000;
// ponytail: a byte cap stands in for a pixel cap (the TV's browser decodes an
// <img> at full size); read the JPEG/PNG header if big-but-small files bite.
var MAX_PHOTO_BYTES = 20 * 1024 * 1024;
// The no-signal watcher's state (scripts/nosignal.sh).
var NOSIGNAL_DIR = '/tmp/nosignal';
var PHOTO_EXT = /\.(jpe?g|png)$/i;
// The TV's browser (Chrome 53) ignores EXIF orientation, so the app turns
// photos itself. The tag sits in the Exif segment near the file's start; a
// segment is at most 64 KB.
var PHOTO_HEAD_BYTES = 64 * 1024;
// The doorbell box's settings (scripts/doorbell.ps1 -Configure writes them):
// {cameraUrl, cameraMode: "mjpeg"|"snapshot", doorUrl?}. Outside the app's
// folder so installs keep it.
var DOORBELL_FILE = '/var/lib/customwebos/doorbell.json';
var DOOR_TIMEOUT_MS = 5000;

// POSTs an empty body; cb(err, statusCode). The page can't do this itself: a
// webhook won't send CORS headers to the TV's browser.
// A wall-clock limit, not req.setTimeout: that one is an idle timeout, and in
// Node 0.12 it isn't armed until the socket connects, so a dropped connect or
// a server trickling bytes would hang for minutes.
function postEmpty(url, cb, timeoutMs) {
    var done = false;
    var req = null;
    var timer = setTimeout(function () {
        if (req) req.abort();
        finish(new Error('no answer within 5 s'));
    }, timeoutMs || DOOR_TIMEOUT_MS);
    function finish(err, status) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        cb(err, status);
    }
    try {
        var opts = require('url').parse(url);
        opts.method = 'POST';
        opts.headers = { 'Content-Length': 0 };
        req = require(opts.protocol === 'https:' ? 'https' : 'http').request(opts, function (res) {
            res.resume();
            finish(null, res.statusCode);
        });
        req.on('error', function (err) { finish(err); });
        req.end();
    } catch (e) {
        finish(e);
    }
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

// The EXIF orientation (1-8) in a JPEG's head; 1 when there is none, the
// file isn't a JPEG, or the head is cut off or malformed.
function jpegOrientation(buf) {
    try {
        if (buf[0] !== 0xff || buf[1] !== 0xd8) return 1;
        var p = 2;
        while (p + 4 <= buf.length && buf[p] === 0xff) {
            var marker = buf[p + 1];
            if (marker === 0xda || marker === 0xd9) return 1; // image data: no EXIF before it
            var len = buf.readUInt16BE(p + 2);
            // APP1 starting "Exif\0\0" (XMP is APP1 too, with another header)
            if (marker === 0xe1 && buf.toString('binary', p + 4, p + 10) === 'Exif\0\0') {
                var t = p + 10;
                var le = buf.toString('binary', t, t + 2) === 'II';
                var u16 = function (o) { return le ? buf.readUInt16LE(t + o) : buf.readUInt16BE(t + o); };
                var u32 = function (o) { return le ? buf.readUInt32LE(t + o) : buf.readUInt32BE(t + o); };
                var ifd = u32(4);
                var count = u16(ifd);
                for (var i = 0; i < count; i++) {
                    var entry = ifd + 2 + 12 * i;
                    if (u16(entry) === 0x0112) {
                        var o = u16(entry + 8);
                        return o >= 1 && o <= 8 ? o : 1;
                    }
                }
                return 1;
            }
            p += 2 + len;
        }
    } catch (e) { /* cut off mid-segment */ }
    return 1;
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

    // The photos for the no-signal slideshow: the NAS share's if it has any,
    // else all USB sticks'; never mixed; [] if none.
    function listPhotos(message) {
        var fsLike = opts.fs || require('fs');
        var prefix = 'nas/';
        var files = photoFiles(walkTree(fsLike, opts.nasRoot || NAS_ROOT, 8, MAX_PHOTO_BYTES));
        if (!files.length) {
            prefix = 'usb/';
            files = photoFiles(walkTree(fsLike, opts.usbRoot || USB_ROOT, 8, MAX_PHOTO_BYTES));
        }
        var photos = [];
        for (var i = 0; i < files.length; i++) photos.push(prefix + files[i]);
        message.respond({ returnValue: true, photos: photos });
    }

    // A slideshow photo's EXIF orientation, from the first 64 KB of the
    // file; path is one of listPhotos' "nas/…" or "usb/…" paths. 1 if
    // unreadable.
    function photoOrientation(message) {
        var p = message.payload && message.payload.path;
        var root = null;
        if (typeof p === 'string' && !/(^|\/)\.\.(\/|$)/.test(p)) {
            if (p.indexOf('nas/') === 0) root = opts.nasRoot || NAS_ROOT;
            else if (p.indexOf('usb/') === 0) root = opts.usbRoot || USB_ROOT;
        }
        if (!root) {
            message.respond({ returnValue: false, errorText: 'path must be a nas/ or usb/ photo' });
            return;
        }
        var fsLike = opts.fs || require('fs');
        var orientation = 1;
        var fd = null;
        try {
            fd = fsLike.openSync(root + p.slice(3), 'r');
            var buf = Buffer.alloc ? Buffer.alloc(PHOTO_HEAD_BYTES) : new Buffer(PHOTO_HEAD_BYTES);
            var n = fsLike.readSync(fd, buf, 0, PHOTO_HEAD_BYTES, 0);
            orientation = jpegOrientation(buf.slice(0, n));
        } catch (e) { /* missing or unreadable: shown as stored */ }
        if (fd !== null) {
            try { fsLike.closeSync(fd); } catch (e) { /* already gone */ }
        }
        message.respond({ returnValue: true, orientation: orientation });
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
        if (!/^https?:\/\//.test(url)) {
            message.respond({ returnValue: false, errorText: 'doorUrl must start with http:// or https://' });
            return;
        }
        (opts.request || postEmpty)(url, function (err, status) {
            if (err) message.respond({ returnValue: false, errorText: err.message });
            else if (status >= 200 && status < 300) message.respond({ returnValue: true, simulated: false });
            else message.respond({ returnValue: false, errorText: 'HTTP ' + status });
        }, opts.doorTimeoutMs);
    }

    return {
        listApps: listApps, launch: launch, perfReport: perfReport, listPhotos: listPhotos, photoOrientation: photoOrientation,
        showEnded: showEnded, doorbellConfig: doorbellConfig, openDoor: openDoor
    };
}

module.exports = {
    APP_MANAGER: APP_MANAGER,
    PERF_FILE: PERF_FILE,
    USB_ROOT: USB_ROOT,
    NAS_ROOT: NAS_ROOT,
    MAX_PHOTO_BYTES: MAX_PHOTO_BYTES,
    DOORBELL_FILE: DOORBELL_FILE,
    photoFiles: photoFiles,
    jpegOrientation: jpegOrientation,
    walkTree: walkTree,
    createHandlers: createHandlers
};
