/// <reference lib="deno.ns" />
import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import {
  listFolderHistory,
  resolveVolumeRelativePath,
} from "./list-folder-history.ts";

const CONFIG_NAME = "snapshot-machine.conf";

/**
 * Runs `body` with a temporary drop-in directory whose managed configuration
 * declares one volume `<root>/vol` with a relative `snapshot_dir .snaps`
 * (omitted with `snapshotDir: null`). `config` replaces the whole content.
 */
async function withVolume(
  body: (
    paths: { root: string; volume: string; snaps: string },
  ) => Promise<void>,
  options: { config?: string | null; snapshotDir?: null } = {},
): Promise<void> {
  const root = await Deno.makeTempDir({ prefix: "folder-history-test-" });
  const dropIn = join(root, "gui.conf.d");
  const volume = join(root, "vol");
  const snaps = join(volume, ".snaps");
  await Deno.mkdir(dropIn);
  await Deno.mkdir(volume);
  const snapshotLine = options.snapshotDir === null
    ? ""
    : "  snapshot_dir .snaps\n";
  const config = options.config === undefined
    ? `volume ${volume}\n${snapshotLine}`
    : options.config;
  if (config !== null) {
    await Deno.writeTextFile(join(dropIn, CONFIG_NAME), config);
  }
  const previous = {
    dir: Deno.env.get("BTRBK_CONFIG_DIR"),
    name: Deno.env.get("BTRBK_CONFIG_NAME"),
  };
  Deno.env.set("BTRBK_CONFIG_DIR", dropIn);
  Deno.env.set("BTRBK_CONFIG_NAME", CONFIG_NAME);
  try {
    await body({ root, volume, snaps });
  } finally {
    if (previous.dir === undefined) Deno.env.delete("BTRBK_CONFIG_DIR");
    else Deno.env.set("BTRBK_CONFIG_DIR", previous.dir);
    if (previous.name === undefined) Deno.env.delete("BTRBK_CONFIG_NAME");
    else Deno.env.set("BTRBK_CONFIG_NAME", previous.name);
    await Deno.remove(root, { recursive: true });
  }
}

/** Captures console.warn output while `body` runs. */
async function captureWarnings(body: () => Promise<void>): Promise<string[]> {
  const original = console.warn;
  const messages: string[] = [];
  console.warn = (...args: unknown[]) => {
    messages.push(args.map(String).join(" "));
  };
  try {
    await body();
  } finally {
    console.warn = original;
  }
  return messages;
}

/**
 * True when mode 000 directories are enforced for this process. Root bypasses
 * mode bits, so the unreadable-directory tests are ignored there.
 */
const MODE_BITS_ENFORCED = await (async () => {
  const probe = await Deno.makeTempDir({ prefix: "folder-history-probe-" });
  try {
    await Deno.chmod(probe, 0o000);
    try {
      for await (const _ of Deno.readDir(probe)) break;
      return false;
    } catch {
      return true;
    }
  } finally {
    await Deno.chmod(probe, 0o755);
    await Deno.remove(probe, { recursive: true });
  }
})();

Deno.test("resolveVolumeRelativePath returns the path relative to the volume", () => {
  assertEquals(resolveVolumeRelativePath("/data", "/data/docs/a"), "docs/a");
  assertEquals(resolveVolumeRelativePath("/data", "/data"), "");
});

Deno.test("resolveVolumeRelativePath rejects sibling paths sharing a string prefix", () => {
  assertEquals(resolveVolumeRelativePath("/data", "/database/x"), null);
  assertEquals(resolveVolumeRelativePath("/data", "/data-old"), null);
});

Deno.test("resolveVolumeRelativePath rejects paths outside the volume", () => {
  assertEquals(resolveVolumeRelativePath("/data", "/etc/passwd"), null);
  assertEquals(resolveVolumeRelativePath("/data/sub", "/data"), null);
});

