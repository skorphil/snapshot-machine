/**
 * Starter content of the managed drop-in file. Accepted by `btrbk list config`.
 * Written to `<drop-in dir>/<config name>` when that file does not exist yet,
 * and offered by the config editor.
 */
export const DEFAULT_CONFIG_TEMPLATE: string = [
  "# snapshot-machine configuration drop-in",
  "# Options configured here override or extend /etc/btrbk.conf",
  "",
  "snapshot_preserve_min   latest",
  "snapshot_preserve       24h 7d 4w",
  "",
].join("\n");
