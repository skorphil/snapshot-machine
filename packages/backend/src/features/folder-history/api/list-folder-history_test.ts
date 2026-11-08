/// <reference lib="deno.ns" />
import { assertEquals } from "@std/assert";
import { resolveVolumeRelativePath } from "./list-folder-history.ts";

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
