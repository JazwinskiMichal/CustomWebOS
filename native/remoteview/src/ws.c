#include "ws.h"

#include <stdio.h>

static int frame(int opcode, const uint8_t *payload, size_t len, const uint8_t mask[4],
                 uint8_t *out, size_t outsz)
{
    size_t hdr, i;

    hdr = len < 126 ? 2 : len < 65536 ? 4 : 10;
    if (outsz < hdr + 4 + len)
        return -1;
    out[0] = (uint8_t)(0x80 | opcode);
    if (len < 126) {
        out[1] = (uint8_t)(0x80 | len);
    } else if (len < 65536) {
        out[1] = 0x80 | 126;
        out[2] = (uint8_t)(len >> 8);
        out[3] = (uint8_t)len;
    } else {
        out[1] = 0x80 | 127;
        for (i = 0; i < 8; i++)
            out[2 + i] = (uint8_t)((uint64_t)len >> (56 - 8 * i));
    }
    for (i = 0; i < 4; i++)
        out[hdr + i] = mask[i];
    for (i = 0; i < len; i++)
        out[hdr + 4 + i] = payload[i] ^ mask[i % 4];
    return (int)(hdr + 4 + len);
}

int ws_frame_text(const char *payload, size_t len, const uint8_t mask[4],
                  uint8_t *out, size_t outsz)
{
    return frame(1, (const uint8_t *)payload, len, mask, out, outsz);
}

int ws_frame_pong(const uint8_t *payload, size_t len, const uint8_t mask[4],
                  uint8_t *out, size_t outsz)
{
    return frame(10, payload, len, mask, out, outsz);
}

int ws_parse(const uint8_t *buf, size_t len, int *opcode, size_t *off, size_t *plen)
{
    size_t hdr = 2, n, i;

    if (len < 2)
        return 0;
    if (buf[1] & 0x80)
        return -1;
    n = buf[1] & 0x7f;
    if (n == 126) {
        if (len < 4)
            return 0;
        n = ((size_t)buf[2] << 8) | buf[3];
        hdr = 4;
    } else if (n == 127) {
        if (len < 10)
            return 0;
        if (buf[2] || buf[3] || buf[4] || buf[5] || buf[6] > 0)
            return -1; /* >= 16 MiB: never from the TV */
        n = 0;
        for (i = 2; i < 10; i++)
            n = (n << 8) | buf[i];
        hdr = 10;
    }
    if (len < hdr + n)
        return 0;
    *opcode = buf[0] & 0x0f;
    *off = hdr;
    *plen = n;
    return (int)(hdr + n);
}

int ws_handshake_request(char *out, size_t n, const char *host, int port,
                         const char *path, const char *key_b64)
{
    int w = snprintf(out, n,
                     "GET %s HTTP/1.1\r\n"
                     "Host: %s:%d\r\n"
                     "Upgrade: websocket\r\n"
                     "Connection: Upgrade\r\n"
                     "Sec-WebSocket-Key: %s\r\n"
                     "Sec-WebSocket-Version: 13\r\n"
                     "\r\n",
                     path, host, port, key_b64);
    return (w < 0 || (size_t)w >= n) ? -1 : w;
}
