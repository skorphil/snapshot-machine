/**
 * Backup schedule management. The schedule is expressed as a pair of systemd
 * units (`snapshot-machine-backup.service` and `.timer`) written to the unit
 * directory and controlled with `systemctl`. The interval is stored in the
 * timer's `OnCalendar=` line, so the unit files are the single source of truth.
 */

import { join } from "@std/path";
import type { ScheduleUnit } from "../../shared/types.ts";
import {
  isValidScheduleCount,
  SCHEDULE_COUNTS,
  SCHEDULE_UNITS,
} from "../../shared/schedule-limits.ts";

/** A repeating backup interval, for example every 2 hours. */
export interface ScheduleInterval {
  /** Whole number of units between two runs. */
  count: number;
  /** Unit of `count`. */
  unit: ScheduleUnit;
}

/** Current schedule as read from the unit files and systemd. */
export interface ScheduleSettings {
  /** Configured interval, `null` when no timer unit is installed. */
  interval: ScheduleInterval | null;
  /** True when the timer is enabled in systemd. */
  enabled: boolean;
}

/** Last and next run of the scheduled backup, as reported by systemd. */
export interface ScheduleStatus {
  /** Time of the last trigger as printed by systemd, or an empty string if never triggered. */
  lastRunTime: string;
  /** Time of the next elapse as printed by systemd, or an empty string if none is scheduled. */
  nextRunTime: string;
  /** `never`, `running`, `success` or `failure`. */
  lastRunResult: string;
}

/** Raised when a schedule request is rejected for its arguments. */
export class ScheduleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScheduleError";
  }
}

/** Base name of the systemd units that run the scheduled backup. */
export const SCHEDULE_UNIT_BASE = "snapshot-machine-backup";
/** Name of the service unit started by the timer. */
export const SERVICE_UNIT_NAME = `${SCHEDULE_UNIT_BASE}.service`;
/** Name of the timer unit that triggers the service. */
export const TIMER_UNIT_NAME = `${SCHEDULE_UNIT_BASE}.timer`;

/** Default unit directory for system-wide units. */
export const SYSTEMD_UNIT_DIR = "/etc/systemd/system";

/**
 * Unprivileged unit directory used in development (`USE_SESSION_BUS=1`), so
 * no root or `/etc` access is needed.
 */
export const DEV_SYSTEMD_UNIT_DIR = "/tmp/snapshot-machine-dev/systemd";

/** Absolute path of the btrbk binary, required by systemd for `ExecStart`. */
export const BTRBK_BINARY = "/usr/bin/btrbk";

/** Permission bits for generated unit files. */
const UNIT_FILE_MODE = 0o644;

/** Matches the `OnCalendar=` line of a timer unit written by this module. */
const ON_CALENDAR_PATTERN = /^OnCalendar=(.+)$/m;

/** Keyword forms written by earlier versions, mapped to the equivalent interval. */
const LEGACY_CALENDAR: Readonly<Record<string, ScheduleInterval>> = {
  hourly: { count: 1, unit: "hours" },
  daily: { count: 1, unit: "days" },
};

/**
 * Returns the unit directory. A non-empty `unitDirOverride` (from
 * `SYSTEMD_UNIT_DIR`) takes precedence. Otherwise only the exact value `"1"` of
 * `USE_SESSION_BUS` selects the development directory.
 */
export function resolveScheduleUnitDir(
  useSessionBus: string | undefined,
  unitDirOverride?: string | undefined,
): string {
  if (unitDirOverride) return unitDirOverride;
  return useSessionBus === "1" ? DEV_SYSTEMD_UNIT_DIR : SYSTEMD_UNIT_DIR;
}

/**
 * Returns a validated interval. `count` must be one of the counts accepted for
 * `unit` (see `SCHEDULE_COUNTS`).
 *
 * @throws {ScheduleError} If the unit is unknown or the count is not accepted.
 */
export function validateInterval(
  unit: string,
  count: unknown,
): ScheduleInterval {
  if (!SCHEDULE_UNITS.some((item) => item === unit)) {
    throw new ScheduleError(
      `invalid unit "${unit}", expected one of: ${SCHEDULE_UNITS.join(", ")}`,
    );
  }
  const scheduleUnit = unit as ScheduleUnit;
  if (typeof count !== "number" || !Number.isSafeInteger(count)) {
    throw new ScheduleError("interval count must be a whole number");
  }
  if (!isValidScheduleCount(scheduleUnit, count)) {
    throw new ScheduleError(
      `interval count for ${unit} must be one of: ${
        SCHEDULE_COUNTS[scheduleUnit].join(", ")
      }`,
    );
  }
  return { count, unit: scheduleUnit };
}

