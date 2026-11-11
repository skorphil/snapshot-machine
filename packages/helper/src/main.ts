/**
 * Root Helper for Snapshot Machine. Exposes the btrbk drop-in configuration files
 * under `com.snapshot_machine.BtrbkService1` on the system bus. Writes are authorized per
 * request through Polkit (`com.snapshot_machine.BtrbkService1.configure`).
 * Manual backup runs are authorized with `com.snapshot_machine.BtrbkService1.run`.
 * Schedule changes (systemd timer units) are authorized with
 * `com.snapshot_machine.BtrbkService1.schedule`.
 */

import {
  DBusError,
  interface as dbusInterface,
  Message,
  sessionBus,
  systemBus,
  Variant,
} from "dbus-next";
import type { MessageBus } from "dbus-next";
import {
  assertValidConfigFileName,
  assertValidContent,
  ConfigFileError,
  configFilePath,
  ConfigSyntaxError,
  ensureConfigDir,
  listConfigFiles,
  readConfigFile,
  resolveConfigDir,
  validateWithBtrbk,
  writeConfigFileAtomic,
} from "./config-files.ts";
import {
  assertConfigFileExists,
  BackupBusyError,
  BackupRunner,
} from "./backup-run.ts";
import {
  createDevController,
  createSystemctlController,
  resolveScheduleUnitDir,
  ScheduleError,
  ScheduleInterval,
  ScheduleManager,
  type ScheduleSettings,
  type ScheduleStatus,
  type TimerController,
  validateInterval,
} from "./schedule.ts";

/** Wire value of the `unit` argument that means "no schedule". */
const SCHEDULE_OFF = "off";

const { Interface } = dbusInterface;

const SERVICE_NAME = "com.snapshot_machine.BtrbkService1";
const OBJECT_PATH = "/com/snapshot_machine/BtrbkService1";
const POLKIT_CONFIGURE_ACTION = "com.snapshot_machine.BtrbkService1.configure";
const POLKIT_RUN_ACTION = "com.snapshot_machine.BtrbkService1.run";
const POLKIT_SCHEDULE_ACTION = "com.snapshot_machine.BtrbkService1.schedule";
const POLKIT_BUS = "org.freedesktop.PolicyKit1";
const POLKIT_PATH = "/org/freedesktop/PolicyKit1/Authority";
const POLKIT_AUTHORITY = "org.freedesktop.PolicyKit1.Authority";
/** DBUS_NAME_FLAG_REPLACE_EXISTING */
const NAME_FLAG_REPLACE_EXISTING = 0x4;
/** MessageType.METHOD_CALL */
const METHOD_CALL = 1;

/** Error names returned on the bus. */
const ERR = {
  INVALID_ARGS: "com.snapshot_machine.BtrbkService1.Error.InvalidArgument",
  NOT_AUTHORIZED: "com.snapshot_machine.BtrbkService1.Error.NotAuthorized",
  BUSY: "com.snapshot_machine.BtrbkService1.Error.Busy",
  FAILED: "com.snapshot_machine.BtrbkService1.Error.Failed",
  INTERNAL: "com.snapshot_machine.BtrbkService1.Error.Internal",
} as const;

/** Maps a thrown value onto a D-Bus error with the matching error name. */
function toDBusError(error: unknown): DBusError {
  if (error instanceof DBusError) return error;
  if (
    error instanceof ConfigSyntaxError ||
    error instanceof ConfigFileError ||
    error instanceof ScheduleError
  ) {
    return new DBusError(ERR.INVALID_ARGS, error.message);
  }
  const message = error instanceof Error ? error.message : String(error);
  return new DBusError(ERR.FAILED, message);
}

/**
 * Asks polkit whether the caller identified by its unique bus name may perform
 * `action`. Any failure to reach polkit denies the request.
 */
async function isAuthorized(
  bus: MessageBus,
  sender: string,
  action: string,
): Promise<boolean> {
  if (Deno.env.get("USE_SESSION_BUS") === "1") {
    console.log(
      "[Helper] USE_SESSION_BUS=1: Polkit authorization bypassed in dev mode",
    );
    return true;
  }
  try {
    const proxy = await bus.getProxyObject(POLKIT_BUS, POLKIT_PATH);
    const authority = proxy.getInterface(POLKIT_AUTHORITY);
    // CheckAuthorization(subject (sa{sv}), action (s), details (a{ss}), flags (u), cancellation (s)) -> (bba{ss})
    const [isAuthorized] = await authority.CheckAuthorization(
      ["system-bus-name", { name: new Variant("s", sender) }],
      action,
      {},
      1, // AllowUserInteraction
      "",
    );
    return isAuthorized === true;
  } catch (error) {
    console.error(`[Helper] Polkit check failed for ${action}:`, error);
    return false;
  }
}

