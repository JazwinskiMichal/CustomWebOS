#undef NDEBUG
#include <assert.h>
#include <math.h>
#include <stdio.h>

#include "../src/cpustat.h"

/* A /proc/self/stat line with the given name and utime/stime. */
static void mk(char *out, size_t n, const char *name, long ut, long st)
{
    snprintf(out, n, "42 (%s) S 1 42 42 0 -1 4194560 100 0 0 0 %ld %ld 0 0 20 0 2 0 1000 5000000 300 4294967295",
             name, ut, st);
}

int main(void)
{
    char a[256], b[256];

    mk(a, sizeof a, "remoteview", 500, 100);
    mk(b, sizeof b, "remoteview", 540, 160);
    assert(fabs(cpustat_fraction(a, b, 2.0, 100) - 0.5) < 1e-9);

    mk(a, sizeof a, "remote view", 10, 10);
    mk(b, sizeof b, "remote view", 60, 60);
    assert(fabs(cpustat_fraction(a, b, 2.0, 100) - 0.5) < 1e-9);

    mk(a, sizeof a, "a) b (c", 0, 0);
    mk(b, sizeof b, "a) b (c", 100, 0);
    assert(fabs(cpustat_fraction(a, b, 1.0, 100) - 1.0) < 1e-9);

    assert(cpustat_fraction(a, b, 0.0, 100) == 0.0);
    assert(cpustat_fraction(a, b, -1.0, 100) == 0.0);
    assert(cpustat_fraction("garbage", b, 2.0, 100) < 0);
    assert(cpustat_fraction(a, "1 (x) S 1 2", 2.0, 100) < 0);
    assert(cpustat_fraction(NULL, b, 2.0, 100) < 0);
    return 0;
}
