/// <reference lib="deno.ns" />
import { assertEquals, assertStrictEquals } from "@std/assert";
import {
  buildSubvolumeTree,
  groupByFilesystem,
  listBtrfsVolumes,
  parseMountInfo,
  parseSubvolumeList,
  unescapeMountPath,
} from "./btrfs.ts";

const MOUNTINFO = [
  "46 1 0:37 /root / rw,relatime shared:1 - btrfs /dev/mapper/root rw,compress=zstd:1,subvolid=256,subvol=/root",
  "61 46 0:37 /home /home rw,relatime shared:125 - btrfs /dev/mapper/root rw,subvolid=257,subvol=/home",
  "62 46 0:37 /mnt/my\\040backups /mnt/my\\040backups rw - btrfs /dev/mapper/root rw,subvolid=258,subvol=/backups",
  "70 46 8:2 / /boot rw - ext4 /dev/sda2 rw",
  "71 46 0:41 / /data rw - btrfs /dev/sdb1 rw,subvolid=5,subvol=/",
  "bogus line without separator",
].join("\n");

const SUBVOLUME_LIST = [
  "ID 256 gen 9 parent 5 top level 5 path root",
  "ID 257 gen 12 parent 5 top level 5 path home",
  "ID 258 gen 14 parent 257 top level 257 path home/.snapshots/1",
  "ID 259 gen 15 parent 5 top level 5 path <FS_TREE>/var/lib",
].join("\n");

Deno.test("unescapeMountPath decodes octal escapes", () => {
  assertEquals(unescapeMountPath("/mnt/my\\040backups"), "/mnt/my backups");
  assertEquals(unescapeMountPath("/plain"), "/plain");
});

Deno.test("parseMountInfo keeps only btrfs entries with mount point and subvolid", () => {
  const mounts = parseMountInfo(MOUNTINFO);
  assertEquals(mounts.map((m) => m.mountPoint), [
    "/",
    "/home",
    "/mnt/my backups",
    "/data",
  ]);
  assertEquals(mounts[0], {
    superblock: "0:37",
    device: "/dev/mapper/root",
    mountPoint: "/",
    subvolId: 256,
  });
  assertEquals(mounts[3].subvolId, 5);
});

Deno.test("parseMountInfo leaves subvolId null when the option is absent", () => {
  const [mount] = parseMountInfo(
    "80 46 0:50 / /srv rw - btrfs /dev/sdc rw,compress=zstd",
  );
  assertStrictEquals(mount.subvolId, null);
});

Deno.test("groupByFilesystem merges mounts of one superblock and records subvolume mounts", () => {
  const filesystems = groupByFilesystem(parseMountInfo([
    "46 1 0:37 /root / rw - btrfs /dev/mapper/root rw,subvolid=256",
    "61 46 0:37 /home /home rw - btrfs /dev/mapper/root rw,subvolid=257",
    "62 46 0:37 /home /var/home rw - btrfs /dev/mapper/root rw,subvolid=257",
    "71 46 0:41 / /data rw - btrfs /dev/sdb1 rw,subvolid=5",
  ].join("\n")));
  assertEquals(filesystems.length, 2);
  assertEquals(filesystems[0].device, "/dev/mapper/root");
  assertEquals(filesystems[0].listingMountPoint, "/");
  assertEquals(filesystems[0].mountPoints, ["/", "/home", "/var/home"]);
  assertEquals(filesystems[0].mountsBySubvolId.get(257), [
    "/home",
    "/var/home",
  ]);
  assertEquals(filesystems[1].mountsBySubvolId.get(5), ["/data"]);
});

Deno.test("parseSubvolumeList reads ids, parents and paths", () => {
  const records = parseSubvolumeList(SUBVOLUME_LIST);
  assertEquals(records, [
    { id: 256, parentId: 5, path: "root" },
    { id: 257, parentId: 5, path: "home" },
    { id: 258, parentId: 257, path: "home/.snapshots/1" },
    { id: 259, parentId: 5, path: "var/lib" },
  ]);
});

Deno.test("parseSubvolumeList ignores lines it cannot parse", () => {
  const records = parseSubvolumeList(
    "garbage\n\nID 300 gen 1 parent 5 top level 5 path x\n",
  );
  assertEquals(records.map((r) => r.id), [300]);
});

