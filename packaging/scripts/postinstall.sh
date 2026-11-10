#!/bin/sh
# Refresh desktop and icon caches so the launcher picks up the new entry.
set -e

if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database -q /usr/share/applications || true
fi

if command -v gtk-update-icon-cache >/dev/null 2>&1; then
  gtk-update-icon-cache -q -t -f /usr/share/icons/hicolor || true
fi

# Make systemd pick up the Root Helper unit and the D-Bus system bus pick up
# the new policy and activation files. Both are best-effort: the helper is
# activated on demand by the bus, so a failed reload must not fail the install.
if command -v systemctl >/dev/null 2>&1; then
  systemctl daemon-reload || true
fi

if command -v systemctl >/dev/null 2>&1 && systemctl is-active --quiet dbus.service 2>/dev/null; then
  systemctl reload dbus.service 2>/dev/null || true
elif command -v killall >/dev/null 2>&1; then
  killall -HUP dbus-daemon 2>/dev/null || true
fi

# Drop-in directory read by btrbk and written by the Root Helper.
mkdir -p /etc/btrbk/gui.conf.d
chmod 0755 /etc/btrbk/gui.conf.d
