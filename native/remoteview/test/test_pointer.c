#undef NDEBUG
#include <assert.h>
#include <string.h>
#include "../src/pointer.h"

static void check(pointer_state *s, int x, int y, int mask, const char *want)
{
    char out[512];
    int n = pointer_update(s, x, y, mask, out, sizeof out);
    assert(n == (int)strlen(want));
    assert(memcmp(out, want, (size_t)n) == 0);
}

int main(void)
{
    pointer_state s = { 0, 0, 0, 0, 1.0 };
    char small[8];

    check(&s, 100, 50, 0,
          "type:move\ndx:-3000\ndy:-3000\ndown:0\n\n"
          "type:move\ndx:100\ndy:50\ndown:0\n\n");
    check(&s, 110, 50, 0, "type:move\ndx:10\ndy:0\ndown:0\n\n");
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
    return 0;
}
