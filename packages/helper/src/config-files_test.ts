/// <reference lib="deno.ns" />
import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import { join } from "@std/path";
import {
  assertValidConfigFileName,
  assertValidContent,
  CONFIG_DIR,
  ConfigFileError,
  configFilePath,
  ConfigSyntaxError,
  DEV_CONFIG_DIR,
  ensureConfigDir,
  listConfigFiles,
  MAX_CONFIG_BYTES,
  readConfigFile,
  resolveConfigDir,
  validateWithBtrbk,
  writeConfigFileAtomic,
} from "./config-files.ts";

async function withTempDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await Deno.makeTempDir({ prefix: "helper-test-" });
  try {
    await run(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

/** Reports whether run permission for btrbk is granted and `btrbk --version` succeeds. */
async function btrbkUsable(): Promise<boolean> {
  const { state } = await Deno.permissions.query({
    name: "run",
    command: "btrbk",
  });
  if (state !== "granted") return false;
  try {
    return (await new Deno.Command("btrbk", {
      args: ["--version"],
      stdout: "null",
      stderr: "null",
    }).output())
      .success;
  } catch {
    return false;
  }
}

Deno.test("accepts well-formed configuration file names", () => {
  for (
    const name of ["a.conf", "home-backup.conf", "x_1.2.conf", "0start.conf"]
  ) {
    assertEquals(assertValidConfigFileName(name), name);
  }
});

Deno.test("rejects names that could escape the directory or are malformed", () => {
  const bad = [
    "../etc/passwd.conf",
    "sub/a.conf",
    "a..conf",
    "-leading.conf",
    ".hidden.conf",
    "noext",
    "a.conf.bak",
    "a b.conf",
    "",
    `${"a".repeat(129)}.conf`,
  ];
  for (const name of bad) {
    assertThrows(
      () => assertValidConfigFileName(name),
      ConfigFileError,
      "invalid configuration file name",
    );
  }
});

Deno.test("configFilePath stays inside the directory", () => {
  assertEquals(
    configFilePath("/etc/btrbk/gui.conf.d", "a.conf"),
    "/etc/btrbk/gui.conf.d/a.conf",
  );
  assertThrows(
    () => configFilePath("/etc/btrbk/gui.conf.d", "../x.conf"),
    ConfigFileError,
  );
});

Deno.test("assertValidContent enforces size and NUL restrictions", () => {
  assertValidContent("volume /data\n");
  assertThrows(() => assertValidContent("a\u0000b"), ConfigFileError, "NUL");
  assertThrows(
    () => assertValidContent("x".repeat(MAX_CONFIG_BYTES + 1)),
    ConfigFileError,
    "size limit",
  );
});

Deno.test("listConfigFiles returns sorted valid names and skips others", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(`${dir}/b.conf`, "");
    await Deno.writeTextFile(`${dir}/a.conf`, "");
    await Deno.writeTextFile(`${dir}/notes.txt`, "");
    await Deno.writeTextFile(`${dir}/.hidden.conf`, "");
    assertEquals(await listConfigFiles(dir), ["a.conf", "b.conf"]);
  });
});

Deno.test("listConfigFiles returns an empty list for a missing directory", async () => {
  await withTempDir(async (dir) => {
    assertEquals(await listConfigFiles(`${dir}/missing`), []);
  });
});

Deno.test("readConfigFile reads content and reports missing files", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(`${dir}/a.conf`, "volume /x\n");
    assertEquals(await readConfigFile(dir, "a.conf"), "volume /x\n");
    await assertRejects(
      () => readConfigFile(dir, "gone.conf"),
      ConfigFileError,
      "not found",
    );
  });
});

Deno.test("writeConfigFileAtomic replaces the file and leaves no temporary files", async () => {
  await withTempDir(async (dir) => {
    await writeConfigFileAtomic(dir, "a.conf", "first\n");
    await writeConfigFileAtomic(dir, "a.conf", "second\n");
    assertEquals(await Deno.readTextFile(`${dir}/a.conf`), "second\n");
    assertEquals(await listConfigFiles(dir), ["a.conf"]);
    const entries: string[] = [];
    for await (const entry of Deno.readDir(dir)) entries.push(entry.name);
    assertEquals(entries.sort(), ["a.conf"]);
  });
});

Deno.test({
  name: "validateWithBtrbk accepts a valid configuration",
  ignore: !(await btrbkUsable()),
  fn: async () => {
    await validateWithBtrbk("# empty configuration\n");
  },
});

Deno.test({
  name:
    "validateWithBtrbk rejects an unknown option with a 'config is incorrect' error",
  ignore: !(await btrbkUsable()),
  fn: async () => {
    const error = await validateWithBtrbk("bogus_option 1\n").then(
      () => null,
      (e: unknown) => e,
    );
    assertEquals(error instanceof ConfigSyntaxError, true);
    const message = (error as Error).message;
    assertStringIncludes(message, "config is incorrect: ");
    assertStringIncludes(message, "bogus_option");
    assertEquals(
      message.includes("<candidate>") || message.includes("candidate.conf"),
      true,
    );
  },
});

Deno.test("resolveConfigDir selects the dev directory only for USE_SESSION_BUS=1", () => {
  assertEquals(resolveConfigDir("1"), DEV_CONFIG_DIR);
  assertEquals(resolveConfigDir("0"), CONFIG_DIR);
  assertEquals(resolveConfigDir(undefined), CONFIG_DIR);
});

Deno.test("resolveConfigDir prefers a BTRBK_CONFIG_DIR override", () => {
  assertEquals(resolveConfigDir("1", "/srv/custom.d"), "/srv/custom.d");
  assertEquals(resolveConfigDir(undefined, "/srv/custom.d"), "/srv/custom.d");
  assertEquals(resolveConfigDir(undefined, ""), CONFIG_DIR);
});

Deno.test("ensureConfigDir creates a missing directory tree", async () => {
  await withTempDir(async (dir) => {
    const nested = join(dir, "a", "b", "gui.conf.d");
    await ensureConfigDir(nested);
    assertEquals((await Deno.stat(nested)).isDirectory, true);
  });
});
