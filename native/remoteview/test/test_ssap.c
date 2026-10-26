#undef NDEBUG
#include <assert.h>
#include <string.h>
#include "../src/ssap.h"

#define RESP "{\"type\":\"response\",\"id\":\"ptr\",\"payload\":{\"socketPath\":\"ws://192.168.88.244:3000/resources/da557d6155080484091c2520f5f5d24037ea8004/netinput.pointer.sock\",\"returnValue\":true}}"
#define PATH "/resources/da557d6155080484091c2520f5f5d24037ea8004/netinput.pointer.sock"

int main(void)
{
    char m[8192], v[256];

    assert(ssap_register_msg(m, sizeof m, "abc") > 0);
    assert(strstr(m, "\"type\":\"register\""));
    assert(strstr(m, "\"client-key\":\"abc\""));
    assert(strstr(m, "\"pairingType\":\"PROMPT\""));
    assert(ssap_register_msg(m, sizeof m, NULL) > 0);
    assert(strstr(m, "\"type\":\"register\""));
    assert(!strstr(m, "client-key"));
    assert(ssap_register_msg(m, 20, NULL) == -1);

    assert(ssap_request_msg(m, sizeof m, "i1", "ssap://x/y", NULL) > 0);
    assert(strstr(m, "\"uri\":\"ssap://x/y\""));
    assert(strstr(m, "\"id\":\"i1\""));
    assert(!strstr(m, "payload"));
    assert(ssap_request_msg(m, sizeof m, "i1", "ssap://x/y", "{\"a\":1}") > 0);
    assert(strstr(m, "\"payload\":{\"a\":1}"));

    assert(ssap_find_string(RESP, "socketPath", v, sizeof v) == 1);
    assert(strncmp(v, "ws://192.168.88.244:3000/", 25) == 0);
    assert(ssap_find_string(RESP, "nope", v, sizeof v) == 0);
    assert(ssap_find_string(RESP, "socketPath", v, 5) == 0);

    ssap_find_string(RESP, "socketPath", v, sizeof v);
    {
        char p[128];
        assert(ssap_url_path(v, p, sizeof p) == 1);
        assert(strcmp(p, PATH) == 0);
        assert(ssap_url_path("garbage", p, sizeof p) == 0);
    }
    return 0;
}
