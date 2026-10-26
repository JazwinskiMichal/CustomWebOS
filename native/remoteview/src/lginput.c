#define _GNU_SOURCE
#include "lginput.h"

#include <arpa/inet.h>
#include <errno.h>
#include <fcntl.h>
#include <netinet/in.h>
#include <stdarg.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/time.h>
#include <syslog.h>
#include <time.h>
#include <unistd.h>

#include "ssap.h"
#include "ws.h"

#define TV_HOST "127.0.0.1"
#define TV_PORT 3000
#define IO_TIMEOUT_S 5
#define PAIR_TIMEOUT_S 60
#define MSG_MAX 8192

typedef struct {
    int fd;
    uint8_t buf[MSG_MAX + 16];
    size_t len;
} wsconn;

struct lginput {
    wsconn ssap;
    wsconn ptr;
};

static int verbose;
static int log_opened;

void lginput_verbose(int on)
{
    verbose = on;
}

static void fail(const char *fmt, ...)
{
    char msg[200];
    va_list ap;

    va_start(ap, fmt);
    vsnprintf(msg, sizeof msg, fmt, ap);
    va_end(ap);
    if (!log_opened) {
        openlog("remoteview", LOG_PID, LOG_DAEMON);
        log_opened = 1;
    }
    syslog(LOG_ERR, "lginput: %s", msg);
    if (verbose)
        fprintf(stderr, "lginput: %s\n", msg);
}

static void random_bytes(uint8_t *out, size_t n)
{
    int fd = open("/dev/urandom", O_RDONLY);
    size_t got = 0;

    if (fd >= 0) {
        while (got < n) {
            ssize_t r = read(fd, out + got, n - got);
            if (r <= 0)
                break;
            got += (size_t)r;
        }
        close(fd);
    }
    for (; got < n; got++) /* only if urandom is unreadable; masks need no secrecy */
        out[got] = (uint8_t)(rand() >> 4);
}

