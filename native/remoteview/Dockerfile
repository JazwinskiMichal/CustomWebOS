FROM ubuntu:24.04
RUN apt-get update \
 && apt-get install -y --no-install-recommends cmake build-essential git wget ca-certificates file \
 && rm -rf /var/lib/apt/lists/*
# LG webOS cross toolchain (arm-webos-linux-gnueabi), relocated to /opt.
RUN wget -q -O /tmp/sdk.tar.gz https://github.com/openlgtv/buildroot-nc4/releases/download/webos-b17b4cc/arm-webos-linux-gnueabi_sdk-buildroot.tar.gz \
 && echo "1f69af43caac4b6898d8f0323c975be60af04abdd1e1c144773072b28c961c20  /tmp/sdk.tar.gz" | sha256sum -c - \
 && tar -xzf /tmp/sdk.tar.gz -C /opt \
 && rm /tmp/sdk.tar.gz \
 && /opt/arm-webos-linux-gnueabi_sdk-buildroot/relocate-sdk.sh
ENV TOOLCHAIN_FILE=/opt/arm-webos-linux-gnueabi_sdk-buildroot/share/buildroot/toolchainfile.cmake
# LibVNCServer 0.9.14, static, for the TV. zlib and libjpeg come from the toolchain sysroot.
RUN wget -q -O /tmp/lvnc.tar.gz https://github.com/LibVNC/libvncserver/archive/refs/tags/LibVNCServer-0.9.14.tar.gz  && echo "83104e4f7e28b02f8bf6b010d69b626fae591f887e949816305daebae527c9a5  /tmp/lvnc.tar.gz" | sha256sum -c -  && mkdir /tmp/lvnc && tar -xzf /tmp/lvnc.tar.gz -C /tmp/lvnc --strip-components=1  && cmake -S /tmp/lvnc -B /tmp/lvnc/build -DCMAKE_TOOLCHAIN_FILE=$TOOLCHAIN_FILE -DCMAKE_BUILD_TYPE=Release       -DCMAKE_INSTALL_PREFIX=/opt/libvnc -DBUILD_SHARED_LIBS=OFF       -DWITH_OPENSSL=OFF -DWITH_GNUTLS=OFF -DWITH_WEBSOCKETS=OFF -DWITH_SYSTEMD=OFF -DWITH_GCRYPT=OFF       -DWITH_EXAMPLES=OFF -DWITH_TESTS=OFF -DWITH_SDL=OFF -DWITH_GTK=OFF -DWITH_PNG=OFF -DWITH_FFMPEG=OFF       -DWITH_IPv6=OFF -DWITH_THREADS=ON  && cmake --build /tmp/lvnc/build -j2 && cmake --install /tmp/lvnc/build  && rm -rf /tmp/lvnc /tmp/lvnc.tar.gz
WORKDIR /src
