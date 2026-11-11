/**
 * Discovers mounted Btrfs filesystems and their subvolume hierarchy. Mount
 * points come from `/proc/self/mountinfo`; subvolumes come from
 * `btrfs subvolume list`. Each filesystem is reported on its own, so a volume
 * that cannot be listed (for example, missing privileges) does not hide the
 * others.
 */

import type { BtrfsSubvolume, BtrfsVolume } from "../../shared/types.ts";

/** Path of the mount table of the current process. */
export const MOUNTINFO_PATH = "/proc/self/mountinfo";

/** Subvolume id of the top-level tree, which `btrfs subvolume list` never prints. */
const TOP_LEVEL_ID = 5;

/** Prefix `btrfs subvolume list -a` puts in front of paths outside the given path. */
const FS_TREE_PREFIX = /^<FS_TREE>\/?/;

/** One btrfs mount entry from mountinfo. */
export interface BtrfsMount {
  /** Anonymous device number of the filesystem superblock, e.g. `0:37`. */
  superblock: string;
  /** Source device as reported by the mount, e.g. `/dev/mapper/root`. */
  device: string;
  /** Mount point with octal escapes decoded. */
  mountPoint: string;
  /** Subvolume id from the `subvolid=` mount option, or null if absent. */
  subvolId: number | null;
}

/** One row of `btrfs subvolume list`. */
export interface SubvolumeRecord {
  id: number;
  parentId: number;
  path: string;
}

/** Runs `btrfs subvolume list` for a mount point; resolves with stdout or throws. */
export type SubvolumeLister = (mountPoint: string) => Promise<string>;

/** Options of {@link listBtrfsVolumes}; injectable for tests. */
export interface ListBtrfsVolumesOptions {
  /** Returns the mountinfo text. */
  readMountInfo?: () => Promise<string>;
  /** Lists subvolumes of one mounted filesystem. */
  listSubvolumes?: SubvolumeLister;
}

/** Decodes the octal escapes (`\040` for space, ...) used in mountinfo paths. */
export function unescapeMountPath(value: string): string {
  return value.replace(
    /\\([0-7]{3})/g,
    (_, octal: string) => String.fromCharCode(parseInt(octal, 8)),
  );
}

/**
 * Parses the btrfs entries of a mountinfo table. Lines are of the form
 * `id parent maj:min root mountpoint options [optional...] - fstype source superopts`.
 */
export function parseMountInfo(content: string): BtrfsMount[] {
  const mounts: BtrfsMount[] = [];
  for (const line of content.split("\n")) {
    const tokens = line.trim().split(/\s+/);
    const separator = tokens.indexOf("-");
    if (separator < 5 || tokens.length < separator + 4) continue;

    const fsType = tokens[separator + 1];
    if (fsType !== "btrfs") continue;

    const superOptions = tokens[separator + 3].split(",");
    const subvolOption = superOptions.find((option) =>
      option.startsWith("subvolid=")
    );
    const subvolId = subvolOption
      ? Number.parseInt(subvolOption.slice("subvolid=".length), 10)
      : Number.NaN;

    mounts.push({
      superblock: tokens[2],
      device: tokens[separator + 2],
      mountPoint: unescapeMountPath(tokens[4]),
      subvolId: Number.isInteger(subvolId) ? subvolId : null,
    });
  }
  return mounts;
}

/** A mounted filesystem with all of its mount points. */
export interface BtrfsFilesystem {
  /** Source device of the first mount. */
  device: string;
  /** Mount point used to list subvolumes. */
  listingMountPoint: string;
  /** Every mount point of the filesystem, in mount table order. */
  mountPoints: string[];
  /** Subvolume id to the mount points showing it. */
  mountsBySubvolId: Map<number, string[]>;
}

/**
 * Groups btrfs mounts by superblock, so every mount of one filesystem (including
 * bind mounts and subvolume mounts) belongs to a single entry.
 */
export function groupByFilesystem(mounts: BtrfsMount[]): BtrfsFilesystem[] {
  const filesystems = new Map<string, BtrfsFilesystem>();
  for (const mount of mounts) {
    let fs = filesystems.get(mount.superblock);
    if (!fs) {
      fs = {
        device: mount.device,
        listingMountPoint: mount.mountPoint,
        mountPoints: [],
        mountsBySubvolId: new Map(),
      };
      filesystems.set(mount.superblock, fs);
    }
    if (!fs.mountPoints.includes(mount.mountPoint)) {
      fs.mountPoints.push(mount.mountPoint);
    }
    if (mount.subvolId !== null) {
      const mounted = fs.mountsBySubvolId.get(mount.subvolId) ?? [];
      if (!mounted.includes(mount.mountPoint)) mounted.push(mount.mountPoint);
      fs.mountsBySubvolId.set(mount.subvolId, mounted);
    }
  }
  return [...filesystems.values()];
}

