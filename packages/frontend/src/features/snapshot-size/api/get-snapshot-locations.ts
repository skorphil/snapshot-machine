import type { SnapshotLocation } from "@snapshot-machine/shared/types.ts";
import { getBindings } from "@/shared/bindings.ts";

/** Lists the snapshot directories declared in the GUI-managed btrbk configuration. */
export function listSnapshotLocations(): Promise<SnapshotLocation[]> {
  return getBindings().listSnapshotLocations();
}