/** Helper methods exported on the system bus. */
class HelperInterface extends Interface {
  private readonly bus: MessageBus;
  private readonly configDir: string;
  private readonly configFile: string;
  private readonly backups: BackupRunner;
  private readonly schedule: ScheduleManager;
  /** Unique bus name of the caller of the method call being dispatched. */
  currentSender: string | null = null;

  constructor(
    bus: MessageBus,
    configDir: string,
    configFile: string,
    backups: BackupRunner,
    schedule: ScheduleManager,
  ) {
    super(SERVICE_NAME);
    this.bus = bus;
    this.configDir = configDir;
    this.configFile = configFile;
    this.backups = backups;
    this.schedule = schedule;
  }

  /** Lists configuration file names in the drop-in directory. */
  async ListConfigFiles(): Promise<string[]> {
    try {
      return await listConfigFiles(this.configDir);
    } catch (error) {
      throw toDBusError(error);
    }
  }

  /** Returns the content of one configuration file. */
  async ReadConfigFile(name: string): Promise<string> {
    try {
      return await readConfigFile(this.configDir, name);
    } catch (error) {
      throw toDBusError(error);
    }
  }

  /**
   * Validates the candidate content with btrbk, then checks Polkit and writes
   * it atomically. Validation runs first, so malformed input is rejected
   * before any authorization round-trip.
   */
  async SaveConfigFile(name: string, content: string): Promise<void> {
    // Captured synchronously, before the first await, so concurrent calls
    // cannot overwrite it.
    const sender = this.currentSender;
    if (!sender) {
      throw new DBusError(ERR.INTERNAL, "Could not identify sender");
    }

    try {
      assertValidConfigFileName(name);
      assertValidContent(content);
      await validateWithBtrbk(content);
    } catch (error) {
      throw toDBusError(error);
    }

    if (!await isAuthorized(this.bus, sender, POLKIT_CONFIGURE_ACTION)) {
      throw new DBusError(ERR.NOT_AUTHORIZED, "Not authorized by Polkit");
    }

    try {
      await writeConfigFileAtomic(this.configDir, name, content);
    } catch (error) {
      throw toDBusError(error);
    }
  }

  /**
   * Starts `btrbk run` in the background after Polkit authorization and
   * returns without waiting for it to finish. Progress is read with
   * `GetBackupStatus`. A run already in progress is rejected before any
   * authorization prompt is shown.
   */
  async RunBackup(): Promise<void> {
    // Captured synchronously, before the first await.
    const sender = this.currentSender;
    if (!sender) {
      throw new DBusError(ERR.INTERNAL, "Could not identify sender");
    }

    if (this.backups.getStatus().state === "running") {
      throw new DBusError(ERR.BUSY, "A backup is already running");
    }

    try {
      await assertConfigFileExists(this.configFile);
    } catch (error) {
      throw toDBusError(error);
    }

    if (!await isAuthorized(this.bus, sender, POLKIT_RUN_ACTION)) {
      throw new DBusError(ERR.NOT_AUTHORIZED, "Not authorized by Polkit");
    }

    try {
      this.backups.start();
    } catch (error) {
      if (error instanceof BackupBusyError) {
        throw new DBusError(ERR.BUSY, error.message);
      }
      throw toDBusError(error);
    }
  }

  /** Returns the status of the current or most recent backup run as JSON. */
  GetBackupStatus(): Promise<string> {
    return Promise.resolve(JSON.stringify(this.backups.getStatus()));
  }

  /**
   * Returns the configured interval as `(unit, count, enabled)`. `unit` is
   * `off` and `count` is 0 when no timer is installed.
   */
  async GetSchedule(): Promise<[string, number, boolean]> {
    try {
      const settings: ScheduleSettings = await this.schedule.getSchedule();
      if (settings.interval === null) return [SCHEDULE_OFF, 0, false];
      return [
        settings.interval.unit,
        settings.interval.count,
        settings.enabled,
      ];
    } catch (error) {
      throw toDBusError(error);
    }
  }

