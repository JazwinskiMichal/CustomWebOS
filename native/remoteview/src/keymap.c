#include "keymap.h"

/* Special keys: edit here to change what the TV receives. */
static const struct { uint32_t keysym; const char *name; } special[] = {
    { 0xff51, "LEFT" },
    { 0xff52, "UP" },
    { 0xff53, "RIGHT" },
    { 0xff54, "DOWN" },
    { 0xff0d, "ENTER" },
    { 0xff1b, "BACK" },  /* Esc */
    { 0xff08, "BACK" },  /* BackSpace */
    { 0xff50, "HOME" },  /* Home */
    { 0xffbe, "INPUT" },       /* F1: LG's source picker (server.c shows it) */
    { 0xffbf, "MUTE" },        /* F2 */
    { 0xffc0, "VOLUMEDOWN" },  /* F3 */
    { 0xffc1, "VOLUMEUP" },    /* F4 */
    { 0xff55, "CHANNELUP" },   /* Page Up */
    { 0xff56, "CHANNELDOWN" }, /* Page Down */
};

const char *keymap_button(uint32_t keysym)
{
    unsigned i;
    for (i = 0; i < sizeof special / sizeof special[0]; i++)
        if (special[i].keysym == keysym)
            return special[i].name;
    return NULL;
}

int keymap_text(uint32_t keysym, char out[2])
{
    if (keysym < 0x20 || keysym > 0x7e)
        return 0;
    out[0] = (char)keysym;
    out[1] = '\0';
    return 1;
}
