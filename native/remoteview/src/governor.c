#include "governor.h"

/* See governor.h. */
int governor_next(int fps_now, int fps_max, double cpu_core_fraction)
{
    if (cpu_core_fraction > 0.50) {
        int half = fps_now / 2;
        return half < 2 ? 2 : half;
    }
    if (cpu_core_fraction < 0.35)
        return fps_now + 1 < fps_max ? fps_now + 1 : fps_max;
    return fps_now;
}
