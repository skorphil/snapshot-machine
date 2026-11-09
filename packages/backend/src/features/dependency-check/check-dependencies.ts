import type {
  DependencyName,
  DependencyReport,
  DependencyStatus,
} from "@snapshot-machine/shared/types.ts";

/** Extracts the version from `btrbk --version` output, e.g. "btrbk command line client, version 0.32.7". */
export function parseBtrbkVersion(output: string): string | null {
  return /btrbk command line client,? version\s+(\S+)/i.exec(output)?.[1] ??
    null;
}

/** Extracts the version from `btrfs --version` output, e.g. "btrfs-progs v7.1". */
export function parseBtrfsVersion(output: string): string | null {
  return /btrfs-progs\s+v?(\S+)/i.exec(output)?.[1] ?? null;
}

/** Converts a failure to spawn a binary into a short, user-facing reason. */
export function describeSpawnError(error: unknown): string {
  if (error instanceof Deno.errors.NotFound) {
    return "not found in PATH";
  }
  if (error instanceof Deno.errors.PermissionDenied) {
    return "not executable (permission denied)";
  }
  return error instanceof Error ? error.message : String(error);
}

/** Required external binaries and how to read their version. */
const REQUIRED_DEPENDENCIES: readonly {
  name: DependencyName;
  parseVersion: (output: string) => string | null;
}[] = [
  { name: "btrbk", parseVersion: parseBtrbkVersion },
  { name: "btrfs", parseVersion: parseBtrfsVersion },
];

const decoder = new TextDecoder();

/** Runs `<name> --version` and reports whether the binary is present and executable. */
async function probeDependency(
  dependency: (typeof REQUIRED_DEPENDENCIES)[number],
): Promise<DependencyStatus> {
  const { name, parseVersion } = dependency;
  try {
    const { success, code, stdout, stderr } = await new Deno.Command(name, {
      args: ["--version"],
      stdout: "piped",
      stderr: "piped",
    }).output();

    if (!success) {
      return {
        name,
        available: false,
        version: null,
        error: `exited with code ${code} for --version`,
      };
    }

    const output = decoder.decode(stdout) + decoder.decode(stderr);
    return {
      name,
      available: true,
      version: parseVersion(output),
      error: null,
    };
  } catch (error) {
    return {
      name,
      available: false,
      version: null,
      error: describeSpawnError(error),
    };
  }
}

/** Probes every required dependency and returns the combined report. */
export async function checkDependencies(): Promise<DependencyReport> {
  const dependencies = await Promise.all(
    REQUIRED_DEPENDENCIES.map(probeDependency),
  );
  return {
    ok: dependencies.every((dependency) => dependency.available),
    dependencies,
  };
}

/** Returns the names of the dependencies that are not available in the report. */
export function missingDependencies(
  report: DependencyReport,
): DependencyName[] {
  return report.dependencies
    .filter((dependency) => !dependency.available)
    .map((dependency) => dependency.name);
}

/** Throws when the report lists a missing dependency. */
export function assertReportAvailable(report: DependencyReport): void {
  if (report.ok) return;

  const missing = missingDependencies(report).join(", ");
  throw new Error(
    `Missing required dependencies: ${missing}. Install them to use backup operations.`,
  );
}

/**
 * Probes the dependencies and throws when one is missing. Backup operations
 * call this before touching snapshots so that they never run half-configured.
 */
export async function assertDependenciesAvailable(): Promise<void> {
  assertReportAvailable(await checkDependencies());
}
