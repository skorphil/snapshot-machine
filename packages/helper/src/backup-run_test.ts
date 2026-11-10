/// <reference lib="deno.ns" />
import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { join } from "@std/path";
import {
  assertConfigFileExists,
  BackupBusyError,
  BackupRunner,
  type BtrbkRunResult,
} from "./backup-run.ts";

/** Waits until the runner leaves the `running` state (background I/O included). */
async function settle(runner: BackupRunner): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (runner.getStatus().state !== "running") return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/** Returns a runner whose result is controlled by the test. */
function controlledRunner() {
  const calls: string[] = [];
  const pending: Array<(result: BtrbkRunResult) => void> = [];
  const run = (configFile: string) => {
    calls.push(configFile);
    return new Promise<BtrbkRunResult>((resolve) => pending.push(resolve));
  };
  /** Completes the next invocation, waiting until btrbk has been called. */
  const finish = async (result: BtrbkRunResult): Promise<void> => {
    while (pending.length === 0) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    pending.shift()?.(result);
  };
  return { run, calls, finish };
}

/** Snapshot directory step that does nothing, for tests that do not exercise it. */
const noopEnsure = (_configFile: string): Promise<void> => Promise.resolve();

/** Runs `fn` with a temporary drop-in directory and removes it afterwards. */
async function withDropIn(
  fn: (dir: string, configFile: string) => Promise<void>,
): Promise<void> {
  const dir = await Deno.makeTempDir({ prefix: "btrbk-run-test-" });
  try {
    await fn(dir, join(dir, "snapshot-machine.conf"));
  } finally {
    await Deno.remove(dir, { recursive: true }).catch(() => undefined);
  }
}

Deno.test("assertConfigFileExists fails with the Config Editor hint for a missing file", async () => {
  await withDropIn(async (_dir, configFile) => {
    await assertRejects(
      () => assertConfigFileExists(configFile),
      Error,
      `Configuration file not found: ${configFile}. Configure it in the Config Editor first.`,
    );
  });
});

Deno.test("assertConfigFileExists accepts an existing drop-in file", async () => {
  await withDropIn(async (_dir, configFile) => {
    await Deno.writeTextFile(configFile, "# test");
    await assertConfigFileExists(configFile);
  });
});

Deno.test("BackupRunner fails without running btrbk when the drop-in is missing", async () => {
  await withDropIn(async (_dir, configFile) => {
    const controlled = controlledRunner();
    const runner = new BackupRunner({
      configFile,
      run: controlled.run,
      ensureSnapshotDirs: noopEnsure,
    });

    runner.start();
    await settle(runner);

    const status = runner.getStatus();
    assertEquals(status.state, "failure");
    assertEquals(
      status.message,
      `Configuration file not found: ${configFile}. Configure it in the Config Editor first.`,
    );
    assertEquals(controlled.calls, []);
  });
});

Deno.test("BackupRunner runs the existing drop-in and records success", async () => {
  await withDropIn(async (_dir, configFile) => {
    await Deno.writeTextFile(configFile, "# test");
    const controlled = controlledRunner();
    const runner = new BackupRunner({
      configFile,
      run: controlled.run,
      ensureSnapshotDirs: noopEnsure,
    });

    runner.start();
    assertEquals(runner.getStatus().state, "running");

    await controlled.finish({ success: true, code: 0, output: "done" });
    await settle(runner);
    assertEquals(controlled.calls, [configFile]);

    const status = runner.getStatus();
    assertEquals(status.state, "success");
    assertEquals(status.finishedAt !== null, true);
  });
});

Deno.test("BackupRunner starts idle", () => {
  const runner = new BackupRunner({
    configFile: "/unused/snapshot-machine.conf",
  });
  assertEquals(runner.getStatus().state, "idle");
  assertEquals(runner.getStatus().startedAt, null);
});

Deno.test("BackupRunner reports failure with the output tail", async () => {
  await withDropIn(async (_dir, configFile) => {
    await Deno.writeTextFile(configFile, "# test");
    const controlled = controlledRunner();
    const runner = new BackupRunner({
      configFile,
      run: controlled.run,
      ensureSnapshotDirs: noopEnsure,
    });

    runner.start();
    await controlled.finish({
      success: false,
      code: 1,
      output: "first line\n\nerror: volume not found\n",
    });
    await settle(runner);

    const status = runner.getStatus();
    assertEquals(status.state, "failure");
    assertEquals(
      status.message,
      "btrbk exited with code 1:\nfirst line\nerror: volume not found",
    );
  });
});

