#ifndef REMOTEVIEW_LGINPUT_H
#define REMOTEVIEW_LGINPUT_H

#include <stddef.h>

#define LGINPUT_KEY_PATH "/home/root/.config/customwebos/remoteview.client-key"

typedef struct lginput lginput;

/* When nonzero, failures are also printed to stderr (syslog always). */
void lginput_verbose(int on);

/* Connects to the TV's second-screen API on 127.0.0.1:3000, registers with the
 * stored client key and opens the pointer socket. NULL on any failure. */
lginput *lginput_open(const char *key_path);

/* Sends pointer-socket messages as produced by pointer_update(): one
 * WebSocket frame per message. Returns 0, or -1 on failure. */
int lginput_pointer(lginput *l, const char *msgs, size_t len);

/* Presses a remote button ("ENTER", "BACK", ...). Returns 0, or -1. */
int lginput_button(lginput *l, const char *name);

/* Types text into the focused field via the IME service. Returns 0, or -1. */
int lginput_text(lginput *l, const char *text);

void lginput_close(lginput *l);

/* Registers without a key and waits up to 60 s for the on-screen prompt to be
 * accepted; stores the resulting key at key_path (mode 600). Returns 0, or -1. */
int lginput_pair(const char *key_path);

#endif
