import { formatBytes } from "@/shared/format/index.ts";
import type {
  FileHistoryEntry,
  FileVersion,
} from "@snapshot-machine/shared/types.ts";
import { getDisplayDate, parseValidDate } from "./dates.ts";

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/**
 * Splits a file name into its stem and extension. Dotfiles and names without
 * a dot keep an empty extension, so `.bashrc` stays a single name.
 */
export function splitFileName(name: string): FileNameParts {
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) {
    return { stem: name, extension: "" };
  }
  return { stem: name.slice(0, dot), extension: name.slice(dot + 1) };
}

/** Formats a date as `dd Mon yyyy`, e.g. `07 Nov 2026`. Returns "Unknown date" when invalid. */
export function formatEditedDate(
  value: Date | string | null | undefined,
): string {
  const date = parseValidDate(value);
  if (!date) return "Unknown date";
  const day = String(date.getDate()).padStart(2, "0");
  return `${day} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

/** Formats a version time as `HH:MM` (24-hour), e.g. `09:05`. Returns "--:--" when invalid. */
export function formatVersionTime(
  value: Date | string | null | undefined,
): string {
  const date = parseValidDate(value);
  if (!date) return "--:--";
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

/**
 * Formats a version timestamp as `dd Mon yyyy, HH:MM`, e.g.
 * `07 Nov 2026, 14:30`. Returns "Unknown date" when the value is invalid.
 */
export function formatVersionDateTime(
  value: Date | string | null | undefined,
): string {
  const date = parseValidDate(value);
  if (!date) return "Unknown date";
  return `${formatEditedDate(date)}, ${formatVersionTime(date)}`;
}

/** Pluralised version count, e.g. `1 version` or `3 versions`. */
export function formatVersionCount(count: number): string {
  return count === 1 ? "1 version" : `${count} versions`;
}

/**
 * Collapses versions that describe the same file state. An unmodified file
 * keeps its `mtime` and `size` across snapshots, so only the first (newest)
 * occurrence of each `(mtime, size)` pair is kept. Versions without an `mtime`
 * cannot be compared and are always kept.
 *
 * Expects versions newest first, as returned by the backend. Input order is
 * preserved and the input array is not mutated.
 */
export function deduplicateVersions(versions: FileVersion[]): FileVersion[] {
  const seen = new Set<string>();
  const unique: FileVersion[] = [];
  for (const version of versions) {
    if (version.mtime === null) {
      unique.push(version);
      continue;
    }
    const key = JSON.stringify([version.mtime, version.size]);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(version);
  }
  return unique;
}

/**
 * Summary of a history entry for a snippet row: the edit date and size come
 * from the newest version (versions are sorted newest first by the backend),
 * and the version count reflects distinct file states.
 */
export function summarizeEntry(entry: FileHistoryEntry): EntrySummary {
  const versions = deduplicateVersions(entry.versions);
  const latest: FileVersion | undefined = versions[0];
  const editedAt = latest ? getDisplayDate(latest) : null;
  return {
    ...splitFileName(entry.name),
    deleted: entry.deleted,
    versionCount: versions.length,
    editedLabel: formatEditedDate(editedAt),
    sizeLabel: latest ? formatBytes(latest.size) : formatBytes(0),
  };
}

/** Formats one version row: date, time and size. */
export function summarizeVersion(version: FileVersion): VersionSummary {
  return {
    dateTimeLabel: formatVersionDateTime(getDisplayDate(version)),
    sizeLabel: formatBytes(version.size),
  };
}

export type FileNameParts = {
  stem: string;
  extension: string;
};

export type EntrySummary = FileNameParts & {
  deleted: boolean;
  versionCount: number;
  editedLabel: string;
  sizeLabel: string;
};

export type VersionSummary = {
  dateTimeLabel: string;
  sizeLabel: string;
};
