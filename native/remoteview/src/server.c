#define _GNU_SOURCE
#include "server.h"

#include <arpa/inet.h>
#include <errno.h>
#include <fcntl.h>
#include <pthread.h>
#include <rfb/rfb.h>
#include <signal.h>
#include <stdatomic.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <syslog.h>
#include <time.h>
#include <unistd.h>

#include "capture.h"
#include "cpustat.h"
#include "governor.h"
#include "keymap.h"
#include "lanfilter.h"
#include "lginput.h"
#include "pointer.h"
#include "session.h"
#include "toast.h"

#define TILE 64
#define CONFIG_DIR "/home/root/.config/customwebos"
#define HOME_APP_ID "org.jazwinski.customwebos.home"
#define GOV_PERIOD_S 2
#define GOV_LOG_S 30

static rfbScreenInfoPtr screen;
static rv_config cfg;
static session sess;
static lginput *input;
static pointer_state pstate;
static uint8_t *stage; /* latest captured frame; guarded by stage_mu */
static uint8_t *dirty; /* one flag per tile, guarded by stage_mu */
static pthread_mutex_t stage_mu = PTHREAD_MUTEX_INITIALIZER;

static struct {
    pthread_t th;
    pthread_mutex_t mu;
    pthread_cond_t cv;
    int running, stop;
} cap;

/* Current capture rate: written by the main thread (capture_start, governor),
 * read by the capture thread every frame and by the main loop timeout. */
static _Atomic int fps_now = 10;

static struct {
    char prev[1024]; /* /proc/self/stat at the last sample; empty = none */
    double prev_t, last_log_t;
} gov;

/* Logs to syslog and stderr (never a file on flash). This TV's PmLogDaemon drops
 * plain syslog, and the capture backends re-run openlog(), so stderr is the
 * readable copy; the boot hook points it at /tmp. Also LibVNCServer's log. */
static void logf_(const char *fmt, ...)
{
    va_list ap;

    va_start(ap, fmt);
    vsyslog(LOG_INFO, fmt, ap);
    va_end(ap);
    va_start(ap, fmt);
    fputs("remoteview: ", stderr);
    vfprintf(stderr, fmt, ap);
    if (*fmt && fmt[strlen(fmt) - 1] != '\n')
        fputc('\n', stderr);
    va_end(ap);
}

/* Copies the tiles of cur that differ from the staging frame into it and flags
 * them dirty. Capture thread; never touches LibVNCServer. */
static void publish_frame(const uint8_t *cur)
{
    int w = cfg.width, h = cfg.height, tx, ty, y, cols = (w + TILE - 1) / TILE;

    pthread_mutex_lock(&stage_mu);
    for (ty = 0; ty < h; ty += TILE) {
        int th = ty + TILE > h ? h - ty : TILE;
        for (tx = 0; tx < w; tx += TILE) {
            int tw = tx + TILE > w ? w - tx : TILE, changed = 0;
            for (y = ty; y < ty + th; y++) {
                size_t o = ((size_t)y * w + tx) * 4;
                if (memcmp(cur + o, stage + o, (size_t)tw * 4)) {
                    changed = 1;
                    break;
                }
            }
            if (!changed)
                continue;
            for (y = ty; y < ty + th; y++) {
                size_t o = ((size_t)y * w + tx) * 4;
                memcpy(stage + o, cur + o, (size_t)tw * 4);
            }
            dirty[(ty / TILE) * cols + tx / TILE] = 1;
        }
    }
    pthread_mutex_unlock(&stage_mu);
}

/* Main thread: moves dirty tiles from the staging frame into the framebuffer
 * and marks them modified. All LibVNCServer calls stay on this thread. */
static void flush_dirty(void)
{
    int w = cfg.width, h = cfg.height, tx, ty, y, cols = (w + TILE - 1) / TILE;

    pthread_mutex_lock(&stage_mu);
    for (ty = 0; ty < h; ty += TILE) {
        int th = ty + TILE > h ? h - ty : TILE;
        for (tx = 0; tx < w; tx += TILE) {
            int tw = tx + TILE > w ? w - tx : TILE;
            if (!dirty[(ty / TILE) * cols + tx / TILE])
                continue;
            dirty[(ty / TILE) * cols + tx / TILE] = 0;
            for (y = ty; y < ty + th; y++) {
                size_t o = ((size_t)y * w + tx) * 4;
                memcpy(screen->frameBuffer + o, stage + o, (size_t)tw * 4);
            }
            rfbMarkRectAsModified(screen, tx, ty, tx + tw, ty + th);
        }
    }
    pthread_mutex_unlock(&stage_mu);
}

