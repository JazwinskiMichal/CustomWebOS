#ifndef CAPTURE_H
#define CAPTURE_H

#include <stdint.h>

/* Opens the UI layer and, when possible, the video layer, scaled to
 * width x height. Returns 0 if at least the UI layer opened. *has_video is 0
 * when the video layer (DILE_VT) failed; the reason is logged. */
int capture_open(int width, int height, int *has_video);

/* Writes one composited frame (video under UI) as ARGB into argb_out, which
 * holds height rows of stride bytes. Returns 0 on success, -1 on failure. */
int capture_frame(uint8_t *argb_out, int stride);

/* Releases every capture resource. Idempotent; safe from the shutdown path. */
void capture_close(void);

#endif
