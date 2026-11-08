import { sessionBus } from "dbus-next";
import type { ClientInterface, MessageBus } from "dbus-next";
import { logger } from "./logger.ts";
import {
  PORTAL_DESTINATION,
  PORTAL_FILE_CHOOSER,
  PORTAL_PATH,
} from "./constants.ts";

/**
 * Opens a connection to the D-Bus session bus.
 *
 * @returns A promise that resolves with the bus once connected, or rejects if
 * the connection fails before the `connect` event fires.
 */
export function connectSessionBus(): Promise<MessageBus> {
  return new Promise((resolve, reject) => {
    const bus = sessionBus();
    bus.on("error", (error: unknown) => logger.error("D-Bus error:", error));
    bus.once("connect", () => resolve(bus));
    // Reject if the connection fails before the 'connect' event fires.
    bus.once("error", reject);
  });
}

/**
 * Returns the FileChooser interface of the XDG Desktop Portal.
 *
 * @param bus - Connected session bus.
 */
export async function getFileChooser(
  bus: MessageBus,
): Promise<ClientInterface> {
  const portal = await bus.getProxyObject(PORTAL_DESTINATION, PORTAL_PATH);
  return portal.getInterface(PORTAL_FILE_CHOOSER);
}
