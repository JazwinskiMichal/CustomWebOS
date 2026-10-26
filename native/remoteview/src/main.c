#include <stdio.h>
#include <string.h>

int main(int argc, char **argv)
{
    if (argc > 1 && strcmp(argv[1], "--version") == 0) {
        printf("remoteview %s\n", REMOTEVIEW_VERSION);
        return 0;
    }
    fprintf(stderr, "usage: remoteview --version\n");
    return 2;
}
