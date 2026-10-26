#include "cpustat.h"

#include <stdlib.h>
#include <string.h>

/* utime+stime ticks of one stat line, or -1. The name in parentheses may hold
 * spaces and parentheses, so fields count from the last ')'. */
static long long ticks_of(const char *s)
{
    const char *p = s ? strrchr(s, ')') : NULL;
    char *end;
    long long ut, st;
    int i;

    if (!p)
        return -1;
    p++;
    /* Field 3 (state) is the first token after ')'; skip it and fields 4..13. */
    for (i = 3; i < 14; i++) {
        while (*p == ' ')
            p++;
        if (!*p)
            return -1;
        while (*p && *p != ' ')
            p++;
    }
    ut = strtoll(p, &end, 10);
    if (end == p)
        return -1;
    p = end;
    st = strtoll(p, &end, 10);
    if (end == p)
        return -1;
    return ut + st;
}

/* See cpustat.h. */
double cpustat_fraction(const char *stat_before, const char *stat_after, double seconds, long hz)
{
    long long a = ticks_of(stat_before), b = ticks_of(stat_after);

    if (a < 0 || b < 0 || hz <= 0)
        return -1.0;
    if (seconds <= 0 || b < a)
        return 0.0;
    return (double)(b - a) / hz / seconds;
}
