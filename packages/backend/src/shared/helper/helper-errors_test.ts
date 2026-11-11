/// <reference lib="deno.ns" />
import { assertEquals, assertInstanceOf } from "@std/assert";
import { DBusError } from "dbus-next";
import { HelperUnavailableError, toHelperError } from "./helper-errors.ts";

function withCode(code: string): Error {
  const error = new Error(`connect ${code}`);
  Object.assign(error, { code });
  return error;
}

Deno.test("toHelperError maps ENOENT to a missing socket message", () => {
  const mapped = toHelperError(withCode("ENOENT"));
  assertInstanceOf(mapped, HelperUnavailableError);
  assertEquals(mapped.message.includes("socket not found"), true);
});

Deno.test("toHelperError maps ServiceUnknown to a missing service message", () => {
  const mapped = toHelperError(
    new DBusError("org.freedesktop.DBus.Error.ServiceUnknown", "no such name"),
  );
  assertInstanceOf(mapped, HelperUnavailableError);
  assertEquals(mapped.message.includes("service not found"), true);
});

Deno.test("toHelperError keeps helper-side rejections unchanged", () => {
  const rejection = new DBusError(
    "com.snapshot_machine.BtrbkService1.Error.NotAuthorized",
    "denied",
  );
  assertEquals(toHelperError(rejection), rejection);
});

Deno.test("toHelperError maps NotCapable and unknown failures", () => {
  assertInstanceOf(
    toHelperError(new Error("NotCapable")),
    HelperUnavailableError,
  );
  assertEquals(
    toHelperError(new Error("boom")).message,
    "Root Helper is not available: boom",
  );
});

Deno.test("toHelperError keeps a Busy rejection unchanged", () => {
  const rejection = new DBusError(
    "com.snapshot_machine.BtrbkService1.Error.Busy",
    "A backup is already running",
  );
  assertEquals(toHelperError(rejection), rejection);
});
