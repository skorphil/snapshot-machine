/// <reference lib="deno.ns" />
import { assertEquals } from "@std/assert";
import { resolveSnapshotLocations } from "./list-snapshot-locations.ts";

Deno.test("resolveSnapshotLocations resolves relative and absolute snapshot_dir", () => {
  const locations = resolveSnapshotLocations({
    volumes: [
      { path: "/", snapshotDir: "/.snapshots", subvolumes: [], targets: [] },
      { path: "/home", snapshotDir: ".snaps", subvolumes: [], targets: [] },
    ],
  });
  assertEquals(locations, [
    { kind: "snapshot_dir", volumePath: "/", path: "/.snapshots" },
    { kind: "snapshot_dir", volumePath: "/home", path: "/home/.snaps" },
  ]);
});

Deno.test("resolveSnapshotLocations skips volumes without snapshot_dir or targets", () => {
  const locations = resolveSnapshotLocations({
    volumes: [
      { path: "/data", subvolumes: [], targets: [] },
      { path: "/srv", snapshotDir: "snap", subvolumes: [], targets: [] },
    ],
  });
  assertEquals(locations, [
    { kind: "snapshot_dir", volumePath: "/srv", path: "/srv/snap" },
  ]);
});

Deno.test("resolveSnapshotLocations includes local targets and subvolume locations", () => {
  const locations = resolveSnapshotLocations({
    volumes: [
      {
        path: "/data",
        snapshotDir: ".snapshots",
        targets: ["/mnt/usb"],
        subvolumes: [
          { path: "docs", snapshotDir: ".docs", targets: ["/mnt/docs"] },
        ],
      },
    ],
  });
  assertEquals(locations, [
    { kind: "snapshot_dir", volumePath: "/data", path: "/data/.snapshots" },
    { kind: "target", volumePath: "/data", path: "/mnt/usb" },
    { kind: "snapshot_dir", volumePath: "/data", path: "/data/.docs" },
    { kind: "target", volumePath: "/data", path: "/mnt/docs" },
  ]);
});

Deno.test("resolveSnapshotLocations deduplicates repeated locations of one kind", () => {
  const locations = resolveSnapshotLocations({
    volumes: [
      {
        path: "/data",
        snapshotDir: ".snapshots",
        targets: ["/mnt/usb", "/mnt/usb"],
        subvolumes: [],
      },
      { path: "/data", snapshotDir: ".snapshots", subvolumes: [], targets: [] },
    ],
  });
  assertEquals(locations, [
    { kind: "snapshot_dir", volumePath: "/data", path: "/data/.snapshots" },
    { kind: "target", volumePath: "/data", path: "/mnt/usb" },
  ]);
});

Deno.test("resolveSnapshotLocations returns an empty list without volumes", () => {
  assertEquals(resolveSnapshotLocations({ volumes: [] }), []);
});
