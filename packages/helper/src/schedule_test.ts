/// <reference lib="deno.ns" />
import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { join } from "@std/path";
import type { ScheduleUnit } from "../../shared/types.ts";
import {
  SCHEDULE_COUNTS,
  SCHEDULE_UNITS,
} from "../../shared/schedule-limits.ts";
import {
  BTRBK_BINARY,
  createDevController,
  createSystemctlController,
  DEV_SYSTEMD_UNIT_DIR,
  parseCalendar,
  parseShowOutput,
  parseTimerInterval,
  renderCalendar,
  renderServiceUnit,
  renderTimerUnit,
  resolveScheduleUnitDir,
  ScheduleError,
  type ScheduleInterval,
  ScheduleManager,
  SERVICE_UNIT_NAME,
  SystemctlError,
  type SystemctlResult,
  SYSTEMD_UNIT_DIR,
  systemdQuote,
  TIMER_UNIT_NAME,
  type TimerController,
  validateInterval,
} from "./schedule.ts";

const HOURLY: ScheduleInterval = { count: 1, unit: "hours" };
const EVERY_2_HOURS: ScheduleInterval = { count: 2, unit: "hours" };
const DAILY: ScheduleInterval = { count: 1, unit: "days" };

/** Runs `fn` with a temporary unit directory and removes it afterwards. */
async function withUnitDir(
  fn: (dir: string) => Promise<void>,
): Promise<void> {
  const dir = await Deno.makeTempDir({ prefix: "schedule-test-" });
  try {
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true }).catch(() => undefined);
  }
}

/** Records controller calls and reports the timer as enabled when asked. */
function fakeController(options: {
  enabled?: boolean;
  show?: Record<string, string>;
} = {}) {
  const calls: string[] = [];
  let enabled = options.enabled ?? false;
  const controller: TimerController = {
    daemonReload() {
      calls.push("daemon-reload");
      return Promise.resolve();
    },
    enableTimer(timer) {
      calls.push(`enable ${timer}`);
      enabled = true;
      return Promise.resolve();
    },
    disableTimer(timer) {
      calls.push(`disable ${timer}`);
      enabled = false;
      return Promise.resolve();
    },
    isTimerEnabled() {
      return Promise.resolve(enabled);
    },
    showUnit(unit, properties) {
      calls.push(`show ${unit}`);
      return Promise.resolve(
        Object.fromEntries(
          properties.map((name) => [name, options.show?.[name] ?? "n/a"]),
        ),
      );
    },
  };
  return { controller, calls };
}

/** Builds a manager that writes units into `dir` with a fake controller. */
function managerIn(dir: string, controller: TimerController) {
  return new ScheduleManager({
    unitDir: dir,
    configFile: "/etc/btrbk/gui.conf.d/snapshot-machine.conf",
    controller,
  });
}

// --- interval validation --------------------------------------------------

Deno.test("validateInterval accepts every shared count for each unit", () => {
  for (const unit of SCHEDULE_UNITS) {
    for (const count of SCHEDULE_COUNTS[unit]) {
      assertEquals(validateInterval(unit, count), { count, unit });
    }
  }
});

Deno.test("validateInterval rejects counts that do not divide the calendar period", () => {
  for (
    const [unit, count] of [
      ["minutes", 0],
      ["minutes", 7],
      ["minutes", 60],
      ["hours", 0],
      ["hours", 5],
      ["hours", 24],
      ["days", 0],
      ["days", 2],
      ["days", 7],
    ] as const
  ) {
    assertThrows(
      () => validateInterval(unit, count),
      ScheduleError,
      "must be one of",
    );
  }
});

Deno.test("validateInterval rejects fractional, non-numeric and unsafe counts", () => {
  for (const count of [1.5, Number.NaN, Infinity, "2", null, undefined]) {
    assertThrows(
      () => validateInterval("hours", count),
      ScheduleError,
      "whole number",
    );
  }
});

