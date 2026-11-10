import { type BtrbkConfig, parseConfig } from "./parser.ts";
import { getConfigNamePath } from "./paths.ts";

/**
 * Loads the GUI-managed btrbk configuration `<drop-in dir>/<config name>`.
 * The main `/etc/btrbk/btrbk.conf` is never read.
 *
 * @throws {Error} If the managed configuration file does not exist.
 */
export async function loadBtrbkConfig(): Promise<BtrbkConfig> {
  const path = getConfigNamePath();
  const info = await Deno.stat(path).catch(() => null);
  if (!info?.isFile) {
    throw new Error(
      `Configuration file not found: ${path}. Configure it in the Config Editor first.`,
    );
  }
  return await parseConfig(path);
}
