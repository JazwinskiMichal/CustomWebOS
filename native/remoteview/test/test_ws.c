#undef NDEBUG
#include <assert.h>
#include <stdint.h>
#include <string.h>
#include "../src/ws.h"

int main(void)
{
    static const uint8_t mask[4] = { 1, 2, 3, 4 };
    uint8_t out[512], big[300];
    char req[512];
    int n, op;
    size_t off, plen, i;

    n = ws_frame_text("hello", 5, mask, out, sizeof out);
    assert(n == 11);
    assert(out[0] == 0x81 && out[1] == 0x85);
    assert(memcmp(out + 2, mask, 4) == 0);
    for (i = 0; i < 5; i++)
        assert(out[6 + i] == (uint8_t)("hello"[i] ^ mask[i % 4]));
    assert(ws_frame_text("hello", 5, mask, out, 10) == -1);

    memset(big, 'x', sizeof big);
    n = ws_frame_text((char *)big, 200, mask, out, sizeof out);
    assert(n == 4 + 4 + 200);
    assert(out[0] == 0x81 && out[1] == (0x80 | 126) && out[2] == 0 && out[3] == 200);

    {
        static const uint8_t srv[] = { 0x81, 0x03, 'a', 'b', 'c' };
        assert(ws_parse(srv, 5, &op, &off, &plen) == 5);
        assert(op == 1 && off == 2 && plen == 3);
        assert(ws_parse(srv, 4, &op, &off, &plen) == 0);
        assert(ws_parse(srv, 1, &op, &off, &plen) == 0);
    }
    {
        static const uint8_t bad[] = { 0x81, 0x83, 1, 2, 3, 4, 0, 0, 0 };
        assert(ws_parse(bad, sizeof bad, &op, &off, &plen) == -1);
    }

    n = ws_handshake_request(req, sizeof req, "127.0.0.1", 3000, "/path", "dGhlIHNhbXBsZQ==");
    assert(n > 0);
    assert(strstr(req, "GET /path HTTP/1.1"));
    assert(strstr(req, "Upgrade: websocket"));
    assert(strstr(req, "Sec-WebSocket-Key: dGhlIHNhbXBsZQ=="));
    assert(strstr(req, "Sec-WebSocket-Version: 13"));
    assert(strstr(req, "\r\n\r\n"));
    assert(ws_handshake_request(req, 10, "h", 1, "/", "k") == -1);
    return 0;
}
