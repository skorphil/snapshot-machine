/**
 * Builds the .deb and .rpm packages for Snapshot Machine into the root dist/
 * directory using nfpm (https://nfpm.goreleaser.com).
 *
 * Usage:
 *   deno task package
 */

const NFPM_CONFIG = "nfpm.yaml";
const OUTPUT_DIR = "dist";
const PACKAGERS = ["deb", "rpm"] as const;

/** Runs a command with inherited stdio and returns its exit code. */
async function run(cmd: string, args: string[]): Promise<number> {
  const status = await new Deno.Command(cmd, {
    args,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  }).spawn().status;
  return status.code;
}

/** Returns true when the nfpm binary can be executed from PATH. */
async function hasNfpm(): Promise<boolean> {
  try {
    await new Deno.Command("nfpm", {
      args: ["--version"],
      stdout: "null",
      stderr: "null",
    })
      .output();
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}

if (!await hasNfpm()) {
  console.error(
    [
      "error: nfpm is not installed or not on PATH.",
      "Install it from https://nfpm.goreleaser.com/install/ (for example, download",
      "the official release tarball and place the 'nfpm' binary in ~/.local/bin).",
    ].join("\n"),
  );
  Deno.exit(1);
}

for (
  const [cmd, args] of [
    ["deno", ["task", "build:frontend"]],
    ["deno", ["task", "--cwd", "packages/backend", "start"]],
    ["deno", ["task", "--cwd", "packages/helper", "build"]],
  ] as const
) {
  const code = await run(cmd, [...args]);
  if (code !== 0) {
    console.error(
      `error: '${cmd} ${args.join(" ")}' failed with status ${code}.`,
    );
    Deno.exit(code);
  }
}

await Deno.mkdir(OUTPUT_DIR, { recursive: true });

for (const packager of PACKAGERS) {
  console.log(`Packaging ${packager}...`);
  const code = await run("nfpm", [
    "package",
    "--config",
    NFPM_CONFIG,
    "--packager",
    packager,
    "--target",
    `${OUTPUT_DIR}/`,
  ]);
  if (code !== 0) {
    console.error(`error: nfpm failed to build the ${packager} package.`);
    Deno.exit(code);
  }
}

console.log(`Packages written to ${OUTPUT_DIR}/.`);
