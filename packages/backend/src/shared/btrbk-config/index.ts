/**
 * Shared btrbk configuration module: parsing, drop-in path resolution, and
 * loading of the GUI-managed configuration.
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
  DEFAULT_DROP_IN_DIR,
  DEV_DROP_IN_DIR,
  getConfigName,
  getConfigNamePath,
  getDropInDir,
} from "./paths.ts";
export { loadBtrbkConfig } from "./loader.ts";
