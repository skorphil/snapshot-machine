/**
 * Creates the `snapshot_dir` directories referenced by the GUI-managed btrbk
 * configuration. btrbk fails for a subvolume whose snapshot directory is
 * missing, so the helper prepares them before every `btrbk run`.
 */

import { isAbsolute, join } from "@std/path";

/** Permission bits for snapshot directories created by the helper. */
export const SNAPSHOT_DIR_MODE = 0o755;

/** Others read and execute bits required to traverse and list a directory. */
const OTHERS_READ_EXEC = 0o005;

/** Snapshot setting collected for one `volume` section. */
interface VolumeEntry {
  path: string;
  snapshotDir: string | null;
}

/** Returns the message of an unknown thrown value. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Extracts the snapshot directories of a btrbk configuration.
 *
 * A `snapshot_dir` inside a `volume` section applies to that volume; a
 * `snapshot_dir` before the first `volume` is global and applies to every
 * volume without its own setting. Relative directories are joined onto the
 * volume path, absolute ones are used as they are. Options inside `subvolume`
 * sections are ignored. A global relative directory without any volume to
 * resolve it against is skipped.
 *
 * @param content - Raw btrbk configuration text.
 * @returns Unique snapshot directory paths in order of first appearance.
 */
export function extractSnapshotDirs(content: string): string[] {
  let globalSnapshotDir: string | null = null;
  const volumes: VolumeEntry[] = [];
  let scope: "root" | "volume" | "subvolume" = "root";
  let current: VolumeEntry | null = null;

  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const [key, ...values] = line.split(/\s+/);
    const value = values.join(" ");

    if (key === "volume") {
      current = { path: value, snapshotDir: null };
      volumes.push(current);
      scope = "volume";
    } else if (key === "subvolume") {
      scope = "subvolume";
    } else if (key === "snapshot_dir") {
      if (scope === "root") {
        globalSnapshotDir = value;
      } else if (scope === "volume" && current) {
        current.snapshotDir = value;
      }
    }
  }

  const dirs = new Set<string>();
  for (const volume of volumes) {
    const dir = volume.snapshotDir ?? globalSnapshotDir;
    if (!dir) continue;
    if (isAbsolute(dir)) {
      dirs.add(dir);
    } else {
      dirs.add(join(volume.path, dir));
    }
  }
  if (
    volumes.length === 0 && globalSnapshotDir && isAbsolute(globalSnapshotDir)
  ) {
    dirs.add(globalSnapshotDir);
  }
  return [...dirs];
}

/**
 * Prepares every directory in `dirs`: missing ones are created, existing ones
 * keep their modes except for the others read/execute bits (see
 * {@link ensureSnapshotDir}).
 *
 * @throws {Error} If a path exists but is not a directory, cannot be inspected,
 * or cannot be created. The message names the failing path.
 */
export async function ensureSnapshotDirs(dirs: string[]): Promise<void> {
  for (const dir of dirs) {
    await ensureSnapshotDir(dir);
  }
}

/**
 * Prepares one snapshot directory. A missing path is created with
 * `SNAPSHOT_DIR_MODE`. An existing real directory only gains the others
 * read/execute bits it lacks, so owner, group and write modes are kept. A
 * symlink is never chmod'ed, neither itself nor its target, because the target
 * may lie outside the snapshot storage; it must resolve to a directory.
 */
async function ensureSnapshotDir(path: string): Promise<void> {
  let info: Deno.FileInfo | null = null;
  try {
    info = await Deno.lstat(path);
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) {
      throw new Error(
        `Cannot access snapshot directory ${path}: ${errorMessage(error)}`,
      );
    }
  }

  if (info) {
    if (info.isSymlink) {
      await verifySymlinkedDir(path);
      return;
    }
    if (!info.isDirectory) {
      throw new Error(
        `Snapshot directory path exists but is not a directory: ${path}`,
      );
    }
    await addOthersReadExec(path, info.mode);
    return;
  }

  try {
    await Deno.mkdir(path, { recursive: true, mode: SNAPSHOT_DIR_MODE });
    await Deno.chmod(path, SNAPSHOT_DIR_MODE);
  } catch (error) {
    throw new Error(
      `Cannot create snapshot directory ${path}: ${errorMessage(error)}`,
    );
  }
}

/**
 * Verifies that a symlinked snapshot directory resolves to a directory. The
 * link and its target are left unchanged.
 *
 * @throws {Error} If the link is dangling or points to a non-directory.
 */
async function verifySymlinkedDir(path: string): Promise<void> {
  let target: Deno.FileInfo;
  try {
    target = await Deno.stat(path);
  } catch (error) {
    throw new Error(
      `Cannot access snapshot directory ${path}: ${errorMessage(error)}`,
    );
  }
  if (!target.isDirectory) {
    throw new Error(
      `Snapshot directory symlink does not point to a directory: ${path}`,
    );
  }
}

/**
 * Adds the others read/execute bits to an existing directory when missing.
 * Other mode bits are preserved. A null mode (platform without POSIX modes)
 * is left alone.
 */
async function addOthersReadExec(
  path: string,
  mode: number | null,
): Promise<void> {
  if (mode === null) return;
  if ((mode & OTHERS_READ_EXEC) === OTHERS_READ_EXEC) return;
  try {
    await Deno.chmod(path, (mode & 0o7777) | OTHERS_READ_EXEC);
  } catch (error) {
    throw new Error(
      `Cannot update permissions of snapshot directory ${path}: ${
        errorMessage(error)
      }`,
    );
  }
}

/**
 * Reads the GUI-managed configuration and creates its snapshot directories.
 *
 * @throws {Error} If the configuration cannot be read or a directory cannot be prepared.
 */
export async function ensureConfiguredSnapshotDirs(
  configFile: string,
): Promise<void> {
  const content = await Deno.readTextFile(configFile);
  await ensureSnapshotDirs(extractSnapshotDirs(content));
}
