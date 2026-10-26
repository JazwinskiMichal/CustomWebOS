#include "ssap.h"

#include <stdio.h>
#include <string.h>

#include "pairing_manifest.h"

int ssap_register_msg(char *out, size_t n, const char *client_key)
{
    int w;

    if (client_key)
        w = snprintf(out, n,
                     "{\"type\":\"register\",\"id\":\"reg0\",\"payload\":"
                     "{\"client-key\":\"%s\",%s}}",
                     client_key, PAIRING_PAYLOAD_FIELDS);
    else
        w = snprintf(out, n,
                     "{\"type\":\"register\",\"id\":\"reg0\",\"payload\":{%s}}",
                     PAIRING_PAYLOAD_FIELDS);
    return (w < 0 || (size_t)w >= n) ? -1 : w;
}

int ssap_request_msg(char *out, size_t n, const char *id, const char *uri,
                     const char *payload_json)
{
    int w;

    if (payload_json)
        w = snprintf(out, n,
                     "{\"type\":\"request\",\"id\":\"%s\",\"uri\":\"%s\",\"payload\":%s}",
                     id, uri, payload_json);
    else
        w = snprintf(out, n, "{\"type\":\"request\",\"id\":\"%s\",\"uri\":\"%s\"}", id, uri);
    return (w < 0 || (size_t)w >= n) ? -1 : w;
}

int ssap_find_string(const char *json, const char *key, char *out, size_t n)
{
    char pat[64];
    const char *p, *end;
    size_t len;

    if (snprintf(pat, sizeof pat, "\"%s\"", key) >= (int)sizeof pat)
        return 0;
    p = strstr(json, pat);
    if (!p)
        return 0;
    p += strlen(pat);
    while (*p == ' ')
        p++;
    if (*p++ != ':')
        return 0;
    while (*p == ' ')
        p++;
    if (*p++ != '"')
        return 0;
    end = strchr(p, '"');
    if (!end)
        return 0;
    len = (size_t)(end - p);
    if (len >= n)
        return 0;
    memcpy(out, p, len);
    out[len] = '\0';
    return 1;
}

int ssap_url_path(const char *url, char *path, size_t n)
{
    const char *p = strstr(url, "://");
    size_t len;

    if (!p)
        return 0;
    p = strchr(p + 3, '/');
    if (!p)
        return 0;
    len = strlen(p);
    if (len >= n)
        return 0;
    memmove(path, p, len + 1);
    return 1;
}
