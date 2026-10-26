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
WORKDIR /src
