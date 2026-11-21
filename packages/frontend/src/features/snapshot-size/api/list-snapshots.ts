import type { SnapshotEntry } from "@snapshot-machine/shared/types.ts";
import { getBindings } from "@/shared/bindings.ts";

/** Lists the snapshots stored in one snapshot location, newest first. Sizes are not calculated. */
export function listSnapshots(path: string): Promise<SnapshotEntry[]> {
  return getBindings().listSnapshots(path);
}
