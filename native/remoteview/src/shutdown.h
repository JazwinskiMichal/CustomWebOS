#ifndef SHUTDOWN_H
#define SHUTDOWN_H

/* Registers handlers for SIGTERM/SIGINT/SIGHUP/SIGQUIT and atexit. cleanup runs
 * exactly once; after a signal the process exits with 128+sig. */
void shutdown_install(void (*cleanup)(void));

/* Nonzero once a termination signal has arrived. */
int shutdown_requested(void);

#endif
