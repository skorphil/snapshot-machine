import type {
  BtrfsSubvolume,
  BtrfsVolume,
} from "@snapshot-machine/shared/types.ts";
import {
  HelperUnavailableError,
  withHelper,
} from "@snapshot-machine/backend/shared/helper/index.ts";

/** Returns true when `value` is a plain (non-array, non-null) object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Returns true when `value` is an array of strings. */
function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) &&
    value.every((item) => typeof item === "string");
}

/** Throws a helper error naming the offending field. */
function invalid(field: string): never {
  throw new HelperUnavailableError(
    `Root Helper returned an invalid btrfs volume list (${field})`,
  );
}

/** Validates one subvolume node and its descendants. */
function parseSubvolume(value: unknown, field: string): BtrfsSubvolume {
  if (!isRecord(value)) invalid(field);
  const { id, parentId, path, mountPoints, children } = value;
  if (typeof id !== "number" || !Number.isInteger(id)) invalid(`${field}.id`);
  if (typeof parentId !== "number" || !Number.isInteger(parentId)) {
    invalid(`${field}.parentId`);
  }
  if (typeof path !== "string") invalid(`${field}.path`);
  if (!isStringArray(mountPoints)) invalid(`${field}.mountPoints`);
  if (!Array.isArray(children)) invalid(`${field}.children`);
  return {
    id,
    parentId,
    path,
    mountPoints,
    children: children.map((child, index) =>
      parseSubvolume(child, `${field}.children[${index}]`)
    ),
  };
}

/** Validates one volume entry. */
function parseVolume(value: unknown, index: number): BtrfsVolume {
  const field = `[${index}]`;
  if (!isRecord(value)) invalid(field);
  const { device, mountPoints, subvolumes, error } = value;
  if (typeof device !== "string") invalid(`${field}.device`);
  if (!isStringArray(mountPoints)) invalid(`${field}.mountPoints`);
  if (!Array.isArray(subvolumes)) invalid(`${field}.subvolumes`);
  if (error !== null && typeof error !== "string") invalid(`${field}.error`);
  return {
    device,
    mountPoints,
    subvolumes: subvolumes.map((node, nodeIndex) =>
      parseSubvolume(node, `${field}.subvolumes[${nodeIndex}]`)
    ),
    error,
  };
}

/**
 * Parses the JSON document returned by the helper's `ListBtrfsVolumes` method.
 *
 * @throws {HelperUnavailableError} If the document is not valid JSON or does not match {@link BtrfsVolume}[].
 */
export function parseBtrfsVolumes(json: unknown): BtrfsVolume[] {
  if (typeof json !== "string") invalid("payload");
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    invalid("payload");
  }
  if (!Array.isArray(parsed)) invalid("payload");
  return parsed.map((entry, index) => parseVolume(entry, index));
}

/**
 * Lists the mounted btrfs filesystems and their subvolume trees from the Root Helper.
 *
 * @throws {HelperUnavailableError} If the helper is unreachable or returns an invalid document.
 */
export async function listBtrfsVolumes(): Promise<BtrfsVolume[]> {
  const raw: unknown = await withHelper((helper) =>
    helper.ListBtrfsVolumes() as Promise<string>
  );
  return parseBtrfsVolumes(raw);
}
