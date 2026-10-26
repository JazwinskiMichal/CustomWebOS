#ifndef REMOTEVIEW_KEYMAP_H
#define REMOTEVIEW_KEYMAP_H

#include <stdint.h>

/* Maps an X11 keysym to a Linux key code. Returns 1 if mapped, 0 if not.
 * *needs_shift is set to 1 for shifted symbols (uppercase letters). */
int keymap_lookup(uint32_t keysym, int *linux_key, int *needs_shift);

/* Iterates every distinct Linux key code the map can produce (for uinput
 * capability setup). Returns the code at index i, or -1 past the end. */
int keymap_key_at(int i);

#endif
