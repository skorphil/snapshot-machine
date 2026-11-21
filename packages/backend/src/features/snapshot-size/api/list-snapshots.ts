import { join } from "@std/path";
import type { SnapshotEntry } from "@snapshot-machine/shared/types.ts";
import { assertValidPath } from "./get-snapshot-size.ts";

/** btrbk timestamp suffix: `.YYYYMMDD`, optionally followed by `THHMM` or `THHMMSS`. */
const TIMESTAMP_SUFFIX = /\.(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?)?$/;

/**
 * Extracts the creation time from a btrbk snapshot name such as
 * `home.20261119T1200`. The time is read in local time, as btrbk writes it.
 *
 * @returns The ISO timestamp, or null when the name carries no valid timestamp.
 */
export function parseSnapshotDate(name: string): string | null {
  const match = TIMESTAMP_SUFFIX.exec(name);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4] ?? 0);
  const minute = Number(match[5] ?? 0);
  const second = Number(match[6] ?? 0);
  const date = new Date(year, month - 1, day, hour, minute, second);
  const valid = date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day &&
    hour <= 23 && minute <= 59 && second <= 59;
  return valid ? date.toISOString() : null;
}

/** Orders entries newest first; undated entries come last, then by name. */
function compareEntries(a: SnapshotEntry, b: SnapshotEntry): number {
  if (a.date !== null && b.date !== null) {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  } else if (a.date !== null) {
    return -1;
  } else if (b.date !== null) {
    return 1;
  }
  return a.name.localeCompare(b.name);
}

/**
 * Lists the snapshots stored in one snapshot location. Sizes are not
 * calculated here, so `size` is always null. A missing directory means no
 * snapshots yet and yields an empty list.
 *
 * @throws {Error} If the path is invalid or the directory cannot be read.
 */
export async function listSnapshots(
  locationPath: string,
): Promise<SnapshotEntry[]> {
  assertValidPath(locationPath);
  const entries: SnapshotEntry[] = [];
  try {
    for await (const entry of Deno.readDir(locationPath)) {
      if (!entry.isDirectory && !entry.isSymlink) continue;
      entries.push({
        name: entry.name,
        path: join(locationPath, entry.name),
        date: parseSnapshotDate(entry.name),
        size: null,
      });
    }
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return [];
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Cannot read snapshot location ${locationPath}: ${message}`,
    );
  }
  return entries.sort(compareEntries);
}
