#!/bin/sh
# Stop the running helper service before removing package files.
set -e

if command -v systemctl >/dev/null 2>&1; then
  systemctl stop btrbk-gui-helper.service 2>/dev/null || true
fi
