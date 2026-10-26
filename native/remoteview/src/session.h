#ifndef REMOTEVIEW_SESSION_H
#define REMOTEVIEW_SESSION_H

typedef struct { int clients; } session;

typedef enum {
    SA_NONE = 0,
    SA_OPEN_CAPTURE = 1,
    SA_CLOSE_CAPTURE = 2,
    SA_TOAST_START = 4,
    SA_TOAST_END = 8
} session_action;

/* An authenticated client arrived. Returns the session_action bitmask. */
int session_client_added(session *s);

/* An authenticated client left. Returns the session_action bitmask. */
int session_client_gone(session *s);

int session_clients(const session *s);

#endif
