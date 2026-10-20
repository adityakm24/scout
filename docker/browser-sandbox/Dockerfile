# The Browser Agent's sandbox image: Debian's Chromium with fonts for every script, run headless and
# unprivileged (the Scout app draws the browser frame from DevTools). Keep this package list in step with agent/agent_bridge/browser_image.py, which builds the same rootfs locally
# without Docker; bump its IMAGE_VERSION whenever this changes. Publish the built image to your
# registry and pin it by digest.
FROM debian:trixie-slim@sha256:a29215f6a35e51e22adffa17f89e9d2ef06214e64a2bad10d765c46aea49f11f

# Pinned archive snapshot: the same inputs give the same image.
RUN printf '%s\n' \
      'deb [check-valid-until=no] https://snapshot.debian.org/archive/debian/20261001T000000Z trixie main' \
      'deb [check-valid-until=no] https://snapshot.debian.org/archive/debian-security/20261001T000000Z trixie-security main' \
      > /etc/apt/sources.list \
 && rm -f /etc/apt/sources.list.d/* \
 && apt-get update \
 && apt-get install -y --no-install-recommends \
      chromium procps \
      fonts-noto-core fonts-noto-cjk fonts-noto-color-emoji fonts-dejavu-core \
 && rm -rf /var/lib/apt/lists/*