/** Human-readable form of an interval, for example "every 2 hours". */
export function describeInterval(interval: ScheduleInterval): string {
  const unit = interval.count === 1
    ? interval.unit.slice(0, -1)
    : interval.unit;
  return `every ${interval.count} ${unit}`;
}

/**
 * Returns the systemd calendar expression for an interval. The count divides
 * the period (60 minutes, 24 hours), so runs are evenly spaced across the
 * period boundary, and the daily form fires every day at midnight.
 */
export function renderCalendar(interval: ScheduleInterval): string {
  const { count } = interval;
  switch (interval.unit) {
    case "minutes":
      return `*:0/${count}`;
    case "hours":
      return `*-*-* 00/${count}:00:00`;
    case "days":
      return "*-*-* 00:00:00";
  }
}

/**
 * Reads an interval back from an `OnCalendar=` value written by
 * {@link renderCalendar}, or from a legacy `hourly` or `daily` keyword.
 *
 * @throws {ScheduleError} If the value is not a recognized calendar form.
 */
export function parseCalendar(value: string): ScheduleInterval {
  const legacy = LEGACY_CALENDAR[value];
  if (legacy) return { ...legacy };

  const patterns: [RegExp, ScheduleUnit][] = [
    [/^\*:0\/(\d+)$/, "minutes"],
    [/^\*-\*-\* 00\/(\d+):00:00$/, "hours"],
  ];
  for (const [pattern, unit] of patterns) {
    const match = pattern.exec(value);
    if (match) return validateInterval(unit, Number(match[1]));
  }
  if (value === "*-*-* 00:00:00") return { count: 1, unit: "days" };
  throw new ScheduleError(`unsupported OnCalendar value "${value}"`);
}

/**
 * Quotes a value for a systemd `ExecStart=` argument. `%` is doubled so that
 * systemd does not expand it as a unit specifier.
 */
export function systemdQuote(value: string): string {
  const escaped = value
    .replaceAll("%", "%%")
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"');
  return `"${escaped}"`;
}

/** Renders the service unit that runs `btrbk run` for the configuration file. */
export function renderServiceUnit(configFile: string): string {
  return [
    "# Managed by Snapshot Machine. Changes are overwritten by the application.",
    "[Unit]",
    "Description=Snapshot Machine scheduled btrbk backup",
    "Documentation=https://github.com/skorphil/snapshot-machine",
    "",
    "[Service]",
    "Type=oneshot",
    `ExecStart=${BTRBK_BINARY} -c ${systemdQuote(configFile)} run`,
    "",
  ].join("\n");
}

/**
 * Renders the timer unit for an interval. `Persistent=true` makes systemd run
 * a missed backup once after the machine wakes up.
 */
export function renderTimerUnit(interval: ScheduleInterval): string {
  return [
    "# Managed by Snapshot Machine. Changes are overwritten by the application.",
    "[Unit]",
    `Description=Snapshot Machine scheduled btrbk backup (${
      describeInterval(interval)
    })`,
    "",
    "[Timer]",
    `OnCalendar=${renderCalendar(interval)}`,
    "Persistent=true",
    `Unit=${SERVICE_UNIT_NAME}`,
    "",
    "[Install]",
    "WantedBy=timers.target",
    "",
  ].join("\n");
}

/**
 * Reads the interval back from the content of a timer unit.
 *
 * @throws {ScheduleError} If the content has no recognized `OnCalendar=` value.
 */
export function parseTimerInterval(content: string): ScheduleInterval {
  const value = ON_CALENDAR_PATTERN.exec(content)?.[1]?.trim();
  if (value === undefined) {
    throw new ScheduleError("timer unit has no OnCalendar setting");
  }
  return parseCalendar(value);
}

/** Parses `systemctl show --property=...` output (`Key=Value` lines). */
export function parseShowOutput(output: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of output.split("\n")) {
    const separator = line.indexOf("=");
    if (separator === -1) continue;
    result[line.slice(0, separator)] = line.slice(separator + 1).trim();
  }
  return result;
}

