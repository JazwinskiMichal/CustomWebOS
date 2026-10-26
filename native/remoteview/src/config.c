#include "config.h"

#include <math.h>
#include <stdlib.h>
#include <string.h>

static int clampi(long v, int lo, int hi)
{
    return v < lo ? lo : v > hi ? hi : (int)v;
}

/* Parses a whole-string integer; returns 0 on success. */
static int parse_int(const char *s, long *v)
{
    char *end;
    *v = strtol(s, &end, 10);
    return end == s || *end ? -1 : 0;
}

static int parse_dbl(const char *s, double *v)
{
    char *end;
    *v = strtod(s, &end);
    return end == s || *end ? -1 : 0;
}

/* Applies one trimmed line; returns 1 if it is bad. */
static int apply_line(char *line, rv_config *c)
{
    char *eq, *key = line, *val, *e;
    long iv;
    double dv;

    while (*key == ' ' || *key == '\t')
        key++;
    if (!*key || *key == '#')
        return 0;
    eq = strchr(key, '=');
    if (!eq)
        return 1;
    *eq = '\0';
    val = eq + 1;
    for (e = key + strlen(key); e > key && (e[-1] == ' ' || e[-1] == '\t'); )
        *--e = '\0';
    while (*val == ' ' || *val == '\t')
        val++;
    for (e = val + strlen(val); e > val && (e[-1] == ' ' || e[-1] == '\t' || e[-1] == '\r'); )
        *--e = '\0';

    if (!strcmp(key, "width") || !strcmp(key, "height") || !strcmp(key, "fps")) {
        if (parse_int(val, &iv))
            return 1;
        if (key[0] == 'w')
            c->width = clampi(iv, 320, 1920);
        else if (key[0] == 'h')
            c->height = clampi(iv, 240, 1080);
        else
            c->fps_max = clampi(iv, 1, 30);
    } else if (!strcmp(key, "pointer_scale")) {
        if (parse_dbl(val, &dv) || !isfinite(dv))
            return 1;
        c->pointer_scale = dv < 0.25 ? 0.25 : dv > 4 ? 4 : dv;
    }
    return 0;
}

int config_parse(const char *text, rv_config *out)
{
    int bad = 0;
    const char *p = text;

    out->width = 960;
    out->height = 540;
    out->fps_max = 15;
    out->pointer_scale = 0.51;
    while (p && *p) {
        char line[128];
        size_t n = strcspn(p, "\n");

        if (n >= sizeof line)
            bad++;
        else {
            memcpy(line, p, n);
            line[n] = '\0';
            bad += apply_line(line, out);
        }
        p += n;
        if (*p == '\n')
            p++;
    }
    return bad;
}
