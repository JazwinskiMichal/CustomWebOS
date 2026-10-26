#undef NDEBUG
#include <assert.h>
#include <stdlib.h>
#include <string.h>
#include "../src/pointer.h"

static void check(pointer_state *s, int x, int y, int mask, const char *want)
{
    char out[512];
    int n = pointer_update(s, x, y, mask, out, sizeof out);
    assert(n == (int)strlen(want));
    assert(memcmp(out, want, (size_t)n) == 0);
}

static int sum_dx(const char *out)
{
    int total = 0;
    const char *p = out;
    while ((p = strstr(p, "dx:")) != NULL) {
        total += atoi(p + 3);
        p += 3;
    }
    return total;
}

int main(void)
{
    pointer_state s = { 0, 0, 0, 0, 1.0 };
    char small[8];

    /* First update: corner slam then a move to (100,50), every step at most 30 per axis. */
    {
        char o[8192];
        const char *p;
        int n = pointer_update(&s, 100, 50, 0, o, sizeof o), msgs = 0, dy = 0;
        assert(n > 0);
        assert(sum_dx(o) == -2400 + 100);
        for (p = o; (p = strstr(p, "type:move\ndx:")) != NULL; p += 13) {
            int dx = atoi(p + 13);
            const char *q = strstr(p, "dy:");
            assert(dx >= -30 && dx <= 30);
            assert(atoi(q + 3) >= -30 && atoi(q + 3) <= 30);
            dy += atoi(q + 3);
            msgs++;
        }
        assert(dy == -2400 + 50);
        assert(msgs == 80 + 4);
        /* The slam alone must not fit a small buffer. */
        s.synced = 0;
        assert(pointer_update(&s, 100, 50, 0, o, 512) == -1);
        s.synced = 0;
        assert(pointer_update(&s, 100, 50, 0, o, sizeof o) == n);
    }
    check(&s, 110, 50, 0, "type:move\ndx:10\ndy:0\ndown:0\n\n");
    check(&s, 150, 50, 0, "type:move\ndx:30\ndy:0\ndown:0\n\ntype:move\ndx:10\ndy:0\ndown:0\n\n");
    check(&s, 110, 50, 0, "type:move\ndx:-30\ndy:0\ndown:0\n\ntype:move\ndx:-10\ndy:0\ndown:0\n\n");
    check(&s, 110, 50, 0, "");
    check(&s, 110, 50, 1, "type:click\n\n");
    check(&s, 110, 50, 0, "");
    check(&s, 110, 50, 4, "type:button\nname:BACK\n\n");
    check(&s, 110, 50, 0, "");
    check(&s, 110, 50, 8, "type:scroll\ndx:0\ndy:-1\n\n");
    check(&s, 110, 50, 0, "");
    check(&s, 110, 50, 16, "type:scroll\ndx:0\ndy:1\n\n");

    s.scale = 2.0;
    check(&s, 120, 50, 16, "type:move\ndx:20\ndy:0\ndown:0\n\n");

    assert(pointer_update(&s, 130, 50, 16, small, sizeof small) == -1);

    /* Rounding must not accumulate per delta: totals follow round(x*scale). */
    {
        pointer_state f = { 0, 0, 0, 0, 0.4 };
        char o[8192];
        int i, total = 0;
        assert(pointer_update(&f, 0, 0, 0, o, sizeof o) > 0);
        for (i = 1; i <= 10; i++) {
            assert(pointer_update(&f, i, 0, 0, o, sizeof o) >= 0);
            total += sum_dx(o);
        }
        assert(total == 4);

        f.synced = 0; f.x = 0; f.y = 0; f.scale = 1.5;
        assert(pointer_update(&f, 0, 0, 0, o, sizeof o) > 0);
        total = 0;
        assert(pointer_update(&f, 1, 0, 0, o, sizeof o) > 0);
        total += sum_dx(o);
        assert(pointer_update(&f, 2, 0, 0, o, sizeof o) > 0);
        total += sum_dx(o);
        assert(total == 3);
    }
    return 0;
}