/** Converts a systemd time value; `n/a` and empty values become an empty string. */
function displayTime(value: string | undefined): string {
  if (value === undefined || value === "n/a") return "";
  return value;
}

/** Outcome of one `systemctl` invocation. */
export interface SystemctlResult {
  /** True when systemctl exited with status 0. */
  success: boolean;
  /** Standard output. */
  stdout: string;
  /** Standard error. */
  stderr: string;
}

/** Executes `systemctl` with the given arguments. */
export type SystemctlRunner = (args: string[]) => Promise<SystemctlResult>;

/** Runs the system `systemctl` binary. */
export async function runSystemctl(args: string[]): Promise<SystemctlResult> {
  const { success, stdout, stderr } = await new Deno.Command("systemctl", {
    args,
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
  }).output();
  const decoder = new TextDecoder();
  return {
    success,
    stdout: decoder.decode(stdout),
    stderr: decoder.decode(stderr),
  };
}

/**
 * Operations the schedule needs from the service manager. The systemd
 * implementation drives `systemctl`; the development implementation tracks
 * the enabled state in marker files.
 */
export interface TimerController {
  /** Re-reads the unit files. */
  daemonReload(): Promise<void>;
  /** Enables the timer and starts it, applying the current unit files. */
  enableTimer(timer: string): Promise<void>;
  /** Stops the timer and disables it. */
  disableTimer(timer: string): Promise<void>;
  /** True when the timer is enabled. */
  isTimerEnabled(timer: string): Promise<boolean>;
  /** Reads the given properties of a unit. Missing values are returned as `n/a`. */
  showUnit(unit: string, properties: string[]): Promise<Record<string, string>>;
}

/** Raised when systemctl reports a failure. */
export class SystemctlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SystemctlError";
  }
}

/** Returns a result or throws a {@link SystemctlError} carrying systemctl's stderr. */
function requireSuccess(
  action: string,
  result: SystemctlResult,
): SystemctlResult {
  if (!result.success) {
    const details = result.stderr.trim() || result.stdout.trim();
    throw new SystemctlError(
      `systemctl ${action} failed${details ? `: ${details}` : ""}`,
    );
  }
  return result;
}

/** Builds the systemd-backed controller on top of a `systemctl` runner. */
export function createSystemctlController(
  run: SystemctlRunner = runSystemctl,
): TimerController {
  return {
    async daemonReload() {
      requireSuccess("daemon-reload", await run(["daemon-reload"]));
    },
    async enableTimer(timer) {
      requireSuccess(
        `enable ${timer}`,
        await run(["enable", "--now", timer]),
      );
      // `enable --now` does not re-arm a timer that is already running, so a
      // changed OnCalendar would otherwise only apply after the next restart.
      requireSuccess(`restart ${timer}`, await run(["restart", timer]));
    },
    async disableTimer(timer) {
      requireSuccess(
        `disable ${timer}`,
        await run(["disable", "--now", timer]),
      );
    },
    async isTimerEnabled(timer) {
      const result = await run(["is-enabled", "--quiet", timer]);
      return result.success;
    },
    async showUnit(unit, properties) {
      const result = requireSuccess(
        `show ${unit}`,
        await run([
          "show",
          unit,
          `--property=${properties.join(",")}`,
        ]),
      );
      return parseShowOutput(result.stdout);
    },
  };
}

/**
 * Development controller that keeps the enabled state in `<timer>.enabled`
 * marker files inside the unit directory. No systemd access is needed and
 * the status reports no runs.
 */
export function createDevController(unitDir: string): TimerController {
  const marker = (timer: string) => join(unitDir, `${timer}.enabled`);
  return {
    daemonReload() {
      return Promise.resolve();
    },
    async enableTimer(timer) {
      await Deno.writeTextFile(marker(timer), "");
    },
    async disableTimer(timer) {
      await Deno.remove(marker(timer)).catch(() => undefined);
    },
    async isTimerEnabled(timer) {
      const info = await Deno.stat(marker(timer)).catch(() => null);
      return info?.isFile === true;
    },
    showUnit(_unit, properties) {
      return Promise.resolve(
        Object.fromEntries(properties.map((name) => [name, "n/a"])),
      );
    },
  };
}

/** Writes a unit file atomically (temporary file, then rename). */
async function writeUnitFile(path: string, content: string): Promise<void> {
  const tmp = `${path}.${crypto.randomUUID()}.tmp`;
  try {
    await Deno.writeTextFile(tmp, content, { mode: UNIT_FILE_MODE });
    await Deno.rename(tmp, path);
  } catch (error) {
    await Deno.remove(tmp).catch(() => undefined);
    throw error;
  }
}

