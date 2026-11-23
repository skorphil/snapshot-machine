import { isAbsolute, join, relative, SEPARATOR } from "@std/path";
import type {
  FileHistoryEntry,
  FileVersion,
} from "@snapshot-machine/shared/types.ts";
import {
  loadBtrbkConfig,
  type VolumeConfig,
} from "@snapshot-machine/backend/shared/btrbk-config/index.ts";
import { logger } from "@snapshot-machine/backend/shared/logger.ts";

/**
 * Returns true when `error` means the path is absent or not a directory, i.e.
 * a snapshot that simply does not contain the folder.
 */
function isAbsentPath(error: unknown): boolean {
  return error instanceof Deno.errors.NotFound ||
    error instanceof Deno.errors.NotADirectory;
}

/** Returns the message of an unknown thrown value. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

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

/** A directory entry of one snapshot, stat'ed and ready for grouping. */
type ObservedEntry = {
  name: string;
  ino: string;
  fullPath: string;
  stat: Deno.FileInfo;
  type: FileHistoryEntry["type"];
};

/** Last observed state of one lone inode in the newer snapshot scanned before. */
type InodeRecord = {
  /** Entry the inode's version was attached to. */
  entry: FileHistoryEntry;
  /** Name the inode had in that snapshot. */
  name: string;
  /** Birth time in ms, or null when unavailable. */
  birthtime: number | null;
  /** Version recorded for the inode in that snapshot. */
  version: FileVersion;
};

/**
 * Returns true when two observations may describe the same file. An inode
 * number can be reused after a deletion, so the birth time must agree whenever
 * both sides report one.
 */
function sameBirth(a: number | null, b: number | null): boolean {
  return a === null || b === null || a === b;
}

/**
 * Builds the version history of a folder by scanning every snapshot of the
 * btrbk volume that contains it.
 *
 * Entries are grouped by their relative name, so an atomic replacement (a new
 * inode under the same name) extends the existing entry instead of creating a
 * deleted duplicate. When a lone inode reappears in an older snapshot under a
 * different name, it is treated as a rename: the older version joins the entry
 * of the current name, and the newer version records the previous name in
 * `renamedFrom`. Hardlinked names (several names sharing an inode in one
 * snapshot) are never treated as renames.
 *
 * @param targetPath - Absolute path of the folder to inspect; must lie inside a configured btrbk volume and must not contain `..` segments.
 * @returns One {@link FileHistoryEntry} per relative name, or an empty array if the snapshot directory is unreadable.
 * @throws If `targetPath` is relative or contains `..`, no volume contains it, or the volume has no snapshot directory.
 */
export async function listFolderHistory(
  targetPath: string,
): Promise<FileHistoryEntry[]> {
  if (!isAbsolute(targetPath) || targetPath.split(/[\\/]/).includes("..")) {
    throw new Error(`Invalid folder path: ${targetPath}`);
  }

  const config = await loadBtrbkConfig();
  if (config.volumes.length === 0) {
    return [];
  }

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
  } catch (error) {
    if (isAbsentPath(error)) {
      logger.warn(`Snapshot directory does not exist yet: ${snapshotDir}`);
    } else {
      logger.warn(
        `Cannot read snapshot directory ${snapshotDir}: ${errorMessage(error)}`,
      );
    }
    return [];
  }

  // Sort snapshots newest first (assuming sortable names like home.20261107T1700)
  snapshots.sort().reverse();

  const entriesByName = new Map<string, FileHistoryEntry>();
  // Names present in the newest snapshot that actually contains the folder.
  let liveNames: Set<string> | null = null;
  // Lone inodes of the previously scanned (newer) snapshot.
  let previous = new Map<string, InodeRecord>();

  // 3. Process snapshots sequentially (one readDir/lstat at a time)
  for (const snap of snapshots) {
    const snapshotDate = parseSnapshotDate(snap);
    const snapPath = join(snapshotDir, snap, relPath);

    let dirEntries: Deno.DirEntry[];
    try {
      dirEntries = [];
      for await (const entry of Deno.readDir(snapPath)) {
        dirEntries.push(entry);
      }
    } catch (error) {
      if (!isAbsentPath(error)) {
        logger.warn(
          `Cannot read snapshot folder ${snapPath}: ${errorMessage(error)}`,
        );
      }
      // The snapshot does not contain this folder
      continue;
    }

    // Stat every entry first so hardlinks (several names, one inode) are known
    // before any version is attributed.
    const observed: ObservedEntry[] = [];
    for (const entry of dirEntries) {
      const fullPath = join(snapPath, entry.name);
      let stat: Deno.FileInfo;
      try {
        stat = await Deno.lstat(fullPath);
      } catch (error) {
        if (!isAbsentPath(error)) {
          logger.warn(
            `Cannot inspect snapshot entry ${fullPath}: ${errorMessage(error)}`,
          );
        }
        continue;
      }
      if (stat.ino == null) continue;
      observed.push({
        name: entry.name,
        ino: String(stat.ino),
        fullPath,
        stat,
        type: entry.isDirectory
          ? "directory"
          : (entry.isFile ? "file" : "other"),
      });
    }

    const namesPerInode = new Map<string, number>();
    for (const item of observed) {
      namesPerInode.set(item.ino, (namesPerInode.get(item.ino) ?? 0) + 1);
    }

    const current = new Map<string, InodeRecord>();
    const names = new Set<string>();

    for (const item of observed) {
      const { name, ino, fullPath, stat } = item;
      names.add(name);

      const birthtime = stat.birthtime ? stat.birthtime.getTime() : null;
      const version: FileVersion = {
        snapshot: snap,
        path: fullPath,
        snapshotDate: snapshotDate ? snapshotDate.toISOString() : null,
        mtime: stat.mtime ? stat.mtime.toISOString() : null,
        ctime: stat.ctime ? stat.ctime.toISOString() : null,
        birthtime: stat.birthtime ? stat.birthtime.toISOString() : null,
        size: stat.size,
      };

      // Rename: a lone inode seen in the newer snapshot under another name is
      // still a lone inode here under this name.
      const prior = previous.get(ino);
      const isRename = prior !== undefined &&
        prior.name !== name &&
        namesPerInode.get(ino) === 1 &&
        sameBirth(prior.birthtime, birthtime);

      let target: FileHistoryEntry;
      if (isRename) {
        target = prior.entry;
        prior.version.renamedFrom = name;
      } else {
        const existing = entriesByName.get(name);
        if (existing) {
          target = existing;
        } else {
          target = {
            name,
            path: name,
            ino,
            type: item.type,
            deleted: false,
            lastSeen: snap,
            versions: [],
          };
          entriesByName.set(name, target);
        }
      }

      target.versions.push(version);

      if (namesPerInode.get(ino) === 1) {
        current.set(ino, { entry: target, name, birthtime, version });
      }
    }

    // Snapshots are iterated newest first, so the first one that contains
    // the folder defines the current state.
    if (liveNames === null) {
      liveNames = names;
    }
    previous = current;
  }

  // Mark deleted: an entry is live only if its name exists in the newest
  // snapshot that contains the folder.
  const live = liveNames ?? new Set<string>();
  for (const entry of entriesByName.values()) {
    entry.deleted = !live.has(entry.name);
  }

  return Array.from(entriesByName.values());
}
