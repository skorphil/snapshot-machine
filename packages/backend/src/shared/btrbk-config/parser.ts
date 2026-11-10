import { dirname, isAbsolute, join, resolve } from "@std/path";
import { logger } from "@snapshot-machine/backend/shared/logger.ts";

/** Maximum nesting of `include` directives before further includes are skipped. */
export const MAX_INCLUDE_DEPTH = 16;

const GLOB_CHARACTERS = /[*?[]/;

/** Mutable state shared by the root file and every file it includes. */
type ParseState = {
  config: BtrbkConfig;
  currentVolume: VolumeConfig | null;
  /** `snapshot_dir` declared before the first volume; applies to later volumes. */
  globalSnapshotDir?: string;
};

/**
 * Reads and parses a btrbk configuration file. Blank lines and `#` comments
 * are ignored; unrecognized keys are skipped.
 *
 * `include <path|glob|directory>` lines are expanded in place. Relative paths
 * are resolved against the directory of the including file, directories
 * contribute their `*.conf` files in name order, and cyclic includes are
 * skipped with a warning.
 *
 * @param configPath - Absolute path to the btrbk configuration file.
 * @returns The parsed configuration. A missing root file yields no volumes.
 */
export async function parseConfig(configPath: string): Promise<BtrbkConfig> {
  let content: string;
  try {
    content = await Deno.readTextFile(configPath);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      logger.warn(`btrbk configuration not found: ${configPath}`);
      return { volumes: [] };
    }
    throw error;
  }
  return await parseConfigText(content, configPath);
}

/**
 * Parses configuration content that is already in memory. `configPath` names
 * the file the content belongs to and anchors relative `include` paths.
 *
 * @param content - Raw btrbk configuration text.
 * @param configPath - Absolute path the content would be read from.
 * @returns The parsed configuration.
 */
export async function parseConfigText(
  content: string,
  configPath: string,
): Promise<BtrbkConfig> {
  const state: ParseState = { config: { volumes: [] }, currentVolume: null };
  await parseContent(content, configPath, state, [
    await canonicalPath(configPath),
  ]);
  return state.config;
}

/**
 * Parses one file's content into `state`. `ancestors` holds the canonical
 * paths of the files whose includes led here and guards against cycles.
 */
async function parseContent(
  content: string,
  filePath: string,
  state: ParseState,
  ancestors: string[],
): Promise<void> {
  for (let line of content.split("\n")) {
    line = line.trim();
    if (!line || line.startsWith("#")) continue;

    const [key, ...values] = line.split(/\s+/);
    const value = values.join(" ");

    if (key === "include") {
      await includeTarget(value, filePath, state, ancestors);
    } else if (key === "volume") {
      state.currentVolume = {
        path: value,
        snapshotDir: state.globalSnapshotDir,
        subvolumes: [],
      };
      state.config.volumes.push(state.currentVolume);
    } else if (key === "snapshot_dir") {
      if (state.currentVolume) {
        state.currentVolume.snapshotDir = value;
      } else {
        state.globalSnapshotDir = value;
      }
    } else if (key === "subvolume" && state.currentVolume) {
      state.currentVolume.subvolumes.push({ path: value });
    } else if (
      key === "snapshot_name" && state.currentVolume &&
      state.currentVolume.subvolumes.length > 0
    ) {
      state.currentVolume.subvolumes[state.currentVolume.subvolumes.length - 1]
        .name = value;
    }
  }
}

/**
 * Resolves the target of an `include` directive and parses every file it
 * matches. Missing or unreadable targets are logged and skipped.
 */
async function includeTarget(
  target: string,
  includingFile: string,
  state: ParseState,
  ancestors: string[],
): Promise<void> {
  if (!target) {
    logger.warn(`btrbk include without a path in ${includingFile}`);
    return;
  }
  if (ancestors.length >= MAX_INCLUDE_DEPTH) {
    logger.warn(
      `btrbk include depth limit (${MAX_INCLUDE_DEPTH}) reached, skipping: ${target}`,
    );
    return;
  }

  const base = dirname(includingFile);
  const pattern = isAbsolute(target) ? target : join(base, target);
  const files = await expandIncludePattern(pattern);
  if (files.length === 0) {
    logger.warn(
      `btrbk include matched no files: ${target} (in ${includingFile})`,
    );
    return;
  }

  for (const file of files) {
    const canonical = await canonicalPath(file);
    if (ancestors.includes(canonical)) {
      logger.warn(`btrbk include cycle skipped: ${file}`);
      continue;
    }
    let content: string;
    try {
      content = await Deno.readTextFile(file);
    } catch (error) {
      logger.warn(
        `btrbk include could not be read: ${file} (${String(error)})`,
      );
      continue;
    }
    await parseContent(content, file, state, [...ancestors, canonical]);
  }
}

