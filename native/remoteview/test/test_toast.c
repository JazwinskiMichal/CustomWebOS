#undef NDEBUG
#include <assert.h>
#include <string.h>

#include "../src/toast.h"

/* 1 if s ends with suffix. */
static int ends_with(const char *s, const char *suffix)
{
    size_t ls = strlen(s), lt = strlen(suffix);

    return ls >= lt && !strcmp(s + ls - lt, suffix);
}

int main(void)
{
    char buf[256];
    int n;

    n = toast_command(buf, sizeof buf, 1, "pl-PL");
    assert(n > 0 && n == (int)strlen(buf));
    assert(strstr(buf, "Zdalny podgląd: połączono") != NULL);
    assert(ends_with(buf, "< /dev/null > /dev/null 2>&1"));
    assert(strstr(buf, "luna://com.webos.notification/createToast") != NULL);
    assert(strstr(buf, "\"sourceId\":\"org.jazwinski.customwebos.home\"") != NULL);

    assert(toast_command(buf, sizeof buf, 0, "pl") > 0);
    assert(strstr(buf, "Zdalny podgląd: rozłączono") != NULL);

    assert(toast_command(buf, sizeof buf, 0, "en-GB") > 0);
    assert(strstr(buf, "Remote view ended") != NULL);
    assert(strstr(buf, "Zdalny") == NULL);

    assert(toast_command(buf, sizeof buf, 1, NULL) > 0);
    assert(strstr(buf, "Remote view started") != NULL);

    assert(toast_command(buf, 20, 1, "en-GB") == -1);
    return 0;
}
