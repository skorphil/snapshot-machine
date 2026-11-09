import {
  showPortalFileDialog,
} from "@snapshot-machine/backend/shared/xdg-portal/index.ts";

const PICKER_TITLE = "Select folder";

/**
 * Opens the XDG Desktop Portal folder chooser over the session D-Bus and
 * waits for the Request `Response` signal.
 *
 * @param title - Dialog title. Defaults to "Select folder".
 * @returns The absolute path of the selected directory, or null if cancelled,
 * empty, or failed.
 */
export async function pickFolder(title?: string): Promise<string | null> {
  const selected = await showPortalFileDialog({
    method: "OpenFile",
    title: title || PICKER_TITLE,
    directory: true,
  });
  return selected;
}