  /**
   * Validates the interval, checks Polkit and then writes or removes the
   * timer units and applies the enabled state through systemd.
   */
  async SetSchedule(
    unit: string,
    count: number,
    enabled: boolean,
  ): Promise<void> {
    // Captured synchronously, before the first await.
    const sender = this.currentSender;
    if (!sender) {
      throw new DBusError(ERR.INTERNAL, "Could not identify sender");
    }

    let interval: ScheduleInterval | null;
    try {
      // Validation runs before the authorization prompt so that malformed
      // requests are rejected without asking the user.
      interval = validateScheduleRequest(unit, count, enabled);
    } catch (error) {
      throw toDBusError(error);
    }

    // A scheduled run needs the configuration file, so it is checked before
    // the prompt. Removing the schedule does not need it.
    if (unit !== SCHEDULE_OFF) {
      try {
        await assertConfigFileExists(this.configFile);
      } catch (error) {
        throw toDBusError(error);
      }
    }

    if (!await isAuthorized(this.bus, sender, POLKIT_SCHEDULE_ACTION)) {
      throw new DBusError(ERR.NOT_AUTHORIZED, "Not authorized by Polkit");
    }

    try {
      await this.schedule.setSchedule(interval, enabled);
    } catch (error) {
      throw toDBusError(error);
    }
  }

  /** Returns the last run time, next run time and result of the scheduled backup. */
  async GetScheduleStatus(): Promise<[string, string, string]> {
    try {
      const status: ScheduleStatus = await this.schedule.getStatus();
      return [status.lastRunTime, status.nextRunTime, status.lastRunResult];
    } catch (error) {
      throw toDBusError(error);
    }
  }
}

/**
 * Checks a schedule request without touching the system. Removing the schedule
 * (`off`) cannot be enabled, since there is no timer to run.
 */
function validateScheduleRequest(
  unit: string,
  count: number,
  enabled: boolean,
): ScheduleInterval | null {
  if (unit === SCHEDULE_OFF) {
    if (enabled) {
      throw new ScheduleError(
        "a schedule cannot be enabled without an interval",
      );
    }
    return null;
  }
  return validateInterval(unit, count);
}

HelperInterface.configureMembers({
  methods: {
    ListConfigFiles: { inSignature: "", outSignature: "as" },
    ReadConfigFile: { inSignature: "s", outSignature: "s" },
    SaveConfigFile: { inSignature: "ss", outSignature: "" },
    RunBackup: { inSignature: "", outSignature: "" },
    GetBackupStatus: { inSignature: "", outSignature: "s" },
    GetSchedule: { inSignature: "", outSignature: "sub" },
    SetSchedule: { inSignature: "sub", outSignature: "" },
    GetScheduleStatus: { inSignature: "", outSignature: "sss" },
  },
});

/**
 * Selects how timers are controlled. Development runs on the session bus use
 * marker files instead of systemd, so no system service manager is touched.
 */
function scheduleController(useSessionBus: boolean): TimerController {
  return useSessionBus
    ? createDevController(
      resolveScheduleUnitDir("1", Deno.env.get("SYSTEMD_UNIT_DIR")),
    )
    : createSystemctlController();
}

/**
 * Connects to the system bus (or the session bus when `USE_SESSION_BUS=1`),
 * exports the interface, and claims the service name.
 */
async function main(): Promise<void> {
  const useSessionBus = Deno.env.get("USE_SESSION_BUS") === "1";
  const bus = useSessionBus ? sessionBus() : systemBus();
  bus.on("error", (error: unknown) => {
    console.error("[Helper] D-Bus error:", error);
    Deno.exit(1);
  });

  const configDir = resolveConfigDir(
    Deno.env.get("USE_SESSION_BUS"),
    Deno.env.get("BTRBK_CONFIG_DIR"),
  );
  if (useSessionBus) {
    await ensureConfigDir(configDir);
    console.log(`[Helper] Session bus mode, config directory: ${configDir}`);
  }

  const configFile = configFilePath(
    configDir,
    Deno.env.get("BTRBK_CONFIG_NAME") || "snapshot-machine.conf",
  );
  const backups = new BackupRunner({ configFile });
  const schedule = new ScheduleManager({
    unitDir: resolveScheduleUnitDir(
      Deno.env.get("USE_SESSION_BUS"),
      Deno.env.get("SYSTEMD_UNIT_DIR"),
    ),
    configFile,
    controller: scheduleController(useSessionBus),
  });
  const iface = new HelperInterface(
    bus,
    configDir,
    configFile,
    backups,
    schedule,
  );

  // Runs before dispatch. Records the caller of each method call; the
  // handler reads it synchronously at the start of the call.
  bus.addMethodHandler((msg: Message) => {
    if (msg.type === METHOD_CALL && msg.path === OBJECT_PATH) {
      iface.currentSender = msg.sender ?? null;
    }
    return false;
  });

  bus.export(OBJECT_PATH, iface);
  await bus.requestName(SERVICE_NAME, NAME_FLAG_REPLACE_EXISTING);
  console.log(`[Helper] Serving ${SERVICE_NAME} at ${OBJECT_PATH}`);
}

if (import.meta.main) {
  await main();
}
