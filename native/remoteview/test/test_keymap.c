#undef NDEBUG
#include <assert.h>
#include <string.h>
#include "../src/keymap.h"

static void btn(uint32_t sym, const char *name)
{
    const char *b = keymap_button(sym);
    assert(b && strcmp(b, name) == 0);
}

static void txt(uint32_t sym, const char *s)
{
    char out[2] = { 0, 0 };
    assert(keymap_text(sym, out) == 1);
    assert(out[0] == s[0] && out[1] == 0);
}

int main(void)
{
    char o[2];
    btn(0xff51, "LEFT");
    btn(0xff52, "UP");
    btn(0xff53, "RIGHT");
    btn(0xff54, "DOWN");
    btn(0xff0d, "ENTER");
    btn(0xff1b, "BACK");
    btn(0xff08, "BACK");
    btn(0xff50, "HOME");
    assert(keymap_button(0xffbe) == NULL);
    txt('a', "a");
    txt('A', "A");
    txt('?', "?");
    assert(keymap_text(0xff0d, o) == 0);
    return 0;
}
