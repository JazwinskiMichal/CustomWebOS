#ifndef REMOTEVIEW_KEYMAP_H
#define REMOTEVIEW_KEYMAP_H

#include <stddef.h>
#include <stdint.h>

/* Maps an X11 keysym to a second-screen remote button name ("LEFT", "UP",
 * "RIGHT", "DOWN", "ENTER", "BACK", "HOME"), or NULL if it is not a button. */
const char *keymap_button(uint32_t keysym);

/* Printable ASCII (0x20-0x7e): writes the character and a NUL to out and
 * returns 1. Anything else returns 0. */
int keymap_text(uint32_t keysym, char out[2]);

#endif
