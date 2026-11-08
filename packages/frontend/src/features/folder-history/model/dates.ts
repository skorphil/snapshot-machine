import type { FileVersion } from "@btrbk-gui/shared/types.ts";
import type { DateMode } from "./types.ts";

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

export function getDisplayDate(v: FileVersion, mode: DateMode): Date | null {
  const candidates: DateInput[] = mode === "arrival"
    ? [v.birthtime, v.ctime, v.mtime, v.snapshotDate]
    : [v.mtime, v.ctime, v.birthtime, v.snapshotDate];

  for (const candidate of candidates) {
    const date = parseValidDate(candidate);
    if (date) return date;
  }
  return null;
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
