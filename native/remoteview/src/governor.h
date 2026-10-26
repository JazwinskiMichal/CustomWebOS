#ifndef GOVERNOR_H
#define GOVERNOR_H

/* Next fps given the current one, the ceiling and the daemon's CPU use as a
 * fraction of one core. Over 0.50 halves (floor 2); under 0.35 adds one (cap
 * fps_max); otherwise unchanged. */
int governor_next(int fps_now, int fps_max, double cpu_core_fraction);

#endif
