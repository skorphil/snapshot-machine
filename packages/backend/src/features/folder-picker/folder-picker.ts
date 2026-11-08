import {
  logger,
  showPortalFileDialog,
} from "@btrbk-gui/backend/shared/xdg-portal/index.ts";

const PICKER_TITLE = "Select folder";

/**
 * Opens the XDG Desktop Portal folder chooser over the session D-Bus and
 * waits for the Request `Response` signal.
 *
 * @param title - Dialog title. Defaults to "Select folder".
 * @returns The absolute path of the selected directory, or null if cancelled,
 * empty, or failed.
 */
export function pickFolder(title?: string): Promise<string | null> {
  return showPortalFileDialog({
    method: "OpenFile",
    title: title || PICKER_TITLE,
    directory: true,
  });
}

// Test harness
if (import.meta.main) {
  logger.info("Testing pickFolder with dbus-next...");
  const title = Deno.args[0] || "Test Title";
  const result = await pickFolder(title);
  logger.info("Result:", result);
  Deno.exit(result ? 0 : 1);
}
