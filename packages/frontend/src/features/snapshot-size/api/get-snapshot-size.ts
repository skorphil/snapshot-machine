import type { SnapshotSize } from "@snapshot-machine/shared/types.ts";
import { getBindings } from "@/shared/bindings.ts";

/** Calculates the exclusive and total size of an absolute mount path through the Root Helper. */
export function getSnapshotSize(path: string): Promise<SnapshotSize> {
  return getBindings().getSnapshotSize(path);
}
