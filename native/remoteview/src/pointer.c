#include "pointer.h"

#include <linux/input.h>

static int push(pointer_event out[], int n, int max, int type, int code, int value)
{
    if (n < max) {
        out[n].type = type;
        out[n].code = code;
        out[n].value = value;
    }
    return n + 1;
}

int pointer_update(pointer_state *s, int x, int y, int mask,
                   pointer_event out[], int max)
{
    static const struct { int bit, code; } btns[] = {
        { 1 << 0, BTN_LEFT },
        { 1 << 2, BTN_RIGHT },
    };
    int n = 0;
    unsigned i;

    if (x != s->x || y != s->y) {
        n = push(out, n, max, EV_ABS, x, y);
        s->x = x;
        s->y = y;
    }
    for (i = 0; i < sizeof btns / sizeof btns[0]; i++) {
        int was = (s->buttons & btns[i].bit) != 0;
        int now = (mask & btns[i].bit) != 0;
        if (was != now)
            n = push(out, n, max, EV_KEY, btns[i].code, now);
    }
    s->buttons = mask;
    return n > max ? max : n;
}
