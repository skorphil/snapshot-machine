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
