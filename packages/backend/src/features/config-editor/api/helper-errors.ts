import { DBusError } from "dbus-next";
import { HELPER_BUS_NAME, SYSTEM_BUS_SOCKET } from "./helper-constants.ts";

/** Error names the Root Helper returns for rejected requests. */
const REJECTED_ERRORS = new Set([
  "com.snapshot_machine.BtrbkService1.Error.InvalidArgument",
  "com.snapshot_machine.BtrbkService1.Error.NotAuthorized",
  "com.snapshot_machine.BtrbkService1.Error.Busy",
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
 * Returns true if the error is a request rejected by the Root Helper itself
 * (invalid argument, denied authorization, or busy), as opposed to a transport failure.
 */
export function isHelperRejection(error: unknown): error is DBusError {
  return error instanceof DBusError && REJECTED_ERRORS.has(error.type);
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