/* Base64 of 16 bytes into out[25]. */
static void b64_16(const uint8_t in[16], char out[25])
{
    static const char t[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    int i, o = 0;

    for (i = 0; i < 15; i += 3) {
        uint32_t v = ((uint32_t)in[i] << 16) | ((uint32_t)in[i + 1] << 8) | in[i + 2];
        out[o++] = t[v >> 18];
        out[o++] = t[(v >> 12) & 63];
        out[o++] = t[(v >> 6) & 63];
        out[o++] = t[v & 63];
    }
    out[o++] = t[in[15] >> 2];
    out[o++] = t[(in[15] & 3) << 4];
    out[o++] = '=';
    out[o++] = '=';
    out[o] = '\0';
}

static int send_all(int fd, const uint8_t *p, size_t n)
{
    while (n) {
        ssize_t w = send(fd, p, n, MSG_NOSIGNAL);
        if (w < 0 && errno == EINTR)
            continue;
        if (w <= 0)
            return -1;
        p += w;
        n -= (size_t)w;
    }
    return 0;
}

static int ws_send(wsconn *c, const char *text, size_t len)
{
    uint8_t mask[4], frame[MSG_MAX + 16];
    int n;

    random_bytes(mask, 4);
    n = ws_frame_text(text, len, mask, frame, sizeof frame);
    if (n < 0) {
        fail("message too large (%zu bytes)", len);
        return -1;
    }
    if (send_all(c->fd, frame, (size_t)n) < 0) {
        fail("send failed: %s", strerror(errno));
        return -1;
    }
    return 0;
}

/* Answers the ping whose payload sits at c->buf + off. */
static void answer_ping(wsconn *c, size_t off, size_t plen)
{
    uint8_t mask[4], pong[140];
    int n;

    random_bytes(mask, 4);
    n = ws_frame_pong(c->buf + off, plen > 125 ? 125 : plen, mask, pong, sizeof pong);
    if (n > 0)
        send_all(c->fd, pong, (size_t)n);
}

/* Reads the next text frame into out (NUL-terminated), answering pings.
 * Gives up after timeout_s seconds. Returns 0, or -1. */
static int ws_recv(wsconn *c, char *out, size_t outsz, int timeout_s)
{
    time_t deadline = time(NULL) + timeout_s;

    for (;;) {
        int op = 0;
        size_t off = 0, plen = 0;
        int flen = ws_parse(c->buf, c->len, &op, &off, &plen);
        ssize_t r;

        if (flen < 0) {
            fail("invalid frame from TV");
            return -1;
        }
        if (flen > 0) {
            int done = 0;
            if (op == 9) {
                answer_ping(c, off, plen);
            } else if (op == 8) {
                fail("TV closed the connection");
                return -1;
            } else if (op == 1) {
                if (plen >= outsz) {
                    fail("message from TV too large");
                    return -1;
                }
                memcpy(out, c->buf + off, plen);
                out[plen] = '\0';
                done = 1;
            }
            memmove(c->buf, c->buf + flen, c->len - (size_t)flen);
            c->len -= (size_t)flen;
            if (done)
                return 0;
            continue;
        }
        if (c->len == sizeof c->buf) {
            fail("frame from TV too large");
            return -1;
        }
        r = recv(c->fd, c->buf + c->len, sizeof c->buf - c->len, 0);
        if (r > 0) {
            c->len += (size_t)r;
        } else if (r == 0) {
            fail("TV closed the connection");
            return -1;
        } else if (errno == EINTR) {
            continue;
        } else if ((errno == EAGAIN || errno == EWOULDBLOCK) && time(NULL) < deadline) {
            continue;
        } else {
            fail("receive failed: %s", errno == EAGAIN ? "timeout" : strerror(errno));
            return -1;
        }
    }
}

/* TCP connect + WebSocket upgrade. Returns 0, or -1. */
static int ws_connect(wsconn *c, const char *path)
{
    struct sockaddr_in a;
    struct timeval tv;
    uint8_t keyraw[16];
    char key[25], req[512], hdr[1024];
    int n;
    size_t got = 0;

    c->len = 0;
    c->fd = socket(AF_INET, SOCK_STREAM, 0);
    if (c->fd < 0) {
        fail("socket: %s", strerror(errno));
        return -1;
    }
    tv.tv_sec = IO_TIMEOUT_S;
    tv.tv_usec = 0;
    setsockopt(c->fd, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof tv);
    setsockopt(c->fd, SOL_SOCKET, SO_SNDTIMEO, &tv, sizeof tv);
    memset(&a, 0, sizeof a);
    a.sin_family = AF_INET;
    a.sin_port = htons(TV_PORT);
    inet_pton(AF_INET, TV_HOST, &a.sin_addr);
    if (connect(c->fd, (struct sockaddr *)&a, sizeof a) < 0) {
        fail("connect %s:%d: %s", TV_HOST, TV_PORT, strerror(errno));
        goto err;
    }
    random_bytes(keyraw, sizeof keyraw);
    b64_16(keyraw, key);
    n = ws_handshake_request(req, sizeof req, TV_HOST, TV_PORT, path, key);
    if (n < 0 || send_all(c->fd, (uint8_t *)req, (size_t)n) < 0) {
        fail("handshake send failed");
        goto err;
    }
    /* Read byte by byte up to the blank line so no frame data is swallowed. */
    while (got < sizeof hdr - 1) {
        ssize_t r = recv(c->fd, hdr + got, 1, 0);
        if (r <= 0) {
            fail("handshake read failed: %s", r == 0 ? "closed" : strerror(errno));
            goto err;
        }
        got++;
        if (got >= 4 && memcmp(hdr + got - 4, "\r\n\r\n", 4) == 0)
            break;
    }
    hdr[got] = '\0';
    /* Local, trusted endpoint: only the status line is checked. */
    if (strncmp(hdr, "HTTP/1.1 101", 12) != 0) {
        fail("websocket upgrade refused: %.40s", hdr);
        goto err;
    }
    return 0;
err:
    close(c->fd);
    c->fd = -1;
    return -1;
}

/* Reads frames until one contains needle; "error" messages abort. */
static int await(wsconn *c, const char *needle, int timeout_s, char *msg, size_t msgsz)
{
    time_t end = time(NULL) + timeout_s;

    for (;;) {
        int left = (int)(end - time(NULL));
        if (left < 1)
            left = 1;
        if (ws_recv(c, msg, msgsz, left) < 0)
            return -1;
        if (strstr(msg, needle))
            return 0;
        if (strstr(msg, "\"type\":\"error\"")) {
            fail("TV reported an error: %.120s", msg);
            return -1;
        }
        if (time(NULL) >= end) {
            fail("timed out waiting for %s", needle);
            return -1;
        }
    }
}

/* Connects the second-screen socket and registers. key NULL means pairing,
 * which waits up to PAIR_TIMEOUT_S for the user. On success the registered
 * message is left in msg. */
static int register_client(wsconn *c, const char *key, char *msg, size_t msgsz)
{
    char reg[MSG_MAX];
    int n;

    if (ws_connect(c, "/") < 0)
        return -1;
    n = ssap_register_msg(reg, sizeof reg, key);
    if (n < 0 || ws_send(c, reg, (size_t)n) < 0)
        goto err;
    if (await(c, "\"type\":\"registered\"", key ? IO_TIMEOUT_S : PAIR_TIMEOUT_S, msg, msgsz) < 0)
        goto err;
    return 0;
err:
    close(c->fd);
    c->fd = -1;
    return -1;
}

static int read_key(const char *path, char *key, size_t n)
{
    FILE *f = fopen(path, "r");
    size_t len;

    if (!f) {
        fail("cannot read %s (run --pair first): %s", path, strerror(errno));
        return -1;
    }
    len = fread(key, 1, n - 1, f);
    fclose(f);
    while (len && (key[len - 1] == '\n' || key[len - 1] == '\r' || key[len - 1] == ' '))
        len--;
    key[len] = '\0';
    if (!len) {
        fail("%s is empty", path);
        return -1;
    }
    return 0;
}

lginput *lginput_open(const char *key_path)
{
    lginput *l;
    char key[128], msg[MSG_MAX], url[256], path[256], req[512];
    int n;

    if (read_key(key_path, key, sizeof key) < 0)
        return NULL;
    l = calloc(1, sizeof *l);
    if (!l)
        return NULL;
    l->ssap.fd = l->ptr.fd = -1;
    if (register_client(&l->ssap, key, msg, sizeof msg) < 0)
        goto err;
    n = ssap_request_msg(req, sizeof req, "ptr",
                         "ssap://com.webos.service.networkinput/getPointerInputSocket", NULL);
    if (n < 0 || ws_send(&l->ssap, req, (size_t)n) < 0)
        goto err;
    if (await(&l->ssap, "socketPath", IO_TIMEOUT_S, msg, sizeof msg) < 0)
        goto err;
    if (!ssap_find_string(msg, "socketPath", url, sizeof url) ||
        !ssap_url_path(url, path, sizeof path)) {
        fail("no usable socketPath in: %.120s", msg);
        goto err;
    }
    if (ws_connect(&l->ptr, path) < 0)
        goto err;
    return l;
err:
    lginput_close(l);
    return NULL;
}

int lginput_pointer(lginput *l, const char *msgs, size_t len)
{
    size_t i = 0;

    while (i < len) {
        const char *end = memmem(msgs + i, len - i, "\n\n", 2);
        size_t mlen = end ? (size_t)(end - (msgs + i)) + 2 : len - i;
        if (ws_send(&l->ptr, msgs + i, mlen) < 0)
            return -1;
        i += mlen;
    }
    return 0;
}

int lginput_button(lginput *l, const char *name)
{
    char m[64];
    int n = snprintf(m, sizeof m, "type:button\nname:%s\n\n", name);

    if (n < 0 || (size_t)n >= sizeof m)
        return -1;
    return lginput_pointer(l, m, (size_t)n);
}

int lginput_text(lginput *l, const char *text)
{
    char payload[1024], req[1280], msg[MSG_MAX];
    size_t o = 0;
    const char *p;
    int n;

    o += (size_t)snprintf(payload, sizeof payload, "{\"text\":\"");
    for (p = text; *p; p++) {
        if (o + 4 >= sizeof payload) {
            fail("text too long");
            return -1;
        }
        if (*p == '"' || *p == '\\')
            payload[o++] = '\\';
        payload[o++] = *p;
    }
    snprintf(payload + o, sizeof payload - o, "\",\"replace\":false}");
    n = ssap_request_msg(req, sizeof req, "txt", "ssap://com.webos.service.ime/insertText", payload);
    if (n < 0 || ws_send(&l->ssap, req, (size_t)n) < 0)
        return -1;
    return await(&l->ssap, "\"id\":\"txt\"", IO_TIMEOUT_S, msg, sizeof msg);
}

int lginput_launch(lginput *l, const char *app_id)
{
    char payload[256], req[512], msg[MSG_MAX];
    int n;

    /* App ids are [a-z0-9.]; no JSON escaping needed. */
    snprintf(payload, sizeof payload, "{\"id\":\"%s\"}", app_id);
    n = ssap_request_msg(req, sizeof req, "launch", "ssap://system.launcher/launch", payload);
    if (n < 0 || ws_send(&l->ssap, req, (size_t)n) < 0)
        return -1;
    return await(&l->ssap, "\"id\":\"launch\"", IO_TIMEOUT_S, msg, sizeof msg);
}

/* Reads whatever is available on c without blocking, answers pings and drops
 * the rest. Returns 0, or -1 if the socket closed or sent garbage. */
static int conn_poll(wsconn *c)
{
    for (;;) {
        int flen, op;
        size_t off, plen;
        ssize_t r;

        while ((flen = ws_parse(c->buf, c->len, &op, &off, &plen)) > 0) {
            if (op == 9)
                answer_ping(c, off, plen);
            else if (op == 8)
                return -1;
            memmove(c->buf, c->buf + flen, c->len - (size_t)flen);
            c->len -= (size_t)flen;
        }
        if (flen < 0 || c->len == sizeof c->buf)
            return -1;
        r = recv(c->fd, c->buf + c->len, sizeof c->buf - c->len, MSG_DONTWAIT);
        if (r > 0)
            c->len += (size_t)r;
        else if (r == 0)
            return -1;
        else if (errno == EINTR)
            continue;
        else
            return (errno == EAGAIN || errno == EWOULDBLOCK) ? 0 : -1;
    }
}

int lginput_poll(lginput *l)
{
    if (conn_poll(&l->ssap) < 0 || conn_poll(&l->ptr) < 0) {
        fail("TV closed the input connection");
        return -1;
    }
    return 0;
}

void lginput_close(lginput *l)
{
    if (!l)
        return;
    if (l->ptr.fd >= 0)
        close(l->ptr.fd);
    if (l->ssap.fd >= 0)
        close(l->ssap.fd);
    free(l);
}

static void mkdirs_for(const char *path)
{
    char d[256];
    char *s;

    snprintf(d, sizeof d, "%s", path);
    for (s = d + 1; *s; s++) {
        if (*s == '/') {
            *s = '\0';
            mkdir(d, 0755);
            *s = '/';
        }
    }
}

int lginput_pair(const char *key_path)
{
    wsconn c;
    char msg[MSG_MAX], key[128];
    int fd;
    size_t len;

    if (register_client(&c, NULL, msg, sizeof msg) < 0)
        return -1;
    close(c.fd);
    if (!ssap_find_string(msg, "client-key", key, sizeof key)) {
        fail("registered, but no client-key in: %.120s", msg);
        return -1;
    }
    mkdirs_for(key_path);
    fd = open(key_path, O_WRONLY | O_CREAT | O_TRUNC, 0600);
    if (fd < 0) {
        fail("cannot write %s: %s", key_path, strerror(errno));
        return -1;
    }
    fchmod(fd, 0600);
    len = strlen(key);
    if (write(fd, key, len) != (ssize_t)len) {
        fail("cannot write %s: %s", key_path, strerror(errno));
        close(fd);
        return -1;
    }
    close(fd);
    return 0;
}
