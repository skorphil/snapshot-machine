import type { SaveFileOptions } from "@btrbk-gui/shared/types.ts";
import { showPortalFileDialog } from "@btrbk-gui/backend/shared/xdg-portal/index.ts";

/**
 * Opens the XDG Desktop Portal save dialog and resolves with the chosen
 * destination path (which may not exist yet).
 *
 * @param opts - Dialog title, suggested name and folder, and confirm label.
 * @returns The chosen destination path, or null if cancelled or failed.
 */
export function saveFile(opts: SaveFileOptions = {}): Promise<string | null> {
  return showPortalFileDialog({
    method: "SaveFile",
    title: opts.title || "Save file",
    currentName: opts.suggestedName,
    currentFolder: opts.suggestedFolder,
    acceptLabel: opts.acceptLabel,
  });
}
