/// <reference lib="deno.ns" />
import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import {
  DEFAULT_BTRBK_CONFIG_FILE,
  getDefaultBtrbkConfigPath,
} from "./paths.ts";
import { MAX_INCLUDE_DEPTH, parseConfig } from "./parser.ts";

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await Deno.makeTempDir({ prefix: "btrbk-parser-test-" });
  try {
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true }).catch(() => undefined);
  }
}

async function withEnv(
  name: string,
  value: string | undefined,
  fn: () => void | Promise<void>,
): Promise<void> {
  const previous = Deno.env.get(name);
  if (value === undefined) Deno.env.delete(name);
  else Deno.env.set(name, value);
  try {
    await fn();
  } finally {
    if (previous === undefined) Deno.env.delete(name);
    else Deno.env.set(name, previous);
  }
}

const BASE_CONFIG = `
# comment line
volume /data
  snapshot_dir .snapshots
  subvolume docs
    snapshot_name docs-snap
  subvolume photos

volume /mnt/backup
  snapshot_dir /srv/snaps
`;

Deno.test("getDefaultBtrbkConfigPath returns the built-in path without an override", async () => {
  await withEnv("BTRBK_CONFIG_FILE", undefined, () => {
    assertEquals(getDefaultBtrbkConfigPath(), DEFAULT_BTRBK_CONFIG_FILE);
    assertEquals(DEFAULT_BTRBK_CONFIG_FILE, "/etc/btrbk/btrbk.conf");
  });
});

Deno.test("getDefaultBtrbkConfigPath honours BTRBK_CONFIG_FILE and ignores empty values", async () => {
  await withEnv("BTRBK_CONFIG_FILE", "/tmp/custom-btrbk.conf", () => {
    assertEquals(getDefaultBtrbkConfigPath(), "/tmp/custom-btrbk.conf");
  });
  await withEnv("BTRBK_CONFIG_FILE", "", () => {
    assertEquals(getDefaultBtrbkConfigPath(), DEFAULT_BTRBK_CONFIG_FILE);
  });
});

Deno.test("parseConfig reads volumes, subvolumes and snapshot_dir", async () => {
  await withTempDir(async (dir) => {
    const file = join(dir, "btrbk.conf");
    await Deno.writeTextFile(file, BASE_CONFIG);

    const config = await parseConfig(file);

    assertEquals(config.volumes, [
      {
        path: "/data",
        snapshotDir: ".snapshots",
        subvolumes: [
          { path: "docs", name: "docs-snap" },
          { path: "photos" },
        ],
      },
      {
        path: "/mnt/backup",
        snapshotDir: "/srv/snaps",
        subvolumes: [],
      },
    ]);
  });
});

Deno.test("parseConfig returns no volumes for a missing file", async () => {
  await withTempDir(async (dir) => {
    const config = await parseConfig(join(dir, "absent.conf"));
    assertEquals(config, { volumes: [] });
  });
});

Deno.test("parseConfig follows the BTRBK_CONFIG_FILE override", async () => {
  await withTempDir(async (dir) => {
    const file = join(dir, "override.conf");
    await Deno.writeTextFile(file, "volume /override\n  snapshot_dir snaps\n");
    await withEnv("BTRBK_CONFIG_FILE", file, async () => {
      const config = await parseConfig(getDefaultBtrbkConfigPath());
      assertEquals(config.volumes.map((v) => v.path), ["/override"]);
    });
  });
});

Deno.test("parseConfig expands a relative include directory of drop-ins", async () => {
  await withTempDir(async (dir) => {
    const dropIn = join(dir, "gui.conf.d");
    await Deno.mkdir(dropIn);
    await Deno.writeTextFile(
      join(dir, "btrbk.conf"),
      "include gui.conf.d/*.conf\n",
    );
    await Deno.writeTextFile(
      join(dropIn, "b.conf"),
      "volume /second\n  snapshot_dir s\n",
    );
    await Deno.writeTextFile(
      join(dropIn, "a.conf"),
      "volume /first\n  snapshot_dir s\n",
    );
    await Deno.writeTextFile(join(dropIn, "notes.txt"), "volume /ignored\n");

    const config = await parseConfig(join(dir, "btrbk.conf"));

    assertEquals(config.volumes.map((v) => v.path), ["/first", "/second"]);
  });
});

Deno.test("parseConfig includes a directory path and an absolute file path", async () => {
  await withTempDir(async (dir) => {
    const dropIn = join(dir, "drop");
    await Deno.mkdir(dropIn);
    const extra = join(dir, "extra.conf");
    await Deno.writeTextFile(join(dropIn, "one.conf"), "volume /one\n");
    await Deno.writeTextFile(extra, "volume /extra\n");
    await Deno.writeTextFile(
      join(dir, "btrbk.conf"),
      `include ${dropIn}\ninclude ${extra}\n`,
    );

    const config = await parseConfig(join(dir, "btrbk.conf"));

    assertEquals(config.volumes.map((v) => v.path), ["/one", "/extra"]);
  });
});

Deno.test("parseConfig skips include patterns that match nothing", async () => {
  await withTempDir(async (dir) => {
    await Deno.writeTextFile(
      join(dir, "btrbk.conf"),
      `include ${dir}/missing/*.conf\nvolume /kept\n`,
    );
    const config = await parseConfig(join(dir, "btrbk.conf"));
    assertEquals(config.volumes.map((v) => v.path), ["/kept"]);
  });
});

Deno.test("parseConfig stops on a file that includes itself", async () => {
  await withTempDir(async (dir) => {
    const file = join(dir, "self.conf");
    await Deno.writeTextFile(file, `volume /self\ninclude ${file}\n`);

    const config = await parseConfig(file);

    assertEquals(config.volumes.map((v) => v.path), ["/self"]);
  });
});

Deno.test("parseConfig breaks include cycles across files", async () => {
  await withTempDir(async (dir) => {
    const a = join(dir, "a.conf");
    const b = join(dir, "b.conf");
    await Deno.writeTextFile(a, `volume /a\ninclude b.conf\n`);
    await Deno.writeTextFile(b, `volume /b\ninclude a.conf\n`);

    const config = await parseConfig(a);

    assertEquals(config.volumes.map((v) => v.path), ["/a", "/b"]);
  });
});

Deno.test("parseConfig caps nesting of include directives", async () => {
  await withTempDir(async (dir) => {
    const depth = MAX_INCLUDE_DEPTH + 4;
    for (let i = 0; i < depth; i++) {
      const next = i + 1 < depth ? `include level${i + 1}.conf\n` : "";
      await Deno.writeTextFile(
        join(dir, `level${i}.conf`),
        `volume /level${i}\n${next}`,
      );
    }

    const config = await parseConfig(join(dir, "level0.conf"));

    assertEquals(config.volumes.length, MAX_INCLUDE_DEPTH);
    assertEquals(config.volumes[0].path, "/level0");
  });
});

Deno.test("parseConfig propagates unexpected read errors", async () => {
  await withTempDir(async (dir) => {
    await assertRejects(() => parseConfig(dir));
  });
});
