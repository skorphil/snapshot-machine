/**
 * Development orchestrator for Snapshot Machine.
 * Spawns the Vite dev server and the Deno Desktop application.
 * Ensures both processes are terminated when the window is closed or on Ctrl+C.
 */

const controller = new AbortController();

/** Spawns the helper, frontend, and backend processes and waits for completion. */
async function run() {
  console.log("Starting development environment...");

  // Root Helper on the session bus: no sudo, no Polkit prompt in dev mode.
  const helper = new Deno.Command("deno", {
    args: ["run", "--allow-all", "packages/helper/src/main.ts"],
    env: { USE_SESSION_BUS: "1" },
    stdout: "inherit",
    stderr: "inherit",
    signal: controller.signal,
  }).spawn();

  const frontend = new Deno.Command("deno", {
    args: ["task", "--cwd", "packages/frontend", "dev"],
    stdout: "inherit",
    stderr: "inherit",
    signal: controller.signal,
  }).spawn();

  const desktop = new Deno.Command("deno", {
    args: [
      "desktop",
      "--hmr",
      "-o",
      "packages/backend/dist",
      "--include",
      "packages/frontend/dist",
      "--import-map",
      "deno.jsonc",
      "--allow-net",
      "--allow-read",
      "--allow-run",
      "--allow-env",
      "--allow-sys",
      "--allow-write=/var/run/dbus/system_bus_socket,/run/dbus/system_bus_socket,/run/user",
      "packages/backend/main.ts",
    ],
    env: {
      VITE_DEV_URL: "http://127.0.0.1:5173",
      USE_SESSION_BUS: "1",
    },
    stdout: "inherit",
    stderr: "inherit",
    signal: controller.signal,
  }).spawn();

  // Wait for any child process to exit
  const winner = await Promise.race([
    frontend.status.then((s) => ({ name: "Vite", status: s })),
    desktop.status.then((s) => ({ name: "Desktop", status: s })),
    helper.status.then((s) => ({ name: "Helper", status: s })),
  ]);

  console.log(`\n${winner.name} exited with status ${winner.status.code}.`);
  cleanup();
}

/** Aborts all spawned processes and exits the script. */
function cleanup() {
  try {
    controller.abort();
  } catch {
    // Already aborted
  }
  Deno.exit(0);
}

// Handle signals
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  Deno.addSignalListener(sig, () => {
    console.log(`\nReceived ${sig}, exiting...`);
    cleanup();
  });
}

await run();
