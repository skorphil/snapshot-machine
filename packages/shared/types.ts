/** One logical file or directory tracked across snapshots, identified by inode. */
export type FileHistoryEntry = {
  /** Base name of the entry. */
  name: string;
  /** Name relative to the scanned folder. */
  path: string;
  /** Inode number used as the identity across snapshots, as a string to preserve 64-bit precision. */
  ino: string;
  /** Kind of filesystem entry. */
  type: "file" | "directory" | "other";
  /** True when the inode is absent from the latest snapshot. */
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
}

/** Outcome of saving a configuration file. */
export interface SaveConfigResult {
  /** True when the file was validated and written. */
  ok: boolean;
  /** Reason the save was rejected, e.g. "config is incorrect: ...". */
  error?: string;
}
