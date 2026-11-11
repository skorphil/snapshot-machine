/// <reference lib="deno.ns" />
import { assertEquals, assertThrows } from "@std/assert";
import { HelperUnavailableError } from "@snapshot-machine/backend/shared/helper/index.ts";
import { parseSchedule, parseScheduleStatus } from "./backup-schedule.ts";

Deno.test("parseSchedule maps the off unit to no interval", () => {
  assertEquals(parseSchedule("off", 0, false), {
    interval: null,
    enabled: false,
  });
});

Deno.test("parseSchedule accepts every unit with an in-range count", () => {
  assertEquals(parseSchedule("minutes", 15, true), {
    interval: { count: 15, unit: "minutes" },
    enabled: true,
  });
  assertEquals(parseSchedule("hours", 2, false), {
    interval: { count: 2, unit: "hours" },
    enabled: false,
  });
  assertEquals(parseSchedule("days", 1, true), {
    interval: { count: 1, unit: "days" },
    enabled: true,
  });
});

Deno.test("parseSchedule rejects an enabled schedule without an interval", () => {
  assertThrows(
    () => parseSchedule("off", 0, true),
    HelperUnavailableError,
    "without an interval",
  );
});

Deno.test("parseSchedule rejects unknown units", () => {
  assertThrows(
    () => parseSchedule("weekly", 1, true),
    HelperUnavailableError,
    "unknown schedule unit",
  );
  assertThrows(
    () => parseSchedule(undefined, 1, true),
    HelperUnavailableError,
  );
});

Deno.test("parseSchedule rejects counts outside the limits of the unit", () => {
  for (
    const [unit, count] of [
      ["minutes", 0],
      ["minutes", 60],
      ["minutes", 7],
      ["hours", 24],
      ["hours", 5],
      ["days", 2],
      ["days", 31],
      ["hours", 1.5],
      ["hours", "2"],
    ] as const
  ) {
    assertThrows(
      () => parseSchedule(unit, count, true),
      HelperUnavailableError,
      "invalid schedule count",
    );
  }
});

Deno.test("parseSchedule rejects a non-boolean enabled value", () => {
  assertThrows(
    () => parseSchedule("hours", 1, "yes"),
    HelperUnavailableError,
    "(enabled)",
  );
  assertThrows(
    () => parseSchedule("hours", 1, 1),
    HelperUnavailableError,
    "(enabled)",
  );
});

Deno.test("parseScheduleStatus accepts every known run result", () => {
  for (const result of ["never", "running", "success", "failure"]) {
    assertEquals(
      parseScheduleStatus("", "Wed 2026-11-11 03:00:00 UTC", result),
      {
        lastRunTime: "",
        nextRunTime: "Wed 2026-11-11 03:00:00 UTC",
        lastRunResult: result,
      },
    );
  }
});

Deno.test("parseScheduleStatus rejects an unknown run result", () => {
  assertThrows(
    () => parseScheduleStatus("", "", "done"),
    HelperUnavailableError,
    "unknown schedule run result",
  );
});
