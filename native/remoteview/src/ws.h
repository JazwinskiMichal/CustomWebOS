#ifndef REMOTEVIEW_WS_H
#define REMOTEVIEW_WS_H

#include <stddef.h>
#include <stdint.h>

/* Builds a masked client text frame (FIN set, opcode 1). Returns the frame
 * length, or -1 if outsz is too small. */
int ws_frame_text(const char *payload, size_t len, const uint8_t mask[4],
                  uint8_t *out, size_t outsz);

/* Builds a masked client pong frame (opcode 10) echoing payload (len <= 125). */
int ws_frame_pong(const uint8_t *payload, size_t len, const uint8_t mask[4],
                  uint8_t *out, size_t outsz);

/* Parses one unmasked server frame at buf. On success sets *opcode, *off
 * (payload offset) and *plen, and returns the whole frame's length. Returns 0
 * if the frame is incomplete, -1 if invalid (masked, or too large). */
int ws_parse(const uint8_t *buf, size_t len, int *opcode, size_t *off, size_t *plen);

/* Writes the HTTP upgrade request. Returns its length, or -1 if n is too small. */
int ws_handshake_request(char *out, size_t n, const char *host, int port,
                         const char *path, const char *key_b64);

#endif
