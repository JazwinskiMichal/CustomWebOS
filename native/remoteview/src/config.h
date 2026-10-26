#ifndef REMOTEVIEW_CONFIG_H
#define REMOTEVIEW_CONFIG_H

#define CONFIG_PATH "/home/root/.config/customwebos/remoteview.conf"
#define PASSWD_PATH "/home/root/.config/customwebos/remoteview.passwd"

typedef struct { int width, height, fps_max; double pointer_scale; } rv_config;

/* Fills out with defaults (960x540, 10 fps, scale 0.51), then applies the
 * "key=value" lines of text (keys width, height, fps, pointer_scale; '#'
 * comments), clamping values. Unknown keys are ignored. Returns the number of
 * bad lines. */
int config_parse(const char *text, rv_config *out);

#endif
