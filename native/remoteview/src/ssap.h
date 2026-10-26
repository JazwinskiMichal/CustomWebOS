#ifndef REMOTEVIEW_SSAP_H
#define REMOTEVIEW_SSAP_H

#include <stddef.h>

/* Registration message with the embedded pairing manifest. client_key NULL
 * adds no "client-key" field. Return the length, or -1 if n is too small. */
int ssap_register_msg(char *out, size_t n, const char *client_key);

/* Request message; payload_json NULL adds no payload. Same return values. */
int ssap_request_msg(char *out, size_t n, const char *id, const char *uri,
                     const char *payload_json);

/* Finds "key":"value" in json (no unescaping) and copies value to out.
 * Returns 1 on success, 0 if absent or if it does not fit. */
int ssap_find_string(const char *json, const char *key, char *out, size_t n);

/* ws://host:port/path -> "/path". Returns 1 on success, else 0. */
int ssap_url_path(const char *url, char *path, size_t n);

#endif
