/// <reference lib="deno.ns" />
import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { HelperUnavailableError } from "@snapshot-machine/backend/shared/helper/index.ts";
import { assertValidPath, parseSnapshotSize } from "./get-snapshot-size.ts";

const VALID = {
  path: "/home/alice/.snapshots/home.2026",
  totalBytes: 21528117248,
  exclusiveBytes: 8412565504,
  sharedBytes: 9785421824,
};

Deno.test("parseSnapshotSize accepts a valid document", () => {
  assertEquals(parseSnapshotSize(JSON.stringify(VALID)), VALID);
});

Deno.test("parseSnapshotSize accepts a document without sharedBytes", () => {
  const { sharedBytes: _omitted, ...rest } = VALID;
  assertEquals(parseSnapshotSize(JSON.stringify(rest)), rest);
});

Deno.test("parseSnapshotSize rejects a payload that is not a string", () => {
  assertThrows(() => parseSnapshotSize(42), HelperUnavailableError);
});

Deno.test("parseSnapshotSize rejects invalid JSON", () => {
  assertThrows(() => parseSnapshotSize("{"), HelperUnavailableError);
});

Deno.test("parseSnapshotSize rejects a non-object document", () => {
  assertThrows(() => parseSnapshotSize("[]"), HelperUnavailableError);
});

Deno.test("parseSnapshotSize names the field with the wrong type", () => {
  assertThrows(
    () => parseSnapshotSize(JSON.stringify({ ...VALID, exclusiveBytes: "1" })),
    HelperUnavailableError,
    "exclusiveBytes",
  );
});

Deno.test("parseSnapshotSize rejects a non-integer byte count", () => {
  assertThrows(
    () => parseSnapshotSize(JSON.stringify({ ...VALID, totalBytes: 1.5 })),
    HelperUnavailableError,
    "totalBytes",
  );
});

Deno.test("assertValidPath accepts an absolute path", () => {
  assertValidPath("/mnt/backups/x");
});

Deno.test("assertValidPath rejects relative, empty and NUL-containing paths", () => {
  assertThrows(() => assertValidPath("x/y"), Error, "absolute");
  assertThrows(() => assertValidPath(""), Error, "between 1 and");
  assertThrows(() => assertValidPath("/a\0b"), Error, "NUL");
});

Deno.test("getSnapshotSize rejects an invalid path before calling the helper", async () => {
  const { getSnapshotSize } = await import("./get-snapshot-size.ts");
  await assertRejects(() => getSnapshotSize("relative"), Error, "absolute");
});
