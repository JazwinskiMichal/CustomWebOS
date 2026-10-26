#include "governor.h"

/* See governor.h. */
int governor_next(int fps_now, int fps_max, double cpu_core_fraction)
{
    if (cpu_core_fraction > 0.50) {
        int next = (int)(fps_now * 0.45 / cpu_core_fraction);
        if (next >= fps_now)
            next = fps_now - 1;
        return next < 2 ? 2 : next;
    }
    if (cpu_core_fraction < 0.35)
        return fps_now + 1 < fps_max ? fps_now + 1 : fps_max;
    return fps_now;
}
