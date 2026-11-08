/**
 * Reads and parses a btrbk configuration file. Blank lines and `#` comments
 * are ignored; unrecognized keys are skipped.
 *
 * @param configPath - Absolute path to the btrbk configuration file.
 * @returns The parsed configuration.
 */
export async function parseConfig(configPath: string): Promise<BtrbkConfig> {
  const content = await Deno.readTextFile(configPath);
  const lines = content.split("\n");
  const config: BtrbkConfig = { volumes: [] };
  let currentVolume: VolumeConfig | null = null;

  for (let line of lines) {
    line = line.trim();
    if (!line || line.startsWith("#")) continue;

    const [key, ...values] = line.split(/\s+/);
    const value = values.join(" ");

    if (key === "volume") {
      currentVolume = { path: value, subvolumes: [] };
      config.volumes.push(currentVolume);
    } else if (key === "snapshot_dir" && currentVolume) {
      currentVolume.snapshotDir = value;
    } else if (key === "subvolume" && currentVolume) {
      currentVolume.subvolumes.push({ path: value });
    } else if (
      key === "snapshot_name" && currentVolume &&
      currentVolume.subvolumes.length > 0
    ) {
      currentVolume.subvolumes[currentVolume.subvolumes.length - 1].name =
        value;
    }
  }

  return config;
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
