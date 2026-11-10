/// <reference lib="deno.ns" />
import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { ensureSnapshotDirs, extractSnapshotDirs } from "./snapshot-dirs.ts";

Deno.test("extractSnapshotDirs joins relative and keeps absolute volume snapshot_dir", () => {
  const dirs = extractSnapshotDirs([
    "volume /home",
    "  snapshot_dir _btrbk_snapshots",
    "volume /data",
    "  snapshot_dir /srv/snaps",
  ].join("\n"));
  assertEquals(dirs, ["/home/_btrbk_snapshots", "/srv/snaps"]);
});

Deno.test("extractSnapshotDirs applies a global snapshot_dir to volumes without their own", () => {
  const dirs = extractSnapshotDirs([
    "snapshot_dir /var/snaps",
    "volume /home",
    "volume /data",
    "  snapshot_dir .snap",
  ].join("\n"));
  assertEquals(dirs, ["/var/snaps", "/data/.snap"]);
});

Deno.test("extractSnapshotDirs ignores subvolume options and comments", () => {
  const dirs = extractSnapshotDirs([
    "# snapshot_dir /commented",
    "volume /home",
    "  subvolume user",
    "    snapshot_dir /not-used",
  ].join("\n"));
  assertEquals(dirs, []);
});

Deno.test("extractSnapshotDirs de-duplicates and skips a relative global dir without volumes", () => {
  const dirs = extractSnapshotDirs([
    "snapshot_dir rel",
    "volume /home",
    "  snapshot_dir /x",
    "volume /home",
    "  snapshot_dir /x",
  ].join("\n"));
  assertEquals(dirs, ["/x"]);
});

Deno.test("ensureSnapshotDirs creates missing directories and keeps existing ones", async () => {
  const root = await Deno.makeTempDir({ prefix: "snapdirs-test-" });
  try {
    const existing = join(root, "existing");
    const missing = join(root, "a", "b", "missing");
    await Deno.mkdir(existing);
    await ensureSnapshotDirs([existing, missing]);
    assertEquals((await Deno.stat(missing)).isDirectory, true);
    assertEquals((await Deno.stat(existing)).isDirectory, true);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("ensureSnapshotDirs creates a missing directory with mode 0o755", async () => {
  const root = await Deno.makeTempDir({ prefix: "snapdirs-test-" });
  try {
    const missing = join(root, "created");
    await ensureSnapshotDirs([missing]);
    const info = await Deno.stat(missing);
    assertEquals(info.isDirectory, true);
    if (info.mode !== null) {
      assertEquals(info.mode & 0o777, 0o755);
    }
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("ensureSnapshotDirs keeps group and owner modes and adds others read/execute", async () => {
  const root = await Deno.makeTempDir({ prefix: "snapdirs-test-" });
  try {
    const group = join(root, "group");
    await Deno.mkdir(group);
    await Deno.chmod(group, 0o775);
    await ensureSnapshotDirs([group]);
    assertEquals((await Deno.stat(group)).mode! & 0o777, 0o775);

    const restrictive = join(root, "restrictive");
    await Deno.mkdir(restrictive);
    await Deno.chmod(restrictive, 0o700);
    await ensureSnapshotDirs([restrictive]);
    assertEquals((await Deno.stat(restrictive)).mode! & 0o777, 0o705);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("ensureSnapshotDirs leaves an existing directory with others read/execute unchanged", async () => {
  const root = await Deno.makeTempDir({ prefix: "snapdirs-test-" });
  try {
    const existing = join(root, "existing");
    await Deno.mkdir(existing);
    await Deno.chmod(existing, 0o750);
    await ensureSnapshotDirs([existing]);
    assertEquals((await Deno.stat(existing)).mode! & 0o777, 0o755);
    await Deno.chmod(existing, 0o751);
    await ensureSnapshotDirs([existing]);
    assertEquals((await Deno.stat(existing)).mode! & 0o777, 0o755);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("ensureSnapshotDirs does not chmod a symlink target outside the snapshot path", async () => {
  const root = await Deno.makeTempDir({ prefix: "snapdirs-test-" });
  try {
    const external = join(root, "external");
    await Deno.mkdir(external);
    await Deno.chmod(external, 0o700);
    const link = join(root, "link");
    await Deno.symlink(external, link);
    await ensureSnapshotDirs([link]);
    assertEquals((await Deno.stat(external)).mode! & 0o777, 0o700);
    assertEquals((await Deno.lstat(link)).isSymlink, true);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("ensureSnapshotDirs rejects a dangling symlink", async () => {
  const root = await Deno.makeTempDir({ prefix: "snapdirs-test-" });
  try {
    const link = join(root, "dangling");
    await Deno.symlink(join(root, "missing"), link);
    await assertRejects(
      () => ensureSnapshotDirs([link]),
      Error,
      `Cannot access snapshot directory ${link}`,
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("ensureSnapshotDirs rejects a symlink to a regular file without chmod", async () => {
  const root = await Deno.makeTempDir({ prefix: "snapdirs-test-" });
  try {
    const file = join(root, "file");
    await Deno.writeTextFile(file, "x");
    await Deno.chmod(file, 0o600);
    const link = join(root, "link");
    await Deno.symlink(file, link);
    await assertRejects(
      () => ensureSnapshotDirs([link]),
      Error,
      `Snapshot directory symlink does not point to a directory: ${link}`,
    );
    assertEquals((await Deno.stat(file)).mode! & 0o777, 0o600);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("ensureSnapshotDirs fails when the path is a regular file", async () => {
  const root = await Deno.makeTempDir({ prefix: "snapdirs-test-" });
  try {
    const file = join(root, "file");
    await Deno.writeTextFile(file, "x");
    await assertRejects(
      () => ensureSnapshotDirs([file]),
      Error,
      `Snapshot directory path exists but is not a directory: ${file}`,
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("ensureSnapshotDirs names the path when it cannot be inspected", async () => {
  const root = await Deno.makeTempDir({ prefix: "snapdirs-test-" });
  try {
    const blocker = join(root, "blocker");
    await Deno.writeTextFile(blocker, "x");
    const target = join(blocker, "child");
    await assertRejects(
      () => ensureSnapshotDirs([target]),
      Error,
      `Cannot access snapshot directory ${target}`,
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
