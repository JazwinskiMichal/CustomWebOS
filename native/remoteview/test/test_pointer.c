#undef NDEBUG
#include <assert.h>
#include <linux/input.h>
#include "../src/pointer.h"

int main(void)
{
    pointer_state s = {0, 0, 0};
    pointer_event ev[8];
    int n;

    n = pointer_update(&s, 10, 20, 0, ev, 8);
    assert(n == 1 && ev[0].type == EV_ABS && ev[0].code == 10 && ev[0].value == 20);

    n = pointer_update(&s, 10, 20, 0, ev, 8);
    assert(n == 0);

    n = pointer_update(&s, 10, 20, 1, ev, 8);
    assert(n == 1 && ev[0].type == EV_KEY && ev[0].code == BTN_LEFT && ev[0].value == 1);

    n = pointer_update(&s, 30, 20, 1, ev, 8);
    assert(n == 1 && ev[0].type == EV_ABS);

    n = pointer_update(&s, 30, 20, 0, ev, 8);
    assert(n == 1 && ev[0].code == BTN_LEFT && ev[0].value == 0);

    n = pointer_update(&s, 30, 20, 4, ev, 8);
    assert(n == 1 && ev[0].code == BTN_RIGHT && ev[0].value == 1);

    /* move + press together: move first */
    n = pointer_update(&s, 1, 2, 5, ev, 8);
    assert(n == 2 && ev[0].type == EV_ABS && ev[1].code == BTN_LEFT && ev[1].value == 1);
    return 0;
}
