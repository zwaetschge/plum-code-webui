# Godot engine image for Plum Code WebUI.
#
# Godot ships glibc-linked Linux builds and the WebUI runs on Alpine/musl, so
# the engine cannot live in the main image — gcompat does not carry it (the
# binary fails relocation on fcntl64, __res_init and friends). Instead the
# engine gets its own glibc image and the MCP bridge drives it with one-shot
# `docker run` calls through the socket proxy. That also keeps the Android SDK,
# a ~1.5 GB dependency needed only for exports, out of the WebUI image.
#
# Temurin is the base because signing an APK needs a JDK anyway: Godot's
# non-Gradle Android export repacks its template and then calls apksigner.
FROM eclipse-temurin:17-jdk-noble

ARG GODOT_VERSION=4.7.2
ARG GODOT_RELEASE=stable
ARG ANDROID_CMDLINE_TOOLS=13114758
ARG ANDROID_PLATFORM=android-35
ARG ANDROID_BUILD_TOOLS=35.0.0

ENV GODOT_VERSION=${GODOT_VERSION} \
    GODOT_RELEASE=${GODOT_RELEASE} \
    ANDROID_HOME=/opt/android-sdk \
    ANDROID_SDK_ROOT=/opt/android-sdk \
    JAVA_HOME=/opt/java/openjdk \
    XDG_DATA_HOME=/opt/godot/share \
    XDG_CONFIG_HOME=/opt/godot/config \
    XDG_CACHE_HOME=/opt/godot/cache \
    HOME=/opt/godot/home

RUN mkdir -p /opt/godot/home /opt/godot/share /opt/godot/config /opt/godot/cache

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates curl unzip zip python3 git \
 && rm -rf /var/lib/apt/lists/*

# --- Engine -----------------------------------------------------------------
RUN set -eux; \
    cd /tmp; \
    curl -fsSL -o godot.zip \
      "https://github.com/godotengine/godot/releases/download/${GODOT_VERSION}-${GODOT_RELEASE}/Godot_v${GODOT_VERSION}-${GODOT_RELEASE}_linux.x86_64.zip"; \
    unzip -q godot.zip; \
    mv "Godot_v${GODOT_VERSION}-${GODOT_RELEASE}_linux.x86_64" /usr/local/bin/godot; \
    chmod 755 /usr/local/bin/godot; \
    rm -f godot.zip; \
    godot --headless --version

# --- Export templates -------------------------------------------------------
# Without these an export fails with "No export template found"; the Android
# ones are the prebuilt APK shells the exporter repacks around the PCK.
RUN set -eux; \
    cd /tmp; \
    curl -fsSL -o templates.tpz \
      "https://github.com/godotengine/godot/releases/download/${GODOT_VERSION}-${GODOT_RELEASE}/Godot_v${GODOT_VERSION}-${GODOT_RELEASE}_export_templates.tpz"; \
    mkdir -p "${XDG_DATA_HOME}/godot/export_templates/${GODOT_VERSION}.${GODOT_RELEASE}"; \
    unzip -q templates.tpz -d /tmp/tpl; \
    mv /tmp/tpl/templates/* "${XDG_DATA_HOME}/godot/export_templates/${GODOT_VERSION}.${GODOT_RELEASE}/"; \
    rm -rf templates.tpz /tmp/tpl; \
    ls "${XDG_DATA_HOME}/godot/export_templates/${GODOT_VERSION}.${GODOT_RELEASE}/" | head

# --- Android SDK ------------------------------------------------------------
RUN set -eux; \
    mkdir -p "${ANDROID_HOME}/cmdline-tools"; \
    cd /tmp; \
    curl -fsSL -o cmdline.zip \
      "https://dl.google.com/android/repository/commandlinetools-linux-${ANDROID_CMDLINE_TOOLS}_latest.zip"; \
    unzip -q cmdline.zip -d "${ANDROID_HOME}/cmdline-tools"; \
    mv "${ANDROID_HOME}/cmdline-tools/cmdline-tools" "${ANDROID_HOME}/cmdline-tools/latest"; \
    rm -f cmdline.zip; \
    yes | "${ANDROID_HOME}/cmdline-tools/latest/bin/sdkmanager" --licenses > /dev/null; \
    "${ANDROID_HOME}/cmdline-tools/latest/bin/sdkmanager" \
      "platform-tools" "platforms;${ANDROID_PLATFORM}" "build-tools;${ANDROID_BUILD_TOOLS}" > /dev/null; \
    test -x "${ANDROID_HOME}/build-tools/${ANDROID_BUILD_TOOLS}/apksigner"

ENV PATH="${PATH}:/opt/android-sdk/platform-tools:/opt/android-sdk/cmdline-tools/latest/bin"

# --- Debug keystore ---------------------------------------------------------
# The stock Android debug identity. It signs nothing that leaves the device, so
# the well-known password is the point: any machine can rebuild an equivalent.
RUN set -eux; \
    mkdir -p /opt/godot; \
    keytool -keyalg RSA -genkeypair -alias androiddebugkey \
      -keypass android -storepass android -validity 10950 -keysize 2048 \
      -dname "CN=Android Debug,O=Android,C=US" \
      -keystore /opt/godot/debug.keystore -storetype pkcs12

# --- Editor settings --------------------------------------------------------
COPY patch-editor-settings.py /usr/local/bin/patch-editor-settings.py
RUN set -eux; \
    mkdir -p /tmp/seed; \
    printf 'config_version=5\n\n[application]\nconfig/name="seed"\n' > /tmp/seed/project.godot; \
    godot --headless --editor --quit --path /tmp/seed >/dev/null 2>&1 || true; \
    python3 /usr/local/bin/patch-editor-settings.py; \
    rm -rf /tmp/seed

# The bridge runs this image with -u <uid>:<gid> so files land owned by the
# caller, which means every path Godot writes to has to be world-writable.
RUN chmod -R 0777 /opt/godot && mkdir -p /opt/godot/home && chmod 0777 /opt/godot/home

WORKDIR /project
ENTRYPOINT []
CMD ["godot", "--headless", "--version"]