/** Returns true when the path exists as a regular file. */
async function fileExists(path: string): Promise<boolean> {
  const info = await Deno.stat(path).catch(() => null);
  return info?.isFile === true;
}

/**
 * Reads and applies the backup schedule for one GUI-managed configuration
 * file. Requests are assumed to be serialized by the caller.
 */
export class ScheduleManager {
  private readonly unitDir: string;
  private readonly configFile: string;
  private readonly controller: TimerController;

  /**
   * @param options.unitDir - Directory the unit files are written to.
   * @param options.configFile - Configuration file the service runs with `btrbk -c`.
   * @param options.controller - Service manager operations; defaults to systemctl.
   */
  constructor(options: {
    unitDir: string;
    configFile: string;
    controller?: TimerController;
  }) {
    this.unitDir = options.unitDir;
    this.configFile = options.configFile;
    this.controller = options.controller ?? createSystemctlController();
  }

  private get servicePath(): string {
    return join(this.unitDir, SERVICE_UNIT_NAME);
  }

  private get timerPath(): string {
    return join(this.unitDir, TIMER_UNIT_NAME);
  }

  /** Returns the configured interval and whether the timer is enabled. */
  async getSchedule(): Promise<ScheduleSettings> {
    if (!await fileExists(this.timerPath)) {
      return { interval: null, enabled: false };
    }
    const content = await Deno.readTextFile(this.timerPath);
    return {
      interval: parseTimerInterval(content),
      enabled: await this.controller.isTimerEnabled(TIMER_UNIT_NAME),
    };
  }

  /**
   * Applies a schedule. A `null` interval disables the timer and removes both
   * units. Any other interval writes the units; `enabled` decides whether the
   * timer is started.
   *
   * @throws {ScheduleError} If the interval is invalid or `enabled` is set without one.
   */
  async setSchedule(
    interval: ScheduleInterval | null,
    enabled: boolean,
  ): Promise<ScheduleSettings> {
    if (interval === null) {
      if (enabled) {
        throw new ScheduleError(
          "a schedule cannot be enabled without an interval",
        );
      }
      if (await fileExists(this.timerPath)) {
        await this.controller.disableTimer(TIMER_UNIT_NAME);
      }
      await Deno.remove(this.timerPath).catch(() => undefined);
      await Deno.remove(this.servicePath).catch(() => undefined);
      await this.controller.daemonReload();
      return { interval: null, enabled: false };
    }

    const value = validateInterval(interval.unit, interval.count);

    await Deno.mkdir(this.unitDir, { recursive: true, mode: 0o755 });
    await writeUnitFile(this.servicePath, renderServiceUnit(this.configFile));
    await writeUnitFile(this.timerPath, renderTimerUnit(value));
    await this.controller.daemonReload();

    if (enabled) {
      await this.controller.enableTimer(TIMER_UNIT_NAME);
    } else {
      await this.controller.disableTimer(TIMER_UNIT_NAME);
    }
    return { interval: value, enabled };
  }

  /** Reports the last and next scheduled run and the result of the last run. */
  async getStatus(): Promise<ScheduleStatus> {
    // Without a timer unit file there is nothing to query, and systemd would
    // report the missing unit as an error rather than as a normal state.
    if (!await fileExists(this.timerPath)) {
      return { lastRunTime: "", nextRunTime: "", lastRunResult: "never" };
    }
    const timer = await this.controller.showUnit(TIMER_UNIT_NAME, [
      "LastTriggerUSec",
      "NextElapseUSecRealtime",
    ]);
    const service = await this.controller.showUnit(SERVICE_UNIT_NAME, [
      "ActiveState",
      "Result",
    ]);

    const lastRunTime = displayTime(timer.LastTriggerUSec);
    const nextRunTime = displayTime(timer.NextElapseUSecRealtime);
    const running = service.ActiveState === "activating" ||
      service.ActiveState === "active";

    let lastRunResult: string;
    if (running) {
      lastRunResult = "running";
    } else if (lastRunTime === "") {
      lastRunResult = "never";
    } else {
      lastRunResult = service.Result === "success" ? "success" : "failure";
    }
    return { lastRunTime, nextRunTime, lastRunResult };
  }
}
