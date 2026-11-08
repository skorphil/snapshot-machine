import { isAbsolute, join, relative, SEPARATOR } from "@std/path";
import type { FileHistoryEntry } from "@btrbk-gui/shared/types.ts";
import { parseConfig, type VolumeConfig } from "../btrbk-config-parser.ts";
import { logger } from "@btrbk-gui/backend/shared/logger.ts";

const SNAPSHOT_TIMESTAMP =
  /\.(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(?:_\d+)?$/;

/**
 * Extracts the creation time encoded in a btrbk snapshot name, e.g.
 * "home.20261107T1700", "home.20261107T170000" or "home.20261107T1700_1"
 * (local time). Returns null when the name carries no valid timestamp.
 */
export function parseSnapshotDate(snapshotName: string): Date | null {
  const match = SNAPSHOT_TIMESTAMP.exec(snapshotName);
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  const date = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second ?? 0),
  );
  return Number.isFinite(date.getTime()) ? date : null;
}

/**
 * Returns the path of `targetPath` relative to `volumePath`, or null when
 * `targetPath` is not the volume itself or a descendant of it. Containment is
 * checked per path component, so `/data/database` is not inside `/data`.
 */
export function resolveVolumeRelativePath(
  volumePath: string,
  targetPath: string,
): string | null {
  const rel = relative(volumePath, targetPath);
  if (rel === ".." || rel.startsWith(`..${SEPARATOR}`) || isAbsolute(rel)) {
    return null;
  }
  return rel;
}

/**
 * Builds the version history of a folder by scanning every snapshot of the
 * btrbk volume that contains it. Entries are grouped by inode.
 *
 * @param targetPath - Absolute path of the folder to inspect; must lie inside a configured btrbk volume and must not contain `..` segments.
 * @returns One {@link FileHistoryEntry} per distinct inode, or an empty array if the snapshot directory is unreadable.
 * @throws If `targetPath` is relative or contains `..`, no volume contains it, or the volume has no snapshot directory.
 */
export async function listFolderHistory(
  targetPath: string,
): Promise<FileHistoryEntry[]> {
  if (!isAbsolute(targetPath) || targetPath.split(/[\\/]/).includes("..")) {
    throw new Error(`Invalid folder path: ${targetPath}`);
  }

  const config = await parseConfig("/etc/btrbk/btrbk.conf");

  // 1. Find the volume
  let bestVolume: VolumeConfig | null = null;
  let relPath = "";
  for (const vol of config.volumes) {
    const rel = resolveVolumeRelativePath(vol.path, targetPath);
    if (rel === null) continue;
    if (!bestVolume || vol.path.length > bestVolume.path.length) {
      bestVolume = vol;
      relPath = rel;
    }
  }

  if (!bestVolume) {
    throw new Error(`No btrbk volume found for path: ${targetPath}`);
  }

  const snapshotDir = bestVolume.snapshotDir
    ? (bestVolume.snapshotDir.startsWith("/")
      ? bestVolume.snapshotDir
      : join(bestVolume.path, bestVolume.snapshotDir))
    : null;

  if (!snapshotDir) {
    throw new Error(
      `No snapshot directory configured for volume: ${bestVolume.path}`,
    );
  }

  // 2. List snapshots
  const snapshots: string[] = [];
  try {
    for await (const entry of Deno.readDir(snapshotDir)) {
      if (entry.isDirectory) {
        snapshots.push(entry.name);
      }
    }
  } catch (e) {
    logger.error(`Failed to read snapshot directory ${snapshotDir}:`, e);
    return [];
  }

  // Sort snapshots newest first (assuming sortable names like home.20261107T1700)
  snapshots.sort().reverse();

  const historyMap = new Map<string, FileHistoryEntry>();
  // Inodes present in the newest snapshot that actually contains the folder.
  let latestInodes: Set<string> | null = null;

  // 3. Process snapshots sequentially (one readDir/lstat at a time)
  for (const snap of snapshots) {
    const snapshotDate = parseSnapshotDate(snap);
    const snapPath = join(snapshotDir, snap, relPath);
    const snapInodes = new Set<string>();

    let dirEntries: Deno.DirEntry[];
    try {
      dirEntries = [];
      for await (const entry of Deno.readDir(snapPath)) {
        dirEntries.push(entry);
      }
    } catch {
      // Snapshot does not contain this folder
      continue;
    }

    for (const entry of dirEntries) {
      const fullPath = join(snapPath, entry.name);
      let stat: Deno.FileInfo;
      try {
        stat = await Deno.lstat(fullPath);
      } catch {
        continue;
      }

      const ino = stat.ino == null ? null : String(stat.ino);
      if (ino === null) continue;
      snapInodes.add(ino);

      let historyEntry = historyMap.get(ino);
      if (!historyEntry) {
        historyEntry = {
          name: entry.name,
          path: entry.name,
          ino,
          type: entry.isDirectory
            ? "directory"
            : (entry.isFile ? "file" : "other"),
          deleted: false,
          lastSeen: snap,
          versions: [],
        };
        historyMap.set(ino, historyEntry);
      }

      historyEntry.versions.push({
        snapshot: snap,
        path: fullPath,
        snapshotDate: snapshotDate ? snapshotDate.toISOString() : null,
        mtime: stat.mtime ? stat.mtime.toISOString() : null,
        ctime: stat.ctime ? stat.ctime.toISOString() : null,
        birthtime: stat.birthtime ? stat.birthtime.toISOString() : null,
        size: stat.size,
      });
    }

    // Snapshots are iterated newest first, so the first one that contains
    // the folder defines the current state.
    if (latestInodes === null) {
      latestInodes = snapInodes;
    }
  }

  // Mark deleted: an entry is live only if it exists in the newest snapshot
  // that contains the folder.
  const live = latestInodes ?? new Set<string>();
  for (const [ino, entry] of historyMap.entries()) {
    entry.deleted = !live.has(ino);
  }

  return Array.from(historyMap.values());
}
