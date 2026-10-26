#undef NDEBUG
#include <assert.h>
#include "../src/keymap.h"

static void expect(uint32_t sym, int key, int shift)
{
    int k = -1, s = -1;
    assert(keymap_lookup(sym, &k, &s) == 1);
    assert(k == key);
    assert(s == shift);
}

int main(void)
{
    int k, s;
    expect(0xff51, 105, 0); /* Left */
    expect(0xff52, 103, 0); /* Up */
    expect(0xff53, 106, 0); /* Right */
    expect(0xff54, 108, 0); /* Down */
    expect(0xff0d, 28, 0);  /* Enter */
    expect(0xff1b, 158, 0); /* Esc -> Back */
    expect(0xff08, 158, 0); /* BackSpace -> Back */
    expect(0xff50, 172, 0); /* Home */
    expect('a', 30, 0);
    expect('A', 30, 1);
    expect('1', 2, 0);
    expect(' ', 57, 0);
    assert(keymap_lookup(0xffbe, &k, &s) == 0); /* F1 */
    assert(keymap_key_at(0) > 0);
    assert(keymap_key_at(100000) == -1);
    return 0;
}
