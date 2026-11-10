import type { SaveConfigResult } from "@snapshot-machine/shared/types.ts";
import { getBindings } from "@/shared/bindings.ts";

/** Returns the name of the drop-in file the app manages. */
export function getConfigName(): Promise<string> {
  return getBindings().getConfigName();
}

/** Returns the full path of the drop-in file the app manages. */
export function getConfigPath(): Promise<string> {
  return getBindings().getConfigPath();
}

/** Lists the btrbk configuration files in /etc/btrbk/gui.conf.d. */
export function listConfigFiles(): Promise<string[]> {
  return getBindings().listConfigFiles();
}

/** Reads the content of one configuration file. */
export function readConfigFile(name: string): Promise<string> {
  return getBindings().readConfigFile(name);
}

/** Validates and saves a configuration file through the Root Helper. */
export function saveConfigFile(
  name: string,
  content: string,
): Promise<SaveConfigResult> {
  return getBindings().saveConfigFile(name, content);
}
