import { isAbsolute, join } from "@std/path";
import type {
  SnapshotLocation,
  SnapshotLocationKind,
} from "@snapshot-machine/shared/types.ts";
import {
  type BtrbkConfig,
  loadBtrbkConfig,
} from "@snapshot-machine/backend/shared/btrbk-config/index.ts";

/** Resolves a btrbk path that may be relative to the volume it belongs to. */
function resolveAgainst(volumePath: string, path: string): string {
  return isAbsolute(path) ? path : join(volumePath, path);
}

/**
 * Resolves the snapshot storage locations of a parsed btrbk configuration to
 * absolute paths. A location is a `snapshot_dir` (of a volume or of one of its
 * subvolumes) or a local `target`. Relative paths are relative to their volume.
 * Each kind and path appears once, in order of first declaration.
 */
export function resolveSnapshotLocations(
  config: BtrbkConfig,
): SnapshotLocation[] {
  const locations: SnapshotLocation[] = [];
  const seen = new Set<string>();

  const add = (
    kind: SnapshotLocationKind,
    volumePath: string,
    path: string,
  ) => {
    const key = `${kind}\0${path}`;
    if (seen.has(key)) return;
    seen.add(key);
    locations.push({ kind, volumePath, path });
  };

  for (const volume of config.volumes) {
    if (volume.snapshotDir) {
      add(
        "snapshot_dir",
        volume.path,
        resolveAgainst(volume.path, volume.snapshotDir),
      );
    }
    for (const target of volume.targets) {
      add("target", volume.path, resolveAgainst(volume.path, target));
    }
    for (const subvolume of volume.subvolumes) {
      if (subvolume.snapshotDir) {
        add(
          "snapshot_dir",
          volume.path,
          resolveAgainst(volume.path, subvolume.snapshotDir),
        );
      }
      for (const target of subvolume.targets ?? []) {
        add("target", volume.path, resolveAgainst(volume.path, target));
      }
    }
  }
  return locations;
}

/**
 * Lists the snapshot storage locations (`snapshot_dir` and local `target`)
 * declared in the GUI-managed btrbk configuration.
 *
 * @throws {Error} If the managed configuration file is unreadable.
 */
export async function listSnapshotLocations(): Promise<SnapshotLocation[]> {
  return resolveSnapshotLocations(await loadBtrbkConfig());
}
