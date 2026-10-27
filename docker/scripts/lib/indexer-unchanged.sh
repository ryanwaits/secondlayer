#!/bin/bash
# True when recreating the indexer for this deploy would restart the same
# filesystem with the same config: the running container's image layers equal
# the new image's layers, and the compose config rendered with the RUNNING tag
# hashes to the container's own config-hash label (so only the tag differs).
# Images are tagged per deploy SHA, so the tag alone always changes.
# Needs $COMPOSE (the compose command) and the new image pulled locally.
indexer_unchanged() {
  local container="${INDEXER_CONTAINER:-secondlayer-indexer-1}"
  local running_image running_tag new_image running_layers new_layers label pinned
  [ "$(docker inspect -f '{{.State.Running}}' "$container" 2>/dev/null)" = "true" ] || return 1
  running_image=$(docker inspect -f '{{.Config.Image}}' "$container" 2>/dev/null) || return 1
  running_tag="${running_image##*:}"
  [ -n "$running_tag" ] && [ "$running_tag" != "$running_image" ] || return 1
  new_image=$($COMPOSE config --images indexer 2>/dev/null | head -n1)
  [ -n "$new_image" ] || return 1
  [ "$new_image" != "$running_image" ] || return 1 # same reference: compose decides, as before
  running_layers=$(docker image inspect -f '{{json .RootFS.Layers}}' "$(docker inspect -f '{{.Image}}' "$container" 2>/dev/null)" 2>/dev/null) || return 1
  new_layers=$(docker image inspect -f '{{json .RootFS.Layers}}' "$new_image" 2>/dev/null) || return 1
  [ -n "$running_layers" ] && [ "$running_layers" = "$new_layers" ] || return 1
  label=$(docker inspect -f '{{index .Config.Labels "com.docker.compose.config-hash"}}' "$container" 2>/dev/null) || return 1
  pinned=$(DEPLOY_IMAGE_TAG="$running_tag" $COMPOSE config --hash indexer 2>/dev/null | awk '{print $2}')
  [ -n "$label" ] && [ "$label" = "$pinned" ] || return 1
  return 0
}
