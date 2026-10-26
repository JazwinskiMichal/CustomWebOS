#include "uinput.h"
#include "keymap.h"

#include <fcntl.h>
#include <string.h>
#include <sys/ioctl.h>
#include <unistd.h>
#include <linux/input.h>
#include <linux/uinput.h>

static void emit(int fd, int type, int code, int value)
{
    struct input_event ie;
    memset(&ie, 0, sizeof ie);
    ie.type = type;
    ie.code = code;
    ie.value = value;
    if (write(fd, &ie, sizeof ie) < 0) {
        /* device gone; nothing useful to do */
    }
}

int uinput_open(int width, int height)
{
    struct uinput_user_dev dev;
    int fd, i, k;

    fd = open("/dev/uinput", O_WRONLY | O_NONBLOCK);
    if (fd < 0)
        return -1;

    ioctl(fd, UI_SET_EVBIT, EV_KEY);
    ioctl(fd, UI_SET_EVBIT, EV_ABS);
    ioctl(fd, UI_SET_EVBIT, EV_SYN);
    for (i = 0; (k = keymap_key_at(i)) >= 0; i++)
        ioctl(fd, UI_SET_KEYBIT, k);
    ioctl(fd, UI_SET_KEYBIT, BTN_LEFT);
    ioctl(fd, UI_SET_KEYBIT, BTN_RIGHT);
    ioctl(fd, UI_SET_ABSBIT, ABS_X);
    ioctl(fd, UI_SET_ABSBIT, ABS_Y);

    memset(&dev, 0, sizeof dev);
    strncpy(dev.name, "remoteview", UINPUT_MAX_NAME_SIZE - 1);
    dev.id.bustype = BUS_VIRTUAL;
    dev.id.vendor = 0x1;
    dev.id.product = 0x1;
    dev.id.version = 1;
    dev.absmin[ABS_X] = 0;
    dev.absmax[ABS_X] = width - 1;
    dev.absmin[ABS_Y] = 0;
    dev.absmax[ABS_Y] = height - 1;

    if (write(fd, &dev, sizeof dev) != (ssize_t)sizeof dev ||
        ioctl(fd, UI_DEV_CREATE) < 0) {
        close(fd);
        return -1;
    }
    return fd;
}

void uinput_key(int fd, int key, int down)
{
    emit(fd, EV_KEY, key, down);
    emit(fd, EV_SYN, SYN_REPORT, 0);
}

void uinput_pointer(int fd, const pointer_event *ev, int n)
{
    int i;
    for (i = 0; i < n; i++) {
        if (ev[i].type == EV_ABS) {
            /* pointer_event move: code = x, value = y */
            emit(fd, EV_ABS, ABS_X, ev[i].code);
            emit(fd, EV_ABS, ABS_Y, ev[i].value);
        } else {
            emit(fd, ev[i].type, ev[i].code, ev[i].value);
        }
    }
    if (n > 0)
        emit(fd, EV_SYN, SYN_REPORT, 0);
}

void uinput_close(int fd)
{
    ioctl(fd, UI_DEV_DESTROY);
    close(fd);
}