Deno.test("listFolderHistory groups hardlinked versions and marks deleted entries", async () => {
  await withVolume(async ({ volume, snaps }) => {
    await Deno.mkdir(join(snaps, "home.20261101T1000", "docs"), {
      recursive: true,
    });
    await Deno.mkdir(join(snaps, "home.20261102T1000", "docs"), {
      recursive: true,
    });
    await Deno.mkdir(join(snaps, "home.20261103T1000", "docs"), {
      recursive: true,
    });
    const first = join(snaps, "home.20261101T1000", "docs", "a.txt");
    await Deno.writeTextFile(first, "one");
    await Deno.writeTextFile(
      join(snaps, "home.20261101T1000", "docs", "gone.txt"),
      "x",
    );
    await Deno.link(first, join(snaps, "home.20261102T1000", "docs", "a.txt"));
    await Deno.link(first, join(snaps, "home.20261103T1000", "docs", "a.txt"));

    const history = await listFolderHistory(join(volume, "docs"));
    const byName = Object.fromEntries(history.map((e) => [e.name, e]));
    assertEquals(history.length, 2);
    assertEquals(byName["a.txt"].deleted, false);
    assertEquals(byName["a.txt"].lastSeen, "home.20261103T1000");
    assertEquals(byName["a.txt"].versions.map((v) => v.snapshot), [
      "home.20261103T1000",
      "home.20261102T1000",
      "home.20261101T1000",
    ]);
    assertEquals(
      byName["a.txt"].versions[0].snapshotDate,
      new Date(2026, 10, 3, 10, 0).toISOString(),
    );
    assertEquals(byName["gone.txt"].deleted, true);
    assertEquals(byName["gone.txt"].versions.length, 1);
    assertEquals(byName["gone.txt"].type, "file");
  });
});

Deno.test("listFolderHistory uses the volume root and nested subfolders as the traversal base", async () => {
  await withVolume(async ({ volume, snaps }) => {
    await Deno.mkdir(join(snaps, "home.20261101T1000", "a", "b"), {
      recursive: true,
    });
    await Deno.writeTextFile(join(snaps, "home.20261101T1000", "top.txt"), "t");
    await Deno.writeTextFile(
      join(snaps, "home.20261101T1000", "a", "b", "deep.txt"),
      "d",
    );

    const root = await listFolderHistory(volume);
    assertEquals(root.map((e) => e.name), ["top.txt", "a"]);
    const nested = await listFolderHistory(join(volume, "a", "b"));
    assertEquals(nested.map((e) => e.name), ["deep.txt"]);
    assertEquals(nested[0].path, "deep.txt");
    assertEquals(
      nested[0].versions[0].path,
      join(snaps, "home.20261101T1000", "a", "b", "deep.txt"),
    );
  });
});

Deno.test("listFolderHistory skips snapshots that do not contain the folder", async () => {
  await withVolume(async ({ volume, snaps }) => {
    await Deno.mkdir(join(snaps, "home.20261101T1000", "docs"), {
      recursive: true,
    });
    await Deno.mkdir(join(snaps, "home.20261102T1000"));
    await Deno.writeTextFile(
      join(snaps, "home.20261101T1000", "docs", "a.txt"),
      "a",
    );
    // Newest snapshot lacks the folder: the newest one that has it defines the live state.
    const history = await listFolderHistory(join(volume, "docs"));
    assertEquals(history.length, 1);
    assertEquals(history[0].deleted, false);
    assertEquals(history[0].versions[0].snapshot, "home.20261101T1000");
  });
});

Deno.test("listFolderHistory returns an empty list when no snapshot holds the folder", async () => {
  await withVolume(async ({ volume, snaps }) => {
    await Deno.mkdir(join(snaps, "home.20261101T1000"), { recursive: true });
    assertEquals(await listFolderHistory(join(volume, "missing")), []);
  });
});

Deno.test("listFolderHistory treats a path that is a file inside a snapshot as absent without warning", async () => {
  await withVolume(async ({ volume, snaps }) => {
    await Deno.mkdir(join(snaps, "home.20261101T1000"), { recursive: true });
    await Deno.writeTextFile(join(snaps, "home.20261101T1000", "docs"), "file");
    const warnings = await captureWarnings(async () => {
      assertEquals(await listFolderHistory(join(volume, "docs")), []);
    });
    assertEquals(warnings, []);
  });
});

