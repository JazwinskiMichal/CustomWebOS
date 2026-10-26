#undef NDEBUG
#include <assert.h>

#include "../src/lanfilter.h"

#define IP(a, b, c, d) (((uint32_t)(a) << 24) | ((b) << 16) | ((c) << 8) | (d))

int main(void)
{
    assert(lan_allowed(IP(192, 168, 88, 217)));
    assert(lan_allowed(IP(10, 0, 0, 1)));
    assert(lan_allowed(IP(172, 31, 255, 255)));
    assert(lan_allowed(IP(172, 16, 0, 0)));
    assert(lan_allowed(IP(169, 254, 1, 1)));
    assert(lan_allowed(IP(127, 0, 0, 1)));
    assert(!lan_allowed(IP(172, 32, 0, 1)));
    assert(!lan_allowed(IP(172, 15, 255, 255)));
    assert(!lan_allowed(IP(8, 8, 8, 8)));
    assert(!lan_allowed(IP(100, 64, 0, 1)));
    return 0;
}
