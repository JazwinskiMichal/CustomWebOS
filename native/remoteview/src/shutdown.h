#ifndef SHUTDOWN_H
#define SHUTDOWN_H

/* For the diagnostics (--capture-test) only: serve mode blocks these signals
 * and shuts down from its main loop instead (see server.c).
 * Registers handlers for SIGTERM/SIGINT/SIGHUP/SIGQUIT and atexit. cleanup runs
 * exactly once; after a signal the process exits with 128+sig. */
void shutdown_install(void (*cleanup)(void));

/* Nonzero once a termination signal has arrived. */
int shutdown_requested(void);

#endif
