#undef NDEBUG
#include <assert.h>
#include <signal.h>
#include <stdlib.h>
#include <sys/wait.h>
#include <unistd.h>

#include "../src/shutdown.h"

static int wfd;
static int exit_in_cleanup;

static void cleanup(void)
{
    (void)!write(wfd, "x", 1);
    if (exit_in_cleanup)
        exit(5); /* re-enters the atexit path while cleanup is running */
}

/* Forks a child that installs cleanup, runs mode, and reports marker count and exit status. */
static void run(int sig, int exit_inside, int *markers, int *status)
{
    int p[2], st, n = 0;
    char c;
    pid_t pid;

    assert(pipe(p) == 0);
    pid = fork();
    assert(pid >= 0);
    if (pid == 0) {
        close(p[0]);
        wfd = p[1];
        exit_in_cleanup = exit_inside;
        shutdown_install(cleanup);
        if (sig)
            raise(sig);
        exit(0);
    }
    close(p[1]);
    while (read(p[0], &c, 1) == 1)
        n++;
    close(p[0]);
    assert(waitpid(pid, &st, 0) == pid);
    assert(WIFEXITED(st));
    *markers = n;
    *status = WEXITSTATUS(st);
}

int main(void)
{
    int m, s;

    run(SIGTERM, 0, &m, &s);
    assert(m == 1 && s == 143);
    run(SIGINT, 0, &m, &s);
    assert(m == 1 && s == 130);
    run(0, 0, &m, &s);
    assert(m == 1 && s == 0);
    run(SIGTERM, 1, &m, &s);
    assert(m == 1 && s == 5);
    return 0;
}
