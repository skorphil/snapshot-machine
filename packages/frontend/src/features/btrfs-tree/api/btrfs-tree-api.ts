import type { BtrfsVolume } from "@snapshot-machine/shared/types.ts";
import { getBindings } from "@/shared/bindings.ts";

/** Lists the mounted btrfs filesystems and their subvolume trees. */
export function listBtrfsVolumes(): Promise<BtrfsVolume[]> {
  return getBindings().listBtrfsVolumes();
}
