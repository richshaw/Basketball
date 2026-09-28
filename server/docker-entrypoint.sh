#!/bin/sh
# Container entrypoint. When started as root (the default, and how Fly starts machines), give the
# data directory to the unprivileged "node" user, then drop privileges and run the server as
# "node". Fly mounts volumes owned by root, so this cannot be done at build time.
set -eu

DATA_DIR="${DATA_DIR:-/data}"

if [ "$(id -u)" = "0" ]; then
  case "$DATA_DIR" in
    "" | "/")
      echo "Refusing to use DATA_DIR='$DATA_DIR'" >&2
      exit 1
      ;;
  esac
  mkdir -p "$DATA_DIR"
  chown -R node:node "$DATA_DIR"
  # BusyBox su ships with the base image. It keeps the environment (no -l) and the inner exec
  # replaces the shell with the server, so the server receives SIGTERM/SIGINT directly.
  exec su -s /bin/sh -c 'exec "$0" "$@"' node "$@"
fi

exec "$@"
