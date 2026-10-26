#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <time.h>
#include <unistd.h>

#include "capture.h"
#include "keymap.h"
#include "lginput.h"
#include "pointer.h"
#include "shutdown.h"

#define TV_W 1920
#define TV_H 1080

static volatile sig_atomic_t stop;

static void on_signal(int sig)
{
    (void)sig;
    stop = 1;
}

/* Sleeps up to s seconds; returns 1 if interrupted by a signal. */
static int wait_s(int s)
{
    int i;
    for (i = 0; i < s * 10 && !stop; i++)
        usleep(100000);
    return stop;
}

static int send_update(lginput *in, pointer_state *ps, int x, int y, int mask)
{
    char out[8192];
    int n = pointer_update(ps, x, y, mask, out, sizeof out);

    if (n < 0)
        return -1;
    return n ? lginput_pointer(in, out, (size_t)n) : 0;
}

/* Diagnostic: drives the pointer and buttons through the second-screen API,
 * one line per action. Targets sit 100 px in from the corners, matching the
 * circles of the calibration page (native/remoteview/calib/). */
static int input_test(double scale)
{
    static const int pts[][2] = {
        { 100, 100 }, { TV_W - 100, 100 }, { TV_W - 100, TV_H - 100 }, { 100, TV_H - 100 },
        { TV_W / 2, TV_H / 2 },
    };
    static const struct { const char *name; uint32_t sym; } keys[] = {
        { "RIGHT", 0xff53 }, { "RIGHT", 0xff53 }, { "LEFT", 0xff51 },
        { "ENTER", 0xff0d }, { "BACK", 0xff1b }, { "HOME", 0xff50 },
    };
    pointer_state ps = { 0, 0, 0, 0, scale };
    lginput *in;
    int i;

    signal(SIGINT, on_signal);
    signal(SIGTERM, on_signal);
    lginput_verbose(1);

    in = lginput_open(LGINPUT_KEY_PATH);
    if (!in) {
        fprintf(stderr, "input-test: cannot open input (see above); run --pair first?\n");
        return 1;
    }
    printf("input open\n");
    fflush(stdout);

    for (i = 0; i < 5; i++) {
        printf("move+click %d,%d\n", pts[i][0], pts[i][1]);
        fflush(stdout);
        if (send_update(in, &ps, pts[i][0], pts[i][1], 0) < 0 || wait_s(1) ||
            send_update(in, &ps, ps.x, ps.y, 1) < 0 || send_update(in, &ps, ps.x, ps.y, 0) < 0 ||
            wait_s(1))
            goto done;
    }
    for (i = 0; i < 6; i++) {
        const char *b = keymap_button(keys[i].sym);
        printf("button %s\n", keys[i].name);
        fflush(stdout);
        if (!b || lginput_button(in, b) < 0 || wait_s(1))
            goto done;
    }
done:
    lginput_close(in);
    puts("closed");
    return 0;
}

static int pair(void)
{
    lginput_verbose(1);
    puts("accept the prompt on the TV");
    fflush(stdout);
    if (lginput_pair(LGINPUT_KEY_PATH) < 0) {
        puts("pairing failed");
        return 1;
    }
    puts("paired");
    return 0;
}

static double now_ms(void)
{
    struct timespec t;
    clock_gettime(CLOCK_MONOTONIC, &t);
    return t.tv_sec * 1000.0 + t.tv_nsec / 1e6;
}

/* Writes an ARGB frame (BGRA bytes in memory) as raw RGB24. */
static int dump_rgb(const uint8_t *argb, int w, int h, const char *path)
{
    FILE *f = fopen(path, "wb");
    int x, y;

    if (!f)
        return -1;
    for (y = 0; y < h; y++)
        for (x = 0; x < w; x++) {
            const uint8_t *p = argb + ((size_t)y * w + x) * 4;
            uint8_t rgb[3] = { p[2], p[1], p[0] };
            fwrite(rgb, 1, 3, f);
        }
    return fclose(f);
}

/* Diagnostic: n times open, grab 5 frames, close. The last frame of the last
 * cycle goes to /tmp/rv/frame.data as raw RGB24. */
static int capture_test(int n, int w, int h)
{
    uint8_t *buf = malloc((size_t)w * h * 4);
    int i, f, rc = 0;

    if (!buf)
        return 1;
    shutdown_install(capture_close);
    for (i = 1; i <= n && !shutdown_requested(); i++) {
        int has_video = 0, ok = 0;
        double t0;

        if (capture_open(w, h, &has_video) != 0) {
            printf("cycle %d: ui=0 video=0\n", i);
            fflush(stdout);
            rc = 1;
            break;
        }
        memset(buf, 0, (size_t)w * h * 4);
        t0 = now_ms();
        for (f = 0; f < 5; f++)
            ok += capture_frame(buf, w * 4) == 0;
        printf("cycle %d: ui=1 video=%d ms=%.1f%s\n", i, has_video, (now_ms() - t0) / 5,
               ok == 5 ? "" : " (frame errors)");
        fflush(stdout);
        if (ok != 5)
            rc = 1;
        if (i == n) {
            mkdir("/tmp/rv", 0755);
            if (dump_rgb(buf, w, h, "/tmp/rv/frame.data") < 0)
                perror("frame.data");
        }
        capture_close();
    }
    free(buf);
    return rc;
}

int main(int argc, char **argv)
{
    if (argc > 1 && strcmp(argv[1], "--version") == 0) {
        printf("remoteview %s\n", REMOTEVIEW_VERSION);
        return 0;
    }
    if (argc > 1 && strcmp(argv[1], "--pair") == 0)
        return pair();
    if (argc > 1 && strcmp(argv[1], "--input-test") == 0)
        return input_test(argc > 2 ? atof(argv[2]) : 1.0);
    if (argc > 2 && strcmp(argv[1], "--capture-test") == 0) {
        int w = 960, h = 540;
        if (argc > 4 && strcmp(argv[3], "--size") == 0 && (sscanf(argv[4], "%dx%d", &w, &h) != 2 || w <= 0 || h <= 0)) {
            fprintf(stderr, "usage: remoteview --capture-test N [--size WxH], W and H positive\n");
            return 2;
        }
        return capture_test(atoi(argv[2]), w, h);
    }
    fprintf(stderr, "usage: remoteview --version | --pair | --input-test | --capture-test N [--size WxH]\n");
    return 2;
}
