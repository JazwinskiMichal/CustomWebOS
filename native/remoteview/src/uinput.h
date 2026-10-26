#ifndef REMOTEVIEW_UINPUT_H
#define REMOTEVIEW_UINPUT_H

#include "pointer.h"

/* Creates one virtual device (keys, BTN_LEFT/RIGHT, absolute pointer
 * 0..width-1 x 0..height-1). Returns an fd, or -1 on error. */
int uinput_open(int width, int height);
void uinput_key(int fd, int key, int down);
void uinput_pointer(int fd, const pointer_event *ev, int n);
void uinput_close(int fd);

#endif
