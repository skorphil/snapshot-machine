import type { DependencyReport } from "@snapshot-machine/shared/types.ts";
import { getBindings } from "@/shared/bindings.ts";

/** Asks the backend whether the required btrbk and btrfs binaries are available. */
export function getDependencyStatus(): Promise<DependencyReport> {
  return getBindings().getDependencyStatus();
}
