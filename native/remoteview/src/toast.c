#include "toast.h"

#include <errno.h>
#include <pthread.h>
#include <signal.h>
#include <spawn.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/wait.h>

extern char **environ;

#define LOCALE_TMP "/tmp/remoteview-locale.json"
#define LOCALE_CMD "luna-send -n 1 luna://com.webos.settingsservice/getSystemSettings " \
    "'{\"keys\":[\"localeInfo\"]}' < /dev/null > " LOCALE_TMP " 2>&1"

static pthread_once_t lang_once = PTHREAD_ONCE_INIT;
static char lang_buf[16] = "en";

/* Runs cmd via /bin/sh and waits. posix_spawn with an empty signal mask and default
 * handlers, so the child can be stopped and system()'s SIGINT/SIGQUIT ignoring is avoided.
 * Skips silently if the spawn fails. */
static void run_sh(const char *cmd)
{
    posix_spawnattr_t attr;
    sigset_t none, def;
    char *argv[4];
    pid_t pid;
    int st;

    argv[0] = "sh";
    argv[1] = "-c";
    argv[2] = (char *)cmd;
    argv[3] = NULL;
    if (posix_spawnattr_init(&attr) != 0)
        return;
    sigemptyset(&none);
    sigemptyset(&def);
    sigaddset(&def, SIGTERM);
    sigaddset(&def, SIGINT);
    sigaddset(&def, SIGHUP);
    sigaddset(&def, SIGQUIT);
    sigaddset(&def, SIGCHLD);
    posix_spawnattr_setsigmask(&attr, &none);
    posix_spawnattr_setsigdefault(&attr, &def);
    posix_spawnattr_setflags(&attr, POSIX_SPAWN_SETSIGMASK | POSIX_SPAWN_SETSIGDEF);
    if (posix_spawn(&pid, "/bin/sh", NULL, &attr, argv, environ) == 0)
        while (waitpid(pid, &st, 0) < 0 && errno == EINTR)
            ;
    posix_spawnattr_destroy(&attr);
}

/* Reads the UI locale into lang_buf; keeps "en" on any failure. Runs once per process. */
static void read_lang(void)
{
    char text[4096];
    FILE *f;
    size_t n, i = 0;
    const char *p;

    run_sh(LOCALE_CMD);
    f = fopen(LOCALE_TMP, "r");
    if (!f)
        return;
    n = fread(text, 1, sizeof text - 1, f);
    fclose(f);
    text[n] = '\0';

    p = strstr(text, "\"UI\":\"");
    if (!p)
        return;
    p += strlen("\"UI\":\"");
    while (p[i] && p[i] != '"' && i < sizeof lang_buf - 1)
        i++;
    if (i == 0 || p[i] != '"')
        return;
    memcpy(lang_buf, p, i);
    lang_buf[i] = '\0';
}

/* Thread body: arg carries started as an integer. */
static void *toast_thread(void *arg)
{
    char cmd[256];

    pthread_once(&lang_once, read_lang);
    if (toast_command(cmd, sizeof cmd, (int)(intptr_t)arg, lang_buf) >= 0)
        run_sh(cmd);
    return NULL;
}

int toast_command(char *buf, size_t n, int started, const char *lang)
{
    const char *msg;
    int len;

    if (lang && lang[0] == 'p' && lang[1] == 'l')
        msg = started ? "Zdalny podgląd: połączono" : "Zdalny podgląd: rozłączono";
    else
        msg = started ? "Remote view started" : "Remote view ended";
    len = snprintf(buf, n,
        "luna-send -n 1 luna://com.webos.notification/createToast "
        "'{\"sourceId\":\"org.jazwinski.customwebos.home\",\"message\":\"%s\"}' "
        "< /dev/null > /dev/null 2>&1", msg);
    return len < 0 || (size_t)len >= n ? -1 : len;
}

void toast_send(int started)
{
    pthread_t th;

    if (pthread_create(&th, NULL, toast_thread, (void *)(intptr_t)(started != 0)) == 0)
        pthread_detach(th);
}