Deno.test("validateInterval rejects unknown units and differently cased values", () => {
  for (const unit of ["", "week", "Hours", "hours\n", "off"]) {
    assertThrows(
      () => validateInterval(unit, 1),
      ScheduleError,
      "invalid unit",
    );
  }
});

// --- unit rendering -------------------------------------------------------

Deno.test("renderServiceUnit runs btrbk with the managed configuration file", () => {
  const unit = renderServiceUnit("/etc/btrbk/gui.conf.d/snapshot-machine.conf");
  assertEquals(unit.includes("Type=oneshot"), true);
  assertEquals(
    unit.includes(
      `ExecStart=${BTRBK_BINARY} -c "/etc/btrbk/gui.conf.d/snapshot-machine.conf" run`,
    ),
    true,
  );
});

Deno.test("renderServiceUnit escapes systemd specifiers and quotes in the path", () => {
  const unit = renderServiceUnit('/tmp/a%h "b"\\c.conf');
  assertEquals(
    unit.includes(`-c "/tmp/a%%h \\"b\\"\\\\c.conf" run`),
    true,
  );
});

Deno.test("systemdQuote doubles percent signs and escapes quotes and backslashes", () => {
  assertEquals(systemdQuote("plain"), '"plain"');
  assertEquals(systemdQuote("50%"), '"50%%"');
  assertEquals(systemdQuote('x"y'), '"x\\"y"');
});

Deno.test("renderCalendar maps each unit to a systemd calendar expression", () => {
  assertEquals(renderCalendar({ count: 15, unit: "minutes" }), "*:0/15");
  assertEquals(renderCalendar(EVERY_2_HOURS), "*-*-* 00/2:00:00");
  assertEquals(renderCalendar(DAILY), "*-*-* 00:00:00");
});

Deno.test("renderTimerUnit writes the interval as OnCalendar and links the service", () => {
  const unit = renderTimerUnit(EVERY_2_HOURS);
  assertEquals(unit.includes("OnCalendar=*-*-* 00/2:00:00\n"), true);
  assertEquals(unit.includes("(every 2 hours)"), true);
  assertEquals(unit.includes(`Unit=${SERVICE_UNIT_NAME}`), true);
  assertEquals(unit.includes("Persistent=true"), true);
  assertEquals(unit.includes("WantedBy=timers.target"), true);
});

Deno.test("renderTimerUnit uses the singular unit for a count of one", () => {
  assertEquals(renderTimerUnit(HOURLY).includes("(every 1 hour)"), true);
  assertEquals(renderTimerUnit(DAILY).includes("(every 1 day)"), true);
});

Deno.test("parseTimerInterval reads back the rendered interval", () => {
  for (
    const interval of [
      { count: 30, unit: "minutes" },
      HOURLY,
      EVERY_2_HOURS,
      DAILY,
    ] as ScheduleInterval[]
  ) {
    assertEquals(parseTimerInterval(renderTimerUnit(interval)), interval);
  }
});

Deno.test("parseCalendar reads legacy frequency keywords", () => {
  assertEquals(parseCalendar("hourly"), HOURLY);
  assertEquals(parseCalendar("daily"), DAILY);
});

Deno.test("parseCalendar rejects expressions it did not write", () => {
  for (
    const value of [
      "monthly",
      "*-*-* 03:00:00",
      "*:0/60",
      "*-*-* 00/24:00:00",
      "*:0/7",
      "*-*-* 00/5:00:00",
      "*-*-01/2 00:00:00",
      "*:0/0",
    ]
  ) {
    assertThrows(() => parseCalendar(value), ScheduleError);
  }
});

Deno.test("parseTimerInterval rejects a timer without a recognized OnCalendar", () => {
  assertThrows(
    () => parseTimerInterval("[Timer]\nPersistent=true\n"),
    ScheduleError,
    "no OnCalendar",
  );
  assertThrows(
    () => parseTimerInterval("OnCalendar=monthly\n"),
    ScheduleError,
    "unsupported OnCalendar",
  );
});

// --- output parsing -------------------------------------------------------

