// Method handlers for the CustomWebOS home service. ES5 only (Node 0.12 on
// the TV). Kept free of webos-service so the logic is testable in plain Node:
// service.js injects call(uri, params, callback), which wraps service.call.

var APP_MANAGER = 'luna://com.webos.applicationManager';

function createHandlers(call) {
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

    return { listApps: listApps, launch: launch };
}

module.exports = {
    APP_MANAGER: APP_MANAGER,
    createHandlers: createHandlers
};
