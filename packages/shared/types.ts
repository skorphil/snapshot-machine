/**
 * One logical file or directory tracked across snapshots, identified by its
 * name relative to the scanned folder. Versions with different inodes (atomic
 * replacements) and renamed versions are consolidated into one entry.
 */
export type FileHistoryEntry = {
  /** Base name of the entry, i.e. the name in the newest snapshot that holds it. */
  name: string;
  /** Name relative to the scanned folder. Equal to `name` for direct children. */
  path: string;
  /** Inode of the newest version, as a string to preserve 64-bit precision. */
  ino: string;
  /** Kind of filesystem entry. */
  type: "file" | "directory" | "other";
  /** True when no snapshot holding the folder contains this name in the newest one. */
  deleted: boolean;
  /** Name of the most recent snapshot the entry was seen in. */
  lastSeen: string;
  /** Every observed version, newest snapshot first. */
  versions: FileVersion[];
};

/** A single snapshot's view of a history entry. */
export type FileVersion = {
  /** Snapshot directory name. */
  snapshot: string;
  /** Absolute path of the entry inside the snapshot. */
  path: string;
  /** ISO timestamp parsed from the snapshot name, or null if it has none. */
  snapshotDate: string | null;
  /** ISO modification time, or null if unavailable. */
  mtime: string | null;
  /** ISO status-change time, or null if unavailable. */
  ctime: string | null;
  /** ISO birth time, or null if unavailable. */
  birthtime: string | null;
  /** Size in bytes. */
  size: number;
  /**
   * Previous name of the entry when this snapshot's version was reached by a
   * rename, or null when the name did not change.
   */
  renamedFrom?: string | null;
};

/** External binaries the application requires. */
export type DependencyName = "btrbk" | "btrfs";

/** Availability of a single external binary. */
export interface DependencyStatus {
  /** Binary name as invoked on PATH. */
  name: DependencyName;
  /** True when the binary exists and `--version` succeeded. */
  available: boolean;
  /** Version reported by the binary, or null if unavailable or unparsable. */
  version: string | null;
  /** Human-readable reason the binary is unavailable, or null. */
  error: string | null;
}

/** Result of checking every required dependency. */
export interface DependencyReport {
  /** True when every required dependency is available. */
  ok: boolean;
  /** Per-dependency status, in check order. */
  dependencies: DependencyStatus[];
}

/** Options accepted by the native save dialog. */
export interface SaveFileOptions {
  /** Dialog title. Defaults to "Save file". */
  title?: string;
  /** File name pre-filled in the dialog. */
  suggestedName?: string;
  /** Folder shown initially in the dialog. */
  suggestedFolder?: string;
  /** Label of the confirm button. */
  acceptLabel?: string;
}

/**
 * Functions the Deno Desktop backend exposes to the frontend under
 * `globalThis.bindings`. This is the single contract between both sides.
 */
export interface DesktopBindings {
  /** Opens the native folder picker. Resolves to the chosen path, or null if cancelled. */
  pickFolder(title?: string): Promise<string | null>;
  /** Opens the native save dialog. Resolves to the chosen path, or null if cancelled. */
  saveFile(opts?: SaveFileOptions): Promise<string | null>;
  /** Reports whether the required btrbk and btrfs binaries are available. */
  getDependencyStatus(): Promise<DependencyReport>;
  /** Scans the btrbk snapshot history of a folder. Fails if dependencies are missing. */
  listFolderHistory(path: string): Promise<FileHistoryEntry[]>;
  /** Copies a snapshot file to the destination path. Fails if dependencies are missing. */
  restoreFile(src: string, dest: string): Promise<void>;
  /** Returns the absolute home directory of the current user. */
  getHomeDirectory(): Promise<string>;
  /** Forwards a diagnostic message from the webview to the backend log. */
  logFromWebview(msg: unknown): void;
  /** Returns the drop-in file name the app manages (`BTRBK_CONFIG_NAME`, default `snapshot-machine.conf`). */
  getConfigName(): Promise<string>;
  /** Returns the full path of the managed drop-in file, e.g. /etc/btrbk/gui.conf.d/snapshot-machine.conf. */
  getConfigPath(): Promise<string>;
  /** Lists the btrbk configuration file names in /etc/btrbk/gui.conf.d via the Root Helper. */
  listConfigFiles(): Promise<string[]>;
  /** Reads a configuration file from /etc/btrbk/gui.conf.d via the Root Helper. */
  readConfigFile(name: string): Promise<string>;
  /**
   * Validates and saves a configuration file through the Root Helper. Resolves with
   * `ok: false` and an `error` message when btrbk rejects the content or access is denied.
   */
  saveConfigFile(name: string, content: string): Promise<SaveConfigResult>;
  /**
   * Starts `btrbk run` through the Root Helper after Polkit authorization. Resolves once the run
   * has started; progress is read with `getBackupStatus`. Resolves with `ok: false` and an `error`
   * message when access is denied or a run is already in progress.
   */
  runBackup(): Promise<RunBackupResult>;
  /** Lists the mounted btrfs filesystems with their subvolume trees via the Root Helper. */
  listBtrfsVolumes(): Promise<BtrfsVolume[]>;
  /**
   * Calculates the exclusive and total size of a snapshot or subvolume with
   * `btrfs filesystem du` through the Root Helper. The path must be an absolute
   * mount point path. Resolves with `error` set when the calculation fails or times out.
   */
  getSnapshotSize(path: string): Promise<SnapshotSize>;
  /**
   * Lists the snapshot storage locations (`snapshot_dir` and local `target`
   * directories) of the GUI-managed btrbk configuration, with absolute paths.
   * Rejects when the configuration is unreadable.
   */
  listSnapshotLocations(): Promise<SnapshotLocation[]>;
  /**
   * Lists the snapshots stored directly in one snapshot location, newest first.
   * Sizes are not calculated; `size` is null. Resolves with an empty list when
   * the location does not exist yet.
   */
  listSnapshots(path: string): Promise<SnapshotEntry[]>;
  /** Returns the state of the current or most recent backup run from the Root Helper. */
  getBackupStatus(): Promise<BackupStatus>;
  /** Returns the configured backup interval and whether the systemd timer is enabled. */
  getSchedule(): Promise<BackupSchedule>;
  /**
   * Applies the backup schedule through the Root Helper, which writes the systemd units and
   * asks for Polkit authorization. `interval` is `null` to remove the schedule. Resolves with
   * `ok: false` and an `error` message when the request is rejected.
   */
  setSchedule(
    interval: ScheduleInterval | null,
    enabled: boolean,
  ): Promise<SetScheduleResult>;
  /** Returns the last run time, next run time and result of the scheduled backup. */
  getScheduleStatus(): Promise<ScheduleStatus>;
}

