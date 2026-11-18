# WAL-G backup sidecar: ships the WAL the postgres container already archives to
# /wal_archive up to R2, and takes periodic base backups for point-in-time
# recovery. Debian-based because the official wal-g release binaries are glibc
# (the postgres image is alpine/musl, so wal-g can't run there directly — hence
# a sidecar rather than changing archive_command to `wal-g wal-push`).
FROM debian:bookworm-slim

# Pin a known wal-g release. VERIFY the latest at
# https://github.com/wal-g/wal-g/releases and update the version, the asset
# name and the checksum together if it changes.
ARG WALG_VERSION=v3.0.9
ARG WALG_ASSET=wal-g-pg-22.04-amd64
# From the release's `<asset>.tar.gz.sha256`; update with the version.
ARG WALG_SHA256=4f03ee4679db7f660bfd1b2b8291ac5df247cd2ec48074b60c112f4897299f24

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl postgresql-client \
 && curl -fsSL -o /tmp/wal-g.tar.gz \
      "https://github.com/wal-g/wal-g/releases/download/${WALG_VERSION}/${WALG_ASSET}.tar.gz" \
 && echo "${WALG_SHA256}  /tmp/wal-g.tar.gz" | sha256sum -c - \
 && tar -xzf /tmp/wal-g.tar.gz -C /usr/local/bin \
 && mv "/usr/local/bin/${WALG_ASSET}" /usr/local/bin/wal-g \
 && chmod +x /usr/local/bin/wal-g \
 && rm -rf /tmp/wal-g.tar.gz /var/lib/apt/lists/*

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
