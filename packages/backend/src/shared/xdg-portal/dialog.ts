import { Variant } from "dbus-next";
import type { MessageBus } from "dbus-next";
import { logger } from "./logger.ts";
import { connectSessionBus, getFileChooser } from "./bus.ts";
import { toNulTerminatedBytes } from "./variants.ts";
import { waitForResponse } from "./responses.ts";
import type { PortalOptions } from "./types.ts";

/**
 * Generates a unique handle token so the portal Request path is known in
 * advance.
 */
export function createHandleToken(): string {
  return `snapshot_machine_${
    crypto.randomUUID().replaceAll("-", "").slice(0, 16)
  }`;
}

/**
 * Opens an XDG Desktop Portal FileChooser dialog (`OpenFile` or `SaveFile`)
 * and waits for the user's answer.
 *
 * @param opts - Dialog method, title, and optional dialog settings.
 * @returns The selected local path, or null if cancelled, failed, or timed out.
 */
export async function showPortalFileDialog(
  opts: PortalOptions,
): Promise<string | null> {
  let bus: MessageBus | null = null;

  try {
    bus = await connectSessionBus();
    const fileChooser = await getFileChooser(bus);

    const token = createHandleToken();

    // a{sv}: every value must be a Variant with the correct signature.
    const options: Record<string, Variant> = {
      handle_token: new Variant("s", token),
      modal: new Variant("b", true),
    };

    if (opts.directory) {
      options.directory = new Variant("b", true);
    }
    if (opts.currentName) {
      options.current_name = new Variant("s", opts.currentName);
    }
    if (opts.currentFolder) {
      options.current_folder = new Variant(
        "ay",
        toNulTerminatedBytes(opts.currentFolder),
      );
    }
    if (opts.acceptLabel) {
      options.accept_label = new Variant("s", opts.acceptLabel);
    }

    logger.info(
      `Calling ${opts.method} with token=${token}, title="${opts.title}"`,
    );
    // Both methods take (parent_window, title, options).
    const handlePath: string = await fileChooser[opts.method](
      "",
      opts.title,
      options,
    );

    return await waitForResponse(bus, handlePath);
  } catch (error) {
    logger.error(`${opts.method} failed:`, error);
    return null;
  } finally {
    // Closing the connection lets the process exit once the dialog is done.
    bus?.disconnect();
  }
}
