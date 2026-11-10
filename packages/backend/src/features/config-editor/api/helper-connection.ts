import { sessionBus, systemBus } from "dbus-next";
import type { ClientInterface, MessageBus, ProxyObject } from "dbus-next";
import { logger } from "@snapshot-machine/backend/shared/logger.ts";
import {
  CONNECT_TIMEOUT_MS,
  HELPER_BUS_NAME,
  HELPER_INTERFACE,
  HELPER_OBJECT_PATH,
  INTROSPECTION_TIMEOUT_MS,
  METHOD_CALL_TIMEOUT_MS,
} from "./helper-constants.ts";
import { HelperUnavailableError, toHelperError } from "./helper-errors.ts";

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
export async function withHelper<T>(
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
