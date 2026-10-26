#ifndef REMOTEVIEW_LANFILTER_H
#define REMOTEVIEW_LANFILTER_H

#include <stdint.h>

/* 1 for 10/8, 172.16/12, 192.168/16, 169.254/16 and 127/8; else 0. */
int lan_allowed(uint32_t ipv4_host_order);

#endif
