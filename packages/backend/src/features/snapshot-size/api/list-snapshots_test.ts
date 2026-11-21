/// <reference lib="deno.ns" />
import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { listSnapshots, parseSnapshotDate } from "./list-snapshots.ts";

Deno.test("parseSnapshotDate reads minute precision timestamps", () => {
  assertEquals(
    parseSnapshotDate("home.20261119T1200"),
    new Date(2026, 10, 19, 12, 0, 0).toISOString(),
  );
});

Deno.test("parseSnapshotDate reads second precision timestamps", () => {
  assertEquals(
    parseSnapshotDate("root.20261119T120530"),
    new Date(2026, 10, 19, 12, 5, 30).toISOString(),
  );
});

Deno.test("parseSnapshotDate reads a bare date", () => {
  assertEquals(
    parseSnapshotDate("data.20261119"),
    new Date(2026, 10, 19, 0, 0, 0).toISOString(),
  );
});

Deno.test("parseSnapshotDate returns null without a timestamp or with invalid values", () => {
  assertEquals(parseSnapshotDate("notes"), null);
  assertEquals(parseSnapshotDate("home.2026"), null);
  assertEquals(parseSnapshotDate("home.20261340T1200"), null);
  assertEquals(parseSnapshotDate("home.20261119T2500"), null);
});

Deno.test("listSnapshots returns named snapshots newest first with null sizes", async () => {
  const dir = await Deno.makeTempDir({ prefix: "snapshots-test-" });
  try {
    await Deno.mkdir(join(dir, "home.20261118T0900"));
    await Deno.mkdir(join(dir, "home.20261119T1200"));
    await Deno.mkdir(join(dir, "manual"));
    await Deno.writeTextFile(join(dir, "stray.txt"), "not a snapshot");

    const entries = await listSnapshots(dir);

    assertEquals(entries.map((entry) => entry.name), [
      "home.20261119T1200",
      "home.20261118T0900",
      "manual",
    ]);
    assertEquals(entries[0], {
      name: "home.20261119T1200",
      path: join(dir, "home.20261119T1200"),
      date: new Date(2026, 10, 19, 12, 0, 0).toISOString(),
      size: null,
    });
    assertEquals(entries[2].date, null);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("listSnapshots returns an empty list for a missing directory", async () => {
  const dir = await Deno.makeTempDir({ prefix: "snapshots-test-" });
  await Deno.remove(dir);
  assertEquals(await listSnapshots(dir), []);
});

Deno.test("listSnapshots rejects a relative path", async () => {
  await assertRejects(() => listSnapshots("relative/dir"), Error, "absolute");
});
