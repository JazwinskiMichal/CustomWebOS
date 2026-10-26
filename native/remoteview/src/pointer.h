#ifndef REMOTEVIEW_POINTER_H
#define REMOTEVIEW_POINTER_H

/* Fields mirror linux struct input_event (type/code/value), except the move
 * event: a move is ONE event {EV_ABS, code = x, value = y}, which
 * uinput_pointer() expands into ABS_X + ABS_Y + SYN. Button events are plain
 * {EV_KEY, BTN_LEFT or BTN_RIGHT, 1 or 0}. */
typedef struct { int type, code, value; } pointer_event;

typedef struct { int x, y; int buttons; } pointer_state;

/* Turns a VNC pointer message (x, y, button mask) into input events: an ABS
 * move if x/y changed, then BTN_LEFT/BTN_RIGHT press/release for each changed
 * mask bit (bit 0 left, bit 2 right). Returns the number of events written
 * to out (at most max). */
int pointer_update(pointer_state *s, int x, int y, int mask,
                   pointer_event out[], int max);

#endif
