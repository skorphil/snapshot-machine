/// <reference lib="deno.ns" />
import { assertEquals, assertThrows } from "@std/assert";
import { HelperUnavailableError } from "@snapshot-machine/backend/shared/helper/index.ts";
import { parseBackupStatus } from "./backup-run.ts";

Deno.test("parseBackupStatus accepts a well-formed status document", () => {
  const status = parseBackupStatus(
    JSON.stringify({
      state: "failure",
      message: "btrbk exited with code 1",
      startedAt: "2026-11-10T10:00:00.000Z",
      finishedAt: "2026-11-10T10:00:05.000Z",
    }),
  );
  assertEquals(status, {
    state: "failure",
    message: "btrbk exited with code 1",
    startedAt: "2026-11-10T10:00:00.000Z",
    finishedAt: "2026-11-10T10:00:05.000Z",
  });
});

Deno.test("parseBackupStatus accepts an idle status without timestamps", () => {
  const status = parseBackupStatus(
    JSON.stringify({
      state: "idle",
      message: "No backup has been run yet.",
      startedAt: null,
      finishedAt: null,
    }),
  );
  assertEquals(status.state, "idle");
  assertEquals(status.startedAt, null);
});

Deno.test("parseBackupStatus rejects invalid JSON", () => {
  assertThrows(() => parseBackupStatus("{not json"), HelperUnavailableError);
});

Deno.test("parseBackupStatus rejects unknown states and wrong field types", () => {
  assertThrows(
    () =>
      parseBackupStatus(
        JSON.stringify({
          state: "done",
          message: "",
          startedAt: null,
          finishedAt: null,
        }),
      ),
    HelperUnavailableError,
  );
  assertThrows(
    () =>
      parseBackupStatus(
        JSON.stringify({
          state: "idle",
          message: 3,
          startedAt: null,
          finishedAt: null,
        }),
      ),
    HelperUnavailableError,
  );
  assertThrows(
    () =>
      parseBackupStatus(
        JSON.stringify({
          state: "idle",
          message: "",
          startedAt: 5,
          finishedAt: null,
        }),
      ),
    HelperUnavailableError,
  );
  assertThrows(() => parseBackupStatus("null"), HelperUnavailableError);
});