/* Sleeps until deadline or a stop request; returns 1 on stop. */
static int wait_or_stop(const struct timespec *deadline)
{
    int stop;

    pthread_mutex_lock(&cap.mu);
    while (!cap.stop && pthread_cond_timedwait(&cap.cv, &cap.mu, deadline) == 0)
        ;
    stop = cap.stop;
    pthread_mutex_unlock(&cap.mu);
    return stop;
}

/* Capture thread: owns every capture_* call. Opens, grabs frames at fps_max
 * until asked to stop, closes. */
static void *capture_main(void *arg)
{
    uint8_t *cur = malloc((size_t)cfg.width * cfg.height * 4);
    int has_video = 0, fails = 0;
    struct timespec next, now;

    (void)arg;
    if (!cur || capture_open(cfg.width, cfg.height, &has_video) != 0) {
        logf_("capture failed to open; clients see a static picture");
        free(cur);
        return NULL;
    }
    logf_("capture open (video layer %s)", has_video ? "yes" : "no");
    clock_gettime(CLOCK_MONOTONIC, &next);
    for (;;) {
        if (capture_frame(cur, cfg.width * 4) == 0) {
            publish_frame(cur);
            fails = 0;
        } else if (fails++ == 0) {
            logf_("capture_frame failed");
        }
        next.tv_nsec += 1000000000L / atomic_load(&fps_now);
        if (next.tv_nsec >= 1000000000L) {
            next.tv_nsec -= 1000000000L;
            next.tv_sec++;
        }
        clock_gettime(CLOCK_MONOTONIC, &now);
        if (next.tv_sec < now.tv_sec || (next.tv_sec == now.tv_sec && next.tv_nsec < now.tv_nsec))
            next = now; /* running behind: no burst, no spin */
        if (wait_or_stop(&next))
            break;
    }
    capture_close();
    free(cur);
    return NULL;
}

static void capture_start(void)
{
    if (cap.running)
        return;
    atomic_store(&fps_now, cfg.fps_max);
    gov.prev[0] = '\0'; /* first sample of the session only sets the baseline */
    cap.stop = 0;
    if (pthread_create(&cap.th, NULL, capture_main, NULL) == 0)
        cap.running = 1;
    else
        logf_("cannot start capture thread");
}

/* Asks the capture thread to stop and waits for it (it closes capture itself). */
static void capture_stop(void)
{
    if (!cap.running)
        return;
    pthread_mutex_lock(&cap.mu);
    cap.stop = 1;
    pthread_cond_signal(&cap.cv);
    pthread_mutex_unlock(&cap.mu);
    pthread_join(cap.th, NULL);
    cap.running = 0;
}

/* Monotonic seconds. */
static double mono_s(void)
{
    struct timespec t;

    clock_gettime(CLOCK_MONOTONIC, &t);
    return t.tv_sec + t.tv_nsec / 1e9;
}

/* Reads /proc/self/stat (whole process, both threads) into buf; 0 on success. */
static int read_self_stat(char *buf, size_t n)
{
    FILE *f = fopen("/proc/self/stat", "r");
    size_t got;

    if (!f)
        return -1;
    got = fread(buf, 1, n - 1, f);
    fclose(f);
    buf[got] = '\0';
    return got ? 0 : -1;
}

/* Main loop, every pass: while capturing, every 2 s measures the process CPU
 * and lets the governor adjust fps; logs changes, and the CPU every 30 s. */
static void governor_tick(void)
{
    char cur[sizeof gov.prev];
    double t, frac;
    int old, next;

    if (!cap.running) {
        gov.prev[0] = '\0';
        return;
    }
    t = mono_s();
    if (gov.prev[0] && t - gov.prev_t < GOV_PERIOD_S)
        return;
    if (read_self_stat(cur, sizeof cur) != 0)
        return;
    if (!gov.prev[0]) {
        gov.last_log_t = t;
    } else if ((frac = cpustat_fraction(gov.prev, cur, t - gov.prev_t, sysconf(_SC_CLK_TCK))) >= 0) {
        old = atomic_load(&fps_now);
        next = governor_next(old, cfg.fps_max, frac);
        if (next != old) {
            atomic_store(&fps_now, next);
            logf_("fps %d -> %d (cpu %.2f)", old, next, frac);
            gov.last_log_t = t;
        } else if (t - gov.last_log_t >= GOV_LOG_S) {
            logf_("fps %d steady (cpu %.2f)", old, frac);
            gov.last_log_t = t;
        }
    }
    memcpy(gov.prev, cur, sizeof cur);
    gov.prev_t = t;
}