/**
 * Expands an absolute include pattern into regular files. Wildcards (`*`,
 * `?`, `[...]`) are supported in every path segment. A matched directory
 * contributes its `*.conf` files, sorted by name. Hidden entries are never
 * matched by a wildcard.
 *
 * @param pattern - Absolute path, optionally containing glob characters.
 * @returns Matching file paths; empty when nothing matches.
 */
export async function expandIncludePattern(pattern: string): Promise<string[]> {
  const matches = GLOB_CHARACTERS.test(pattern)
    ? await expandGlob(pattern)
    : [pattern];

  const files: string[] = [];
  for (const match of matches) {
    const info = await Deno.stat(match).catch(() => null);
    if (!info) continue;
    if (info.isFile) {
      files.push(match);
    } else if (info.isDirectory) {
      files.push(...await listDropInFiles(match));
    }
  }
  return files;
}

/** Walks an absolute glob pattern segment by segment. */
async function expandGlob(pattern: string): Promise<string[]> {
  let bases = ["/"];
  for (const segment of pattern.split("/").filter(Boolean)) {
    const next: string[] = [];
    if (GLOB_CHARACTERS.test(segment)) {
      const matcher = globSegmentToRegExp(segment);
      for (const base of bases) {
        for (const name of await readDirNames(base)) {
          if (!name.startsWith(".") && matcher.test(name)) {
            next.push(join(base, name));
          }
        }
      }
    } else {
      for (const base of bases) next.push(join(base, segment));
    }
    bases = next;
  }
  return bases.sort();
}

/** Converts one glob path segment into an anchored regular expression. */
function globSegmentToRegExp(segment: string): RegExp {
  let source = "";
  for (const ch of segment) {
    if (ch === "*") source += "[^/]*";
    else if (ch === "?") source += "[^/]";
    else if (ch === "[" || ch === "]") source += ch;
    else source += ch.replace(/[.+^${}()|\\]/g, "\\$&");
  }
  return new RegExp(`^${source}$`);
}

/** Returns the `*.conf` regular files of a drop-in directory, sorted by name. */
async function listDropInFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  for (const name of await readDirNames(dir)) {
    if (name.endsWith(".conf") && !name.startsWith(".")) {
      const path = join(dir, name);
      const info = await Deno.stat(path).catch(() => null);
      if (info?.isFile) files.push(path);
    }
  }
  return files.sort();
}

/** Lists entry names of a directory; unreadable directories yield no names. */
async function readDirNames(dir: string): Promise<string[]> {
  const names: string[] = [];
  try {
    for await (const entry of Deno.readDir(dir)) names.push(entry.name);
  } catch {
    // Not a directory or not readable: nothing to match.
  }
  return names;
}

/** Returns the real path of an existing file, or its resolved path otherwise. */
async function canonicalPath(path: string): Promise<string> {
  try {
    return await Deno.realPath(path);
  } catch {
    return resolve(path);
  }
}

/** Parsed representation of a btrbk configuration file. */
export type BtrbkConfig = {
  /** Volumes declared in the configuration, in file order. */
  volumes: VolumeConfig[];
};

/** A btrbk `volume` block and the subvolumes it contains. */
export type VolumeConfig = {
  /** Mount point of the volume. */
  path: string;
  /** Snapshot directory, relative to the volume or absolute. */
  snapshotDir?: string;
  /** Subvolumes declared under this volume. */
  subvolumes: SubvolumeConfig[];
};

/** A btrbk `subvolume` block. */
export type SubvolumeConfig = {
  /** Path of the subvolume, relative to its volume. */
  path: string;
  /** Optional `snapshot_name` override. */
  name?: string;
};
