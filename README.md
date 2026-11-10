# Snapshot Machine

**Under development**

A user-friendly desktop application for browsing Btrfs snapshot history and
restoring files on Linux. It uses `btrbk` to manage backups.

For contribution see [CONTRIBUTING.md](CONTRIBUTING.md)

## Uninstall

By default, config files are preserved after uninstalling the app. If you want
to remove them:

```shell
sudo rm -rf /etc/btrbk/gui.conf.d
```
