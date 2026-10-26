#ifndef REMOTEVIEW_TOAST_H
#define REMOTEVIEW_TOAST_H

#include <stddef.h>

/* Builds the createToast luna-send command into buf. Polish text for lang
 * starting with "pl", English otherwise (NULL included). Returns the length,
 * or -1 if it does not fit in n bytes. */
int toast_command(char *buf, size_t n, int started, const char *lang);

/* Shows the connect (started=1) or disconnect (started=0) toast from a
 * detached thread; never blocks, and silently skips if the thread can't start. */
void toast_send(int started);

#endif
