import type { ClientInterface, MessageBus } from "dbus-next";
import { logger } from "./logger.ts";
import {
  PICKER_TIMEOUT_MS,
  PORTAL_DESTINATION,
  PORTAL_REQUEST,
  RESPONSE_CANCELLED,
  RESPONSE_SUCCESS,
} from "./constants.ts";
import { unwrapVariant } from "./variants.ts";

/** Converts a `file://` URI from the portal into a local filesystem path. */
function uriToPath(uri: string): string | null {
  if (!uri.startsWith("file://")) return null;
  return decodeURIComponent(new URL(uri).pathname);
}

/**
 * Interprets the `Response` signal of a portal Request.
 *
 * @param code - Response code: 0 for success, 1 for cancelled, other values for errors.
 * @param results - Results dictionary; `uris` holds the selected `file://` URIs on success.
 * @returns The selected local path, or null if cancelled, failed, or unusable.
 */
export function parseResponse(
  code: number,
  results: Record<string, unknown> | undefined,
): string | null {
  if (code === RESPONSE_CANCELLED) {
    logger.info("User cancelled");
    return null;
  }

  if (code !== RESPONSE_SUCCESS) {
    logger.error(`Portal returned error code ${code}`);
    return null;
  }

  const uris = unwrapVariant(results?.uris);
  if (!Array.isArray(uris) || uris.length === 0) {
    logger.warn("No folder selected (empty uris)");
    return null;
  }

  const uri = unwrapVariant(uris[0]);
  if (typeof uri !== "string") {
    logger.warn(`Unexpected URI value: ${String(uri)}`);
    return null;
  }

  const path = uriToPath(uri);
  if (!path) {
    logger.warn(`Unexpected URI format: ${uri}`);
    return null;
  }

  logger.info(`Selected: ${path}`);
  return path;
}

/**
 * Subscribes to the `Response` signal of a portal Request and waits for it,
 * giving up after {@link PICKER_TIMEOUT_MS}.
 *
 * @param bus - Connected session bus.
 * @param handlePath - Object path of the Request returned by the portal method call.
 * @returns The selected path, or null if cancelled, failed, or timed out.
 */
export async function waitForResponse(
  bus: MessageBus,
  handlePath: string,
): Promise<string | null> {
  logger.info(`Got handle: ${handlePath}`);

  // dbus-next adds the AddMatch rule when the listener is attached.
  const request = await bus.getProxyObject(PORTAL_DESTINATION, handlePath);
  const requestIface: ClientInterface = request.getInterface(PORTAL_REQUEST);

  return await new Promise<string | null>((resolve) => {
    const timer = setTimeout(() => {
      logger.warn("Timeout waiting for response");
      resolve(null);
    }, PICKER_TIMEOUT_MS);

    requestIface.on(
      "Response",
      (code: number, results: Record<string, unknown>) => {
        clearTimeout(timer);
        resolve(parseResponse(code, results));
      },
    );
  });
}