Deno.test("parseShowOutput splits Key=Value lines and keeps empty values", () => {
  assertEquals(
    parseShowOutput(
      "LastTriggerUSec=Tue 2026-11-10 03:00:00 UTC\nNextElapseUSecRealtime=\nResult=success\n",
    ),
    {
      LastTriggerUSec: "Tue 2026-11-10 03:00:00 UTC",
      NextElapseUSecRealtime: "",
      Result: "success",
    },
  );
});

Deno.test("parseShowOutput ignores lines without a separator", () => {
  assertEquals(parseShowOutput("garbage\n"), {});
});

// --- unit directory resolution -------------------------------------------

Deno.test("resolveScheduleUnitDir uses /etc/systemd/system by default", () => {
  assertEquals(resolveScheduleUnitDir(undefined), SYSTEMD_UNIT_DIR);
  assertEquals(resolveScheduleUnitDir("0"), SYSTEMD_UNIT_DIR);
  assertEquals(SYSTEMD_UNIT_DIR, "/etc/systemd/system");
});

Deno.test("resolveScheduleUnitDir uses the development directory for USE_SESSION_BUS=1", () => {
  assertEquals(resolveScheduleUnitDir("1"), DEV_SYSTEMD_UNIT_DIR);
});

Deno.test("resolveScheduleUnitDir prefers a non-empty override", () => {
  assertEquals(resolveScheduleUnitDir("1", "/custom/units"), "/custom/units");
  assertEquals(
    resolveScheduleUnitDir(undefined, "/custom/units"),
    "/custom/units",
  );
  assertEquals(resolveScheduleUnitDir("1", ""), DEV_SYSTEMD_UNIT_DIR);
});

// --- ScheduleManager ------------------------------------------------------

Deno.test("getSchedule reports no interval when no timer unit is installed", async () => {
  await withUnitDir(async (dir) => {
    const { controller } = fakeController({ enabled: true });
    const manager = managerIn(dir, controller);
    assertEquals(await manager.getSchedule(), {
      interval: null,
      enabled: false,
    });
  });
});

Deno.test("getSchedule reports the installed interval and the enabled state", async () => {
  await withUnitDir(async (dir) => {
    await Deno.writeTextFile(
      join(dir, TIMER_UNIT_NAME),
      renderTimerUnit(EVERY_2_HOURS),
    );
    const enabled = managerIn(
      dir,
      fakeController({ enabled: true }).controller,
    );
    assertEquals(await enabled.getSchedule(), {
      interval: EVERY_2_HOURS,
      enabled: true,
    });

    const disabled = managerIn(
      dir,
      fakeController({ enabled: false }).controller,
    );
    assertEquals(await disabled.getSchedule(), {
      interval: EVERY_2_HOURS,
      enabled: false,
    });
  });
});

Deno.test("setSchedule writes both units, reloads systemd and enables the timer", async () => {
  await withUnitDir(async (dir) => {
    const { controller, calls } = fakeController();
    const result = await managerIn(dir, controller).setSchedule(
      { count: 2, unit: "hours" },
      true,
    );

    assertEquals(result, { interval: EVERY_2_HOURS, enabled: true });
    assertEquals(
      await Deno.readTextFile(join(dir, TIMER_UNIT_NAME)),
      renderTimerUnit(EVERY_2_HOURS),
    );
    assertEquals(
      await Deno.readTextFile(join(dir, SERVICE_UNIT_NAME)),
      renderServiceUnit("/etc/btrbk/gui.conf.d/snapshot-machine.conf"),
    );
    assertEquals(calls, ["daemon-reload", `enable ${TIMER_UNIT_NAME}`]);
  });
});

Deno.test("setSchedule with enabled=false writes the units and disables the timer", async () => {
  await withUnitDir(async (dir) => {
    const { controller, calls } = fakeController({ enabled: true });
    const result = await managerIn(dir, controller).setSchedule(
      { count: 15, unit: "minutes" },
      false,
    );

    assertEquals(result, {
      interval: { count: 15, unit: "minutes" },
      enabled: false,
    });
    assertEquals(
      await Deno.readTextFile(join(dir, TIMER_UNIT_NAME)),
      renderTimerUnit({ count: 15, unit: "minutes" }),
    );
    assertEquals(calls, ["daemon-reload", `disable ${TIMER_UNIT_NAME}`]);
  });
});

