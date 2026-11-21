/// <reference lib="deno.ns" />
import { assertEquals, assertStrictEquals } from "@std/assert";
import {
  buildSubvolumeTree,
  excludeSnapshots,
  groupByFilesystem,
  isSnapshot,
  listBtrfsVolumes,
  parseMountInfo,
  parseSubvolumeList,
  type SubvolumeRecord,
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
  "ID 256 gen 9 cgen 5 parent 5 top level 5 parent_uuid - received_uuid - uuid 1111-root path root",
  "ID 257 gen 12 cgen 6 parent 5 top level 5 parent_uuid - received_uuid - uuid 2222-home path home",
  "ID 258 gen 14 cgen 14 parent 257 top level 257 parent_uuid 2222-home received_uuid - uuid 3333-snap path home/.snapshots/1",
  "ID 259 gen 15 cgen 15 parent 5 top level 5 parent_uuid - received_uuid - uuid 4444-var path <FS_TREE>/var/lib",
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

Deno.test("parseSubvolumeList reads ids, parents, paths and uuids", () => {
  const records = parseSubvolumeList(SUBVOLUME_LIST);
  assertEquals(records, [
    {
      id: 256,
      parentId: 5,
      path: "root",
      uuid: "1111-root",
      parentUuid: null,
      receivedUuid: null,
    },
    {
      id: 257,
      parentId: 5,
      path: "home",
      uuid: "2222-home",
      parentUuid: null,
      receivedUuid: null,
    },
    {
      id: 258,
      parentId: 257,
      path: "home/.snapshots/1",
      uuid: "3333-snap",
      parentUuid: "2222-home",
      receivedUuid: null,
    },
    {
      id: 259,
      parentId: 5,
      path: "var/lib",
      uuid: "4444-var",
      parentUuid: null,
      receivedUuid: null,
    },
  ]);
});

Deno.test("parseSubvolumeList reads received_uuid and treats '-' as null", () => {
  const [received] = parseSubvolumeList(
    "ID 300 gen 1 cgen 1 parent 5 top level 5 parent_uuid - received_uuid abcd-recv uuid 9999 path backup/recv",
  );
  assertEquals(received.receivedUuid, "abcd-recv");
  assertEquals(received.parentUuid, null);
  assertEquals(received.uuid, "9999");
  assertEquals(received.path, "backup/recv");
});

Deno.test("parseSubvolumeList handles output without uuid columns", () => {
  const [record] = parseSubvolumeList(
    "ID 300 gen 1 parent 5 top level 5 path plain",
  );
  assertEquals(record, {
    id: 300,
    parentId: 5,
    path: "plain",
    uuid: null,
    parentUuid: null,
    receivedUuid: null,
  });
});

Deno.test("isSnapshot detects a parent uuid or a received uuid", () => {
  const base: SubvolumeRecord = {
    id: 1,
    parentId: 5,
    path: "x",
    uuid: "u",
    parentUuid: null,
    receivedUuid: null,
  };
  assertEquals(isSnapshot(base), false);
  assertEquals(isSnapshot({ ...base, parentUuid: "p" }), true);
  assertEquals(isSnapshot({ ...base, receivedUuid: "r" }), true);
});

Deno.test("excludeSnapshots drops snapshots and received subvolumes", () => {
  const kept = excludeSnapshots(parseSubvolumeList(SUBVOLUME_LIST));
  assertEquals(kept.map((r) => r.id), [256, 257, 259]);
});

Deno.test("excludeSnapshots re-parents regular subvolumes under an excluded snapshot to its nearest kept ancestor", () => {
  const records = parseSubvolumeList([
    "ID 257 gen 1 cgen 1 parent 5 top level 5 parent_uuid - received_uuid - uuid a path home",
    "ID 260 gen 2 cgen 2 parent 257 top level 257 parent_uuid a received_uuid - uuid b path home/snap",
    "ID 261 gen 3 cgen 3 parent 260 top level 257 parent_uuid - received_uuid - uuid c path home/snap/work",
    "ID 262 gen 4 cgen 4 parent 261 top level 257 parent_uuid - received_uuid - uuid d path home/snap/work/deep",
  ].join("\n"));
  const kept = excludeSnapshots(records);
  assertEquals(kept.map((r) => [r.id, r.parentId]), [
    [257, 5],
    [261, 257],
    [262, 261],
  ]);
});

Deno.test("excludeSnapshots re-parents to the top-level tree when no kept ancestor remains", () => {
  const kept = excludeSnapshots(parseSubvolumeList([
    "ID 300 gen 1 cgen 1 parent 5 top level 5 parent_uuid p received_uuid - uuid a path snap",
    "ID 301 gen 2 cgen 2 parent 300 top level 300 parent_uuid - received_uuid - uuid b path snap/child",
  ].join("\n")));
  assertEquals(kept.map((r) => [r.id, r.parentId]), [[301, 5]]);
});

Deno.test("excludeSnapshots keeps a regular subvolume that is mounted and nested in a snapshot tree", () => {
  const tree = buildSubvolumeTree(
    excludeSnapshots(parseSubvolumeList([
      "ID 257 gen 1 cgen 1 parent 5 top level 5 parent_uuid - received_uuid - uuid a path data",
      "ID 258 gen 2 cgen 2 parent 257 top level 257 parent_uuid a received_uuid - uuid b path data/.snap/1",
      "ID 259 gen 3 cgen 3 parent 258 top level 257 parent_uuid - received_uuid - uuid c path data/.snap/1/var",
    ].join("\n"))),
    new Map([[259, ["/var"]]]),
  );
  assertEquals(tree.map((n) => n.id), [257]);
  assertEquals(tree[0].children.map((n) => n.id), [259]);
  assertEquals(tree[0].children[0].mountPoints, ["/var"]);
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
    {
      id: 257,
      parentId: 5,
      path: "home",
      uuid: null,
      parentUuid: null,
      receivedUuid: null,
    },
    {
      id: 259,
      parentId: 257,
      path: "work",
      uuid: null,
      parentUuid: null,
      receivedUuid: null,
    },
    {
      id: 260,
      parentId: 259,
      path: "work/nested",
      uuid: null,
      parentUuid: null,
      receivedUuid: null,
    },
  ]);
  assertEquals(tree.map((n) => n.id), [257]);
  assertEquals(tree[0].children.map((n) => n.id), [259]);
  assertEquals(tree[0].children[0].children.map((n) => n.id), [260]);
});

Deno.test("buildSubvolumeTree makes subvolumes with a missing parent roots", () => {
  const tree = buildSubvolumeTree([{
    id: 300,
    parentId: 999,
    path: "orphan",
    uuid: null,
    parentUuid: null,
    receivedUuid: null,
  }]);
  assertEquals(tree.map((n) => n.id), [300]);
});

Deno.test("buildSubvolumeTree does not loop when a subvolume is its own parent", () => {
  const tree = buildSubvolumeTree([{
    id: 300,
    parentId: 300,
    path: "self",
    uuid: null,
    parentUuid: null,
    receivedUuid: null,
  }]);
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
  assertEquals(root.subvolumes[0].children, []);

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
