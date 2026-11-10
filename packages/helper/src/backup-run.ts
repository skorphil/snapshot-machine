/**
 * Runs `btrbk run` on demand and keeps the status of the most recent run in
 * memory. Only one run may be active at a time. Missing snapshot directories
 * are created before btrbk starts.
 */

import { ensureConfiguredSnapshotDirs } from "./snapshot-dirs.ts";

/** Number of trailing output lines included in a failure message. */
export const MAX_MESSAGE_LINES = 20;

/** Lifecycle state of the backup runner. */
export type BackupState = "idle" | "running" | "success" | "failure";

/** Status of the current or most recent backup run. */
export interface BackupStatus {
  /** Lifecycle state. */
  state: BackupState;
  /** Human-readable summary; for failures, the tail of btrbk's output. */
  message: string;
  /** ISO time the current or most recent run started, or null if none ran yet. */
  startedAt: string | null;
  /** ISO time the most recent run finished, or null while running or if none ran yet. */
  finishedAt: string | null;
}

/** Raw outcome of one `btrbk run` invocation. */
export interface BtrbkRunResult {
  /** True when btrbk exited with status 0. */
  success: boolean;
  /** Exit code, or null when the process was terminated by a signal. */
  code: number | null;
  /** Combined stdout and stderr. */
  output: string;
}

/** Executes `btrbk run` for the given configuration file. */
export type BtrbkRunner = (configFile: string) => Promise<BtrbkRunResult>;

/** Creates the snapshot directories referenced by the configuration file. */
export type SnapshotDirsEnsurer = (configFile: string) => Promise<void>;

/** Raised when a run is requested while another one is still active. */
export class BackupBusyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackupBusyError";
  }
}

const IDLE_STATUS: BackupStatus = {
  state: "idle",
  message: "No backup has been run yet.",
  startedAt: null,
  finishedAt: null,
};

/** Builds the error raised when the GUI-managed configuration is missing. */
export function missingConfigMessage(path: string): string {
  return `Configuration file not found: ${path}. Configure it in the Config Editor first.`;
}

/**
 * Throws when the GUI-managed drop-in configuration file does not exist.
 *
 * @throws {Error} If `path` is not an existing regular file.
 */
export async function assertConfigFileExists(path: string): Promise<void> {
  const info = await Deno.stat(path).catch(() => null);
  if (!info?.isFile) {
    throw new Error(missingConfigMessage(path));
  }
}

/** Runs `btrbk -c <configFile> run` and captures its output. */
export async function runBtrbk(configFile: string): Promise<BtrbkRunResult> {
  const { success, code, stdout, stderr } = await new Deno.Command("btrbk", {
    args: ["-c", configFile, "run"],
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
  }).output();
  const decoder = new TextDecoder();
  return {
    success,
    code: code ?? null,
    output: `${decoder.decode(stdout)}\n${decoder.decode(stderr)}`,
  };
}

/** Returns the last few non-empty lines of the output. */
function outputTail(output: string): string {
  return output
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .slice(-MAX_MESSAGE_LINES)
    .join("\n");
}

/** Builds the failure message for a run that did not succeed. */
function describeFailure(result: BtrbkRunResult): string {
  const exit = result.code === null
    ? "btrbk was terminated by a signal"
    : `btrbk exited with code ${result.code}`;
  const tail = outputTail(result.output);
  return tail ? `${exit}:\n${tail}` : exit;
}

/** Returns the message of an unknown thrown value. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Tracks a single asynchronous `btrbk run` and exposes its status. */
export class BackupRunner {
  private readonly configFile: string;
  private readonly run: BtrbkRunner;
  private readonly ensureSnapshotDirs: SnapshotDirsEnsurer;
  private readonly now: () => Date;
  private status: BackupStatus = IDLE_STATUS;

  /**
   * @param options.configFile - GUI-managed drop-in configuration file to run.
   * @param options.run - Executes btrbk; defaults to `runBtrbk`.
   * @param options.ensureSnapshotDirs - Creates missing snapshot directories
   *   before btrbk runs; defaults to `ensureConfiguredSnapshotDirs`.
   */
  constructor(options: {
    configFile: string;
    run?: BtrbkRunner;
    ensureSnapshotDirs?: SnapshotDirsEnsurer;
    now?: () => Date;
  }) {
    this.configFile = options.configFile;
    this.run = options.run ?? runBtrbk;
    this.ensureSnapshotDirs = options.ensureSnapshotDirs ??
      ensureConfiguredSnapshotDirs;
    this.now = options.now ?? (() => new Date());
  }

  /** Returns a copy of the current status. */
  getStatus(): BackupStatus {
    return { ...this.status };
  }

  /**
   * Starts a run in the background and returns immediately. The status is
   * `running` until btrbk exits or the configuration file is found missing.
   *
   * @throws {BackupBusyError} If a run is already in progress.
   */
  start(): void {
    if (this.status.state === "running") {
      throw new BackupBusyError("A backup is already running");
    }
    const startedAt = this.now().toISOString();
    this.status = {
      state: "running",
      message: "Backup is running.",
      startedAt,
      finishedAt: null,
    };
    void this.execute(startedAt);
  }

  /** Verifies the configuration file, runs btrbk and records the outcome. Never rejects. */
  private async execute(startedAt: string): Promise<void> {
    const settle = (state: "success" | "failure", message: string): void => {
      this.status = {
        state,
        message,
        startedAt,
        finishedAt: this.now().toISOString(),
      };
    };

    try {
      await assertConfigFileExists(this.configFile);
    } catch (error) {
      settle("failure", errorMessage(error));
      return;
    }

    try {
      await this.ensureSnapshotDirs(this.configFile);
    } catch (error) {
      settle(
        "failure",
        `Could not prepare snapshot directories: ${errorMessage(error)}`,
      );
      return;
    }

    try {
      const result = await this.run(this.configFile);
      if (result.success) {
        settle("success", "Backup finished successfully.");
      } else {
        settle("failure", describeFailure(result));
      }
    } catch (error) {
      settle("failure", `Could not run btrbk: ${errorMessage(error)}`);
    }
  }
}
