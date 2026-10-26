#include "keymap.h"

#include <linux/input.h>

/* Special keys: edit here to change what the TV receives. */
static const struct { uint32_t keysym; int key; } special[] = {
    { 0xff51, KEY_LEFT },
    { 0xff52, KEY_UP },
    { 0xff53, KEY_RIGHT },
    { 0xff54, KEY_DOWN },
    { 0xff0d, KEY_ENTER },
    { 0xff1b, KEY_BACK },      /* Esc */
    { 0xff08, KEY_BACK },      /* BackSpace */
    { 0xff50, KEY_HOMEPAGE },  /* Home */
    { ' ',    KEY_SPACE },
};
#define NSPECIAL ((int)(sizeof special / sizeof special[0]))

/* Linux codes for 'a'..'z' (QWERTY, not contiguous). */
static const int letters[26] = {
    KEY_A, KEY_B, KEY_C, KEY_D, KEY_E, KEY_F, KEY_G, KEY_H, KEY_I, KEY_J,
    KEY_K, KEY_L, KEY_M, KEY_N, KEY_O, KEY_P, KEY_Q, KEY_R, KEY_S, KEY_T,
    KEY_U, KEY_V, KEY_W, KEY_X, KEY_Y, KEY_Z,
};

/* Linux codes for '0'..'9'. */
static const int digits[10] = {
    KEY_0, KEY_1, KEY_2, KEY_3, KEY_4, KEY_5, KEY_6, KEY_7, KEY_8, KEY_9,
};

int keymap_lookup(uint32_t keysym, int *linux_key, int *needs_shift)
{
    int i;

    *needs_shift = 0;
    if (keysym >= 'a' && keysym <= 'z') {
        *linux_key = letters[keysym - 'a'];
        return 1;
    }
    if (keysym >= 'A' && keysym <= 'Z') {
        *linux_key = letters[keysym - 'A'];
        *needs_shift = 1;
        return 1;
    }
    if (keysym >= '0' && keysym <= '9') {
        *linux_key = digits[keysym - '0'];
        return 1;
    }
    for (i = 0; i < NSPECIAL; i++) {
        if (special[i].keysym == keysym) {
            *linux_key = special[i].key;
            return 1;
        }
    }
    return 0;
}

int keymap_key_at(int i)
{
    int j, k;

    if (i < 0)
        return -1;
    if (i < 26)
        return letters[i];
    i -= 26;
    if (i < 10)
        return digits[i];
    i -= 10;
    /* specials, skipping codes already listed (Esc and BackSpace share one) */
    for (j = 0; j < NSPECIAL; j++) {
        int dup = 0;
        for (k = 0; k < j; k++)
            if (special[k].key == special[j].key)
                dup = 1;
        if (dup)
            continue;
        if (i-- == 0)
            return special[j].key;
    }
    return -1;
}