Deno.test("setSchedule null disables the timer and removes both unit files", async () => {
  await withUnitDir(async (dir) => {
    const seeded = managerIn(dir, fakeController().controller);
    await seeded.setSchedule(DAILY, true);

    const { controller, calls } = fakeController({ enabled: true });
    const result = await managerIn(dir, controller).setSchedule(null, false);

    assertEquals(result, { interval: null, enabled: false });
    assertEquals(calls, [`disable ${TIMER_UNIT_NAME}`, "daemon-reload"]);
    assertEquals(
      await Deno.stat(join(dir, TIMER_UNIT_NAME)).then(() => true, () => false),
      false,
    );
    assertEquals(
      await Deno.stat(join(dir, SERVICE_UNIT_NAME)).then(
        () => true,
        () => false,
      ),
      false,
    );
  });
});

Deno.test("setSchedule null without installed units does not touch systemd", async () => {
  await withUnitDir(async (dir) => {
    const { controller, calls } = fakeController();
    const result = await managerIn(dir, controller).setSchedule(null, false);
    assertEquals(result, { interval: null, enabled: false });
    assertEquals(calls, ["daemon-reload"]);
  });
});

Deno.test("setSchedule rejects enabled=true without an interval before changing anything", async () => {
  await withUnitDir(async (dir) => {
    const { controller, calls } = fakeController();
    await assertRejects(
      () => managerIn(dir, controller).setSchedule(null, true),
      ScheduleError,
      "cannot be enabled without an interval",
    );
    assertEquals(calls, []);
  });
});

Deno.test("setSchedule rejects an out-of-range interval without writing files", async () => {
  await withUnitDir(async (dir) => {
    const { controller, calls } = fakeController();
    await assertRejects(
      () =>
        managerIn(dir, controller).setSchedule(
          { count: 5, unit: "hours" },
          true,
        ),
      ScheduleError,
      "must be one of: 1, 2, 3, 4, 6, 8, 12",
    );
    assertEquals(calls, []);
    const entries = [];
    for await (const entry of Deno.readDir(dir)) entries.push(entry.name);
    assertEquals(entries, []);
  });
});

Deno.test("setSchedule replaces an existing schedule with a new interval", async () => {
  await withUnitDir(async (dir) => {
    const { controller } = fakeController();
    const manager = managerIn(dir, controller);
    await manager.setSchedule(HOURLY, true);
    await manager.setSchedule({ count: 12, unit: "hours" }, true);
    assertEquals(
      parseTimerInterval(await Deno.readTextFile(join(dir, TIMER_UNIT_NAME))),
      { count: 12, unit: "hours" },
    );
  });
});

Deno.test("setSchedule leaves no temporary files behind", async () => {
  await withUnitDir(async (dir) => {
    await managerIn(dir, fakeController().controller).setSchedule(DAILY, true);
    const names = [];
    for await (const entry of Deno.readDir(dir)) names.push(entry.name);
    names.sort();
    assertEquals(names, [SERVICE_UNIT_NAME, TIMER_UNIT_NAME].sort());
  });
});

Deno.test("setSchedule creates a missing unit directory", async () => {
  await withUnitDir(async (dir) => {
    const nested = join(dir, "nested", "units");
    await managerIn(nested, fakeController().controller).setSchedule(
      DAILY,
      true,
    );
    assertEquals(
      await Deno.readTextFile(join(nested, TIMER_UNIT_NAME)),
      renderTimerUnit(DAILY),
    );
  });
});

