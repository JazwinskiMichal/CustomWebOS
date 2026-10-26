#undef NDEBUG
#include <assert.h>

#include "../src/session.h"

int main(void)
{
    session s = { 0 };

    assert(session_client_added(&s) == (SA_OPEN_CAPTURE | SA_TOAST_START));
    assert(session_client_added(&s) == SA_NONE);
    assert(session_clients(&s) == 2);
    assert(session_client_gone(&s) == SA_NONE);
    assert(session_client_gone(&s) == (SA_CLOSE_CAPTURE | SA_TOAST_END));
    assert(session_client_gone(&s) == SA_NONE);
    assert(session_clients(&s) == 0);
    assert(session_client_added(&s) == (SA_OPEN_CAPTURE | SA_TOAST_START));
    return 0;
}