/**
 * Parses `btrfs subvolume list -a -p` output. Each line has the form
 * `ID 256 gen 9 parent 5 top level 5 path home`.
 * The path is the last field, so it is read to the end of the line.
 */
export function parseSubvolumeList(output: string): SubvolumeRecord[] {
  const records: SubvolumeRecord[] = [];
  for (const line of output.split("\n")) {
    const idMatch = /^ID (\d+) /.exec(line);
    const parentMatch = /\bparent (\d+)\b/.exec(line);
    const pathMatch = /\spath (.*)$/.exec(line);
    if (!idMatch || !parentMatch || !pathMatch) continue;

    records.push({
      id: Number(idMatch[1]),
      parentId: Number(parentMatch[1]),
      path: pathMatch[1].trim().replace(FS_TREE_PREFIX, ""),
    });
  }
  return records;
}

/** Compares two paths in a stable, human-friendly order. */
function comparePaths(a: BtrfsSubvolume, b: BtrfsSubvolume): number {
  return a.path.localeCompare(b.path) || a.id - b.id;
}

/**
 * Arranges subvolume records into a tree using their parent ids. Every record
 * is rendered. A subvolume whose parent is not in the list (the top-level tree,
 * or a parent outside the listing) becomes a root.
 */
export function buildSubvolumeTree(
  records: SubvolumeRecord[],
  mountsBySubvolId: ReadonlyMap<number, string[]> = new Map(),
): BtrfsSubvolume[] {
  const nodes = new Map<number, BtrfsSubvolume>();
  for (const record of records) {
    nodes.set(record.id, {
      id: record.id,
      parentId: record.parentId,
      path: record.path,
      mountPoints: [...(mountsBySubvolId.get(record.id) ?? [])],
      children: [],
    });
  }

  const roots: BtrfsSubvolume[] = [];
  for (const record of records) {
    const node = nodes.get(record.id)!;
    const parent = nodes.get(record.parentId);
    if (parent && parent !== node) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const sortTree = (list: BtrfsSubvolume[]): void => {
    list.sort(comparePaths);
    for (const node of list) sortTree(node.children);
  };
  sortTree(roots);
  return roots;
}

/** Runs `btrfs subvolume list` for a mount point and returns stdout. */
async function runBtrfsList(mountPoint: string): Promise<string> {
  const { success, stdout, stderr } = await new Deno.Command("btrfs", {
    args: ["subvolume", "list", "-a", "-p", mountPoint],
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
  }).output();
  const decoder = new TextDecoder();
  if (!success) {
    const reason = decoder.decode(stderr).trim();
    throw new Error(reason || "btrfs subvolume list failed");
  }
  return decoder.decode(stdout);
}

/** Returns the message of an unknown thrown value. */
function errorMessage(error: unknown): string {
  if (error instanceof Deno.errors.NotFound) {
    return "btrfs command not found";
  }
  return error instanceof Error ? error.message : String(error);
}

/**
 * Lists every mounted btrfs filesystem with its subvolume tree. A failure to
 * list one filesystem is reported in that volume's `error` field and does not
 * stop the others.
 *
 * @throws {Error} If the mount table cannot be read.
 */
export async function listBtrfsVolumes(
  options: ListBtrfsVolumesOptions = {},
): Promise<BtrfsVolume[]> {
  const readMountInfo = options.readMountInfo ??
    (() => Deno.readTextFile(MOUNTINFO_PATH));
  const listSubvolumes = options.listSubvolumes ?? runBtrfsList;

  const mountInfo = await readMountInfo();
  const filesystems = groupByFilesystem(parseMountInfo(mountInfo));

  const volumes: BtrfsVolume[] = [];
  for (const fs of filesystems) {
    const base = {
      device: fs.device,
      mountPoints: fs.mountPoints,
    };
    try {
      const records = parseSubvolumeList(
        await listSubvolumes(fs.listingMountPoint),
      ).filter((record) => record.id !== TOP_LEVEL_ID);
      volumes.push({
        ...base,
        subvolumes: buildSubvolumeTree(records, fs.mountsBySubvolId),
        error: null,
      });
    } catch (error) {
      volumes.push({
        ...base,
        subvolumes: [],
        error: `Cannot list subvolumes of ${fs.listingMountPoint}: ${
          errorMessage(error)
        }`,
      });
    }
  }
  return volumes;
}
