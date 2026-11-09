/**
 * Runs Snapshot Machine inside the Distrobox container defined in
 * dev-scripts/distrobox.ini.
 *
 * Usage:
 *   deno task dev:fedora                  # btrbk and btrfs-progs installed
 *   deno task dev:fedora --no-deps        # container without btrbk/btrfs-progs
 *   deno task dev:fedora -- <args...>     # extra args forwarded to `deno task serve`
 */

const MANIFEST = "dev-scripts/distrobox.ini";
const DEFAULT_CONTAINER = "snapshot-machine-dev";
const NODEPS_CONTAINER = "snapshot-machine-dev-nodeps";

async function run(cmd: string, args: string[]): Promise<number> {
  const status = await new Deno.Command(cmd, {
    args,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  }).spawn().status;
  return status.code;
}

async function hasDistrobox(): Promise<boolean> {
  try {
    await new Deno.Command("distrobox", { args: ["--version"] }).output();
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}

const separator = Deno.args.indexOf("--");
const own = separator === -1 ? Deno.args : Deno.args.slice(0, separator);
const extra = separator === -1 ? [] : Deno.args.slice(separator + 1);

const unknown = own.filter((arg) => arg !== "--no-deps");
if (unknown.length > 0) {
  console.error(`Unknown argument(s): ${unknown.join(" ")}`);
  Deno.exit(2);
}

if (!await hasDistrobox()) {
  console.error("distrobox is not installed. Install it with: sudo dnf install distrobox");
  Deno.exit(1);
}

const name = own.includes("--no-deps") ? NODEPS_CONTAINER : DEFAULT_CONTAINER;

const assembleCode = await run("distrobox", [
  "assemble",
  "create",
  "--file",
  MANIFEST,
  "--name",
  name,
]);
if (assembleCode !== 0) Deno.exit(assembleCode);

Deno.exit(
  await run("distrobox", ["enter", name, "--", "deno", "task", "serve", ...extra]),
);
