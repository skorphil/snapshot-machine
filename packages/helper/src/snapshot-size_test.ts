/// <reference lib="deno.ns" />
import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import {
  assertValidSnapshotPath,
  calculateSnapshotSize,
  type DuRunner,
  parseFilesystemDu,
  SnapshotSizeError,
} from "./snapshot-size.ts";

const HEADER = "     Total   Exclusive  Set shared  Filename\n";

Deno.test("parseFilesystemDu reads the sizes of the data row", () => {
  const output =
    `${HEADER}21528117248  8412565504  9785421824  /home/alice/.snapshots/x\n`;
  assertEquals(parseFilesystemDu(output), {
    path: "/home/alice/.snapshots/x",
    totalBytes: 21528117248,
    exclusiveBytes: 8412565504,
    sharedBytes: 9785421824,
  });
});

Deno.test("parseFilesystemDu keeps spaces inside the path", () => {
  const output = `${HEADER}10  4  6  /mnt/my backups/2026 01\n`;
  assertEquals(parseFilesystemDu(output).path, "/mnt/my backups/2026 01");
});

Deno.test("parseFilesystemDu accepts output without a header", () => {
  assertEquals(parseFilesystemDu("1 2 3 /a").exclusiveBytes, 2);
});

Deno.test("parseFilesystemDu rejects empty output", () => {
  assertThrows(
    () => parseFilesystemDu(""),
    SnapshotSizeError,
    "no size information",
  );
  assertThrows(
    () => parseFilesystemDu(HEADER),
    SnapshotSizeError,
    "no size information",
  );
});

Deno.test("parseFilesystemDu rejects an unexpected row", () => {
  assertThrows(
    () => parseFilesystemDu(`${HEADER}not numbers here\n`),
    SnapshotSizeError,
    "Unexpected output",
  );
});

Deno.test("parseFilesystemDu rejects values beyond the safe integer range", () => {
  assertThrows(
    () => parseFilesystemDu("99999999999999999999 1 1 /a"),
    SnapshotSizeError,
    "out of range",
  );
});

Deno.test("calculateSnapshotSize returns the parsed sizes with the requested path", async () => {
  const run: DuRunner = (path) => {
    assertEquals(path, "/home/alice/.snapshots/x");
    return Promise.resolve({
      stdout: `${HEADER}100  40  60  /home/alice/.snapshots/x\n`,
      stderr: "",
    });
  };
  assertEquals(
    await calculateSnapshotSize("/home/alice/.snapshots/x", { run }),
    {
      path: "/home/alice/.snapshots/x",
      totalBytes: 100,
      exclusiveBytes: 40,
      sharedBytes: 60,
    },
  );
});

Deno.test("calculateSnapshotSize reports a timeout when the run never finishes", async () => {
  const run: DuRunner = (_path, signal) =>
    new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason));
    });
  await assertRejects(
    () => calculateSnapshotSize("/a", { run, timeoutMs: 20 }),
    SnapshotSizeError,
    "timed out after 20ms",
  );
});

Deno.test("calculateSnapshotSize passes an abort signal that expires", async () => {
  let observed: AbortSignal | null = null;
  const run: DuRunner = (_path, signal) => {
    observed = signal;
    return Promise.resolve({ stdout: `${HEADER}1 1 0 /a\n`, stderr: "" });
  };
  await calculateSnapshotSize("/a", { run, timeoutMs: 5000 });
  assertEquals((observed as AbortSignal | null)?.aborted, false);
});

Deno.test("calculateSnapshotSize surfaces the command error message", async () => {
  const run: DuRunner = () =>
    Promise.reject(new SnapshotSizeError("not a btrfs filesystem: /tmp"));
  await assertRejects(
    () => calculateSnapshotSize("/tmp", { run }),
    SnapshotSizeError,
    "not a btrfs filesystem",
  );
});

Deno.test("calculateSnapshotSize wraps unexpected failures", async () => {
  const run: DuRunner = () => Promise.reject(new Error("spawn failed"));
  await assertRejects(
    () => calculateSnapshotSize("/tmp", { run }),
    SnapshotSizeError,
    "spawn failed",
  );
});

Deno.test("assertValidSnapshotPath accepts an absolute path", () => {
  assertValidSnapshotPath("/home/alice/.snapshots/x");
});

Deno.test("assertValidSnapshotPath rejects relative and empty paths", () => {
  assertThrows(() => assertValidSnapshotPath("relative/x"), SnapshotSizeError);
  assertThrows(() => assertValidSnapshotPath(""), SnapshotSizeError);
});

Deno.test("assertValidSnapshotPath rejects NUL bytes and overlong paths", () => {
  assertThrows(() => assertValidSnapshotPath("/a\0b"), SnapshotSizeError);
  assertThrows(
    () => assertValidSnapshotPath(`/${"a".repeat(4096)}`),
    SnapshotSizeError,
  );
});
