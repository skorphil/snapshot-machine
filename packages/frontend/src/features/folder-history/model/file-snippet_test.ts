/// <reference lib="deno.ns" />
import { assertEquals } from "@std/assert";
import type {
  FileHistoryEntry,
  FileVersion,
} from "@snapshot-machine/shared/types.ts";
import {
  deduplicateVersions,
  formatEditedDate,
  formatVersionCount,
  formatVersionDateTime,
  formatVersionTime,
  splitFileName,
  summarizeEntry,
  summarizeVersion,
} from "./file-snippet.ts";

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

function entry(overrides: Partial<FileHistoryEntry> = {}): FileHistoryEntry {
  return {
    name: "report.txt",
    path: "report.txt",
    ino: "1",
    type: "file",
    deleted: false,
    lastSeen: "home.20261107T1700",
    versions: [],
    ...overrides,
  };
}

Deno.test("splitFileName separates stem and extension", () => {
  assertEquals(splitFileName("report.final.pdf"), {
    stem: "report.final",
    extension: "pdf",
  });
});

Deno.test("splitFileName keeps names without an extension whole", () => {
  assertEquals(splitFileName("Makefile"), { stem: "Makefile", extension: "" });
  assertEquals(splitFileName(".bashrc"), { stem: ".bashrc", extension: "" });
  assertEquals(splitFileName("trailing."), {
    stem: "trailing.",
    extension: "",
  });
});

Deno.test("formatEditedDate prints day, month and year", () => {
  const date = new Date(2026, 10, 7, 9, 5);
  assertEquals(formatEditedDate(date), "07 Nov 2026");
});

Deno.test("formatEditedDate reports unknown values", () => {
  assertEquals(formatEditedDate(null), "Unknown date");
  assertEquals(formatEditedDate("garbage"), "Unknown date");
});

Deno.test("formatVersionTime prints zero-padded 24-hour HH:MM", () => {
  assertEquals(formatVersionTime(new Date(2026, 0, 1, 9, 5)), "09:05");
  assertEquals(formatVersionTime(new Date(2026, 0, 1, 23, 59)), "23:59");
  assertEquals(formatVersionTime(undefined), "--:--");
});

Deno.test("formatVersionCount pluralises correctly", () => {
  assertEquals(formatVersionCount(1), "1 version");
  assertEquals(formatVersionCount(0), "0 versions");
  assertEquals(formatVersionCount(4), "4 versions");
});

Deno.test("summarizeEntry uses the newest version for date and size", () => {
  const newest = version({
    mtime: new Date(2026, 10, 7, 12, 0).toISOString(),
    size: 2.5 * 1024 * 1024,
  });
  const older = version({
    snapshot: "home.20261001T1700",
    mtime: new Date(2026, 9, 1, 12, 0).toISOString(),
    size: 10,
  });
  const summary = summarizeEntry(
    entry({ versions: [newest, older] }),
  );

  assertEquals(summary.stem, "report");
  assertEquals(summary.extension, "txt");
  assertEquals(summary.versionCount, 2);
  assertEquals(summary.editedLabel, "07 Nov 2026");
  assertEquals(summary.sizeLabel, "2.5 MiB");
  assertEquals(summary.deleted, false);
});

Deno.test("summarizeEntry handles entries without versions", () => {
  const summary = summarizeEntry(entry({ deleted: true }));
  assertEquals(summary.versionCount, 0);
  assertEquals(summary.editedLabel, "Unknown date");
  assertEquals(summary.sizeLabel, "0 B");
  assertEquals(summary.deleted, true);
});

Deno.test("summarizeVersion formats date, time and size", () => {
  const summary = summarizeVersion(
    version({
      birthtime: new Date(2026, 10, 7, 14, 30).toISOString(),
      size: 1536,
    }),
  );
  assertEquals(summary, {
    dateTimeLabel: "07 Nov 2026, 14:30",
    sizeLabel: "1.5 KiB",
  });
});

