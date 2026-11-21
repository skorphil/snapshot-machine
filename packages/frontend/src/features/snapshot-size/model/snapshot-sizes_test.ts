/// <reference lib="deno.ns" />
import { assertEquals } from "@std/assert";
import { elapsedSeconds, summarizeSnapshotSizes } from "./snapshot-sizes.ts";

const ready = (path: string, totalBytes: number, exclusiveBytes: number) => ({
  status: "ready" as const,
  size: { path, totalBytes, exclusiveBytes },
});

Deno.test("summarizeSnapshotSizes sums measured snapshots only", () => {
  const totals = summarizeSnapshotSizes([
    ready("/a", 100, 40),
    { status: "error", message: "timed out" },
    { status: "measuring" },
    undefined,
    ready("/b", 50, 10),
  ]);
  assertEquals(totals, {
    totalBytes: 150,
    exclusiveBytes: 50,
    snapshots: 5,
    measured: 2,
    failed: 1,
  });
});

Deno.test("summarizeSnapshotSizes returns zeros for no snapshots", () => {
  assertEquals(summarizeSnapshotSizes([]), {
    totalBytes: 0,
    exclusiveBytes: 0,
    snapshots: 0,
    measured: 0,
    failed: 0,
  });
});

Deno.test("elapsedSeconds counts whole seconds since the start", () => {
  assertEquals(elapsedSeconds(1_000, 3_999), 2);
  assertEquals(elapsedSeconds(1_000, 4_000), 3);
});

Deno.test("elapsedSeconds is zero for an unknown or future start", () => {
  assertEquals(elapsedSeconds(undefined, 5_000), 0);
  assertEquals(elapsedSeconds(9_000, 5_000), 0);
});
