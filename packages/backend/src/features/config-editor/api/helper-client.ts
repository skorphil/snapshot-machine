import { DBusError, sessionBus, systemBus } from "dbus-next";
import type { ClientInterface, MessageBus, ProxyObject } from "dbus-next";
import type { SaveConfigResult } from "@snapshot-machine/shared/types.ts";
import { logger } from "@snapshot-machine/backend/shared/logger.ts";

/** Well-known bus name of the Root Helper. */
export const HELPER_BUS_NAME = "com.snapshot_machine.BtrbkService1";
/** Object path the Root Helper exports its interface on. */
export const HELPER_OBJECT_PATH = "/com/snapshot_machine/BtrbkService1";
/** Interface name of the Root Helper. */
export const HELPER_INTERFACE = "com.snapshot_machine.BtrbkService1";

/** Default path of the system bus socket. */
export const SYSTEM_BUS_SOCKET = "/var/run/dbus/system_bus_socket";

/** Time allowed for the socket connection and `Hello` handshake. Fails fast otherwise. */
export const CONNECT_TIMEOUT_MS = 3000;
/**
 * Time allowed for `bus.getProxyObject()` (introspection). Long enough for the
 * bus to auto-activate the Root Helper service if it is not running yet.
 */
export const INTROSPECTION_TIMEOUT_MS = 8000;
/**
 * Time allowed for a helper method call. Long enough for a Polkit
 * authorization prompt to be answered by the user.
 */
export const METHOD_CALL_TIMEOUT_MS = 60000;

/** Error names the Root Helper returns for rejected requests. */
const REJECTED_ERRORS = new Set([
  "com.snapshot_machine.BtrbkService1.Error.InvalidArgument",
  "com.snapshot_machine.BtrbkService1.Error.NotAuthorized",
]);

/** Error names the bus returns when no service owns the helper bus name. */
const UNKNOWN_SERVICE_ERRORS = new Set([
  "org.freedesktop.DBus.Error.ServiceUnknown",
  "org.freedesktop.DBus.Error.NameHasNoOwner",
]);

/** Error raised when the Root Helper cannot be reached or fails unexpectedly. */
export class HelperUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HelperUnavailableError";
  }
}

/**
 * Translates any failure of a helper interaction into an error with an
 * actionable message. Helper-side rejections (`DBusError`s listed in
 * {@link REJECTED_ERRORS}) are returned unchanged so callers can handle them.
 */
export function toHelperError(error: unknown): Error {
  if (error instanceof HelperUnavailableError) return error;
  if (error instanceof DBusError) {
    if (REJECTED_ERRORS.has(error.type)) return error;
    if (UNKNOWN_SERVICE_ERRORS.has(error.type)) {
      return new HelperUnavailableError(
        `Root Helper service not found on system bus (${HELPER_BUS_NAME}). Is the helper installed?`,
      );
    }
    return new HelperUnavailableError(
      `Root Helper call failed: ${error.text || error.type}`,
    );
  }

  const code = (error as { code?: unknown } | null)?.code;
  const message = error instanceof Error ? error.message : String(error);
  if (code === "ENOENT") {
    return new HelperUnavailableError(
      `Root Helper D-Bus socket not found (${SYSTEM_BUS_SOCKET}). Is the system D-Bus running?`,
    );
  }
  if (code === "ECONNREFUSED") {
    return new HelperUnavailableError(
      `Root Helper D-Bus socket refused the connection (${SYSTEM_BUS_SOCKET}).`,
    );
  }
  if (code === "EACCES" || code === "EPERM") {
    return new HelperUnavailableError(
      `Permission denied when connecting to the system D-Bus (${SYSTEM_BUS_SOCKET}).`,
    );
  }
  if (message.includes("NotCapable")) {
    return new HelperUnavailableError(
      "System D-Bus rejected the connection (NotCapable). Check the D-Bus authentication setup.",
    );
  }
  return new HelperUnavailableError(`Root Helper is not available: ${message}`);
}

