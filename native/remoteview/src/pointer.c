#include "pointer.h"

#include <stdarg.h>
#include <stdio.h>

#define CORNER_SLAM 3000

static int round_scaled(int d, double scale)
{
    double v = d * scale;
    return (int)(v < 0 ? v - 0.5 : v + 0.5);
}

/* Appends printf output at out[*used]; returns 0, or -1 if it does not fit. */
static int put(char *out, size_t n, size_t *used, const char *fmt, ...)
{
    va_list ap;
    int w;

    va_start(ap, fmt);
    w = vsnprintf(out + *used, n - *used, fmt, ap);
    va_end(ap);
    if (w < 0 || (size_t)w >= n - *used)
        return -1;
    *used += (size_t)w;
    return 0;
}

int pointer_update(pointer_state *s, int x, int y, int mask, char *out, size_t n)
{
    static const char mv[] = "type:move\ndx:%d\ndy:%d\ndown:0\n\n";
    size_t used = 0;
    int rising = mask & ~s->buttons;

    if (n == 0)
        return -1;
    out[0] = '\0';

    if (!s->synced) {
        if (put(out, n, &used, mv, -CORNER_SLAM, -CORNER_SLAM) ||
            put(out, n, &used, mv, round_scaled(x, s->scale), round_scaled(y, s->scale)))
            return -1;
        s->synced = 1;
    } else if (x != s->x || y != s->y) {
        if (put(out, n, &used, mv, round_scaled(x - s->x, s->scale),
                round_scaled(y - s->y, s->scale)))
            return -1;
    }
    s->x = x;
    s->y = y;

    if ((rising & 1) && put(out, n, &used, "type:click\n\n"))
        return -1;
    if ((rising & 4) && put(out, n, &used, "type:button\nname:BACK\n\n"))
        return -1;
    if ((rising & 8) && put(out, n, &used, "type:scroll\ndx:0\ndy:-1\n\n"))
        return -1;
    if ((rising & 16) && put(out, n, &used, "type:scroll\ndx:0\ndy:1\n\n"))
        return -1;
    s->buttons = mask;
    return (int)used;
}