Deno.test("BackupRunner reports a signal termination", async () => {
  await withDropIn(async (_dir, configFile) => {
    await Deno.writeTextFile(configFile, "# test");
    const controlled = controlledRunner();
    const runner = new BackupRunner({
      configFile,
      run: controlled.run,
      ensureSnapshotDirs: noopEnsure,
    });

    runner.start();
    await controlled.finish({ success: false, code: null, output: "" });
    await settle(runner);

    assertEquals(
      runner.getStatus().message,
      "btrbk was terminated by a signal",
    );
  });
});

Deno.test("BackupRunner reports a spawn error as failure", async () => {
  await withDropIn(async (_dir, configFile) => {
    await Deno.writeTextFile(configFile, "# test");
    const runner = new BackupRunner({
      configFile,
      run: () => Promise.reject(new Error("btrbk: not found")),
      ensureSnapshotDirs: noopEnsure,
    });

    runner.start();
    await settle(runner);

    const status = runner.getStatus();
    assertEquals(status.state, "failure");
    assertEquals(status.message, "Could not run btrbk: btrbk: not found");
  });
});

Deno.test("BackupRunner rejects a second start while running", async () => {
  await withDropIn(async (_dir, configFile) => {
    await Deno.writeTextFile(configFile, "# test");
    const controlled = controlledRunner();
    const runner = new BackupRunner({
      configFile,
      run: controlled.run,
      ensureSnapshotDirs: noopEnsure,
    });

    runner.start();
    assertThrows(() => runner.start(), BackupBusyError);
    await controlled.finish({ success: true, code: 0, output: "" });
    await settle(runner);
    assertEquals(controlled.calls.length, 1);
  });
});

Deno.test("BackupRunner accepts a new run after the previous one finished", async () => {
  await withDropIn(async (_dir, configFile) => {
    await Deno.writeTextFile(configFile, "# test");
    const controlled = controlledRunner();
    const runner = new BackupRunner({
      configFile,
      run: controlled.run,
      ensureSnapshotDirs: noopEnsure,
    });

    runner.start();
    await controlled.finish({ success: true, code: 0, output: "" });
    await settle(runner);

    runner.start();
    assertEquals(runner.getStatus().state, "running");
    await controlled.finish({ success: true, code: 0, output: "" });
    await settle(runner);
    assertEquals(controlled.calls.length, 2);
  });
});

Deno.test("BackupRunner.getStatus returns a copy", () => {
  const runner = new BackupRunner({
    configFile: "/unused/snapshot-machine.conf",
  });
  const status = runner.getStatus();
  status.state = "failure";
  assertEquals(runner.getStatus().state, "idle");
});

Deno.test("BackupRunner prepares snapshot directories before btrbk runs", async () => {
  await withDropIn(async (_dir, configFile) => {
    await Deno.writeTextFile(configFile, "# test");
    const order: string[] = [];
    const controlled = controlledRunner();
    const runner = new BackupRunner({
      configFile,
      ensureSnapshotDirs: (file) => {
        order.push(`ensure:${file}`);
        return Promise.resolve();
      },
      run: (file) => {
        order.push("run");
        return controlled.run(file);
      },
    });

    runner.start();
    await controlled.finish({ success: true, code: 0, output: "" });
    await settle(runner);

    assertEquals(order, [`ensure:${configFile}`, "run"]);
    assertEquals(runner.getStatus().state, "success");
  });
});

Deno.test("BackupRunner fails without running btrbk when snapshot directories cannot be prepared", async () => {
  await withDropIn(async (_dir, configFile) => {
    await Deno.writeTextFile(configFile, "# test");
    const controlled = controlledRunner();
    const runner = new BackupRunner({
      configFile,
      ensureSnapshotDirs: () => Promise.reject(new Error("permission denied")),
      run: controlled.run,
    });

    runner.start();
    await settle(runner);

    const status = runner.getStatus();
    assertEquals(status.state, "failure");
    assertEquals(
      status.message,
      "Could not prepare snapshot directories: permission denied",
    );
    assertEquals(controlled.calls, []);
  });
});
