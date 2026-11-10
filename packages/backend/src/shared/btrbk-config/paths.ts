import { join } from "@std/path";
import { resolveConfigName } from "@snapshot-machine/shared/config-name.ts";

/** Built-in location of the main btrbk configuration file. */
export const DEFAULT_BTRBK_CONFIG_FILE = "/etc/btrbk/btrbk.conf";

/**
 * Directory of GUI-managed btrbk drop-in files. Must match `CONFIG_DIR` in
 * `packages/helper/src/config-files.ts`; the helper is a separate package and
 * keeps its own copy.
 */
export const DEFAULT_DROP_IN_DIR = "/etc/btrbk/gui.conf.d";

/**
 * Unprivileged drop-in directory used with `USE_SESSION_BUS=1`. Must match
 * `DEV_CONFIG_DIR` in `packages/helper/src/config-files.ts`.
 */
export const DEV_DROP_IN_DIR = "/tmp/snapshot-machine-dev/gui.conf.d";

/**
 * Returns the btrbk configuration file to read. `BTRBK_CONFIG_FILE` overrides
 * the default when it is set to a non-empty value.
 */
export function getDefaultBtrbkConfigPath(): string {
  const override = Deno.env.get("BTRBK_CONFIG_FILE");
  return override && override.length > 0 ? override : DEFAULT_BTRBK_CONFIG_FILE;
}

/**
 * Returns the drop-in file name the app manages. Read from `BTRBK_CONFIG_NAME`;
 * falls back to `snapshot-machine.conf` when unset or invalid.
 */
export function getConfigName(): string {
  return resolveConfigName(Deno.env.get("BTRBK_CONFIG_NAME"));
}

/**
 * Returns the drop-in directory. Mirrors the Root Helper: a non-empty
 * `BTRBK_CONFIG_DIR` wins, then `USE_SESSION_BUS=1` selects the dev directory.
 */
export function getDropInDir(): string {
  const override = Deno.env.get("BTRBK_CONFIG_DIR");
  if (override && override.length > 0) return override;
  return Deno.env.get("USE_SESSION_BUS") === "1"
    ? DEV_DROP_IN_DIR
    : DEFAULT_DROP_IN_DIR;
}

/** Returns the path of the managed drop-in file, e.g. `/etc/btrbk/gui.conf.d/snapshot-machine.conf`. */
export function getConfigNamePath(): string {
  return join(getDropInDir(), getConfigName());
}
