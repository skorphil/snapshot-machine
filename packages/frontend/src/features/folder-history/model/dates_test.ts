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

Deno.test("selects the newest valid filesystem timestamp", () => {
  const all = version({ birthtime: T_BIRTH, ctime: T_CTIME, mtime: T_MTIME });
  assertEquals(getDisplayDate(all)?.getTime(), iso(T_CTIME));

  const noCtime = version({ birthtime: T_BIRTH, mtime: T_MTIME });
  assertEquals(getDisplayDate(noCtime)?.getTime(), iso(T_BIRTH));

  const onlyMtime = version({ mtime: T_MTIME });
  assertEquals(getDisplayDate(onlyMtime)?.getTime(), iso(T_MTIME));
});

Deno.test("an older mtime does not hide a newer birthtime or ctime", () => {
  const v = version({ mtime: T_MTIME, birthtime: T_BIRTH, ctime: T_CTIME });
  assertEquals(getDisplayDate(v)?.getTime(), iso(T_CTIME));

  const newerMtime = version({ mtime: T_CTIME, birthtime: T_BIRTH });
  assertEquals(getDisplayDate(newerMtime)?.getTime(), iso(T_CTIME));
});

Deno.test("invalid candidates are skipped, not returned", () => {
  const v = version({ birthtime: "not-a-date", ctime: "", mtime: T_MTIME });
  assertEquals(getDisplayDate(v)?.getTime(), iso(T_MTIME));
});

Deno.test("returns null only when every timestamp is missing or invalid", () => {
  assertEquals(getDisplayDate(version()), null);
  const bad = version({
    mtime: "garbage",
    ctime: "??",
    birthtime: "",
    snapshotDate: "nope",
  });
  assertEquals(getDisplayDate(bad), null);
});

Deno.test("falls back to snapshotDate when no filesystem timestamp is valid", () => {
  const onlySnap = version({ snapshotDate: T_SNAP });
  assertEquals(getDisplayDate(onlySnap)?.getTime(), iso(T_SNAP));

  const invalidFs = version({
    mtime: "garbage",
    ctime: "",
    birthtime: null,
    snapshotDate: T_SNAP,
  });
  assertEquals(getDisplayDate(invalidFs)?.getTime(), iso(T_SNAP));
});

Deno.test("the newest of all candidates wins, including snapshotDate", () => {
  const snapNewer = version({
    birthtime: T_BIRTH,
    mtime: T_MTIME,
    snapshotDate: T_SNAP,
  });
  assertEquals(getDisplayDate(snapNewer)?.getTime(), iso(T_SNAP));

  const fsNewer = version({ mtime: T_MTIME, snapshotDate: T_BIRTH });
  assertEquals(getDisplayDate(fsNewer)?.getTime(), iso(T_BIRTH));
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