/* Opens the TV input channel with a fresh, unsynced pointer. */
static void input_start(void)
{
    memset(&pstate, 0, sizeof pstate);
    pstate.scale = cfg.pointer_scale;
    input = lginput_open(LGINPUT_KEY_PATH);
    if (!input)
        logf_("input unavailable, viewing only; if pairing was revoked, re-run `remoteview --pair`");
}

static void input_stop(void)
{
    lginput_close(input);
    input = NULL;
}

/* Drops input after a failure; viewing continues. */
static void input_failed(void)
{
    logf_("input connection lost, input dropped until the next session");
    input_stop();
}

/* Runs the work for a session_action bitmask. */
static void apply(int actions)
{
    if (actions & SA_OPEN_CAPTURE) {
        capture_start();
        input_start();
    }
    if (actions & SA_CLOSE_CAPTURE) {
        capture_stop();
        input_stop();
    }
    if (actions & SA_TOAST_START)
        toast_send(1);
    if (actions & SA_TOAST_END)
        toast_send(0);
}

/* 1 if the password file exists and is non-empty (the default passwordCheck
 * re-reads and decrypts it on every authentication). */
static int have_password(void)
{
    struct stat st;

    return stat(PASSWD_PATH, &st) == 0 && st.st_size > 0;
}

/* Uncounts the client if it had authenticated. */
static void client_gone(rfbClientPtr cl)
{
    int *authed = cl->clientData;

    if (authed && *authed)
        apply(session_client_gone(&sess));
    free(authed);
    cl->clientData = NULL;
}

/* Refuses non-LAN peers and everyone while no password is set. */
static enum rfbNewClientAction new_client(rfbClientPtr cl)
{
    struct in_addr a;

    if (inet_pton(AF_INET, cl->host, &a) != 1 || !lan_allowed(ntohl(a.s_addr))) {
        logf_("refused %s: not a LAN address", cl->host);
        return RFB_CLIENT_REFUSE;
    }
    if (!have_password()) {
        logf_("refused %s: no password set (run `remoteview --store-password`)", cl->host);
        return RFB_CLIENT_REFUSE;
    }
    cl->clientData = calloc(1, sizeof(int)); /* 0 until authenticated */
    if (!cl->clientData)
        return RFB_CLIENT_REFUSE;
    cl->clientGoneHook = client_gone;
    return RFB_CLIENT_ACCEPT;
}

/* Counts clients that have finished authentication (state NORMAL). */
static void scan_clients(void)
{
    rfbClientIteratorPtr it = rfbGetClientIterator(screen);
    rfbClientPtr cl;

    while ((cl = rfbClientIteratorNext(it))) {
        int *authed = cl->clientData;
        if (authed && !*authed && cl->state == RFB_NORMAL) {
            *authed = 1;
            logf_("client %s connected", cl->host);
            apply(session_client_added(&sess));
        }
    }
    rfbReleaseClientIterator(it);
}

/* VNC pointer event to the TV cursor. */
static void on_pointer(int mask, int x, int y, rfbClientPtr cl)
{
    char out[8192];
    int n;

    (void)cl;
    if (!input)
        return;
    n = pointer_update(&pstate, x, y, mask, out, sizeof out);
    if (n > 0 && lginput_pointer(input, out, (size_t)n) < 0)
        input_failed();
}

/* VNC key press to a remote button or typed text. */
static void on_key(rfbBool down, rfbKeySym key, rfbClientPtr cl)
{
    const char *button;
    char text[2];

    (void)cl;
    if (!down || !input)
        return;
    button = keymap_button((uint32_t)key);
    if (button && !strcmp(button, "HOME")) {
        /* A network HOME press skips LG Input Hook and opens LG's home bar;
         * launch CustomWebOS directly, as the remote's Home button does. */
        if (lginput_launch(input, HOME_APP_ID) < 0)
            input_failed();
    } else if (button) {
        if (lginput_button(input, button) < 0)
            input_failed();
    } else if (keymap_text((uint32_t)key, text)) {
        if (lginput_text(input, text) < 0)
            input_failed();
    }
}

/* Stops everything from normal context, in order, then exits 128+sig. */
static void shut_down(int sig)
{
    capture_stop();
    input_stop();
    rfbShutdownServer(screen, TRUE);
    rfbScreenCleanup(screen);
    exit(128 + sig);
}