Deno.test("getStatus reports never run when the timer has not triggered", async () => {
  await withUnitDir(async (dir) => {
    await Deno.writeTextFile(
      join(dir, TIMER_UNIT_NAME),
      renderTimerUnit(DAILY),
    );
    const { controller } = fakeController({
      show: { NextElapseUSecRealtime: "Wed 2026-11-11 03:00:00 UTC" },
    });
    assertEquals(await managerIn(dir, controller).getStatus(), {
      lastRunTime: "",
      nextRunTime: "Wed 2026-11-11 03:00:00 UTC",
      lastRunResult: "never",
    });
  });
});

Deno.test("getStatus reports success and failure from the service result", async () => {
  await withUnitDir(async (dir) => {
    await Deno.writeTextFile(
      join(dir, TIMER_UNIT_NAME),
      renderTimerUnit(DAILY),
    );
    const ok = fakeController({
      show: {
        LastTriggerUSec: "Tue 2026-11-10 03:00:00 UTC",
        Result: "success",
      },
    });
    const okStatus = await managerIn(dir, ok.controller).getStatus();
    assertEquals(okStatus.lastRunResult, "success");
    assertEquals(okStatus.lastRunTime, "Tue 2026-11-10 03:00:00 UTC");

    const bad = fakeController({
      show: {
        LastTriggerUSec: "Tue 2026-11-10 03:00:00 UTC",
        Result: "exit-code",
      },
    });
    assertEquals(
      (await managerIn(dir, bad.controller).getStatus()).lastRunResult,
      "failure",
    );
  });
});

Deno.test("getStatus reports running while the service is active", async () => {
  await withUnitDir(async (dir) => {
    await Deno.writeTextFile(
      join(dir, TIMER_UNIT_NAME),
      renderTimerUnit(DAILY),
    );
    const { controller } = fakeController({
      show: {
        LastTriggerUSec: "Tue 2026-11-10 03:00:00 UTC",
        Result: "success",
      },
    });
    const original = controller.showUnit;
    controller.showUnit = (unit, properties) => {
      if (unit === SERVICE_UNIT_NAME) {
        return Promise.resolve({
          ActiveState: "activating",
          Result: "success",
        });
      }
      return original(unit, properties);
    };
    assertEquals(
      (await managerIn(dir, controller).getStatus()).lastRunResult,
      "running",
    );
  });
});

Deno.test("getStatus maps n/a values to empty strings", async () => {
  await withUnitDir(async (dir) => {
    await Deno.writeTextFile(
      join(dir, TIMER_UNIT_NAME),
      renderTimerUnit(DAILY),
    );
    const { controller } = fakeController({
      show: { LastTriggerUSec: "n/a", NextElapseUSecRealtime: "n/a" },
    });
    const status = await managerIn(dir, controller).getStatus();
    assertEquals(status.lastRunTime, "");
    assertEquals(status.nextRunTime, "");
  });
});

// --- systemctl controller -------------------------------------------------

/** Records systemctl argument lists and answers with the given result. */
function fakeSystemctl(result: Partial<SystemctlResult> = {}) {
  const calls: string[][] = [];
  const run = (args: string[]): Promise<SystemctlResult> => {
    calls.push(args);
    return Promise.resolve({
      success: true,
      stdout: "",
      stderr: "",
      ...result,
    });
  };
  return { run, calls };
}

Deno.test("systemctl controller runs daemon-reload", async () => {
  const { run, calls } = fakeSystemctl();
  await createSystemctlController(run).daemonReload();
  assertEquals(calls, [["daemon-reload"]]);
});

Deno.test("systemctl controller enables the timer now and restarts it to apply changes", async () => {
  const { run, calls } = fakeSystemctl();
  await createSystemctlController(run).enableTimer(TIMER_UNIT_NAME);
  assertEquals(calls, [
    ["enable", "--now", TIMER_UNIT_NAME],
    ["restart", TIMER_UNIT_NAME],
  ]);
});

Deno.test("systemctl controller disables the timer now", async () => {
  const { run, calls } = fakeSystemctl();
  await createSystemctlController(run).disableTimer(TIMER_UNIT_NAME);
  assertEquals(calls, [["disable", "--now", TIMER_UNIT_NAME]]);
});

