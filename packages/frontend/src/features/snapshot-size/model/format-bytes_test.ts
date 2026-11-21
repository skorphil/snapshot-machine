import { assertEquals } from "@std/assert";
import { formatBytes } from "./format-bytes.ts";

Deno.test("formatBytes prints plain bytes below one KiB", () => {
  assertEquals(formatBytes(0), "0 B");
  assertEquals(formatBytes(1023), "1023 B");
});

Deno.test("formatBytes keeps one decimal below ten units", () => {
  assertEquals(formatBytes(1536), "1.5 KiB");
  assertEquals(formatBytes(5 * 1024 * 1024), "5.0 MiB");
});

Deno.test("formatBytes rounds to whole units from ten upwards", () => {
  assertEquals(formatBytes(20 * 1024 * 1024 * 1024), "20 GiB");
  assertEquals(formatBytes(8412565504), "7.8 GiB");
});

Deno.test("formatBytes stops at the largest unit", () => {
  assertEquals(formatBytes(2 * 1024 ** 5), "2.0 PiB");
});

Deno.test("formatBytes rejects invalid counts", () => {
  assertEquals(formatBytes(-1), "—");
  assertEquals(formatBytes(Number.NaN), "—");
});