int server_run(const rv_config *config)
{
    static const int sigs[] = { SIGTERM, SIGINT, SIGHUP, SIGQUIT };
    sigset_t set;
    pthread_condattr_t ca;
    struct timespec zero = { 0, 0 };
    char *argv0[1] = { NULL };
    int argc = 0, i;

    cfg = *config;
    openlog("remoteview", LOG_PID, LOG_DAEMON);
    rfbLog = logf_;
    rfbErr = logf_;

    /* Termination signals stay pending in every thread (all inherit this mask)
     * and are collected by the main loop, so no handler ever interrupts capture. */
    sigemptyset(&set);
    for (i = 0; i < 4; i++)
        sigaddset(&set, sigs[i]);
    pthread_sigmask(SIG_BLOCK, &set, NULL);

    pthread_mutex_init(&cap.mu, NULL);
    pthread_condattr_init(&ca);
    pthread_condattr_setclock(&ca, CLOCK_MONOTONIC);
    pthread_cond_init(&cap.cv, &ca);

    screen = rfbGetScreen(&argc, argv0, cfg.width, cfg.height, 8, 3, 4);
    if (!screen)
        return 1;
    screen->frameBuffer = calloc(1, (size_t)cfg.width * cfg.height * 4);
    stage = calloc(1, (size_t)cfg.width * cfg.height * 4);
    dirty = calloc(1, (size_t)((cfg.width + TILE - 1) / TILE) * ((cfg.height + TILE - 1) / TILE));
    if (!screen->frameBuffer || !stage || !dirty)
        return 1;
    /* Captured frames are bytes R,G,B,A in memory (checked against a live frame on
     * the TV, tv-log 2026-10-26), so red is the low byte; alpha ignored. */
    screen->serverFormat.bitsPerPixel = 32;
    screen->serverFormat.depth = 24;
    screen->serverFormat.bigEndian = 0;
    screen->serverFormat.trueColour = 1;
    screen->serverFormat.redMax = screen->serverFormat.greenMax = screen->serverFormat.blueMax = 255;
    screen->serverFormat.redShift = 0;
    screen->serverFormat.greenShift = 8;
    screen->serverFormat.blueShift = 16;
    screen->desktopName = "LG TV";
    screen->authPasswdData = (void *)PASSWD_PATH;
    screen->newClientHook = new_client;
    screen->ptrAddEvent = on_pointer;
    screen->kbdAddEvent = on_key;
    if (!have_password())
        logf_("no password set; every client is refused until `remoteview --store-password`");
    rfbInitServer(screen);
    if (screen->listenSock == RFB_INVALID_SOCKET) {
        logf_("cannot listen on port %d", screen->port);
        return 1;
    }
    logf_("listening on port %d, %dx%d at up to %d fps", screen->port, cfg.width, cfg.height, cfg.fps_max);

    for (;;) {
        int sig;

        rfbProcessEvents(screen, cap.running ? 1000000 / atomic_load(&fps_now) : 100000);
        governor_tick();
        flush_dirty();
        scan_clients();
        if (input && lginput_poll(input) < 0)
            input_failed();
        sig = sigtimedwait(&set, NULL, &zero);
        if (sig > 0)
            shut_down(sig);
    }
}

int server_store_password(void)
{
    char line[256];
    int fd;

    if (!fgets(line, sizeof line, stdin)) {
        fprintf(stderr, "no password on stdin\n");
        return 1;
    }
    line[strcspn(line, "\r\n")] = '\0';
    if (!line[0]) {
        fprintf(stderr, "empty password refused\n");
        return 1;
    }
    if (strlen(line) > 8) {
        fprintf(stderr, "warning: VNC passwords are limited to 8 characters; truncating\n");
        line[8] = '\0';
    }
    mkdir("/home/root/.config", 0755);
    mkdir(CONFIG_DIR, 0700);
    /* Create mode 600 up front; rfbEncryptAndStorePasswd truncates and keeps it. */
    fd = open(PASSWD_PATH, O_WRONLY | O_CREAT, 0600);
    if (fd < 0) {
        fprintf(stderr, "cannot write %s: %s\n", PASSWD_PATH, strerror(errno));
        return 1;
    }
    fchmod(fd, 0600);
    close(fd);
    if (rfbEncryptAndStorePasswd(line, PASSWD_PATH) != 0) {
        fprintf(stderr, "cannot write %s\n", PASSWD_PATH);
        return 1;
    }
    puts("password stored");
    return 0;
}