Deno.test("listFolderHistory rejects relative paths, '..' segments and paths outside every volume", async () => {
  await withVolume(async ({ volume }) => {
    await assertRejects(
      () => listFolderHistory("relative/path"),
      Error,
      "Invalid folder path",
    );
    await assertRejects(
      () => listFolderHistory(`${volume}/../x`),
      Error,
      "Invalid folder path",
    );
    await assertRejects(
      () => listFolderHistory("/etc/passwd"),
      Error,
      "No btrbk volume found for path: /etc/passwd",
    );
  });
});

Deno.test("listFolderHistory rejects a sibling directory sharing the volume name prefix", async () => {
  await withVolume(async ({ volume }) => {
    const sibling = `${volume}-old`;
    await Deno.mkdir(sibling);
    await assertRejects(
      () => listFolderHistory(join(sibling, "x")),
      Error,
      "No btrbk volume found",
    );
  });
});

Deno.test("listFolderHistory fails when the volume has no snapshot_dir", async () => {
  await withVolume(
    async ({ volume }) => {
      await assertRejects(
        () => listFolderHistory(join(volume, "docs")),
        Error,
        `No snapshot directory configured for volume: ${volume}`,
      );
    },
    { snapshotDir: null },
  );
});

Deno.test("listFolderHistory returns an empty list when the configuration has no volumes", async () => {
  await withVolume(async ({ volume }) => {
    assertEquals(await listFolderHistory(join(volume, "docs")), []);
  }, { config: "# no volumes\n" });
});

Deno.test("listFolderHistory fails when the managed configuration file is missing", async () => {
  await withVolume(async ({ volume }) => {
    await assertRejects(
      () => listFolderHistory(join(volume, "docs")),
      Error,
      "Configuration file not found",
    );
  }, { config: null });
});

Deno.test("listFolderHistory warns and returns an empty list when the snapshot directory is missing", async () => {
  await withVolume(async ({ volume }) => {
    const warnings = await captureWarnings(async () => {
      assertEquals(await listFolderHistory(join(volume, "docs")), []);
    });
    assertEquals(warnings.length, 1);
    assertEquals(
      warnings[0].includes("Snapshot directory does not exist yet"),
      true,
    );
  });
});

Deno.test({
  name:
    "listFolderHistory warns and returns an empty list when the snapshot directory is unreadable",
  ignore: !MODE_BITS_ENFORCED,
  fn: async () => {
    await withVolume(async ({ volume, snaps }) => {
      await Deno.mkdir(join(snaps, "home.20261101T1000", "docs"), {
        recursive: true,
      });
      await Deno.chmod(snaps, 0o000);
      try {
        const warnings = await captureWarnings(async () => {
          assertEquals(await listFolderHistory(join(volume, "docs")), []);
        });
        assertEquals(warnings.length, 1);
        assertEquals(
          warnings[0].includes(`Cannot read snapshot directory ${snaps}`),
          true,
        );
      } finally {
        await Deno.chmod(snaps, 0o755);
      }
    });
  },
});

Deno.test({
  name:
    "listFolderHistory warns about an unreadable snapshot folder and keeps other snapshots",
  ignore: !MODE_BITS_ENFORCED,
  fn: async () => {
    await withVolume(async ({ volume, snaps }) => {
      const older = join(snaps, "home.20261101T1000", "docs");
      const newer = join(snaps, "home.20261102T1000", "docs");
      await Deno.mkdir(older, { recursive: true });
      await Deno.mkdir(newer, { recursive: true });
      await Deno.writeTextFile(join(older, "a.txt"), "a");
      await Deno.chmod(newer, 0o000);
      try {
        const warnings = await captureWarnings(async () => {
          const history = await listFolderHistory(join(volume, "docs"));
          assertEquals(history.map((e) => e.name), ["a.txt"]);
          assertEquals(history[0].versions.map((v) => v.snapshot), [
            "home.20261101T1000",
          ]);
        });
        assertEquals(warnings.length, 1);
        assertEquals(
          warnings[0].includes(`Cannot read snapshot folder ${newer}`),
          true,
        );
      } finally {
        await Deno.chmod(newer, 0o755);
      }
    });
  },
});
