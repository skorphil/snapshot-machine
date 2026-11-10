/**
 * Shared btrbk configuration module: parsing, drop-in path resolution, and
 * read-only loading of the managed configuration.
 *
 * @module
 */
export {
  type BtrbkConfig,
  expandIncludePattern,
  MAX_INCLUDE_DEPTH,
  parseConfig,
  parseConfigText,
  type SubvolumeConfig,
  type VolumeConfig,
} from "./parser.ts";
export {
  DEFAULT_BTRBK_CONFIG_FILE,
  DEFAULT_DROP_IN_DIR,
  DEV_DROP_IN_DIR,
  getConfigName,
  getConfigNamePath,
  getDefaultBtrbkConfigPath,
  getDropInDir,
} from "./paths.ts";
export { loadBtrbkConfig } from "./loader.ts";
