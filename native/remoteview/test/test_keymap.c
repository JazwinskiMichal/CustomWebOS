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
    btn(0xffbe, "INPUT");      /* F1 */
    btn(0xffbf, "MUTE");       /* F2 */
    btn(0xffc0, "VOLUMEDOWN"); /* F3 */
    btn(0xffc1, "VOLUMEUP");   /* F4 */
    btn(0xff55, "CHANNELUP");  /* Page Up */
    btn(0xff56, "CHANNELDOWN"); /* Page Down */
    assert(keymap_button(0xffc5) == NULL); /* F8: the viewer's own menu */
    txt('a', "a");
    txt('A', "A");
    txt('?', "?");
    assert(keymap_text(0xff0d, o) == 0);
    return 0;
}