Deno.test("systemctl controller reports is-enabled from the exit status", async () => {
  const enabled = createSystemctlController(fakeSystemctl().run);
  assertEquals(await enabled.isTimerEnabled(TIMER_UNIT_NAME), true);

  const disabled = createSystemctlController(
    fakeSystemctl({ success: false }).run,
  );
  assertEquals(await disabled.isTimerEnabled(TIMER_UNIT_NAME), false);
});

Deno.test("systemctl controller passes the requested properties to show", async () => {
  const { run, calls } = fakeSystemctl({
    stdout:
      "LastTriggerUSec=n/a\nNextElapseUSecRealtime=Wed 2026-11-11 03:00:00 UTC\n",
  });
  const values = await createSystemctlController(run).showUnit(
    TIMER_UNIT_NAME,
    [
      "LastTriggerUSec",
      "NextElapseUSecRealtime",
    ],
  );
  assertEquals(calls, [[
    "show",
    TIMER_UNIT_NAME,
    "--property=LastTriggerUSec,NextElapseUSecRealtime",
  ]]);
  assertEquals(values.NextElapseUSecRealtime, "Wed 2026-11-11 03:00:00 UTC");
});

Deno.test("systemctl failures surface stderr in a SystemctlError", async () => {
  const controller = createSystemctlController(
    fakeSystemctl({ success: false, stderr: "Failed to enable unit\n" }).run,
  );
  await assertRejects(
    () => controller.enableTimer(TIMER_UNIT_NAME),
    SystemctlError,
    "systemctl enable snapshot-machine-backup.timer failed: Failed to enable unit",
  );
});

Deno.test("systemctl failures without output still name the action", async () => {
  const controller = createSystemctlController(
    fakeSystemctl({ success: false }).run,
  );
  await assertRejects(
    () => controller.daemonReload(),
    SystemctlError,
    "systemctl daemon-reload failed",
  );
});

// --- development controller -----------------------------------------------

Deno.test("dev controller tracks the enabled state in marker files", async () => {
  await withUnitDir(async (dir) => {
    const controller = createDevController(dir);
    assertEquals(await controller.isTimerEnabled(TIMER_UNIT_NAME), false);
    await controller.enableTimer(TIMER_UNIT_NAME);
    assertEquals(await controller.isTimerEnabled(TIMER_UNIT_NAME), true);
    await controller.disableTimer(TIMER_UNIT_NAME);
    assertEquals(await controller.isTimerEnabled(TIMER_UNIT_NAME), false);
    await controller.disableTimer(TIMER_UNIT_NAME);
  });
});

Deno.test("dev controller reports unknown status values as n/a", async () => {
  await withUnitDir(async (dir) => {
    const values = await createDevController(dir).showUnit(TIMER_UNIT_NAME, [
      "Result",
    ]);
    assertEquals(values, { Result: "n/a" });
  });
});

Deno.test("ScheduleManager with the dev controller writes units without systemd", async () => {
  await withUnitDir(async (dir) => {
    const manager = new ScheduleManager({
      unitDir: dir,
      configFile: "/tmp/gui.conf",
      controller: createDevController(dir),
    });
    await manager.setSchedule(DAILY, true);
    assertEquals(await manager.getSchedule(), {
      interval: DAILY,
      enabled: true,
    });
    assertEquals(await manager.getStatus(), {
      lastRunTime: "",
      nextRunTime: "",
      lastRunResult: "never",
    });
    await manager.setSchedule(null, false);
    assertEquals(await manager.getSchedule(), {
      interval: null,
      enabled: false,
    });
  });
});

// --- recurrence semantics -------------------------------------------------

/** Length of one calendar period in minutes: an hour for minutes, a day otherwise. */
function periodMinutes(unit: ScheduleUnit): number {
  return unit === "minutes" ? 60 : 24 * 60;
}

/** Spacing between runs in minutes for an interval. */
function stepMinutes(interval: ScheduleInterval): number {
  const perUnit = { minutes: 1, hours: 60, days: 24 * 60 }[interval.unit];
  return interval.count * perUnit;
}

