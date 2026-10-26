#ifndef REMOTEVIEW_SERVER_H
#define REMOTEVIEW_SERVER_H

#include "config.h"

/* Runs the VNC server until SIGTERM/SIGINT/SIGHUP/SIGQUIT, then exits the
 * process with 128+signal. Returns only on startup failure (nonzero). */
int server_run(const rv_config *cfg);

/* Reads one line from stdin and stores it as the VNC password. Returns an exit status. */
int server_store_password(void);

#endif
