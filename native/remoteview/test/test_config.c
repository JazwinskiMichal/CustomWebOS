#undef NDEBUG
#include <assert.h>
#include <math.h>

#include "../src/config.h"

int main(void)
{
    rv_config c;

    assert(config_parse("", &c) == 0);
    assert(c.width == 960 && c.height == 540 && c.fps_max == 10 && fabs(c.pointer_scale - 0.51) < 1e-9);

    assert(config_parse("width=1280\nheight=720\nfps=5\n", &c) == 0);
    assert(c.width == 1280 && c.height == 720 && c.fps_max == 5);

    assert(config_parse("fps=999\nwidth=10\nheight=5000\npointer_scale=9\n", &c) == 0);
    assert(c.fps_max == 30 && c.width == 320 && c.height == 1080 && c.pointer_scale == 4);

    assert(config_parse("width=abc\n", &c) == 1);
    assert(c.width == 960);

    assert(config_parse("# comment\n\nunknown=1\n  fps = 7  \r\npointer_scale=0.6", &c) == 0);
    assert(c.fps_max == 7 && fabs(c.pointer_scale - 0.6) < 1e-9);

    assert(config_parse("garbage\n", &c) == 1);
    return 0;
}
