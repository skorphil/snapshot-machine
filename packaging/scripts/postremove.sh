#!/bin/sh
# Refresh desktop and icon caches after the launcher entry is removed.
set -e

if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database -q /usr/share/applications || true
fi

if command -v gtk-update-icon-cache >/dev/null 2>&1; then
  gtk-update-icon-cache -q -t -f /usr/share/icons/hicolor || true
fi

# Forget the removed Root Helper unit and bus files. The user's drop-in
# configuration under /etc/btrbk/gui.conf.d is intentionally left in place.
if command -v systemctl >/dev/null 2>&1; then
  systemctl stop btrbk-gui-helper.service 2>/dev/null || true
  systemctl daemon-reload || true
fi

if command -v systemctl >/dev/null 2>&1 && systemctl is-active --quiet dbus.service 2>/dev/null; then
  systemctl reload dbus.service 2>/dev/null || true
elif command -v killall >/dev/null 2>&1; then
  killall -HUP dbus-daemon 2>/dev/null || true
fi