Deno.test("buildSubvolumeTree renders every record and nests children under their parent ids", () => {
  const tree = buildSubvolumeTree(
    parseSubvolumeList(SUBVOLUME_LIST),
    new Map([[257, ["/home"]]]),
  );
  assertEquals(tree.map((n) => n.path), ["home", "root", "var/lib"]);
  const home = tree[0];
  assertEquals(home.mountPoints, ["/home"]);
  assertEquals(home.children.map((n) => n.id), [258]);
  assertEquals(home.children[0].path, "home/.snapshots/1");
  assertEquals(home.children[0].children, []);
});

Deno.test("buildSubvolumeTree nests a subvolume under its direct parent regardless of path", () => {
  const tree = buildSubvolumeTree([
    { id: 257, parentId: 5, path: "home" },
    { id: 259, parentId: 257, path: "work" },
    { id: 260, parentId: 259, path: "work/nested" },
  ]);
  assertEquals(tree.map((n) => n.id), [257]);
  assertEquals(tree[0].children.map((n) => n.id), [259]);
  assertEquals(tree[0].children[0].children.map((n) => n.id), [260]);
});

Deno.test("buildSubvolumeTree makes subvolumes with a missing parent roots", () => {
  const tree = buildSubvolumeTree([{ id: 300, parentId: 999, path: "orphan" }]);
  assertEquals(tree.map((n) => n.id), [300]);
});

Deno.test("buildSubvolumeTree does not loop when a subvolume is its own parent", () => {
  const tree = buildSubvolumeTree([{ id: 300, parentId: 300, path: "self" }]);
  assertEquals(tree.map((n) => n.id), [300]);
  assertEquals(tree[0].children, []);
});

Deno.test("listBtrfsVolumes builds one volume per filesystem with its tree", async () => {
  const calls: string[] = [];
  const volumes = await listBtrfsVolumes({
    readMountInfo: () => Promise.resolve(MOUNTINFO),
    listSubvolumes: (mountPoint) => {
      calls.push(mountPoint);
      return Promise.resolve(SUBVOLUME_LIST);
    },
  });

  assertEquals(volumes.length, 2);
  const [root, data] = volumes;
  assertEquals(root.device, "/dev/mapper/root");
  assertEquals(root.mountPoints, ["/", "/home", "/mnt/my backups"]);
  assertEquals(root.error, null);
  assertEquals(root.subvolumes.map((n) => n.path), ["home", "root", "var/lib"]);
  assertEquals(root.subvolumes[0].mountPoints, ["/home"]);
  assertEquals(root.subvolumes[0].children.map((n) => n.id), [258]);

  assertEquals(data.device, "/dev/sdb1");
  assertEquals(calls, ["/", "/data"]);
});

Deno.test("listBtrfsVolumes reports a per-volume error and keeps the other volumes", async () => {
  const volumes = await listBtrfsVolumes({
    readMountInfo: () => Promise.resolve(MOUNTINFO),
    listSubvolumes: (mountPoint) => {
      if (mountPoint === "/") {
        return Promise.reject(
          new Error("can't perform the search: Operation not permitted"),
        );
      }
      return Promise.resolve("");
    },
  });
  assertEquals(volumes.length, 2);
  assertEquals(volumes[0].subvolumes, []);
  assertEquals(
    volumes[0].error,
    "Cannot list subvolumes of /: can't perform the search: Operation not permitted",
  );
  assertEquals(volumes[1].error, null);
  assertEquals(volumes[1].subvolumes, []);
});

Deno.test("listBtrfsVolumes returns an empty list when no btrfs filesystem is mounted", async () => {
  const volumes = await listBtrfsVolumes({
    readMountInfo: () =>
      Promise.resolve("70 46 8:2 / /boot rw - ext4 /dev/sda2 rw\n"),
    listSubvolumes: () => Promise.reject(new Error("must not be called")),
  });
  assertEquals(volumes, []);
});

Deno.test("listBtrfsVolumes propagates a failure to read the mount table", async () => {
  let failed = false;
  try {
    await listBtrfsVolumes({
      readMountInfo: () => Promise.reject(new Deno.errors.NotFound("gone")),
    });
  } catch (error) {
    failed = error instanceof Deno.errors.NotFound;
  }
  assertStrictEquals(failed, true);
});
