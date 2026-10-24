// CustomWebOS home service — privileged luna proxy.
// Runs under Node 0.12 on the TV. ES5 only.
//
// Methods exposed:
//   luna://org.jazwinski.customwebos.home.service/listApps
//     -> {returnValue: true, apps: Array<{id, title, ...launchPoint fields}>}
//   luna://org.jazwinski.customwebos.home.service/launch
//     payload: {id: string}
//     -> whatever applicationManager/launch returned
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

var APP_MANAGER = 'luna://com.webos.applicationManager';

function proxyRespond(message, response) {
    message.respond(response.payload || { returnValue: false, errorText: 'empty response' });
}

service.register('listApps', function (message) {
    service.call(APP_MANAGER + '/listLaunchPoints', {}, function (response) {
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
});

service.register('launch', function (message) {
    var id = message.payload && message.payload.id;
    if (!id) {
        message.respond({ returnValue: false, errorText: 'id required' });
        return;
    }
    var params = { id: id };
    if (message.payload.params) params.params = message.payload.params;
    service.call(APP_MANAGER + '/launch', params, function (response) {
        proxyRespond(message, response);
    });
});
