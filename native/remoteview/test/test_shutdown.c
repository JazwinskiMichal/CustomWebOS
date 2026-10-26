#undef NDEBUG
#include <assert.h>
#include <signal.h>
#include <stdlib.h>
#include <sys/wait.h>
#include <unistd.h>

#include "../src/shutdown.h"

static int wfd;

static void cleanup(void)
{
    (void)!write(wfd, "x", 1);
}

/* Forks a child that installs cleanup, runs mode, and reports marker count and exit status. */
static void run(int sig, int *markers, int *status)
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

    run(SIGTERM, &m, &s);
    assert(m == 1 && s == 143);
    run(SIGINT, &m, &s);
    assert(m == 1 && s == 130);
    run(0, &m, &s);
    assert(m == 1 && s == 0);
    run(SIGHUP, &m, &s);
    assert(m == 1 && s == 129);
    run(SIGQUIT, &m, &s);
    assert(m == 1 && s == 131);
    return 0;
}
