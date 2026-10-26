#ifndef REMOTEVIEW_POINTER_H
#define REMOTEVIEW_POINTER_H

#include <stddef.h>

/* x, y: last VNC position; buttons: last mask; synced: 0 until the first
 * update has pinned the TV cursor; scale: TV cursor units per VNC pixel. */
typedef struct { int x, y, buttons, synced; double scale; } pointer_state;

/* Turns a VNC pointer message (x, y, button mask) into zero or more
 * pointer-socket messages written back to back into out
 * ("type:<t>\n" + "key:value\n" lines + "\n"). The pointer socket only takes
 * relative moves, so the first update slams the cursor into the top-left
 * corner and then moves to (x, y).
 * Mask bit 0 click, bit 2 BACK button, bit 3 scroll up, bit 4 scroll down;
 * all act on press only. Returns the bytes written, or -1 if n is too small. */
int pointer_update(pointer_state *s, int x, int y, int mask, char *out, size_t n);

#endif
