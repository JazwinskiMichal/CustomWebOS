#include "toast.h"

#include <pthread.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define LOCALE_TMP "/tmp/remoteview-locale.json"
#define LOCALE_CMD "luna-send -n 1 luna://com.webos.settingsservice/getSystemSettings " \
    "'{\"keys\":[\"localeInfo\"]}' < /dev/null > " LOCALE_TMP " 2>&1"

static pthread_once_t lang_once = PTHREAD_ONCE_INIT;
static char lang_buf[16] = "en";

/* Reads the UI locale into lang_buf; keeps "en" on any failure. Runs once per process. */
static void read_lang(void)
{
    char text[4096];
    FILE *f;
    size_t n, i = 0;
    const char *p;

    (void)system(LOCALE_CMD);
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
        (void)system(cmd);
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