/** Unit of a backup interval. */
export type ScheduleUnit = "minutes" | "hours" | "days";

/** A repeating backup interval, for example every 2 hours. */
export interface ScheduleInterval {
  /** Whole number of units between two runs; accepted counts are listed in `SCHEDULE_COUNTS`. */
  count: number;
  /** Unit of `count`. */
  unit: ScheduleUnit;
}

/** Configured backup schedule. */
export interface BackupSchedule {
  /** Repeat interval; `null` when no timer is installed. */
  interval: ScheduleInterval | null;
  /** True when the systemd timer is enabled. */
  enabled: boolean;
}

/** Last and next run of the scheduled backup. */
export interface ScheduleStatus {
  /** Time of the last trigger as reported by systemd, or an empty string if it never ran. */
  lastRunTime: string;
  /** Time of the next scheduled run as reported by systemd, or an empty string if none is set. */
  nextRunTime: string;
  /** Result of the last scheduled run. */
  lastRunResult: "never" | "running" | "success" | "failure";
}

/** Outcome of changing the backup schedule. */
export interface SetScheduleResult {
  /** True when the schedule was applied. */
  ok: boolean;
  /** Reason the schedule was not applied, e.g. a denied authorization. */
  error?: string;
}

/** Lifecycle state of a backup run. */
export type BackupState = "idle" | "running" | "success" | "failure";

/** Status of the current or most recent backup run. */
export interface BackupStatus {
  /** Lifecycle state. */
  state: BackupState;
  /** Human-readable summary; for failures, the tail of btrbk's output. */
  message: string;
  /** ISO time the current or most recent run started, or null if none ran yet. */
  startedAt: string | null;
  /** ISO time the most recent run finished, or null while running or if none ran yet. */
  finishedAt: string | null;
}

/** Outcome of asking the Root Helper to start a backup run. */
export interface RunBackupResult {
  /** True when the run was started. */
  ok: boolean;
  /** Reason the run was not started, e.g. a denied authorization. */
  error?: string;
}

/** Outcome of saving a configuration file. */
export interface SaveConfigResult {
  /** True when the file was validated and written. */
  ok: boolean;
  /** Reason the save was rejected, e.g. "config is incorrect: ...". */
  error?: string;
}

/** Kind of a location that stores snapshots. */
export type SnapshotLocationKind = "snapshot_dir" | "target";

/** A directory that stores snapshots: a btrbk `snapshot_dir` or a local `target`. */
export interface SnapshotLocation {
  /** Whether the directory comes from `snapshot_dir` or `target`. */
  kind: SnapshotLocationKind;
  /** Mount point of the volume the location belongs to. */
  volumePath: string;
  /** Absolute path of the directory that stores snapshots. */
  path: string;
}

/** One snapshot stored in a snapshot location. */
export interface SnapshotEntry {
  /** Directory name, e.g. `home.20261119T1200`. */
  name: string;
  /** Absolute path of the snapshot. */
  path: string;
  /** ISO timestamp parsed from the name, or null when the name carries none. */
  date: string | null;
  /** Size, or null until it is calculated. Listing never calculates sizes. */
  size: SnapshotSize | null;
}

/** Space used by one path, as reported by `btrfs filesystem du -s`. */
export interface SnapshotSize {
  /** Absolute path that was measured. */
  path: string;
  /** Bytes referenced by the path, including data shared with other subvolumes. */
  totalBytes: number;
  /** Bytes referenced only by this path. */
  exclusiveBytes: number;
  /** Bytes shared with other paths of the same set; absent when not reported. */
  sharedBytes?: number;
  /** Reason the size could not be calculated, e.g. a timeout. Absent on success. */
  error?: string;
}

/**
 * One subvolume of a btrfs filesystem, with the subvolumes nested below it.
 */
export interface BtrfsSubvolume {
  /** Subvolume id within the filesystem. */
  id: number;
  /** Id of the parent subvolume, or 5 for the top-level tree. */
  parentId: number;
  /** Path relative to the top-level tree, e.g. `home/alice`. */
  path: string;
  /** Mount points at which this subvolume is mounted; empty when it is not mounted. */
  mountPoints: string[];
  /** Subvolumes whose parent is this one, sorted by path. */
  children: BtrfsSubvolume[];
}

/** A mounted btrfs filesystem and the subvolume tree it contains. */
export interface BtrfsVolume {
  /** Source device of the filesystem, e.g. `/dev/sda2`. */
  device: string;
  /** Every mount point of the filesystem. */
  mountPoints: string[];
  /** Top-level subvolumes of the filesystem; empty when listing failed. */
  subvolumes: BtrfsSubvolume[];
  /** Reason the subvolumes could not be listed, or null when they were. */
  error: string | null;
}
