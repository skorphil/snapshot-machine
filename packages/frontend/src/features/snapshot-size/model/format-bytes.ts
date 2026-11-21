/** Binary units, smallest first. */
const UNITS = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"] as const;

/**
 * Formats a byte count with binary units, e.g. `1536` -> `1.5 KiB`. Values
 * below 10 of a unit keep one decimal place; larger values are rounded.
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  if (unit === 0) return `${value} ${UNITS[0]}`;
  const digits = value < 10 ? 1 : 0;
  return `${value.toFixed(digits)} ${UNITS[unit]}`;
}
