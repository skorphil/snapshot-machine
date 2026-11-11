/**
 * Shared connection layer for the Root Helper D-Bus service.
 *
 * @module
 */
export {
  CONNECT_TIMEOUT_MS,
  HELPER_BUS_NAME,
  HELPER_INTERFACE,
  HELPER_OBJECT_PATH,
  INTROSPECTION_TIMEOUT_MS,
  METHOD_CALL_TIMEOUT_MS,
  SYSTEM_BUS_SOCKET,
} from "./helper-constants.ts";
export {
  HelperUnavailableError,
  isHelperRejection,
  toHelperError,
} from "./helper-errors.ts";
export { withHelper } from "./helper-connection.ts";
