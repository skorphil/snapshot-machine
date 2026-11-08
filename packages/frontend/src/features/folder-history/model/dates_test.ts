/// <reference lib="deno.ns" />
import { assertEquals } from "@std/assert";
import type { FileVersion } from "@snapshot-machine/shared/types.ts";
import { formatDate, getDisplayDate, parseValidDate } from "./dates.ts";

const T_BIRTH = "2026-10-31T17:13:44.651Z";
const T_CTIME = "2026-10-31T17:13:44.700Z";
const T_MTIME = "1998-07-12T17:27:06.000Z";
const T_SNAP = "2026-11-07T17:00:00.000Z";

function version(overrides: Partial<FileVersion> = {}): FileVersion {
  return {
    snapshot: "home.20261107T1700",
    path: "/x",
    snapshotDate: null,
    mtime: null,
    ctime: null,
    birthtime: null,
    size: 0,
    ...overrides,
  };
}

const iso = (s: string) => new Date(s).getTime();

Deno.test("arrival mode prefers birthtime, then ctime, then mtime", () => {
  const all = version({ birthtime: T_BIRTH, ctime: T_CTIME, mtime: T_MTIME });
  assertEquals(getDisplayDate(all, "arrival")?.getTime(), iso(T_BIRTH));

  const noBirth = version({ ctime: T_CTIME, mtime: T_MTIME });
  assertEquals(getDisplayDate(noBirth, "arrival")?.getTime(), iso(T_CTIME));

  const onlyMtime = version({ mtime: T_MTIME });
  assertEquals(getDisplayDate(onlyMtime, "arrival")?.getTime(), iso(T_MTIME));
});

Deno.test("modified mode prefers mtime, then ctime, then birthtime", () => {
  const all = version({ birthtime: T_BIRTH, ctime: T_CTIME, mtime: T_MTIME });
  assertEquals(getDisplayDate(all, "modified")?.getTime(), iso(T_MTIME));

  const noMtime = version({ birthtime: T_BIRTH, ctime: T_CTIME });
  assertEquals(getDisplayDate(noMtime, "modified")?.getTime(), iso(T_CTIME));

  const onlyBirth = version({ birthtime: T_BIRTH });
  assertEquals(getDisplayDate(onlyBirth, "modified")?.getTime(), iso(T_BIRTH));
});

Deno.test("invalid candidates are skipped, not returned", () => {
  const v = version({ birthtime: "not-a-date", ctime: "", mtime: T_MTIME });
  assertEquals(getDisplayDate(v, "arrival")?.getTime(), iso(T_MTIME));
});

Deno.test("returns null only when every timestamp is missing or invalid", () => {
  assertEquals(getDisplayDate(version(), "arrival"), null);
  assertEquals(getDisplayDate(version(), "modified"), null);
  const bad = version({
    mtime: "garbage",
    ctime: "??",
    birthtime: "",
    snapshotDate: "nope",
  });
  assertEquals(getDisplayDate(bad, "modified"), null);
});

Deno.test("falls back to snapshotDate when no filesystem timestamp is valid", () => {
  const onlySnap = version({ snapshotDate: T_SNAP });
  assertEquals(getDisplayDate(onlySnap, "arrival")?.getTime(), iso(T_SNAP));
  assertEquals(getDisplayDate(onlySnap, "modified")?.getTime(), iso(T_SNAP));

  const invalidFs = version({
    mtime: "garbage",
    ctime: "",
    birthtime: null,
    snapshotDate: T_SNAP,
  });
  assertEquals(getDisplayDate(invalidFs, "arrival")?.getTime(), iso(T_SNAP));
  assertEquals(getDisplayDate(invalidFs, "modified")?.getTime(), iso(T_SNAP));
});

Deno.test("filesystem timestamps take precedence over snapshotDate", () => {
  const v = version({
    birthtime: T_BIRTH,
    mtime: T_MTIME,
    snapshotDate: T_SNAP,
  });
  assertEquals(getDisplayDate(v, "arrival")?.getTime(), iso(T_BIRTH));
  assertEquals(getDisplayDate(v, "modified")?.getTime(), iso(T_MTIME));

  const onlyMtime = version({ mtime: T_MTIME, snapshotDate: T_SNAP });
  assertEquals(getDisplayDate(onlyMtime, "arrival")?.getTime(), iso(T_MTIME));
});

Deno.test("parseValidDate accepts Date objects as well as ISO strings", () => {
  assertEquals(parseValidDate(new Date(T_BIRTH))?.getTime(), iso(T_BIRTH));
  assertEquals(parseValidDate(T_BIRTH)?.getTime(), iso(T_BIRTH));
});

Deno.test("parseValidDate rejects empty, null and NaN-producing input", () => {
  assertEquals(parseValidDate(null), null);
  assertEquals(parseValidDate(undefined), null);
  assertEquals(parseValidDate("   "), null);
  assertEquals(parseValidDate(new Date("nope")), null);
  assertEquals(parseValidDate(T_MTIME)?.getTime(), iso(T_MTIME));
});

Deno.test("formatDate never returns 'Invalid Date'", () => {
  assertEquals(formatDate(null), "Unknown date");
  assertEquals(formatDate("garbage"), "Unknown date");
  assertEquals(formatDate(new Date("nope")), "Unknown date");
  assertEquals(formatDate(T_MTIME).includes("Invalid"), false);
});
