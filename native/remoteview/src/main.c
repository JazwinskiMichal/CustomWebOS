#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#include "keymap.h"
#include "lginput.h"
#include "pointer.h"

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
    fprintf(stderr, "usage: remoteview --version | --pair | --input-test\n");
    return 2;
}
