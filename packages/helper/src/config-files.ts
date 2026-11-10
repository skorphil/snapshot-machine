/**
 * File-level operations for the btrbk drop-in directory managed by the Root
 * Helper. Every path handed to the filesystem is derived from a validated
 * file name, so requests cannot escape the configuration directory.
 */

import { join } from "@std/path";

/** Directory that holds GUI-managed btrbk drop-in configuration files. */
export const CONFIG_DIR = "/etc/btrbk/gui.conf.d";

/**
 * Unprivileged directory used when the helper runs on the session bus in
 * development (`USE_SESSION_BUS=1`), so no root or `/etc` access is needed.
 */
export const DEV_CONFIG_DIR = "/tmp/snapshot-machine-dev/gui.conf.d";

/**
 * Returns the configuration directory. A non-empty `btrbkConfigDir` override
 * (from `BTRBK_CONFIG_DIR`) takes precedence. Otherwise only the exact value
 * `"1"` of `USE_SESSION_BUS` selects the development directory.
 */
export function resolveConfigDir(
  useSessionBus: string | undefined,
  btrbkConfigDir?: string | undefined,
): string {
  if (btrbkConfigDir) return btrbkConfigDir;
  return useSessionBus === "1" ? DEV_CONFIG_DIR : CONFIG_DIR;
}

/** Creates the configuration directory (and parents) when it is missing. */
export async function ensureConfigDir(dir: string): Promise<void> {
  await Deno.mkdir(dir, { recursive: true, mode: 0o755 });
}

/** Accepted file names: a letter or digit first, then up to 127 safe characters, ending in `.conf`. */
export const CONFIG_FILE_NAME_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.conf$/;

/** Upper bound for the content of a single configuration file. */
export const MAX_CONFIG_BYTES = 256 * 1024;

/** Raised when a request is rejected for its arguments. */
export class ConfigFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigFileError";
  }
}

/** Raised when the candidate content fails btrbk validation. */
export class ConfigSyntaxError extends Error {
  constructor(details: string) {
    super(`config is incorrect: ${details}`);
    this.name = "ConfigSyntaxError";
  }
}

/**
 * Returns the file name if it matches the allowed pattern, otherwise throws.
 *
 * @throws {ConfigFileError} If the name is not an allowed configuration file name.
 */
export function assertValidConfigFileName(name: string): string {
  if (!CONFIG_FILE_NAME_PATTERN.test(name) || name.includes("..")) {
    throw new ConfigFileError(`invalid configuration file name: ${name}`);
  }
  return name;
}

/**
 * Returns the absolute path of a validated configuration file inside `dir`.
 *
 * @throws {ConfigFileError} If the name is invalid.
 */
export function configFilePath(dir: string, name: string): string {
  return join(dir, assertValidConfigFileName(name));
}

/** Checks the content size and that it contains no NUL bytes. */
export function assertValidContent(content: string): void {
  if (new TextEncoder().encode(content).byteLength > MAX_CONFIG_BYTES) {
    throw new ConfigFileError("configuration content exceeds the size limit");
  }
  if (content.includes("\u0000")) {
    throw new ConfigFileError(
      "configuration content must not contain NUL bytes",
    );
  }
}

/**
 * Lists the configuration file names in `dir`, sorted. Returns an empty list
 * when the directory does not exist yet.
 */
export async function listConfigFiles(dir: string): Promise<string[]> {
  const names: string[] = [];
  try {
    for await (const entry of Deno.readDir(dir)) {
      if (entry.isFile && CONFIG_FILE_NAME_PATTERN.test(entry.name)) {
        names.push(entry.name);
      }
    }
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return [];
    throw error;
  }
  return names.sort();
}

/** Reads a configuration file after validating its name. */
export async function readConfigFile(
  dir: string,
  name: string,
): Promise<string> {
  const path = configFilePath(dir, name);
  try {
    return await Deno.readTextFile(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      throw new ConfigFileError(`configuration file not found: ${name}`);
    }
    throw error;
  }
}

/**
 * Writes `content` to `<dir>/<name>` atomically: the data goes to a temporary
 * file in the same directory which is then renamed over the target.
 */
export async function writeConfigFileAtomic(
  dir: string,
  name: string,
  content: string,
): Promise<void> {
  const target = configFilePath(dir, name);
  await Deno.mkdir(dir, { recursive: true, mode: 0o755 });
  const tmp = `${target}.${crypto.randomUUID()}.tmp`;
  try {
    await Deno.writeTextFile(tmp, content, { mode: 0o644 });
    await Deno.rename(tmp, target);
  } catch (error) {
    await Deno.remove(tmp).catch(() => undefined);
    throw error;
  }
}

/**
 * Runs `btrbk -c <file> list config` on the candidate content and throws
 * {@link ConfigSyntaxError} when btrbk rejects it. The candidate is written
 * to a private temporary file which is always removed afterwards.
 */
export async function validateWithBtrbk(content: string): Promise<void> {
  const tmpDir = await Deno.makeTempDir({ prefix: "snapshot-machine-check-" });
  const tmpFile = join(tmpDir, "candidate.conf");
  try {
    await Deno.writeTextFile(tmpFile, content, { mode: 0o600 });
    const { success, stderr, stdout } = await new Deno.Command("btrbk", {
      args: ["-c", tmpFile, "list", "config"],
      stdout: "piped",
      stderr: "piped",
    }).output();
    if (!success) {
      const decoder = new TextDecoder();
      const details = (decoder.decode(stderr) || decoder.decode(stdout))
        .trim()
        .replaceAll(tmpFile, "<candidate>");
      throw new ConfigSyntaxError(
        details || "btrbk rejected the configuration",
      );
    }
  } finally {
    await Deno.remove(tmpDir, { recursive: true }).catch(() => undefined);
  }
}
