#include "shutdown.h"

#include <signal.h>
#include <stdlib.h>
#include <unistd.h>

static void (*cleanup_fn)(void);
static volatile sig_atomic_t requested;
static volatile sig_atomic_t cleaned;

/* Runs the registered cleanup once, however many paths reach it. */
static void run_cleanup(void)
{
    if (cleaned)
        return;
    cleaned = 1;
    if (cleanup_fn)
        cleanup_fn();
}

/* Cleans up, then leaves with the conventional 128+signal status. */
static void on_signal(int sig)
{
    requested = 1;
    run_cleanup();
    _exit(128 + sig);
}

void shutdown_install(void (*cleanup)(void))
{
    static const int sigs[] = { SIGTERM, SIGINT, SIGHUP, SIGQUIT };
    struct sigaction sa;
    size_t i;

    cleanup_fn = cleanup;
    cleaned = 0;
    sa.sa_handler = on_signal;
    sigemptyset(&sa.sa_mask);
    for (i = 0; i < sizeof sigs / sizeof sigs[0]; i++)
        sigaddset(&sa.sa_mask, sigs[i]);
    sa.sa_flags = 0;
    for (i = 0; i < sizeof sigs / sizeof sigs[0]; i++)
        sigaction(sigs[i], &sa, NULL);
    atexit(run_cleanup);
}

int shutdown_requested(void)
{
    return requested;
}
