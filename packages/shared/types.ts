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
  /** Scans the btrbk snapshot history of a folder. */
  listFolderHistory(path: string): Promise<FileHistoryEntry[]>;
  /** Copies a snapshot file to the destination path. */
  restoreFile(src: string, dest: string): Promise<void>;
  /** Forwards a diagnostic message from the webview to the backend log. */
  logFromWebview(msg: unknown): void;
}
