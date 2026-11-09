/// <reference lib="deno.ns" />
import { assertEquals, assertThrows } from "@std/assert";
import type { DependencyReport } from "@snapshot-machine/shared/types.ts";
import {
  assertReportAvailable,
  checkDependencies,
  describeSpawnError,
  missingDependencies,
  parseBtrbkVersion,
  parseBtrfsVersion,
} from "./check-dependencies.ts";

Deno.test("parseBtrbkVersion extracts the version number", () => {
  assertEquals(
    parseBtrbkVersion("btrbk command line client, version 0.32.7\n"),
    "0.32.7",
  );
});

Deno.test("parseBtrbkVersion returns null for unrelated output", () => {
  assertEquals(parseBtrbkVersion("usage: something else"), null);
});

Deno.test("parseBtrfsVersion extracts the btrfs-progs version", () => {
  assertEquals(parseBtrfsVersion("btrfs-progs v7.1\n-EXPERIMENTAL"), "7.1");
});

Deno.test("parseBtrfsVersion returns null for unrelated output", () => {
  assertEquals(parseBtrfsVersion(""), null);
});

Deno.test("describeSpawnError explains a missing binary", () => {
  assertEquals(
    describeSpawnError(new Deno.errors.NotFound("no such file")),
    "not found in PATH",
  );
});

Deno.test("describeSpawnError explains a non-executable binary", () => {
  assertEquals(
    describeSpawnError(new Deno.errors.PermissionDenied("denied")),
    "not executable (permission denied)",
  );
});

Deno.test("missingDependencies lists only unavailable tools", () => {
  const report: DependencyReport = {
    ok: false,
    dependencies: [
      { name: "btrbk", available: true, version: "0.32.7", error: null },
      { name: "btrfs", available: false, version: null, error: "not found" },
    ],
  };
  assertEquals(missingDependencies(report), ["btrfs"]);
});

Deno.test("assertReportAvailable throws naming every missing tool", () => {
  const report: DependencyReport = {
    ok: false,
    dependencies: [
      { name: "btrbk", available: false, version: null, error: "not found" },
      { name: "btrfs", available: false, version: null, error: "not found" },
    ],
  };
  assertThrows(
    () => assertReportAvailable(report),
    Error,
    "Missing required dependencies: btrbk, btrfs",
  );
});

Deno.test("assertReportAvailable passes when all tools are available", () => {
  const report: DependencyReport = {
    ok: true,
    dependencies: [
      { name: "btrbk", available: true, version: "0.32.7", error: null },
      { name: "btrfs", available: true, version: "7.1", error: null },
    ],
  };
  assertReportAvailable(report);
});

Deno.test("checkDependencies reports both required tools", async () => {
  const report = await checkDependencies();
  assertEquals(
    report.dependencies.map((dependency) => dependency.name),
    ["btrbk", "btrfs"],
  );
  assertEquals(report.ok, missingDependencies(report).length === 0);
});