Deno.test("every accepted interval divides its calendar period, so runs are evenly spaced", () => {
  for (const unit of SCHEDULE_UNITS) {
    for (const count of SCHEDULE_COUNTS[unit]) {
      const interval = { count, unit };
      if (unit !== "days") {
        assertEquals(periodMinutes(unit) % stepMinutes(interval), 0);
      }
    }
  }
});

Deno.test("a count that does not divide the period is not accepted", () => {
  // 7 minutes leaves a 4-minute gap at each hour boundary (56 -> 60),
  // 5 hours a 4-hour gap at midnight (20 -> 24).
  assertEquals(periodMinutes("minutes") % 7 === 0, false);
  assertEquals(periodMinutes("hours") % (5 * 60) === 0, false);
  assertThrows(() => validateInterval("minutes", 7), ScheduleError);
  assertThrows(() => validateInterval("hours", 5), ScheduleError);
});

/**
 * Asks systemd-analyze for the next elapses of an `OnCalendar` value from a
 * fixed base time, in UTC. Returns `null` when systemd-analyze is unavailable.
 */
async function nextCalendarElapses(
  calendar: string,
  baseTime: string,
  iterations: number,
): Promise<number[] | null> {
  let output;
  try {
    output = await new Deno.Command("systemd-analyze", {
      args: [
        "calendar",
        `--base-time=${baseTime} UTC`,
        `--iterations=${iterations}`,
        calendar,
      ],
      env: { TZ: "UTC" },
      stdout: "piped",
      stderr: "piped",
    }).output();
  } catch {
    return null;
  }
  if (!output.success) return null;
  const text = new TextDecoder().decode(output.stdout);
  const pattern =
    /(?:Next elapse|Iteration #\d+):\s+\w+ (\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) UTC/g;
  return [...text.matchAll(pattern)].map((match) => Date.parse(`${match[1]}Z`));
}

Deno.test("systemd fires each accepted interval at a constant gap across month boundaries", async () => {
  // The bases sit just before a month end: Jan 31 -> Feb 1 and Feb 28 -> Mar 1
  // (2026 is not a leap year). Day-of-month forms restart here; the daily
  // expression must not.
  const bases = ["2026-01-31 22:30:00", "2026-02-27 21:00:00"];
  const cases: ScheduleInterval[] = [
    { count: 1, unit: "minutes" },
    { count: 10, unit: "minutes" },
    { count: 30, unit: "minutes" },
    { count: 1, unit: "hours" },
    { count: 8, unit: "hours" },
    { count: 12, unit: "hours" },
    DAILY,
  ];

  for (const base of bases) {
    for (const interval of cases) {
      const elapses = await nextCalendarElapses(
        renderCalendar(interval),
        base,
        12,
      );
      if (elapses === null) return; // systemd-analyze is not installed here.
      assertEquals(elapses.length >= 2, true);
      const gapMs = stepMinutes(interval) * 60 * 1000;
      for (let i = 1; i < elapses.length; i++) {
        assertEquals(
          elapses[i] - elapses[i - 1],
          gapMs,
          `${renderCalendar(interval)} from ${base}`,
        );
      }
    }
  }
});

Deno.test("systemd fires the daily expression at midnight on every day of the month", async () => {
  const elapses = await nextCalendarElapses(
    renderCalendar(DAILY),
    "2026-01-30 12:00:00",
    4,
  );
  if (elapses === null) return;
  assertEquals(
    elapses.map((ms) => new Date(ms).toISOString().slice(0, 10)),
    ["2026-01-31", "2026-02-01", "2026-02-02", "2026-02-03"],
  );
});

Deno.test("getStatus reports never without querying systemd when no timer is installed", async () => {
  await withUnitDir(async (dir) => {
    const { controller, calls } = fakeController({
      show: { LastTriggerUSec: "Tue 2026-11-10 03:00:00 UTC" },
    });
    assertEquals(await managerIn(dir, controller).getStatus(), {
      lastRunTime: "",
      nextRunTime: "",
      lastRunResult: "never",
    });
    assertEquals(calls, []);
  });
});
