const RANK: Record<LogLevel, number> = { debug: 1, info: 2, warn: 3, error: 4 };

/** Creates a logger bound to the given scope. */
export function createLogger(scope: string, options: LoggerOptions): Logger {
  const minRank = RANK[options.production ? "error" : "debug"];

  const emit = (level: LogLevel, message: string, args: unknown[]): void => {
    if (RANK[level] < minRank) return;
    const prefix = `${
      new Date().toISOString()
    } [${level.toUpperCase()}] [${scope}]`;
    console[level](`${prefix} ${message}`, ...args);
  };

  return {
    debug: (message, ...args) => emit("debug", message, args),
    info: (message, ...args) => emit("info", message, args),
    warn: (message, ...args) => emit("warn", message, args),
    error: (message, ...args) => emit("error", message, args),
    child: (name) => createLogger(`${scope}:${name}`, options),
  };
}

/** Severity levels supported by the logger. */
export type LogLevel = "debug" | "info" | "warn" | "error";

/** Configuration accepted by {@link createLogger}. */
export type LoggerOptions = {
  /**
   * In production, only `error` messages are emitted. Outside production every
   * level is emitted.
   */
  production: boolean;
};

/** A scoped logger that emits level-prefixed messages to the console. */
export type Logger = {
  /** Logs a message at the `debug` level. */
  debug(message: string, ...args: unknown[]): void;
  /** Logs a message at the `info` level. */
  info(message: string, ...args: unknown[]): void;
  /** Logs a message at the `warn` level. */
  warn(message: string, ...args: unknown[]): void;
  /** Logs a message at the `error` level. */
  error(message: string, ...args: unknown[]): void;
  /** Returns a logger whose scope is `<scope>:<name>`. */
  child(name: string): Logger;
};
