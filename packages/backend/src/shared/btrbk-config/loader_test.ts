/// <reference lib="deno.ns" />
import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { resolveConfigName } from "@snapshot-machine/shared/config-name.ts";
import { getConfigName, getDropInDir } from "./paths.ts";
import { loadBtrbkConfig } from "./loader.ts";

async function withEnv(
  values: Record<string, string | undefined>,
  fn: () => Promise<void>,
): Promise<void> {
  const previous = Object.keys(values).map((k) =>
    [k, Deno.env.get(k)] as const
  );
  for (const [k, v] of Object.entries(values)) {
    if (v === undefined) Deno.env.delete(k);
    else Deno.env.set(k, v);
  }
  try {
    await fn();
  } finally {
    for (const [k, v] of previous) {
      if (v === undefined) Deno.env.delete(k);
      else Deno.env.set(k, v);
    }
  }
}

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await Deno.makeTempDir({ prefix: "btrbk-loader-test-" });
  try {
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true }).catch(() => undefined);
  }
}

Deno.test("resolveConfigName accepts valid names and falls back otherwise", () => {
  assertEquals(resolveConfigName(undefined), "snapshot-machine.conf");
  assertEquals(resolveConfigName("custom.conf"), "custom.conf");
  assertEquals(resolveConfigName("../evil.conf"), "snapshot-machine.conf");
  assertEquals(resolveConfigName("no-suffix"), "snapshot-machine.conf");
});

Deno.test("getConfigName and getDropInDir honour the environment", async () => {
  await withEnv({
    BTRBK_CONFIG_NAME: "mine.conf",
    BTRBK_CONFIG_DIR: "/tmp/override.d",
  }, () => {
    assertEquals(getConfigName(), "mine.conf");
    assertEquals(getDropInDir(), "/tmp/override.d");
    return Promise.resolve();
  });
  await withEnv({
    BTRBK_CONFIG_NAME: undefined,
    BTRBK_CONFIG_DIR: undefined,
    USE_SESSION_BUS: "1",
  }, () => {
    assertEquals(getConfigName(), "snapshot-machine.conf");
    assertEquals(getDropInDir(), "/tmp/snapshot-machine-dev/gui.conf.d");
    return Promise.resolve();
  });
});

Deno.test("loadBtrbkConfig reads the drop-in and ignores btrbk.conf", async () => {
  await withTempDir(async (dir) => {
    const main = join(dir, "btrbk.conf");
    const dropIn = join(dir, "gui.conf.d");
    await Deno.mkdir(dropIn);
    await Deno.writeTextFile(main, "volume /main\n  snapshot_dir s\n");
    await Deno.writeTextFile(
      join(dropIn, "snapshot-machine.conf"),
      "volume /drop\n  snapshot_dir s\n",
    );
    await withEnv({
      BTRBK_CONFIG_FILE: main,
      BTRBK_CONFIG_DIR: dropIn,
      BTRBK_CONFIG_NAME: undefined,
    }, async () => {
      const config = await loadBtrbkConfig();
      assertEquals(config.volumes.map((v) => v.path), ["/drop"]);
    });
  });
});

Deno.test("loadBtrbkConfig returns an empty config without writing when the drop-in is missing", async () => {
  await withTempDir(async (dir) => {
    const dropIn = join(dir, "gui.conf.d");
    const target = join(dropIn, "snapshot-machine.conf");
    await withEnv({
      BTRBK_CONFIG_FILE: join(dir, "absent.conf"),
      BTRBK_CONFIG_DIR: dropIn,
      BTRBK_CONFIG_NAME: undefined,
    }, async () => {
      const config = await loadBtrbkConfig();
      assertEquals(config.volumes, []);
      const exists = await Deno.stat(target).then(() => true, () => false);
      assertEquals(exists, false);
      const dirExists = await Deno.stat(dropIn).then(() => true, () => false);
      assertEquals(dirExists, false);
    });
  });
});

Deno.test("loadBtrbkConfig keeps an existing drop-in untouched", async () => {
  await withTempDir(async (dir) => {
    const dropIn = join(dir, "gui.conf.d");
    const target = join(dropIn, "snapshot-machine.conf");
    await Deno.mkdir(dropIn);
    await Deno.writeTextFile(target, "volume /keep\n  snapshot_dir s\n");
    await withEnv({
      BTRBK_CONFIG_DIR: dropIn,
      BTRBK_CONFIG_NAME: undefined,
    }, async () => {
      const config = await loadBtrbkConfig();
      assertEquals(config.volumes.map((v) => v.path), ["/keep"]);
      assertEquals(
        await Deno.readTextFile(target),
        "volume /keep\n  snapshot_dir s\n",
      );
    });
  });
});
