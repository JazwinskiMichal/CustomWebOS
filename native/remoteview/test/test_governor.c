#undef NDEBUG
#include <assert.h>

#include "../src/governor.h"

int main(void)
{
    assert(governor_next(10, 10, 0.8) == 5);   /* 10 * 0.45 / 0.8 = 5.6 */
    assert(governor_next(15, 15, 0.6) == 11);  /* 15 * 0.45 / 0.6 = 11.25 */
    assert(governor_next(10, 15, 0.51) == 8);  /* 8.8 */
    assert(governor_next(3, 10, 0.9) == 2);
    assert(governor_next(2, 10, 0.9) == 2);
    assert(governor_next(5, 10, 0.2) == 6);
    assert(governor_next(10, 10, 0.2) == 10);
    assert(governor_next(6, 10, 0.4) == 6);
    return 0;
}
