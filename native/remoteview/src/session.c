#include "session.h"

/* First client opens capture and starts the toast. */
int session_client_added(session *s)
{
    return s->clients++ == 0 ? SA_OPEN_CAPTURE | SA_TOAST_START : SA_NONE;
}

/* Last client closes capture and ends the toast; never underflows. */
int session_client_gone(session *s)
{
    if (s->clients <= 0)
        return SA_NONE;
    return --s->clients == 0 ? SA_CLOSE_CAPTURE | SA_TOAST_END : SA_NONE;
}

int session_clients(const session *s)
{
    return s->clients;
}
