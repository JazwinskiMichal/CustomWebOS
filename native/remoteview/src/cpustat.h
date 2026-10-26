#ifndef CPUSTAT_H
#define CPUSTAT_H

/* CPU use between two /proc/self/stat texts as a fraction of one core (1.0 = one
 * full core), from utime+stime (fields 14, 15) over `seconds` at `hz` ticks/s.
 * seconds <= 0 gives 0.0; unparsable input gives -1.0. */
double cpustat_fraction(const char *stat_before, const char *stat_after, double seconds, long hz);

#endif
