#include "lanfilter.h"

int lan_allowed(uint32_t ip)
{
    return (ip >> 24) == 10 || (ip >> 20) == 0xac1 || (ip >> 16) == 0xc0a8 ||
           (ip >> 16) == 0xa9fe || (ip >> 24) == 127;
}
