/** Drop-in file name used when `BTRBK_CONFIG_NAME` is unset or invalid. */
export const DEFAULT_CONFIG_NAME = "snapshot-machine.conf";

/** Same rule the Root Helper applies to configuration file names. */
const CONFIG_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.conf$/;

/**
 * Returns the drop-in file name to manage. A valid `value` (from
 * `BTRBK_CONFIG_NAME`) is used as is; otherwise {@link DEFAULT_CONFIG_NAME}.
 */
export function resolveConfigName(value: string | undefined): string {
  if (
    value !== undefined && CONFIG_NAME_PATTERN.test(value) &&
    !value.includes("..")
  ) {
    return value;
  }
  return DEFAULT_CONFIG_NAME;
}