/**
 * Resolves once the bus emits `connect`; rejects immediately on the first
 * `error` (ENOENT, ECONNREFUSED, EACCES, NotCapable, ...), or after
 * {@link CONNECT_TIMEOUT_MS} as a fallback.
 */
function waitForConnect(bus: MessageBus): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new HelperUnavailableError(
          `Timed out connecting to the system D-Bus after ${CONNECT_TIMEOUT_MS}ms`,
        ),
      );
    }, CONNECT_TIMEOUT_MS);
    bus.once("connect", () => {
      clearTimeout(timer);
      resolve();
    });
    bus.once("error", (error: unknown) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

/**
 * Races `work` against a timeout and against a bus failure, so that a dead
 * socket fails fast instead of leaving the promise pending forever.
 */
function guard<T>(
  work: Promise<T>,
  busFailure: Promise<never>,
  timeoutMs: number,
  stage: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new HelperUnavailableError(
            `Root Helper ${stage} timed out after ${timeoutMs}ms`,
          ),
        ),
      timeoutMs,
    );
  });
  return Promise.race([work, timeout, busFailure]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

/**
 * Runs `operation` against the Root Helper using a fresh system bus connection
 * that is always closed afterwards.
 */
async function withHelper<T>(
  operation: (helper: ClientInterface) => Promise<T>,
): Promise<T> {
  let bus: MessageBus | undefined;
  try {
    // USE_SESSION_BUS=1 targets the development helper on the session bus.
    bus = Deno.env.get("USE_SESSION_BUS") === "1" ? sessionBus() : systemBus();
    const connection: MessageBus = bus;

    // Persistent listener: without it, an `error` emitted after the one-shot
    // handshake listener is removed would be thrown as unhandled. It also
    // turns late bus failures into a rejection the pending steps can observe.
    let failBus: (error: unknown) => void = () => undefined;
    const busFailure = new Promise<never>((_, reject) => {
      failBus = reject;
    });
    busFailure.catch(() => undefined);
    connection.on("error", (error: unknown) => {
      logger.error("D-Bus error:", error);
      failBus(error);
    });

    await waitForConnect(connection);

    const proxy: ProxyObject = await guard(
      connection.getProxyObject(HELPER_BUS_NAME, HELPER_OBJECT_PATH),
      busFailure,
      INTROSPECTION_TIMEOUT_MS,
      "introspection",
    );
    return await guard(
      operation(proxy.getInterface(HELPER_INTERFACE)),
      busFailure,
      METHOD_CALL_TIMEOUT_MS,
      "call",
    );
  } catch (error) {
    throw toHelperError(error);
  } finally {
    try {
      bus?.disconnect();
    } catch (error) {
      logger.error("D-Bus disconnect failed:", error);
    }
  }
}

/** Returns the names of the configuration files managed by the Root Helper. */
export function listConfigFiles(): Promise<string[]> {
  return withHelper((helper) => helper.ListConfigFiles() as Promise<string[]>);
}

/** Returns the content of one configuration file managed by the Root Helper. */
export function readConfigFile(name: string): Promise<string> {
  return withHelper((helper) => helper.ReadConfigFile(name) as Promise<string>);
}

/**
 * Asks the Root Helper to validate and write a configuration file. A rejected
 * request (invalid syntax, invalid name, or denied authorization) is returned
 * as `{ ok: false, error }`; an unreachable helper still throws.
 */
export async function saveConfigFile(
  name: string,
  content: string,
): Promise<SaveConfigResult> {
  try {
    await withHelper((helper) => helper.SaveConfigFile(name, content));
    return { ok: true };
  } catch (error) {
    if (error instanceof DBusError && REJECTED_ERRORS.has(error.type)) {
      return { ok: false, error: error.text };
    }
    throw error;
  }
}
