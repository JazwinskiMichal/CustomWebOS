#include "capture.h"

#include <libgen.h>
#include <libyuv.h>
#include <limits.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>

#include "converter.h"
#include "log.h"
#include "unicapture.h"

#define UI_BACKEND "libgm_backend.so"
#define VIDEO_BACKEND "libdile_vt_backend.so"

static capture_backend_t ui, video;
static int ui_up, video_up;      /* backend initialised (needs cleanup) */
static int ui_run, video_run;    /* backend started (needs terminate) */
static int cap_w, cap_h;
static converter_t ui_conv, video_conv;

/* Builds the path of a backend .so beside this binary (resolved via /proc/self/exe). */
static int backend_path(char *out, size_t n, const char *name)
{
    char exe[PATH_MAX];
    ssize_t len = readlink("/proc/self/exe", exe, sizeof exe - 1);

    if (len <= 0)
        return -1;
    exe[len] = 0;
    return snprintf(out, n, "%s/%s", dirname(exe), name) < (int)n ? 0 : -1;
}

/* Loads and initialises one backend; returns 0 on success. */
static int load_backend(capture_backend_t *be, const char *name, cap_backend_config_t *cfg)
{
    char path[PATH_MAX + 64];

    if (backend_path(path, sizeof path, name) < 0)
        return -1;
    memset(be, 0, sizeof *be);
    return unicapture_init_backend(cfg, be, path);
}

/* Stops and releases the video layer. */
static void close_video(void)
{
    if (video_run)
        video.terminate(video.state);
    video_run = 0;
    if (video_up)
        video.cleanup(video.state);
    video_up = 0;
}

int capture_open(int width, int height, int *has_video)
{
    cap_backend_config_t cfg;
    int ret;

    *has_video = 0;
    if (ui_up)
        return 0;
    log_init();
    memset(&cfg, 0, sizeof cfg);
    cfg.resolution_width = width;
    cfg.resolution_height = height;
    cap_w = width;
    cap_h = height;
    converter_init(&ui_conv);
    converter_init(&video_conv);

    if (load_backend(&ui, UI_BACKEND, &cfg) != 0) {
        fprintf(stderr, "capture: UI layer (%s) failed to open\n", UI_BACKEND);
        return -1;
    }
    ui_up = 1;
    if (ui.start(ui.state) != 0) {
        fprintf(stderr, "capture: UI layer failed to start\n");
        capture_close();
        return -1;
    }
    ui_run = 1;

    if ((ret = load_backend(&video, VIDEO_BACKEND, &cfg)) != 0) {
        fprintf(stderr, "capture: video layer (DILE_VT) failed to open (code %d), UI only\n", ret);
        ERR("video layer failed to open (code %d), continuing with UI only", ret);
        return 0;
    }
    video_up = 1;
    if (video.start(video.state) != 0) {
        fprintf(stderr, "capture: video layer (DILE_VT) failed to start, UI only\n");
        ERR("video layer failed to start, continuing with UI only");
        close_video();
        return 0;
    }
    video_run = 1;
    *has_video = 1;
    return 0;
}

int capture_frame(uint8_t *argb_out, int stride)
{
    frame_info_t uf = { PIXFMT_INVALID }, vf = { PIXFMT_INVALID };
    frame_info_t uc = { PIXFMT_INVALID }, vc = { PIXFMT_INVALID };
    int got_ui = 0, got_video = 0, w, h, rc = -1;

    if (!ui_run)
        return -1;
    if (video_run) {
        video.wait(video.state);
        got_video = video.acquire_frame(video.state, &vf) == 0;
        if (got_video && converter_run(&video_conv, &vf, &vc, PIXFMT_ARGB) != 0)
            got_video = 0;
    }
    if (ui.acquire_frame(ui.state, &uf) == 0) {
        got_ui = 1;
        if (converter_run(&ui_conv, &uf, &uc, PIXFMT_ARGB) != 0)
            got_ui = 0;
    }

    if (got_ui && got_video) {
        w = vc.width < uc.width ? vc.width : uc.width;
        h = vc.height < uc.height ? vc.height : uc.height;
        w = w < cap_w ? w : cap_w;
        h = h < cap_h ? h : cap_h;
        ARGBBlend(uc.planes[0].buffer, uc.planes[0].stride, vc.planes[0].buffer, vc.planes[0].stride,
                  argb_out, stride, w, h);
        rc = 0;
    } else if (got_ui || got_video) {
        frame_info_t *f = got_ui ? &uc : &vc;
        w = f->width < cap_w ? f->width : cap_w;
        h = f->height < cap_h ? f->height : cap_h;
        ARGBCopy(f->planes[0].buffer, f->planes[0].stride, argb_out, stride, w, h);
        rc = 0;
    }

    /* Always release: DILE_VT stays frozen until the frame is released. */
    if (video_run)
        video.release_frame(video.state, &vf);
    ui.release_frame(ui.state, &uf);
    return rc;
}

void capture_close(void)
{
    close_video();
    if (ui_run)
        ui.terminate(ui.state);
    ui_run = 0;
    if (ui_up)
        ui.cleanup(ui.state);
    ui_up = 0;
    converter_release(&ui_conv);
    converter_release(&video_conv);
    converter_init(&ui_conv);
    converter_init(&video_conv);
}
