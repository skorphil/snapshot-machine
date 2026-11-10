import { join } from "@std/path";
import { resolveConfigName } from "@snapshot-machine/shared/config-name.ts";

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
