/// <reference lib="deno.ns" />
import { assertEquals, assertThrows } from "@std/assert";
import { HelperUnavailableError } from "@snapshot-machine/backend/shared/helper/index.ts";
import { parseBtrfsVolumes } from "./list-btrfs-volumes.ts";

const VALID = [
  {
    device: "/dev/mapper/root",
    mountPoints: ["/", "/home"],
    subvolumes: [
      {
        id: 257,
        parentId: 5,
        path: "home",
        mountPoints: ["/home"],
        children: [
          {
            id: 259,
            parentId: 257,
            path: "home/work",
            mountPoints: [],
            children: [],
          },
        ],
      },
    ],
    error: null,
  },
  {
    device: "/dev/sdb1",
    mountPoints: ["/data"],
    subvolumes: [],
    error: "Cannot list subvolumes of /data: Operation not permitted",
  },
];

Deno.test("parseBtrfsVolumes accepts a valid document and keeps the nested tree", () => {
  const volumes = parseBtrfsVolumes(JSON.stringify(VALID));
  assertEquals(volumes, VALID);
  assertEquals(volumes[0].subvolumes[0].children[0].path, "home/work");
});

Deno.test("parseBtrfsVolumes accepts an empty list", () => {
  assertEquals(parseBtrfsVolumes("[]"), []);
});

Deno.test("parseBtrfsVolumes rejects a payload that is not a string", () => {
  assertThrows(() => parseBtrfsVolumes(42), HelperUnavailableError);
});

Deno.test("parseBtrfsVolumes rejects invalid JSON", () => {
  assertThrows(() => parseBtrfsVolumes("[{"), HelperUnavailableError);
});

Deno.test("parseBtrfsVolumes rejects a document that is not an array", () => {
  assertThrows(() => parseBtrfsVolumes("{}"), HelperUnavailableError);
});

Deno.test("parseBtrfsVolumes names the field that has the wrong type", () => {
  const broken = structuredClone(VALID);
  (broken[0].subvolumes[0].children[0] as Record<string, unknown>).path = 7;
  assertThrows(
    () => parseBtrfsVolumes(JSON.stringify(broken)),
    HelperUnavailableError,
    "subvolumes[0].children[0].path",
  );
});

Deno.test("parseBtrfsVolumes rejects a non-integer subvolume id", () => {
  const broken = structuredClone(VALID);
  broken[0].subvolumes[0].id = 1.5;
  assertThrows(
    () => parseBtrfsVolumes(JSON.stringify(broken)),
    HelperUnavailableError,
    ".id",
  );
});

Deno.test("parseBtrfsVolumes rejects a volume error that is neither string nor null", () => {
  const broken = structuredClone(VALID) as Array<Record<string, unknown>>;
  broken[1].error = 7;
  assertThrows(
    () => parseBtrfsVolumes(JSON.stringify(broken)),
    HelperUnavailableError,
    "[1].error",
  );
});

Deno.test("parseBtrfsVolumes rejects mount points that are not strings", () => {
  const broken = structuredClone(VALID) as Array<Record<string, unknown>>;
  broken[0].mountPoints = ["/", 3];
  assertThrows(
    () => parseBtrfsVolumes(JSON.stringify(broken)),
    HelperUnavailableError,
    "[0].mountPoints",
  );
});
