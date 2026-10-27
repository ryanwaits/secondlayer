#!/bin/bash
# True while the archive publish unit is running. The unit is Type=oneshot, so
# a running instance reports ActiveState=activating, never active; `systemctl
# is-active` exits 3 for it and reads as idle. Ask for the state itself.
archive_publish_busy() {
  local state
  state=$(systemctl show -p ActiveState --value "${ARCHIVE_PUBLISH_UNIT:-secondlayer-archive-publish.service}" 2>/dev/null || true)
  case "$state" in
    active|activating|reloading|deactivating) return 0 ;;
    *) return 1 ;;
  esac
}