Deno.test("formatVersionDateTime joins date and 24-hour time", () => {
  assertEquals(
    formatVersionDateTime(new Date(2026, 10, 7, 14, 30)),
    "07 Nov 2026, 14:30",
  );
  assertEquals(
    formatVersionDateTime(new Date(2026, 0, 1, 0, 5)),
    "01 Jan 2026, 00:05",
  );
  assertEquals(
    formatVersionDateTime(new Date(2026, 11, 31, 23, 59)),
    "31 Dec 2026, 23:59",
  );
});

Deno.test("formatVersionDateTime reports unknown values", () => {
  assertEquals(formatVersionDateTime(null), "Unknown date");
  assertEquals(formatVersionDateTime(undefined), "Unknown date");
  assertEquals(formatVersionDateTime(""), "Unknown date");
  assertEquals(formatVersionDateTime("garbage"), "Unknown date");
});

Deno.test("deduplicateVersions keeps the newest of identical file states", () => {
  const mtime = new Date(2026, 9, 1, 12, 0).toISOString();
  const versions = [
    version({ snapshot: "home.20261103T1000", mtime, size: 10 }),
    version({ snapshot: "home.20261102T1000", mtime, size: 10 }),
    version({ snapshot: "home.20261101T1000", mtime, size: 10 }),
  ];
  assertEquals(deduplicateVersions(versions), [versions[0]]);
});

Deno.test("deduplicateVersions keeps versions whose mtime or size differ", () => {
  const first = new Date(2026, 9, 1, 12, 0).toISOString();
  const second = new Date(2026, 9, 2, 12, 0).toISOString();
  const versions = [
    version({ snapshot: "s3", mtime: second, size: 10 }),
    version({ snapshot: "s2", mtime: first, size: 10 }),
    version({ snapshot: "s1", mtime: first, size: 11 }),
    version({ snapshot: "s0", mtime: first, size: 10 }),
  ];
  assertEquals(
    deduplicateVersions(versions).map((v) => v.snapshot),
    ["s3", "s2", "s1"],
  );
});

Deno.test("deduplicateVersions keeps a changed file that reverts to an earlier state", () => {
  const a = new Date(2026, 9, 1, 12, 0).toISOString();
  const b = new Date(2026, 9, 2, 12, 0).toISOString();
  const versions = [
    version({ snapshot: "s3", mtime: a, size: 10 }),
    version({ snapshot: "s2", mtime: b, size: 10 }),
    version({ snapshot: "s1", mtime: a, size: 10 }),
  ];
  assertEquals(
    deduplicateVersions(versions).map((v) => v.snapshot),
    ["s3", "s2"],
  );
});

Deno.test("deduplicateVersions never merges versions without an mtime", () => {
  const versions = [
    version({ snapshot: "s2", mtime: null, size: 10 }),
    version({ snapshot: "s1", mtime: null, size: 10 }),
  ];
  assertEquals(deduplicateVersions(versions), versions);
});

Deno.test("deduplicateVersions returns an empty list for no versions", () => {
  assertEquals(deduplicateVersions([]), []);
});

Deno.test("deduplicateVersions does not mutate its input", () => {
  const mtime = new Date(2026, 9, 1, 12, 0).toISOString();
  const versions = [
    version({ snapshot: "s2", mtime, size: 10 }),
    version({ snapshot: "s1", mtime, size: 10 }),
  ];
  const copy = [...versions];
  deduplicateVersions(versions);
  assertEquals(versions, copy);
});

Deno.test("summarizeEntry counts only distinct versions", () => {
  const mtime = new Date(2026, 10, 7, 12, 0).toISOString();
  const older = new Date(2026, 9, 1, 12, 0).toISOString();
  const summary = summarizeEntry(
    entry({
      versions: [
        version({ snapshot: "s4", mtime, size: 5 }),
        version({ snapshot: "s3", mtime, size: 5 }),
        version({ snapshot: "s2", mtime: older, size: 5 }),
        version({ snapshot: "s1", mtime: older, size: 5 }),
      ],
    }),
  );
  assertEquals(summary.versionCount, 2);
  assertEquals(formatVersionCount(summary.versionCount), "2 versions");
});
