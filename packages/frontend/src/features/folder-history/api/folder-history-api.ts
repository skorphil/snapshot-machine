import type {
  FileHistoryEntry,
  FileVersion,
} from "@snapshot-machine/shared/types.ts";
import { getBindings } from "@/shared/bindings.ts";
import { logger } from "@/shared/logger.ts";

/** Opens the native folder picker and returns the selected path, if any. */
export async function pickFolder(): Promise<string | null> {
  const selected = await getBindings().pickFolder();
  logger.debug("pickFolder returned:", selected);
  return selected ?? null;
}

/** Scans the btrbk snapshot history for the given folder. */
export function listFolderHistory(path: string): Promise<FileHistoryEntry[]> {
  return getBindings().listFolderHistory(path);
}

/**
 * Prompts for a destination and restores the given file version there.
 * Resolves to `false` when the user cancels the save dialog.
 */
export async function restoreFile(
  entry: FileHistoryEntry,
  version: FileVersion,
  currentPath: string,
): Promise<boolean> {
  const dest = await getBindings().saveFile({
    title: "Restore File",
    suggestedName: entry.name,
    // Default to the parent of the currently scanned path if possible
    suggestedFolder: currentPath.substring(0, currentPath.lastIndexOf("/")),
    acceptLabel: "Restore",
  });
  if (!dest) return false;

  await getBindings().restoreFile(version.path, dest);
  return true;
}
