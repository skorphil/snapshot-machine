import { DEFAULT_CONFIG_TEMPLATE } from "@snapshot-machine/shared/default-config-template.ts";
import { type BtrbkConfig, parseConfig, parseConfigText } from "./parser.ts";
import { getConfigNamePath } from "./paths.ts";

/**
 * Loads the btrbk configuration used for history lookups from the managed
 * drop-in `<drop-in dir>/<config name>`. The main `/etc/btrbk/btrbk.conf` is
 * not read.
 *
 * This function is read-only. When the drop-in does not exist, the default
 * template is parsed from memory and nothing is written to disk. Creating
 * the drop-in belongs to the configuration editor flow.
 */
export async function loadBtrbkConfig(): Promise<BtrbkConfig> {
  const dropInPath = getConfigNamePath();
  if (await isFile(dropInPath)) {
    return await parseConfig(dropInPath);
  }
  return await parseConfigText(DEFAULT_CONFIG_TEMPLATE, dropInPath);
}

/** True when `path` exists and is a regular file. */
async function isFile(path: string): Promise<boolean> {
  const info = await Deno.stat(path).catch(() => null);
  return info?.isFile ?? false;
}
