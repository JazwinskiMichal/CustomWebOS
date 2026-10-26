#include <signal.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>

#include "keymap.h"
#include "pointer.h"
#include "uinput.h"

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

static int move_to(int fd, pointer_state *ps, int x, int y)
{
    pointer_event ev[4];
    int n = pointer_update(ps, x, y, ps->buttons, ev, 4);
    printf("move %d,%d\n", x, y);
    fflush(stdout);
    uinput_pointer(fd, ev, n);
    return wait_s(1);
}

/* Diagnostic: drives the pointer and keys through uinput, one line per action. */
static int input_test(void)
{
    static const int corners[][2] = {
        { 0, 0 }, { TV_W - 1, 0 }, { TV_W - 1, TV_H - 1 }, { 0, TV_H - 1 },
        { TV_W / 2, TV_H / 2 },
    };
    static const struct { const char *name; uint32_t sym; } keys[] = {
        { "RIGHT", 0xff53 }, { "RIGHT", 0xff53 }, { "LEFT", 0xff51 },
        { "ENTER", 0xff0d }, { "ESC", 0xff1b }, { "HOME", 0xff50 },
    };
    pointer_state ps = { -1, -1, 0 };
    pointer_event ev[4];
    int fd, i, n, key, shift;

    signal(SIGINT, on_signal);
    signal(SIGTERM, on_signal);

    fd = uinput_open(TV_W, TV_H);
    if (fd < 0) {
        perror("uinput_open");
        return 1;
    }
    printf("uinput open %dx%d\n", TV_W, TV_H);
    fflush(stdout);

    if (wait_s(2))
        goto done;
    for (i = 0; i < 5; i++)
        if (move_to(fd, &ps, corners[i][0], corners[i][1]))
            goto done;

    puts("click");
    fflush(stdout);
    n = pointer_update(&ps, ps.x, ps.y, 1, ev, 4);
    uinput_pointer(fd, ev, n);
    usleep(100000);
    n = pointer_update(&ps, ps.x, ps.y, 0, ev, 4);
    uinput_pointer(fd, ev, n);
    if (wait_s(1))
        goto done;

    for (i = 0; i < 6; i++) {
        printf("key %s\n", keys[i].name);
        fflush(stdout);
        if (keymap_lookup(keys[i].sym, &key, &shift)) {
            uinput_key(fd, key, 1);
            usleep(50000);
            uinput_key(fd, key, 0);
        }
        if (wait_s(1))
            goto done;
    }
done:
    uinput_close(fd);
    puts("closed");
    return 0;
}

int main(int argc, char **argv)
{
    if (argc > 1 && strcmp(argv[1], "--version") == 0) {
        printf("remoteview %s\n", REMOTEVIEW_VERSION);
        return 0;
    }
    if (argc > 1 && strcmp(argv[1], "--input-test") == 0)
        return input_test();
    fprintf(stderr, "usage: remoteview --version | --input-test\n");
    return 2;
}
