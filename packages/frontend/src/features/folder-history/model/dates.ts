import type { FileVersion } from "@snapshot-machine/shared/types.ts";

/**
 * Parses a timestamp into a valid Date. Returns null for missing, empty,
 * unparseable, or non-finite values so callers never see "Invalid Date".
 */
export function parseValidDate(value: DateInput): Date | null {
  if (value === null || value === undefined) return null;

  let date: Date;
  if (value instanceof Date) {
    date = value;
  } else {
    if (value.trim() === "") return null;
    date = new Date(value);
  }

  return Number.isFinite(date.getTime()) ? date : null;
}

/**
 * Returns the most recent valid timestamp of a version, considering modification,
 * birth, change and snapshot times. Returns null when none of them is valid.
 */
export function getDisplayDate(v: FileVersion): Date | null {
  const candidates: DateInput[] = [
    v.mtime,
    v.birthtime,
    v.ctime,
    v.snapshotDate,
  ];

  let latest: Date | null = null;
  for (const candidate of candidates) {
    const date = parseValidDate(candidate);
    if (date && (latest === null || date.getTime() > latest.getTime())) {
      latest = date;
    }
  }
  return latest;
}

/**
 * Formats a timestamp for display. "Unknown date" is returned only when the
 * value is missing or invalid.
 */
export function formatDate(value: DateInput): string {
  const date = parseValidDate(value);
  return date ? date.toLocaleString() : "Unknown date";
}

export type DateInput = string | Date | null | undefined;
